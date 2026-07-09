// ============================================================
//  Esse Jeffe — PayTR iFrame token üreteci (Supabase Edge Function)
//  Akış: sepet.html → bu fonksiyon → PayTR get-token → { token }
//
//  GÜVENLİK: Tutar ASLA client'tan alınmaz. Fonksiyon sepetteki
//  slug'lara göre fiyatları DB'den (service_role) okuyup toplamı
//  kendisi hesaplar; merchant_key/salt yalnızca burada (secret) bulunur.
//
//  Gerekli secret'lar (Supabase → Edge Functions → Secrets):
//    PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT
//    PAYTR_TEST_MODE   (opsiyonel, '1' = test, '0' = canlı; varsayılan '1')
//    PAYTR_ALLOWED_ORIGINS (opsiyonel, ok/fail yönlendirmesi için izinli origin
//                           listesi, virgülle. Yoksa SITE_URL, o da yoksa prod alan adı.)
//    SITE_URL          (opsiyonel, ok/fail yönlendirme tabanı / tek izinli origin)
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından otomatik gelir.
//
//  NOT: ok/fail yönlendirme origin'i client'tan (body.origin) gelir ama YALNIZCA
//  allowlist'teyse kullanılır; değilse ilk izinli origin'e sabitlenir. Böylece
//  kötü niyetli bir client kullanıcıyı başka bir siteye yönlendiremez.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger, errMsg } from "../_shared/log.ts";
import { checkRateLimit, recordRateLimit } from "../_shared/rate-limit.ts";
import { canonVariant, clientIp, makeOrderNo, parseOriginList, resolveOrigin } from "../_shared/util.ts";
import { corsHeaders } from "../_shared/cors.ts";

// ok/fail yönlendirmesi için izinli origin'ler (client kontrolüne bırakılmaz)
const ALLOWED_ORIGINS = parseOriginList(
  Deno.env.get("PAYTR_ALLOWED_ORIGINS") ||
    Deno.env.get("SITE_URL") ||
    "https://essejeffe.com,https://www.essejeffe.com",
);

// IP başına sipariş/ödeme başlatma sınırı (create-order ile ORTAK 'order' sayacı).
const ORDER_RATE = { table: "fn_rate_limit", kind: "order", max: 10, windowMin: 60 };

// UTF-8 güvenli base64 (Türkçe karakterli sepet için)
function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64str(s: string): string {
  return b64(new TextEncoder().encode(s));
}

// PayTR imzası: base64( HMAC-SHA256( message, key ) )
async function hmacB64(message: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return b64(new Uint8Array(sig));
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const log = createLogger("paytr-token", req);

  // --- PayTR anahtarları (yoksa sipariş bile oluşturma) ---
  const MID = Deno.env.get("PAYTR_MERCHANT_ID");
  const MKEY = Deno.env.get("PAYTR_MERCHANT_KEY");
  const MSALT = Deno.env.get("PAYTR_MERCHANT_SALT");
  if (!MID || !MKEY || !MSALT) {
    return json(
      { error: "PayTR henüz etkin değil: merchant anahtarları (secret) tanımlı değil." },
      503,
    );
  }
  const TEST_MODE = Deno.env.get("PAYTR_TEST_MODE") ?? "1";

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }
  const form = payload?.form ?? {};
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const origin = resolveOrigin(payload?.origin, ALLOWED_ORIGINS);

  // --- temel doğrulama ---
  if (!items.length) return json({ error: "Sepet boş" }, 400);
  for (const f of ["full_name", "phone", "city", "district", "address"]) {
    if (!String(form[f] || "").trim()) return json({ error: "Eksik teslimat bilgisi: " + f }, 400);
  }
  const email = String(form.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Kart ödemesi için geçerli bir e-posta gerekli." }, 400);
  }
  if (!origin) return json({ error: "İzinli origin tanımlı değil (PAYTR_ALLOWED_ORIGINS/SITE_URL)." }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- IP başına hız sınırı (sipariş spam'i / ödeme başlatma istismarı) ---
  const ip = clientIp(req);
  const rl = await checkRateLimit(admin, { ...ORDER_RATE, ip });
  if (rl.error) {
    log.error("rate_limit_db_error", { ip, detail: rl.error });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!rl.allowed) {
    log.warn("rate_limited", { ip, count: rl.count });
    return json({ error: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
  }

  // --- girişli kullanıcıyı (varsa) çöz ---
  let userId: string | null = null;
  const authz = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (authz) {
    const { data } = await admin.auth.getUser(authz);
    if (data?.user) userId = data.user.id;
  }

  // --- fiyatları DB'den oku (GÜVENLİK: client fiyatına güvenme) ---
  const slugs = [...new Set(items.map((it: any) => String(it.id || "")))].filter(Boolean);
  const { data: products, error: pErr } = await admin
    .from("products")
    .select("id, slug, name, price, model_desc, sizes, product_colors(name)")
    .in("slug", slugs)
    .eq("active", true);
  if (pErr) {
    log.error("products_read_error", { ip, detail: pErr.message });
    return json({ error: "Ürünler okunamadı. Lütfen tekrar deneyin." }, 500);
  }
  const bySlug = new Map((products || []).map((p: any) => [p.slug, p]));

  let subtotal = 0;
  const basket: [string, string, number][] = [];
  const orderItems: any[] = [];
  for (const it of items) {
    const p: any = bySlug.get(String(it.id));
    if (!p) return json({ error: "Geçersiz veya pasif ürün: " + (it.name || it.id) }, 400);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    // Renk/bedeni ürünün gerçek listesine sabitle: uydurma varyant ("M ", "m")
    // reserve_stock_bulk'ta satır bulamayıp "takipsiz → sınırsız" sayılırdı.
    const color = canonVariant(it.color, (p.product_colors || []).map((c: any) => c.name));
    const size = canonVariant(it.size, p.sizes);
    if (color === null) return json({ error: "Geçersiz renk seçimi: " + p.name }, 400);
    if (size === null) return json({ error: "Geçersiz beden seçimi: " + p.name }, 400);
    // GÜVENLİK — ürünün beden listesi varsa boş beden reddet (aşırı satış koruması).
    if (size === "" && Array.isArray(p.sizes) && p.sizes.length)
      return json({ error: "Beden seçimi zorunlu: " + p.name }, 400);
    const line = p.price * qty;
    subtotal += line;
    basket.push([p.name, Number(p.price).toFixed(2), qty]);
    orderItems.push({
      product_id: p.id,
      product_name: p.name,
      model_desc: p.model_desc || null,
      color: color || null,
      size: size || null,
      unit_price: p.price,
      qty,
    });
  }
  const shipping = 0;
  const total = subtotal + shipping; // TL (tam sayı)
  const paymentAmount = Math.round(total * 100); // PayTR: kuruş

  // --- stok ayır (GÜVENLİK: aşırı satışı önle) ---
  // Kart siparişinde stok, ödeme başlarken (pending) ayrılır; ödeme
  // başarısız/iptal olursa paytr-callback stoğu geri ekler. Aşağıda token
  // alınamazsa da hemen iade edilir.
  const reserveItems = orderItems.map((r) => ({
    product_id: r.product_id,
    color: r.color || "",
    size: r.size || "",
    qty: r.qty,
  }));
  const restoreStock = () =>
    admin.rpc("restore_stock_bulk", { p_items: reserveItems })
      .then(({ error }) => { if (error) log.error("stock_restore_error", { detail: error.message }); })
      .catch((e) => log.error("stock_restore_error", { detail: errMsg(e) }));

  const { data: reserve, error: rErr } = await admin.rpc("reserve_stock_bulk", {
    p_items: reserveItems,
  });
  if (rErr) {
    log.error("stock_check_error", { ip, detail: rErr.message });
    return json({ error: "Stok kontrol edilemedi. Lütfen tekrar deneyin." }, 500);
  }
  if (reserve && reserve.ok === false) {
    log.warn("out_of_stock", { ip, variant: reserve });
    return json(
      { error: "Üzgünüz, seçtiğiniz üründen yeterli stok kalmadı.", out_of_stock: reserve },
      409,
    );
  }

  // --- siparişi oluştur (pending) ---
  // NOT: makeOrderNo 11 haneli üretir (EJ+YYAAGG+5) — create-order ve
  // schema.sql ile AYNI biçim. Eski yerel üreteç 12 haneliydi; bu yüzden
  // kart siparişleri track-order'ın biçim kontrolüne takılıyordu.
  const oid = makeOrderNo();
  const { data: orderRow, error: oErr } = await admin.from("orders").insert({
    order_no: oid,
    status: "pending",
    user_id: userId,
    payment_method: "card",
    payment_status: "pending",
    subtotal,
    shipping_fee: shipping,
    total,
    full_name: form.full_name,
    phone: form.phone,
    email,
    city: form.city,
    district: form.district,
    address: form.address,
    postal_code: form.postal_code || null,
    note: form.note || null,
  }).select("id").single();
  if (oErr || !orderRow?.id) {
    log.error("order_insert_error", { ip, order_no: oid, detail: oErr?.message || "no_row" });
    await restoreStock();
    return json({ error: "Sipariş oluşturulamadı. Lütfen tekrar deneyin." }, 500);
  }

  // Kalemler yazılamazsa devam ETME: müşteri kalemsiz sipariş için ödeme
  // yapardı ve başarısız ödemede paytr-callback iade edecek kalem bulamayıp
  // ayrılan stok kalıcı kaybolurdu. create-order ile aynı rollback deseni.
  const rows = orderItems.map((r) => ({ ...r, order_id: orderRow.id }));
  const { error: iErr } = await admin.from("order_items").insert(rows);
  if (iErr) {
    log.error("order_items_insert_error", { ip, order_no: oid, detail: iErr.message });
    await admin.from("orders").delete().eq("id", orderRow.id);
    await restoreStock();
    return json({ error: "Sipariş kaydedilemedi. Lütfen tekrar deneyin." }, 500);
  }

  // sipariş açıldı → hız sınırı sayacına ekle (create-order ile ortak kota)
  await recordRateLimit(admin, ORDER_RATE.table, ip, ORDER_RATE.kind);

  // --- PayTR token ---
  const userIp =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "127.0.0.1";
  const userBasket = b64str(JSON.stringify(basket));
  const noInstallment = "0";
  const maxInstallment = "0";
  const currency = "TL";

  const hashStr =
    MID + userIp + oid + email + paymentAmount + userBasket +
    noInstallment + maxInstallment + currency + TEST_MODE;
  const paytrToken = await hmacB64(hashStr + MSALT, MKEY);

  const body = new URLSearchParams({
    merchant_id: MID,
    user_ip: userIp,
    merchant_oid: oid,
    email,
    payment_amount: String(paymentAmount),
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: TEST_MODE === "1" ? "1" : "0",
    no_installment: noInstallment,
    max_installment: maxInstallment,
    user_name: String(form.full_name),
    user_address: String(form.address),
    user_phone: String(form.phone),
    merchant_ok_url: `${origin}/sepet.html?paytr=ok&no=${oid}`,
    merchant_fail_url: `${origin}/sepet.html?paytr=fail&no=${oid}`,
    timeout_limit: "30",
    currency,
    test_mode: TEST_MODE,
    lang: "tr",
  });

  let ptr: any;
  try {
    const res = await fetch("https://www.paytr.com/odeme/api/get-token", {
      method: "POST",
      body,
    });
    ptr = await res.json();
  } catch (e) {
    log.error("paytr_unreachable", { ip, order_no: oid, detail: errMsg(e) });
    await admin.from("orders").update({ payment_status: "failed" }).eq("order_no", oid);
    await restoreStock(); // ödeme başlatılamadı → stoğu geri ver
    return json({ error: "Ödeme sağlayıcısına ulaşılamadı. Lütfen tekrar deneyin." }, 502);
  }
  if (ptr?.status !== "success") {
    log.error("paytr_token_error", { ip, order_no: oid, detail: String(ptr?.reason || "bilinmiyor") });
    await admin.from("orders").update({ payment_status: "failed" }).eq("order_no", oid);
    await restoreStock(); // ödeme başlatılamadı → stoğu geri ver
    return json({ error: "Ödeme başlatılamadı. Lütfen tekrar deneyin veya farklı bir ödeme yöntemi seçin." }, 400);
  }

  log.info("payment_started", { ip, order_no: oid, total, item_count: orderItems.length });
  return json({ token: ptr.token, order_no: oid, total });
});
