// ============================================================
//  Esse Jeffe — PayTR ödeme bildirimi (callback) işleyicisi
//  PayTR sunucusu ödeme sonucunu buraya POST eder (sunucu→sunucu).
//
//  GÜVENLİK: İstek gerçekten PayTR'den mi? merchant_oid + salt +
//  status + total_amount üzerinden HMAC-SHA256 imza doğrulanır.
//  Doğrulanmadan SİPARİŞ GÜNCELLENMEZ. İşlem bitince düz metin
//  "OK" dönülür; dönülmezse PayTR bildirimi tekrar tekrar gönderir.
//
//  Bu fonksiyon PayTR panelinde "Bildirim URL" olarak tanımlanır:
//    https://<proje-ref>.supabase.co/functions/v1/paytr-callback
//  verify_jwt = false (PayTR JWT göndermez; kimlik doğrulama hash ile).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderEmails } from "../_shared/order-email.ts";
import { createLogger, errMsg } from "../_shared/log.ts";
import { markCartRecovered, releaseDiscountByOrder } from "../_shared/discount.ts";
import { accrueLoyalty } from "../_shared/loyalty.ts";

async function hmacB64(message: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

const ok = () => new Response("OK", { status: 200 });
const fail = (msg: string) =>
  new Response("PAYTR notification failed: " + msg, { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST bekleniyor", { status: 405 });
  const log = createLogger("paytr-callback", req);

  const MKEY = Deno.env.get("PAYTR_MERCHANT_KEY");
  const MSALT = Deno.env.get("PAYTR_MERCHANT_SALT");
  if (!MKEY || !MSALT) {
    log.error("missing_secrets");
    return fail("merchant anahtarları tanımlı değil");
  }

  // PayTR application/x-www-form-urlencoded gönderir
  const form = await req.formData();
  const merchantOid = String(form.get("merchant_oid") || "");
  const status = String(form.get("status") || "");
  const totalAmount = String(form.get("total_amount") || "");
  const postedHash = String(form.get("hash") || "");
  const paymentType = String(form.get("payment_type") || "");
  const failReason = String(form.get("failed_reason_msg") || "");

  if (!merchantOid || !postedHash) return fail("eksik alan");

  // --- imza doğrulama ---
  const calcHash = await hmacB64(merchantOid + MSALT + status + totalAmount, MKEY);
  if (calcHash !== postedHash) {
    // sahte/oynanmış bildirim girişimi — izlemeye değer
    log.warn("bad_hash", { order_no: merchantOid });
    return fail("bad hash");
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // siparişi bul (onay e-postası için tüm alanları çek)
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, order_no, user_id, payment_status, payment_method, full_name, phone, email, city, district, address, postal_code, note, subtotal, discount, discount_code, shipping_fee, total",
    )
    .eq("order_no", merchantOid)
    .maybeSingle();
  if (error) {
    log.error("order_read_error", { order_no: merchantOid, detail: error.message });
    return fail("db: " + error.message);
  }
  if (!order) {
    log.error("order_not_found", { order_no: merchantOid });
    return fail("sipariş bulunamadı: " + merchantOid);
  }

  // idempotent: zaten işlenmişse tekrar dokunma (mail de tekrar gitmesin)
  if (order.payment_status === "paid") return ok();

  if (status === "success") {
    log.info("payment_confirmed", { order_no: merchantOid, payment_type: paymentType });
    await admin
      .from("orders")
      .update({
        payment_status: "paid",
        status: "preparing",
        paid_at: new Date().toISOString(),
        payment_ref: paymentType || null,
      })
      .eq("id", order.id);

    // Terk edilmiş sepet varsa "kurtarıldı" işaretle (hatırlatma gitmesin) — fail-soft.
    await markCartRecovered(admin, { userId: order.user_id, email: order.email });

    // Sadakat birikimi (+%5 kupon) — fail-soft, OK yanıtını asla engellemez.
    // İdempotency: yukarıdaki payment_status==='paid' erken dönüşü + RPC'nin
    // orders.loyalty_accrued_at damgası (PayTR bildirimi tekrarlarsa ikisi de tutar).
    await accrueLoyalty(admin, order.id, log);

    // --- ödeme onaylandı → onay e-postası (fail-soft, callback'i bozmaz) ---
    const { data: its } = await admin
      .from("order_items")
      .select("product_name, model_desc, color, size, unit_price, qty")
      .eq("order_id", order.id);
    await sendOrderEmails({
      order_no: order.order_no,
      payment_method: order.payment_method,
      full_name: order.full_name,
      phone: order.phone,
      email: order.email,
      city: order.city,
      district: order.district,
      address: order.address,
      postal_code: order.postal_code,
      note: order.note,
      subtotal: order.subtotal,
      discount: order.discount || 0,
      discount_code: order.discount_code || null,
      shipping_fee: order.shipping_fee,
      total: order.total,
      items: its || [],
    }, log).catch((e) => log.error("mail_error", { order_no: merchantOid, detail: errMsg(e) }));
  } else {
    log.info("payment_failed", { order_no: merchantOid, reason: failReason || null });
    await admin
      .from("orders")
      .update({ payment_status: "failed", payment_ref: failReason || null })
      .eq("id", order.id);

    // Ödeme başarısız/iptal → paytr-token'da ayrılan stoğu geri ver.
    // Yalnızca ilk geçişte (pending → failed) iade et; PayTR aynı bildirimi
    // tekrar gönderirse status artık 'failed' olur, buraya girilmez (çift iade yok).
    if (order.payment_status === "pending") {
      // paytr-token'da claim edilen indirim kodunu da geri aç (varsa).
      // RPC her iki kod türünü (single/campaign) tanır ve idempotenttir.
      if (order.discount_code) {
        await releaseDiscountByOrder(admin, order.id);
      }
      const { data: its } = await admin
        .from("order_items")
        .select("product_id, color, size, qty")
        .eq("order_id", order.id);
      const restore = (its || [])
        .filter((r: any) => r.product_id)
        .map((r: any) => ({
          product_id: r.product_id,
          color: r.color || "",
          size: r.size || "",
          qty: r.qty,
        }));
      if (restore.length) {
        const { error: rErr } = await admin.rpc("restore_stock_bulk", { p_items: restore });
        if (rErr) log.error("stock_restore_error", { order_no: merchantOid, detail: rErr.message });
      }
    }
  }

  return ok(); // PayTR'ye "aldım" — yoksa tekrar gönderir
});
