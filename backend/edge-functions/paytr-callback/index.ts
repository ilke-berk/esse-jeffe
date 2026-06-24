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

  const MKEY = Deno.env.get("PAYTR_MERCHANT_KEY");
  const MSALT = Deno.env.get("PAYTR_MERCHANT_SALT");
  if (!MKEY || !MSALT) return fail("merchant anahtarları tanımlı değil");

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
  if (calcHash !== postedHash) return fail("bad hash");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // siparişi bul
  const { data: order, error } = await admin
    .from("orders")
    .select("id, payment_status")
    .eq("order_no", merchantOid)
    .maybeSingle();
  if (error) return fail("db: " + error.message);
  if (!order) return fail("sipariş bulunamadı: " + merchantOid);

  // idempotent: zaten işlenmişse tekrar dokunma
  if (order.payment_status === "paid") return ok();

  if (status === "success") {
    await admin
      .from("orders")
      .update({
        payment_status: "paid",
        status: "preparing",
        paid_at: new Date().toISOString(),
        payment_ref: paymentType || null,
      })
      .eq("id", order.id);
  } else {
    await admin
      .from("orders")
      .update({ payment_status: "failed", payment_ref: failReason || null })
      .eq("id", order.id);
  }

  return ok(); // PayTR'ye "aldım" — yoksa tekrar gönderir
});
