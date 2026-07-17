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
import { createLogger, errMsg } from "../_shared/log.ts";
import { checkRateLimit, recordRateLimit } from "../_shared/rate-limit.ts";
import { assessCodRisk, CODRISK_HOLD_MIN } from "../_shared/cod-risk.ts";
import { canonVariant, clientIp, makeOrderNo } from "../_shared/util.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  type ClaimRef,
  claimDiscount,
  markCartRecovered,
  normCode,
  releaseDiscount,
  setDiscountOrder,
} from "../_shared/discount.ts";

// IP başına sipariş oluşturma sınırı (paytr-token ile ORTAK 'order' sayacı).
// Dürüst müşteri için bol; bot'un sahte COD siparişi yağdırmasını keser.
const ORDER_RATE = { table: "fn_rate_limit", kind: "order", max: 10, windowMin: 60 };

// Standart kargo ücreti (TL). Kargo bedava kuponu bunu sıfırlar.
const SHIPPING_FEE = 0;

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const log = createLogger("create-order", req);

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

  // --- IP başına hız sınırı (sipariş spam'i / sahte COD savunması) ---
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
    .select("id, slug, name, price, model_desc, sizes, product_colors(name)")
    .in("slug", slugs)
    .eq("active", true);
  if (pErr) {
    log.error("products_read_error", { ip, detail: pErr.message });
    return json({ error: "Ürünler okunamadı. Lütfen tekrar deneyin." }, 500);
  }
  const bySlug = new Map((products || []).map((p: any) => [p.slug, p]));

  let subtotal = 0;
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
    // GÜVENLİK — ürünün beden listesi varsa boş beden reddet. Aksi hâlde
    // size="" satırı reserve_stock_bulk'ta bulunamayıp "takipsiz → sınırsız"
    // sayılır ve beden bazlı stok limiti atlanarak aşırı satış olurdu.
    if (size === "" && Array.isArray(p.sizes) && p.sizes.length)
      return json({ error: "Beden seçimi zorunlu: " + p.name }, 400);
    subtotal += p.price * qty;
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

  // Buradan sonra herhangi bir hata olursa ayrılan stoğu iade et.
  const restoreStock = () =>
    admin.rpc("restore_stock_bulk", { p_items: reserveItems })
      .then(({ error }) => { if (error) log.error("stock_restore_error", { detail: error.message }); })
      .catch((e) => log.error("stock_restore_error", { detail: errMsg(e) }));

  // --- indirim kodu (varsa): ATOMİK claim — GÜVENLİK: tutar sunucuda ---
  // Kod, stok ayrıldıktan SONRA claim edilir; buradan sonraki her hata
  // yolunda releaseDiscount ile geri açılır (restoreStock'un kupon eşi).
  const customerEmail = String(form.email || "").trim().toLowerCase() || null;
  let discount = 0;
  let discountRef: ClaimRef | null = null;
  let discountCode: string | null = null;
  let freeShipping = false;
  const couponInput = normCode(form.coupon);
  if (couponInput) {
    const c = await claimDiscount(admin, couponInput, customerEmail, subtotal);
    if (!c.ok) {
      await restoreStock();
      log.warn("coupon_rejected", { ip });
      return json({ error: c.error }, 400);
    }
    discount = c.discount;
    discountRef = { id: c.id, kind: c.kind, redemptionId: c.redemptionId };
    discountCode = couponInput;
    freeShipping = c.freeShipping;
  }
  const releaseCoupon = () => (discountRef ? releaseDiscount(admin, discountRef) : Promise.resolve());
  const shipping = freeShipping ? 0 : SHIPPING_FEE;
  const total = subtotal - discount + shipping; // TL (tam sayı)

  // --- COD risk skorlama (fail-soft: hata siparişi ASLA engellemez) ---
  // CODRISK_HOLD=0 secret'ı bekletmeyi kapatır (skor yine yazılır).
  let risk: Awaited<ReturnType<typeof assessCodRisk>> = null;
  if (method === "cod") {
    risk = await assessCodRisk(admin, { phone: form.phone });
    if (!risk) log.warn("codrisk_unavailable", { ip });
  }
  const holdEnabled = Deno.env.get("CODRISK_HOLD") !== "0";
  const riskHold = holdEnabled && !!risk && risk.score >= CODRISK_HOLD_MIN;

  // --- siparişi oluştur ---
  const oid = makeOrderNo();
  const { data: orderRow, error: oErr } = await admin
    .from("orders")
    .insert({
      order_no: oid,
      status: "pending",
      user_id: userId,
      payment_method: method,
      payment_status: method === "cod" ? "cod" : "pending",
      subtotal,
      discount,
      discount_code: discountCode,
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
      risk_score: risk?.score ?? null,
      risk_level: risk?.level ?? null,
      risk_reasons: risk?.reasons ?? null,
      risk_hold: riskHold,
    })
    .select("id")
    .single();
  if (oErr) {
    log.error("order_insert_error", { ip, order_no: oid, detail: oErr.message });
    await restoreStock(); // sipariş açılamadı → ayrılan stoğu geri ver
    await releaseCoupon(); // kupon da yeniden kullanılabilir olsun
    return json({ error: "Sipariş oluşturulamadı. Lütfen tekrar deneyin." }, 500);
  }

  const rows = orderItems.map((r) => ({ ...r, order_id: orderRow.id }));
  const { error: iErr } = await admin.from("order_items").insert(rows);
  if (iErr) {
    log.error("order_items_insert_error", { ip, order_no: oid, detail: iErr.message });
    // kalemler yazılamadıysa yarım siparişi ve ayrılan stoğu geri al
    await admin.from("orders").delete().eq("id", orderRow.id);
    await restoreStock();
    await releaseCoupon();
    return json({ error: "Sipariş kaydedilemedi. Lütfen tekrar deneyin." }, 500);
  }
  if (discountRef) await setDiscountOrder(admin, discountRef, orderRow.id);

  // Terk edilmiş sepet varsa "kurtarıldı" işaretle (hatırlatma gitmesin) — fail-soft.
  await markCartRecovered(admin, { userId, email: customerEmail });

  // başarı → hız sınırı sayacına ekle (yalnız gerçekten açılan siparişler sayılır)
  await recordRateLimit(admin, ORDER_RATE.table, ip, ORDER_RATE.kind);

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
    discount,
    discount_code: discountCode,
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
  }, log).catch((e) => log.error("mail_error", { order_no: oid, detail: errMsg(e) }));

  log.info("order_created", {
    ip,
    order_no: oid,
    method,
    total,
    item_count: orderItems.length,
    risk_level: risk?.level ?? null,
    risk_hold: riskHold,
  });
  return json({ order_no: oid, total });
});
