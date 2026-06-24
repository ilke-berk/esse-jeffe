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
//    SITE_URL          (opsiyonel, ok/fail yönlendirme tabanı; body.origin önceliklidir)
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından otomatik gelir.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

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

function orderNo(): string {
  const d = new Date();
  const ymd =
    String(d.getUTCFullYear()).slice(2) +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  return "EJ" + ymd + rnd; // yalnız harf+rakam → PayTR merchant_oid kuralına uygun
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);

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
  const origin = (payload?.origin || Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");

  // --- temel doğrulama ---
  if (!items.length) return json({ error: "Sepet boş" }, 400);
  for (const f of ["full_name", "phone", "city", "district", "address"]) {
    if (!String(form[f] || "").trim()) return json({ error: "Eksik teslimat bilgisi: " + f }, 400);
  }
  const email = String(form.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Kart ödemesi için geçerli bir e-posta gerekli." }, 400);
  }
  if (!origin) return json({ error: "origin eksik (ok/fail yönlendirmesi kurulamıyor)." }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
    .select("id, slug, name, price, model_desc")
    .in("slug", slugs)
    .eq("active", true);
  if (pErr) return json({ error: "Ürünler okunamadı: " + pErr.message }, 500);
  const bySlug = new Map((products || []).map((p: any) => [p.slug, p]));

  let subtotal = 0;
  const basket: [string, string, number][] = [];
  const orderItems: any[] = [];
  for (const it of items) {
    const p: any = bySlug.get(String(it.id));
    if (!p) return json({ error: "Geçersiz veya pasif ürün: " + (it.name || it.id) }, 400);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const line = p.price * qty;
    subtotal += line;
    basket.push([p.name, Number(p.price).toFixed(2), qty]);
    orderItems.push({
      product_id: p.id,
      product_name: p.name,
      model_desc: p.model_desc || null,
      color: it.color || null,
      size: it.size || null,
      unit_price: p.price,
      qty,
    });
  }
  const shipping = 0;
  const total = subtotal + shipping; // TL (tam sayı)
  const paymentAmount = Math.round(total * 100); // PayTR: kuruş

  // --- siparişi oluştur (pending) ---
  const oid = orderNo();
  const { error: oErr } = await admin.from("orders").insert({
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
  });
  if (oErr) return json({ error: "Sipariş oluşturulamadı: " + oErr.message }, 500);

  const { data: orderRow } = await admin.from("orders").select("id").eq("order_no", oid).single();
  if (orderRow?.id) {
    const rows = orderItems.map((r) => ({ ...r, order_id: orderRow.id }));
    await admin.from("order_items").insert(rows);
  }

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
    return json({ error: "PayTR'ye ulaşılamadı: " + (e as Error).message }, 502);
  }
  if (ptr?.status !== "success") {
    await admin.from("orders").update({ payment_status: "failed" }).eq("order_no", oid);
    return json({ error: "PayTR token hatası: " + (ptr?.reason || "bilinmiyor") }, 400);
  }

  return json({ token: ptr.token, order_no: oid, total });
});
