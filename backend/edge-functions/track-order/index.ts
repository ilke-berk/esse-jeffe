// ============================================================
//  Esse Jeffe — Misafir sipariş takibi (Edge Function)
//  Akış: siparis-takip.html → bu fonksiyon → orders + order_items
//
//  NEDEN: Sipariş oluşturma RLS ile client'a kapalı; üye olmayan
//  misafir, sipariş verdikten sonra durumunu geri okuyamıyor
//  ("kendi siparişlerim" politikası auth.uid()'e bağlı). Bu fonksiyon
//  service_role ile okur (RLS baypas) ve YALNIZCA order_no + telefon
//  İKİSİ de eşleşirse sipariş özetini döner.
//
//  GÜVENLİK:
//   - order_no (benzersiz) ile tek satır çekilir; telefon rakamları
//     normalize edilip son 10 hane karşılaştırılır. Biri tutmazsa
//     "bulunamadı" döner (hangisinin yanlış olduğunu sızdırmaz).
//   - IP başına hız sınırı (order_track_rate_limit): kaba kuvvet ve
//     order_no numarası tahmini (enumeration) denemelerini yavaşlatır.
//     Başarılı/başarısız her deneme sayılır.
//   - Yanıt yalnız durum için gereken alanları içerir; tam adres,
//     e-posta, telefon geri dönmez (gizlilik).
//
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından gelir.
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

// IP başına, pencere (dakika) içinde izin verilen sorgu sayısı
const RATE = { max: 15, windowMin: 10 };

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

// telefonu yalnız rakamlara indir, son 10 haneyi al (0/+90 farkını yok say)
function normPhone(v: unknown): string {
  const digits = String(v ?? "").replace(/\D+/g, "");
  return digits.slice(-10);
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

  const orderNo = String(payload?.order_no ?? "").trim().toUpperCase();
  const phone = normPhone(payload?.phone);

  if (!orderNo) return json({ error: "Sipariş numarası gerekli." }, 400);
  if (phone.length < 10) return json({ error: "Geçerli bir telefon numarası girin." }, 400);
  // order_no formatı: EJ + 11 rakam (ör. EJ26070112345). Erken eleme.
  if (!/^EJ\d{11}$/.test(orderNo)) {
    return json({ error: "Sipariş no veya telefon eşleşmedi. Bilgileri kontrol edin." }, 404);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- IP başına hız sınırı (enumeration/brute-force savunması) ---
  const ip = clientIp(req);
  const cutoff = new Date(Date.now() - RATE.windowMin * 60 * 1000).toISOString();

  // eski kayıtları temizle (tablo şişmesin) — 24s öncesi
  await admin.from("order_track_rate_limit").delete().lt("created_at",
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const { count, error: cErr } = await admin
    .from("order_track_rate_limit")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", cutoff);
  if (cErr) return json({ error: "Sunucu hatası." }, 500);
  if ((count ?? 0) >= RATE.max) {
    return json({ error: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
  }
  // her deneme sayılır (başarı da başarısızlık da) — enumeration'ı yavaşlatır
  await admin.from("order_track_rate_limit").insert({ ip });

  // --- siparişi çek (order_no benzersiz) ve telefonu doğrula ---
  const { data: order, error: oErr } = await admin
    .from("orders")
    .select("order_no,status,payment_method,payment_status,subtotal,shipping_fee,total,city,district,created_at,phone,carrier,tracking_no," +
      "order_items(product_name,model_desc,color,size,qty,unit_price)")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (oErr) return json({ error: "Sunucu hatası." }, 500);

  // sipariş yok ya da telefon tutmuyor → aynı belirsiz mesaj (bilgi sızdırma)
  if (!order || normPhone(order.phone) !== phone) {
    return json({ error: "Sipariş no veya telefon eşleşmedi. Bilgileri kontrol edin." }, 404);
  }

  // yalnız güvenli alanları dön (telefonu geri gönderme)
  return json({
    order: {
      order_no: order.order_no,
      status: order.status,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      subtotal: order.subtotal,
      shipping_fee: order.shipping_fee,
      total: order.total,
      city: order.city,
      district: order.district,
      created_at: order.created_at,
      carrier: order.carrier || null,
      tracking_no: order.tracking_no || null,
      items: order.order_items || [],
    },
  });
});
