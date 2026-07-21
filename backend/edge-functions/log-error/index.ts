// ============================================================
//  Esse Jeffe — İstemci hata raporu toplayıcı (Edge Function)
//  Akış: ej.js (EJMonitor: window.onerror / unhandledrejection)
//        → bu fonksiyon → client_errors tablosu (service_role)
//
//  NEDEN: Sitede Sentry gibi bir hata izleme servisi yok; ziyaretçi
//  tarayıcısında patlayan JS hataları görünmezdi. EJMonitor hataları
//  buraya POST'lar; hatalar client_errors tablosunda birikir ve
//  Supabase dashboard'dan (veya admin panelden) izlenir.
//
//  GÜVENLİK / KÖTÜYE KULLANIM:
//   - RLS: client_errors'a doğrudan client insert'i KAPALI; yalnız bu
//     fonksiyon (service_role) yazar. Okuma yalnız admin (is_admin()).
//   - IP başına hız sınırı (fn_rate_limit, kind='client_error'):
//     kasıtlı log seli tabloyu şişiremez. Aşımda 429 — istemci zaten
//     sessizce vazgeçer.
//   - Alan boyları sunucuda da kırpılır (client'a güvenilmez).
//
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından gelir.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { createLogger } from "../_shared/log.ts";
import { checkRateLimit, recordRateLimit } from "../_shared/rate-limit.ts";
import { clientIp } from "../_shared/util.ts";
import { corsHeaders } from "../_shared/cors.ts";

// IP başına hata raporu sınırı (istemci tarafı da sayfa başına 8 ile sınırlı)
const RATE = { table: "fn_rate_limit", kind: "client_error", max: 20, windowMin: 60 };

const trim = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const log = createLogger("log-error", req);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }

  const message = trim(payload?.message, 500);
  if (!message) return json({ error: "message zorunlu" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- IP başına hız sınırı (log seli savunması) ---
  const ip = clientIp(req);
  const rl = await checkRateLimit(admin, { ...RATE, ip });
  if (rl.error) {
    log.error("rate_limit_db_error", { ip, detail: rl.error });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!rl.allowed) return json({ error: "rate limited" }, 429);
  await recordRateLimit(admin, RATE.table, ip, RATE.kind);

  const { error: insErr } = await admin.from("client_errors").insert({
    message,
    stack: trim(payload?.stack, 3000),
    source: trim(payload?.source, 500),
    line: Number.isFinite(+payload?.line) ? Math.trunc(+payload.line) : null,
    col: Number.isFinite(+payload?.col) ? Math.trunc(+payload.col) : null,
    url: trim(payload?.url, 500),
    ua: trim(payload?.ua, 300),
    ip,
  });
  if (insErr) {
    log.error("insert_error", { ip, detail: insErr.message });
    return json({ error: "Kaydedilemedi." }, 500);
  }

  // Sunucu logunda da iz bırak: dashboard'da `"event":"client_error"` ile
  // tablo sorgusuna gerek kalmadan görülür.
  log.warn("client_error", { ip, message, url: trim(payload?.url, 200) });
  return json({ ok: true });
});
