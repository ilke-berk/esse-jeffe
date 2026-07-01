// ============================================================
//  Esse Jeffe — Kapıda ödeme / havale sipariş oluşturucu (Edge Function)
//  Akış: sepet.html → bu fonksiyon → orders + order_items (service_role)
//
//  GÜVENLİK: Tutar ASLA client'tan alınmaz. Fonksiyon sepetteki
//  slug'lara göre fiyatları DB'den (service_role) okuyup toplamı
//  kendisi hesaplar — aynen paytr-token gibi. Böylece konsoldan
//  sepet fiyatını "1 TL" yapıp COD/havale siparişi geçmek imkânsız.
//
//  RLS: orders/order_items'a doğrudan client insert'i kapalıdır
//  (schema.sql). Bu fonksiyon service_role ile yazar, RLS'i baypas eder.
//
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından gelir.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderEmails } from "../_shared/order-email.ts";

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

function orderNo(): string {
  const d = new Date();
  const ymd =
    String(d.getUTCFullYear()).slice(2) +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 1e5).toString().padStart(5, "0");
  return "EJ" + ymd + rnd;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }
  const form = payload?.form ?? {};
  const items = Array.isArray(payload?.items) ? payload.items : [];

  // --- temel doğrulama ---
  if (!items.length) return json({ error: "Sepet boş" }, 400);
  for (const f of ["full_name", "phone", "city", "district", "address"]) {
    if (!String(form[f] || "").trim()) return json({ error: "Eksik teslimat bilgisi: " + f }, 400);
  }

  // Bu fonksiyon yalnızca kapıda ödeme (cod) ve havale/EFT (transfer) içindir.
  // Kart ödemesi paytr-token üzerinden gider.
  const method = String(form.payment_method || "").trim();
  if (method !== "cod" && method !== "transfer") {
    return json({ error: "Geçersiz ödeme yöntemi." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- girişli kullanıcıyı (varsa) çöz → sipariş hesapta görünsün ---
  let userId: string | null = null;
  const authz = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (authz) {
    const { data } = await admin.auth.getUser(authz);
    if (data?.user) userId = data.user.id;
  }

  // --- fiyatları DB'den oku (GÜVENLİK: client fiyatına güvenme) ---
  const slugs = [...new Set(items.map((it: any) => String(it.id || "")))].filter(Boolean);
  if (!slugs.length) return json({ error: "Geçersiz sepet." }, 400);
  const { data: products, error: pErr } = await admin
    .from("products")
    .select("id, slug, name, price, model_desc")
    .in("slug", slugs)
    .eq("active", true);
  if (pErr) return json({ error: "Ürünler okunamadı: " + pErr.message }, 500);
  const bySlug = new Map((products || []).map((p: any) => [p.slug, p]));

  let subtotal = 0;
  const orderItems: any[] = [];
  for (const it of items) {
    const p: any = bySlug.get(String(it.id));
    if (!p) return json({ error: "Geçersiz veya pasif ürün: " + (it.name || it.id) }, 400);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    subtotal += p.price * qty;
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

  // --- stok ayır (GÜVENLİK: aşırı satışı önle) ---
  // Atomik RPC: tüm sepet için stoğu tek işlemde düşer; biri bile yetmezse
  // hiçbirini düşmez ve ok:false döner. Takip edilmeyen (track=false) varyantlar
  // sınırsız kabul edilir, engellenmez.
  const reserveItems = orderItems.map((r) => ({
    product_id: r.product_id,
    color: r.color || "",
    size: r.size || "",
    qty: r.qty,
  }));
  const { data: reserve, error: rErr } = await admin.rpc("reserve_stock_bulk", {
    p_items: reserveItems,
  });
  if (rErr) return json({ error: "Stok kontrol edilemedi: " + rErr.message }, 500);
  if (reserve && reserve.ok === false) {
    return json(
      { error: "Üzgünüz, seçtiğiniz üründen yeterli stok kalmadı.", out_of_stock: reserve },
      409,
    );
  }

  // Buradan sonra herhangi bir hata olursa ayrılan stoğu iade et.
  const restoreStock = () =>
    admin.rpc("restore_stock_bulk", { p_items: reserveItems })
      .then(({ error }) => { if (error) console.error("[create-order] stok iadesi:", error.message); })
      .catch((e) => console.error("[create-order] stok iadesi:", (e as Error).message));

  // --- siparişi oluştur ---
  const oid = orderNo();
  const { data: orderRow, error: oErr } = await admin
    .from("orders")
    .insert({
      order_no: oid,
      status: "pending",
      user_id: userId,
      payment_method: method,
      payment_status: method === "cod" ? "cod" : "pending",
      subtotal,
      shipping_fee: shipping,
      total,
      full_name: form.full_name,
      phone: form.phone,
      email: String(form.email || "").trim() || null,
      city: form.city,
      district: form.district,
      address: form.address,
      postal_code: form.postal_code || null,
      note: form.note || null,
    })
    .select("id")
    .single();
  if (oErr) {
    await restoreStock(); // sipariş açılamadı → ayrılan stoğu geri ver
    return json({ error: "Sipariş oluşturulamadı: " + oErr.message }, 500);
  }

  const rows = orderItems.map((r) => ({ ...r, order_id: orderRow.id }));
  const { error: iErr } = await admin.from("order_items").insert(rows);
  if (iErr) {
    // kalemler yazılamadıysa yarım siparişi ve ayrılan stoğu geri al
    await admin.from("orders").delete().eq("id", orderRow.id);
    await restoreStock();
    return json({ error: "Sipariş kalemleri kaydedilemedi: " + iErr.message }, 500);
  }

  // --- onay e-postası (müşteri + işletme) — fail-soft, siparişi bozmaz ---
  await sendOrderEmails({
    order_no: oid,
    payment_method: method,
    full_name: form.full_name,
    phone: form.phone,
    email: String(form.email || "").trim() || null,
    city: form.city,
    district: form.district,
    address: form.address,
    postal_code: form.postal_code || null,
    note: form.note || null,
    subtotal,
    shipping_fee: shipping,
    total,
    items: orderItems.map((r) => ({
      product_name: r.product_name,
      model_desc: r.model_desc,
      color: r.color,
      size: r.size,
      unit_price: r.unit_price,
      qty: r.qty,
    })),
  }).catch((e) => console.error("[create-order] mail:", (e as Error).message));

  return json({ order_no: oid, total });
});
