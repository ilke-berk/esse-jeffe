// ============================================================
//  Esse Jeffe — Sadakat birikimi tetikleyicisi (Edge Function)
//  Akış: admin-siparisler.html'de COD/havale siparişi 'ödendi'
//  işaretlenir → bu fonksiyon çağrılır → loyalty_accrue RPC (+%5
//  SADAKAT kuponu) → müşteriye kupon e-postası (_shared/loyalty.ts).
//  (Kart ödemelerinde aynı işlem paytr-callback içinden yapılır.)
//
//  GÜVENLİK (order-status-email ile aynı desen):
//   - verify_jwt AÇIK + fonksiyon içinde profiles.is_admin kontrolü.
//   - Sipariş içeriği client'tan GELMEZ; order_id ile RPC service_role
//     üzerinden okur, tutar/e-posta/durum denetimleri RPC içindedir.
//   - İdempotent: orders.loyalty_accrued_at damgası — aynı sipariş
//     ikinci kez 'ödendi' kaydedilirse RPC 'already-accrued' döner.
//
//  Secret'lar: LOYALTY_STEP_PERCENT, LOYALTY_MAX_PERCENT,
//  LOYALTY_MIN_SUBTOTAL, LOYALTY_MAX_DISCOUNT, LOYALTY_VALID_DAYS
//  (hepsi opsiyonel, varsayılan 5/50/1000/1500/180) + Resend ikilisi.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { createLogger } from "../_shared/log.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { accrueLoyalty } from "../_shared/loyalty.ts";

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const log = createLogger("loyalty-accrue", req);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- kimlik: JWT'den kullanıcı → profiles.is_admin ---
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (uErr || !uid) return json({ error: "Oturum gerekli." }, 401);
  const { data: prof } = await admin
    .from("profiles").select("is_admin").eq("id", uid).maybeSingle();
  if (!prof || prof.is_admin !== true) {
    log.warn("not_admin", { uid });
    return json({ error: "Yetkisiz." }, 403);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }
  const orderId = String(payload?.order_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Geçersiz sipariş." }, 400);

  const r = await accrueLoyalty(admin, orderId, log);
  if (r.accrued) {
    return json({ ok: true, accrued: true, percent: r.percent, orders_count: r.ordersCount });
  }
  return json({ ok: true, accrued: false, reason: r.reason });
});
