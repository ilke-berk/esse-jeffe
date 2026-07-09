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
import { createLogger } from "../_shared/log.ts";
import { checkRateLimit, recordRateLimit } from "../_shared/rate-limit.ts";
import { clientIp, isValidOrderNo, normPhone } from "../_shared/util.ts";
import { corsHeaders } from "../_shared/cors.ts";

// IP başına, pencere (dakika) içinde izin verilen sorgu sayısı
const RATE = { max: 15, windowMin: 10 };

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const log = createLogger("track-order", req);

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
  // 12 rakam da kabul edilir: eski paytr-token kart siparişlerinde 12 üretiyordu.
  if (!isValidOrderNo(orderNo)) {
    return json({ error: "Sipariş no veya telefon eşleşmedi. Bilgileri kontrol edin." }, 404);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- IP başına hız sınırı (enumeration/brute-force savunması) ---
  const ip = clientIp(req);
  const rl = await checkRateLimit(admin, {
    table: "order_track_rate_limit", ip, max: RATE.max, windowMin: RATE.windowMin,
  });
  if (rl.error) {
    log.error("rate_limit_db_error", { ip, detail: rl.error });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!rl.allowed) {
    log.warn("rate_limited", { ip, count: rl.count });
    return json({ error: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
  }
  // her deneme sayılır (başarı da başarısızlık da) — enumeration'ı yavaşlatır
  await recordRateLimit(admin, "order_track_rate_limit", ip);

  // --- siparişi çek (order_no benzersiz) ve telefonu doğrula ---
  const { data: order, error: oErr } = await admin
    .from("orders")
    .select("order_no,status,payment_method,payment_status,subtotal,shipping_fee,total,city,district,created_at,phone,carrier,tracking_no," +
      "order_items(product_name,model_desc,color,size,qty,unit_price)")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (oErr) {
    log.error("order_read_error", { ip, detail: oErr.message });
    return json({ error: "Sunucu hatası." }, 500);
  }

  // sipariş yok ya da telefon tutmuyor → aynı belirsiz mesaj (bilgi sızdırma)
  if (!order || normPhone(order.phone) !== phone) {
    log.info("track_no_match", { ip });
    return json({ error: "Sipariş no veya telefon eşleşmedi. Bilgileri kontrol edin." }, 404);
  }
  log.info("track_ok", { ip, order_no: order.order_no });

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
