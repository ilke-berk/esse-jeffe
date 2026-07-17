// ============================================================
//  Esse Jeffe — Bülten & İletişim form gönderimi (Edge Function)
//  Akış: index.html (bülten) / iletisim.html (iletişim)
//        → bu fonksiyon → newsletter_subscribers | contact_messages
//
//  GÜVENLİK / ANTI-SPAM:
//   1) RLS: her iki tabloya doğrudan client insert'i KAPALIDIR
//      (schema.sql — açık "with check (true)" politikaları kaldırıldı).
//      Yazma yalnızca bu fonksiyonun service_role'ü ile olur.
//   2) Honeypot: gizli "website" alanı doluysa istek sessizce yok sayılır
//      (bot forma yazmış demektir; kullanıcıya başarı döneriz, kayıt açılmaz).
//   3) IP başına hız sınırı: form_rate_limit tablosunda pencere içi sayım.
//
//  HOŞ GELDİN KUPONU: İLK bülten kaydında e-postaya bağlı, tek kullanımlık
//  HOSGELDIN-… kodu üretilir (discount_codes, kind='single') ve Resend ile
//  gönderilir. Fail-soft: kupon/e-posta hatası aboneliği ASLA bozmaz.
//  Tekrar kayıt 23505 ile reddedildiğinden ikinci kupon çıkmaz.
//  Secret'lar: WELCOME_DISCOUNT_PERCENT (ops., varsayılan 10),
//  RESEND_API_KEY + ORDER_FROM_EMAIL (yoksa kupon üretilmez, abonelik kalır).
//
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından gelir.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger, errMsg, type Logger } from "../_shared/log.ts";
import { checkRateLimit, recordRateLimit } from "../_shared/rate-limit.ts";
import { clientIp, isValidOrderNo, normPhone } from "../_shared/util.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { makeDiscountCode } from "../_shared/discount.ts";
import { esc, sendViaResend, shell } from "../_shared/order-email.ts";

const WELCOME_VALID_DAYS = 30; // hoş geldin kuponu geçerlilik süresi

// IP başına, pencere (dakika) içinde izin verilen istek sayısı
const LIMITS: Record<string, { max: number; windowMin: number }> = {
  newsletter: { max: 3, windowMin: 60 },
  contact: { max: 5, windowMin: 60 },
  exchange: { max: 5, windowMin: 60 }, // değişim/iptal talebi (degisim-iptal.html)
};

// Değişim/iptal talebi alan whitelistleri (exchange_requests check kısıtlarıyla uyumlu)
const EXCH_TYPES = ["exchange", "cancel"];
const EXCH_REASONS = ["beden", "renk", "model", "kusurlu", "vazgectim", "diger"];

function welcomeHtml(code: string, percent: number, siteUrl: string): string {
  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">Aramıza hoş geldiniz 🎉</h1>
    <p style="font-size:15px;color:#555;margin:0 0 20px;">
      Bültenimize abone olduğunuz için teşekkürler. İlk siparişinizde
      kullanabileceğiniz size özel indirim kodunuz aşağıda.
    </p>

    <div style="margin:0 0 24px;padding:20px;background:#faf6ef;border:1px dashed #b08d57;border-radius:8px;text-align:center;">
      <div style="font-size:13px;letter-spacing:1px;color:#8a6d2f;">SİZE ÖZEL %${percent} HOŞ GELDİN İNDİRİMİ</div>
      <div style="font-size:26px;letter-spacing:3px;color:#1a1a1a;font-weight:700;margin:8px 0;">${esc(code)}</div>
      <div style="font-size:12px;color:#8a6d2f;">${WELCOME_VALID_DAYS} gün geçerlidir · tek kullanımlık · bu e-postaya tanımlıdır</div>
    </div>

    <p style="font-size:14px;color:#555;margin:0 0 20px;">
      Kodu sepet sayfasındaki "İndirim kodu" alanına yazmanız yeterli.
    </p>

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${siteUrl}/koleksiyon.html"
         style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:4px;font-size:14px;letter-spacing:2px;">
        KOLEKSİYONU KEŞFET
      </a>
    </div>

    <p style="font-size:11px;color:#bbb;text-align:center;margin:28px 0 0;">
      Bu e-postayı, essejeffe.com bültenine abone olduğunuz için aldınız.
    </p>
  `);
}

/**
 * İlk bülten kaydına hoş geldin kuponu üret + gönder. FAIL-SOFT: her hata
 * loglanır ve false döner; abonelik kaydı asla geri alınmaz. E-posta
 * gönderilemezse kod satırı silinir (müşterinin göremeyeceği kod kilitli
 * kalmasın).
 */
async function sendWelcomeCoupon(admin: any, email: string, log: Logger): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  if (!apiKey || !from) {
    log.warn("welcome_skipped", { reason: "no-config" });
    return false;
  }
  const siteUrl = (Deno.env.get("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");
  const percent = Math.min(
    90,
    Math.max(1, parseInt(Deno.env.get("WELCOME_DISCOUNT_PERCENT") || "10", 10) || 10),
  );

  // Kod üret (unique çakışmasında bir kez yeniden dene) — cart-reminder deseni.
  let code = makeDiscountCode(Math.random, "HOSGELDIN-");
  let codeId: string | null = null;
  for (let attempt = 0; attempt < 2 && !codeId; attempt++) {
    const { data: codeRow, error: cErr } = await admin
      .from("discount_codes")
      .insert({
        code,
        percent,
        email,
        expires_at: new Date(Date.now() + WELCOME_VALID_DAYS * 86400_000).toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (codeRow) codeId = codeRow.id;
    else if (cErr && (cErr as any).code === "23505") code = makeDiscountCode(Math.random, "HOSGELDIN-");
    else {
      log.error("welcome_code_insert_error", { detail: cErr?.message });
      return false;
    }
  }
  if (!codeId) return false;

  try {
    await sendViaResend(
      apiKey,
      from,
      email,
      `Hoş geldiniz — ilk siparişinize özel %${percent} indirim kodunuz 🎁`,
      welcomeHtml(code, percent, siteUrl),
    );
  } catch (e) {
    log.error("welcome_send_failed", { detail: errMsg(e) });
    await admin.from("discount_codes").delete().eq("id", codeId);
    return false;
  }

  // izleme kolonları (fail-soft — hata aboneliği bozmaz)
  await admin.from("newsletter_subscribers")
    .update({ welcome_code_id: codeId, welcome_sent_at: new Date().toISOString() })
    .eq("email", email);
  log.info("welcome_sent", { percent });
  return true;
}

interface ExchangePayload {
  orderNo: string;
  phone: string; // normPhone ile son 10 hane
  type: string; // 'exchange' | 'cancel'
  reason: string; // EXCH_REASONS
  details: string | null;
}

const EXCH_TYPE_TR: Record<string, string> = { exchange: "Değişim", cancel: "İptal" };
const EXCH_REASON_TR: Record<string, string> = {
  beden: "Beden değişimi",
  renk: "Renk değişimi",
  model: "Model değişimi",
  kusurlu: "Kusurlu/hasarlı ürün",
  vazgectim: "Vazgeçtim",
  diger: "Diğer",
};

/** İşletmeye yeni talep bildirimi. FAIL-SOFT: hata talebi asla bozmaz. */
async function notifyExchange(
  order: { order_no: string; full_name: string; status: string },
  exch: ExchangePayload,
  log: Logger,
): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  const notify = String(Deno.env.get("ORDER_NOTIFY_EMAIL") || "").trim();
  if (!apiKey || !from || !notify) return;
  const html = shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 16px;">
      Yeni ${EXCH_TYPE_TR[exch.type] || exch.type} talebi — ${esc(order.order_no)}</h1>
    <table role="presentation" width="100%" style="border-collapse:collapse;background:#faf9f7;border-radius:6px;">
      <tr><td style="padding:12px 16px;font-size:14px;color:#666;">Müşteri</td>
          <td style="padding:12px 16px;font-size:14px;color:#1a1a1a;text-align:right;font-weight:600;">${esc(order.full_name)}</td></tr>
      <tr><td style="padding:0 16px 12px;font-size:14px;color:#666;">Neden</td>
          <td style="padding:0 16px 12px;font-size:14px;color:#1a1a1a;text-align:right;">${
    esc(EXCH_REASON_TR[exch.reason] || exch.reason)
  }</td></tr>
      <tr><td style="padding:0 16px 12px;font-size:14px;color:#666;">Sipariş durumu</td>
          <td style="padding:0 16px 12px;font-size:14px;color:#1a1a1a;text-align:right;">${esc(order.status)}</td></tr>
    </table>
    ${
    exch.details
      ? `<p style="font-size:14px;color:#555;margin:16px 0 0;white-space:pre-line;"><b>Açıklama:</b> ${esc(exch.details)}</p>`
      : ""
  }
    <p style="font-size:13px;color:#888;margin:20px 0 0;">Talebi admin panelindeki Siparişler ekranından yönetebilirsiniz.</p>
  `);
  try {
    await sendViaResend(
      apiKey,
      from,
      notify,
      `${EXCH_TYPE_TR[exch.type] || exch.type} talebi — ${order.order_no}`,
      html,
    );
  } catch (e) {
    log.error("exchange_notify_failed", { order_no: order.order_no, detail: errMsg(e) });
  }
}

/**
 * Değişim/iptal talebini işle: sipariş no + telefon doğrula (İKİSİ de
 * eşleşmeli, hangisinin yanlış olduğu sızdırılmaz), aynı türde açık talep
 * varsa mükerrer açma, kaydet, işletmeye bildir (fail-soft).
 */
async function handleExchange(
  admin: any,
  exch: ExchangePayload,
  json: (body: unknown, status?: number) => Response,
  log: Logger,
  ip: string,
): Promise<Response> {
  const { data: order, error: oErr } = await admin
    .from("orders")
    .select("id, order_no, full_name, phone, status")
    .eq("order_no", exch.orderNo)
    .maybeSingle();
  if (oErr) {
    log.error("exchange_order_read_error", { ip, detail: oErr.message });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!order || normPhone(order.phone) !== exch.phone) {
    log.info("exchange_no_match", { ip });
    return json({ error: "Sipariş no veya telefon eşleşmedi. Bilgileri kontrol edin." }, 404);
  }

  // Aynı türde açık (kapatılmamış) talep varsa yenisini açma.
  const { data: existing, error: exErr } = await admin
    .from("exchange_requests")
    .select("id")
    .eq("order_id", order.id)
    .eq("request_type", exch.type)
    .neq("status", "closed")
    .limit(1)
    .maybeSingle();
  if (exErr) {
    log.error("exchange_dup_check_error", { ip, detail: exErr.message });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (existing) return json({ ok: true, already: true });

  const { error: insErr } = await admin.from("exchange_requests").insert({
    order_id: order.id,
    order_no: order.order_no,
    request_type: exch.type,
    reason: exch.reason,
    details: exch.details,
  });
  if (insErr) {
    log.error("exchange_insert_error", { ip, detail: insErr.message });
    return json({ error: "Kaydedilemedi." }, 500);
  }

  await notifyExchange(order, exch, log);
  log.info("exchange_saved", { ip, order_no: order.order_no, type: exch.type });
  return json({ ok: true });
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
  const log = createLogger("submit-form", req);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }

  const kind = String(payload?.kind || "").trim();
  const limit = LIMITS[kind];
  if (!limit) return json({ error: "Geçersiz form türü." }, 400);

  // --- honeypot: gizli alan doluysa bot say, sessizce başarı dön ---
  if (String(payload?.hp || "").trim()) {
    log.warn("honeypot_hit", { ip: clientIp(req), kind });
    return json({ ok: true });
  }

  // --- alan doğrulaması ---
  const trim = (v: unknown) => String(v ?? "").trim();
  let email = trim(payload?.email).toLowerCase();
  let row: Record<string, unknown> = {};
  let table = "";
  let exch: ExchangePayload | null = null;

  if (kind === "newsletter") {
    if (!email || email.indexOf("@") < 1) return json({ error: "Geçerli bir e-posta girin." }, 400);
    table = "newsletter_subscribers";
    row = { email };
  } else if (kind === "exchange") {
    // Değişim/iptal talebi: sipariş no + telefon İKİSİ de eşleşmeli
    // (track-order deseni). Asıl doğrulama DB'ye karşı aşağıda,
    // hız sınırından SONRA yapılır — burada yalnız biçim elenir.
    const orderNo = trim(payload?.order_no).toUpperCase();
    const phone = normPhone(payload?.phone);
    const type = trim(payload?.request_type);
    const reason = trim(payload?.reason);
    if (!EXCH_TYPES.includes(type)) return json({ error: "Geçersiz talep türü." }, 400);
    if (!EXCH_REASONS.includes(reason)) return json({ error: "Lütfen bir neden seçin." }, 400);
    if (phone.length < 10) return json({ error: "Geçerli bir telefon numarası girin." }, 400);
    if (!isValidOrderNo(orderNo)) {
      return json({ error: "Sipariş no veya telefon eşleşmedi. Bilgileri kontrol edin." }, 404);
    }
    exch = { orderNo, phone, type, reason, details: trim(payload?.details).slice(0, 2000) || null };
  } else {
    const name = trim(payload?.name);
    const message = trim(payload?.message);
    if (!name || !email || email.indexOf("@") < 1) {
      return json({ error: "Ad ve geçerli e-posta zorunlu." }, 400);
    }
    if (!message) return json({ error: "Mesaj boş olamaz." }, 400);
    table = "contact_messages";
    row = {
      name,
      email,
      phone: trim(payload?.phone) || null,
      subject: trim(payload?.subject) || null,
      order_no: trim(payload?.order_no) || null,
      message: message.slice(0, 4000),
    };
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- IP başına hız sınırı ---
  const ip = clientIp(req);
  const rl = await checkRateLimit(admin, {
    table: "form_rate_limit", ip, kind, max: limit.max, windowMin: limit.windowMin,
  });
  if (rl.error) {
    log.error("rate_limit_db_error", { ip, kind, detail: rl.error });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!rl.allowed) {
    log.warn("rate_limited", { ip, kind, count: rl.count });
    return json({ error: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
  }

  // --- değişim/iptal talebi: ayrı akış (sipariş doğrulaması gerekir) ---
  if (kind === "exchange" && exch) {
    // BAŞARILI/BAŞARISIZ her deneme sayılır — order_no/telefon tahminini
    // (enumeration) yavaşlatır (track-order ile aynı ilke).
    await recordRateLimit(admin, "form_rate_limit", ip, kind);
    return handleExchange(admin, exch, json, log, ip);
  }

  // --- asıl kaydı yaz ---
  const { error: insErr } = await admin.from(table).insert(row);
  if (insErr) {
    if ((insErr as any).code === "23505") {
      // bülten: e-posta zaten kayıtlı (→ ikinci hoş geldin kuponu da yok)
      return json({ ok: true, already: true });
    }
    log.error("insert_error", { ip, kind, detail: insErr.message });
    return json({ error: "Kaydedilemedi." }, 500);
  }

  // başarı → hız sınırı sayacına ekle
  await recordRateLimit(admin, "form_rate_limit", ip, kind);

  // bülten: ilk kayda hoş geldin kuponu (fail-soft — abonelik zaten yazıldı)
  let coupon = false;
  if (kind === "newsletter") {
    coupon = await sendWelcomeCoupon(admin, email, log);
  }

  log.info("form_saved", { ip, kind });
  return json({ ok: true, coupon });
});
