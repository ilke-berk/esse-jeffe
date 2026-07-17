// ============================================================
//  Esse Jeffe — Fiyat alarmı: "fiyat düşünce haber ver" (Edge Function)
//
//  Üç giriş:
//   POST {action:"subscribe", slug, email, hp} — urun.html'deki form.
//     CORS + honeypot + IP hız sınırı (fn_rate_limit, kind='price_alert').
//     price_alerts'e upsert: aynı ürün+e-posta yeniden kaydolursa satır
//     güncel fiyatla sıfırlanır (notified_at=null → yeni düşüşte tekrar mail).
//   POST (pg_cron, saatlik) — x-cron-secret başlığı == CART_CRON_SECRET
//     (cart-reminder ile AYNI secret; yeni manuel adım çıkarmamak için).
//     Güncel fiyatı price_at_signup'ın altına inen bekleyen alarmlara
//     Resend ile bildirim gönderir. Bildirim tek seferliktir.
//   GET ?unsub=<unsub_token> — maildeki "bu alarmı kapat" linki; satırı siler.
//
//  Deploy: verify_jwt KAPALI (cart-reminder gibi) — cron ve tarayıcı linki
//  JWT taşıyamaz; güvenlik secret/token + hız sınırı iledir.
//
//  ÇİFT GÖNDERİM KORUMASI: notified_at ATOMİK claim edilir
//  (update ... where notified_at is null returning). Gönderim hatasında
//  claim geri alınır → sonraki koşu yeniden dener.
//
//  Secret'lar: CART_CRON_SECRET (cron için zorunlu), RESEND_API_KEY,
//  ORDER_FROM_EMAIL, SITE_URL (yoksa gönderim sessizce atlanır).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger, errMsg, type Logger } from "../_shared/log.ts";
import { checkRateLimit, recordRateLimit } from "../_shared/rate-limit.ts";
import { clientIp } from "../_shared/util.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { esc, sendViaResend, shell, tl } from "../_shared/order-email.ts";

const BATCH = 200; // koşu başına taranan bekleyen alarm sayısı
const NOTIFIED_PURGE_DAYS = 30; // bildirilen satırlar bu süre sonra silinir (KVKK)
const MAX_AGE_DAYS = 180; // fiyat hiç düşmezse alarm bu süre sonunda düşer
const RL = { max: 5, windowMin: 60 }; // IP başına kayıt sınırı

interface AlertRow {
  id: string;
  email: string;
  price_at_signup: number;
  unsub_token: string;
  products: {
    slug: string;
    name: string;
    model_desc: string | null;
    price: number;
    active: boolean;
  } | null;
}

function unsubUrl(token: string): string {
  const base = Deno.env.get("SUPABASE_URL") || "";
  return `${base}/functions/v1/price-alert?unsub=${encodeURIComponent(token)}`;
}

function alertHtml(a: AlertRow, siteUrl: string): string {
  const p = a.products!;
  const productUrl = `${siteUrl}/urun.html?slug=${encodeURIComponent(p.slug)}`;
  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">Beklediğiniz fiyat düşüşü gerçekleşti 🎉</h1>
    <p style="font-size:15px;color:#555;margin:0 0 20px;">
      Fiyat alarmı kurduğunuz <b>${esc(p.name)}</b>${
    p.model_desc ? ` — ${esc(p.model_desc)}` : ""
  } şimdi daha uygun fiyata sizi bekliyor.
    </p>

    <div style="margin:0 0 24px;padding:20px;background:#faf6ef;border:1px dashed #b08d57;border-radius:8px;text-align:center;">
      <div style="font-size:13px;letter-spacing:1px;color:#8a6d2f;">YENİ FİYAT</div>
      <div style="margin:8px 0;">
        <span style="font-size:15px;color:#999;text-decoration:line-through;margin-right:12px;">${
    tl(a.price_at_signup)
  }</span>
        <span style="font-size:26px;color:#1a1a1a;font-weight:700;">${tl(p.price)}</span>
      </div>
      <div style="font-size:12px;color:#8a6d2f;">Stoklarla sınırlıdır; fiyat yeniden değişebilir.</div>
    </div>

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${productUrl}"
         style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:4px;font-size:14px;letter-spacing:2px;">
        ÜRÜNE GİT
      </a>
    </div>

    <p style="font-size:11px;color:#bbb;text-align:center;margin:28px 0 0;">
      Bu e-postayı, bu ürün için fiyat alarmı kurduğunuz için aldınız.
      <a href="${unsubUrl(a.unsub_token)}" style="color:#999;">Bu alarmı kapat</a>
    </p>
  `);
}

// Markalı minicik HTML sayfa (unsub onayı — cart-reminder ile aynı desen).
function unsubPage(msg: string): Response {
  return new Response(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1"><title>Esse Jeffe</title></head>
     <body style="margin:0;background:#f6f4f1;font-family:'Segoe UI',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
       <div style="background:#fff;border-radius:8px;padding:40px 48px;text-align:center;max-width:420px;">
         <div style="font-size:20px;letter-spacing:3px;font-weight:600;color:#1a1a1a;">ESSE JEFFE</div>
         <div style="font-size:11px;letter-spacing:2px;color:#b08d57;margin:2px 0 24px;">ABİYE &amp; DAVET</div>
         <p style="font-size:15px;color:#555;line-height:1.7;margin:0;">${msg}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function handleUnsub(admin: any, token: string, log: Logger): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return unsubPage("Geçersiz bağlantı.");
  const { data: row } = await admin
    .from("price_alerts")
    .delete()
    .eq("unsub_token", token)
    .select("id")
    .maybeSingle();
  if (!row) return unsubPage("Bağlantı bulunamadı veya alarm zaten kapatılmış.");
  log.info("price_alert_unsub", { alert_id: row.id });
  return unsubPage(
    "Fiyat alarmı kapatıldı. Dilediğinizde ürün sayfasından yeniden kurabilirsiniz.",
  );
}

// ---------- kayıt (urun.html formu) ----------
async function handleSubscribe(
  admin: any,
  req: Request,
  payload: any,
  cors: Record<string, string>,
  log: Logger,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // honeypot: gizli alan doluysa bot say, sessizce başarı dön
  if (String(payload?.hp || "").trim()) {
    log.warn("honeypot_hit", { ip: clientIp(req) });
    return json({ ok: true });
  }

  const email = String(payload?.email ?? "").trim().toLowerCase();
  const slug = String(payload?.slug ?? "").trim();
  if (!email || email.indexOf("@") < 1 || email.length > 320) {
    return json({ error: "Geçerli bir e-posta girin." }, 400);
  }
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ error: "Geçersiz ürün." }, 400);

  const ip = clientIp(req);
  const rl = await checkRateLimit(admin, {
    table: "fn_rate_limit", ip, kind: "price_alert", max: RL.max, windowMin: RL.windowMin,
  });
  if (rl.error) {
    log.error("rate_limit_db_error", { ip, detail: rl.error });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!rl.allowed) {
    log.warn("rate_limited", { ip, count: rl.count });
    return json({ error: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
  }

  const { data: product, error: pErr } = await admin
    .from("products")
    .select("id, price")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (pErr) {
    log.error("product_read_error", { detail: pErr.message });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!product) return json({ error: "Ürün bulunamadı." }, 404);

  // upsert: yeniden kayıt → güncel fiyattan sıfırla (yeni düşüşte tekrar mail)
  const { error: upErr } = await admin.from("price_alerts").upsert({
    product_id: product.id,
    email,
    price_at_signup: product.price,
    notified_at: null,
    notified_price: null,
  }, { onConflict: "product_id,email" });
  if (upErr) {
    log.error("alert_upsert_error", { detail: upErr.message });
    return json({ error: "Kaydedilemedi." }, 500);
  }

  await recordRateLimit(admin, "fn_rate_limit", ip, "price_alert");
  log.info("price_alert_saved", { slug });
  return json({ ok: true });
}

// ---------- cron taraması ----------
async function handleCron(admin: any, log: Logger): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const nowMs = Date.now();

  // Temizlik (KVKK veri minimizasyonu): bildirilenler 30 gün, tümü 180 gün.
  await admin.from("price_alerts").delete()
    .lt("notified_at", new Date(nowMs - NOTIFIED_PURGE_DAYS * 86400_000).toISOString());
  await admin.from("price_alerts").delete()
    .lt("created_at", new Date(nowMs - MAX_AGE_DAYS * 86400_000).toISOString());

  // Bekleyen alarmlar + güncel ürün fiyatı (FK join). Fiyat karşılaştırması
  // kolon-kolona PostgREST'te yapılamadığı için kodda süzülür.
  const { data: pending, error: qErr } = await admin
    .from("price_alerts")
    .select("id, email, price_at_signup, unsub_token, products(slug, name, model_desc, price, active)")
    .is("notified_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (qErr) {
    log.error("pending_read_error", { detail: qErr.message });
    return json({ error: "tarama başarısız" }, 500);
  }

  const due = ((pending || []) as AlertRow[]).filter((a) =>
    a.products && a.products.active && a.products.price < a.price_at_signup
  );

  let sent = 0, skipped = 0;
  const errors: string[] = [];
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");

  for (const alert of due) {
    if (!apiKey || !from) { skipped++; continue; } // yapılandırma yoksa atla (fail-soft)

    // ATOMİK claim: çakışan cron koşusunda çift gönderimi engeller.
    const { data: claimed } = await admin
      .from("price_alerts")
      .update({ notified_at: new Date().toISOString(), notified_price: alert.products!.price })
      .eq("id", alert.id)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) { skipped++; continue; }

    try {
      await sendViaResend(
        apiKey,
        from,
        alert.email,
        `${alert.products!.name} şimdi ${tl(alert.products!.price)} — fiyat düştü 🎉`,
        alertHtml(alert, siteUrl),
      );
      sent++;
      log.info("price_alert_sent", { alert_id: alert.id, slug: alert.products!.slug });
    } catch (e) {
      log.error("price_alert_send_failed", { alert_id: alert.id, detail: errMsg(e) });
      errors.push("send: " + errMsg(e));
      // claim'i geri al → sonraki koşu yeniden dener
      await admin.from("price_alerts")
        .update({ notified_at: null, notified_price: null })
        .eq("id", alert.id);
      skipped++;
    }
  }

  log.info("price_alert_run_done", { pending: (pending || []).length, due: due.length, sent, skipped });
  return json({ ok: true, pending: (pending || []).length, due: due.length, sent, skipped, errors });
}

Deno.serve(async (req) => {
  const log = createLogger("price-alert", req);
  const cors = corsHeaders(req.headers.get("origin"));
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ---------- GET ?unsub=... : alarmı kapat ----------
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("unsub") || "";
    if (!token) return new Response("Not found", { status: 404 });
    return handleUnsub(admin, token, log);
  }
  if (req.method !== "POST") {
    return new Response("POST bekleniyor", { status: 405, headers: cors });
  }

  // ---------- POST + x-cron-secret : cron taraması ----------
  // cart-reminder ile AYNI secret kullanılır (yeni manuel kurulum adımı yok).
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader !== null) {
    const secret = Deno.env.get("CART_CRON_SECRET");
    if (!secret || cronHeader !== secret) {
      log.warn("bad_cron_secret");
      return new Response(JSON.stringify({ error: "yetkisiz" }), { status: 401 });
    }
    return handleCron(admin, log);
  }

  // ---------- POST : tarayıcıdan kayıt ----------
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Geçersiz istek gövdesi" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return handleSubscribe(admin, req, payload, cors, log);
});
