// ============================================================
//  Esse Jeffe — Sipariş durum değişikliği e-postası (Edge Function)
//  Akış: admin-siparisler.html durum kaydeder → bu fonksiyonu çağırır
//        → sipariş DB'den okunur → müşteriye durum e-postası (Resend).
//
//  GÜVENLİK:
//   - verify_jwt AÇIK (varsayılan) + fonksiyon içinde is_admin kontrolü:
//     Authorization başlığındaki JWT'den kullanıcı çözülür, profiles.is_admin
//     true değilse 403. Anon key tek başına yetmez.
//   - Sipariş içeriği client'tan GELMEZ; order_id ile service_role okur.
//
//  ÇİFT GÖNDERİM KORUMASI: orders.last_status_emailed ATOMİK claim edilir
//  (update ... where last_status_emailed is distinct from <status> returning).
//  Admin aynı durumu iki kez kaydederse ikinci çağrı sessizce atlanır.
//  Gönderim hatasında claim geri alınır → yeniden denenebilir.
//
//  TASARIM İLKESİ (order-email ile aynı): e-posta hatası durumu güncellemeyi
//  ASLA bozmaz — panel kaydı zaten yapılmıştır; yanıt yalnız bilgi verir.
//
//  Secret'lar: RESEND_API_KEY, ORDER_FROM_EMAIL (yoksa gönderim atlanır),
//  SITE_URL (takip linki için, ops.).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { createLogger, errMsg } from "../_shared/log.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { esc, sendViaResend, shell, tl } from "../_shared/order-email.ts";

// E-posta çıkan durumlar. 'pending' yok: sipariş onay maili zaten
// oluşturma anında gider (order-email).
const NOTIFIABLE = ["preparing", "shipped", "delivered", "cancelled"] as const;
type Status = (typeof NOTIFIABLE)[number];

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  full_name: string;
  email: string | null;
  carrier: string | null;
  tracking_no: string | null;
  total: number;
  last_status_emailed: string | null;
}

const SUBJECT: Record<Status, (o: OrderRow) => string> = {
  preparing: (o) => `Siparişiniz hazırlanıyor — ${o.order_no}`,
  shipped: (o) => `Siparişiniz kargoda 📦 — ${o.order_no}`,
  delivered: (o) => `Siparişiniz teslim edildi — ${o.order_no}`,
  cancelled: (o) => `Siparişiniz iptal edildi — ${o.order_no}`,
};

// Zaman çizelgesi adımları (e-postadaki mini gösterim).
const STEPS: { key: string; label: string }[] = [
  { key: "pending", label: "Alındı" },
  { key: "preparing", label: "Hazırlanıyor" },
  { key: "shipped", label: "Kargoda" },
  { key: "delivered", label: "Teslim edildi" },
];

function timelineHtml(status: string): string {
  const idx = STEPS.findIndex((s) => s.key === status);
  if (idx < 0) return ""; // cancelled → çizelge yerine metin
  const cells = STEPS.map((s, i) => {
    const on = i <= idx;
    return `<td align="center" style="padding:0 4px;">
      <div style="width:14px;height:14px;border-radius:50%;margin:0 auto 6px;
        background:${on ? "#b08d57" : "#e6e2da"};"></div>
      <div style="font-size:11px;letter-spacing:.4px;color:${on ? "#1a1a1a" : "#bbb"};
        ${i === idx ? "font-weight:700;" : ""}white-space:nowrap;">${esc(s.label)}</div>
    </td>`;
  }).join("");
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:20px 0 8px;"><tr>${cells}</tr></table>`;
}

function bodyHtml(o: OrderRow, status: Status, siteUrl: string): string {
  const trackUrl = `${siteUrl}/siparis-takip.html?no=${encodeURIComponent(o.order_no)}`;

  const lead: Record<Status, string> = {
    preparing:
      "Siparişiniz hazırlanmaya başlandı. Kargoya verildiğinde takip bilgileriyle tekrar haber vereceğiz.",
    shipped: "Siparişiniz kargoya verildi ve yola çıktı.",
    delivered:
      "Siparişiniz teslim edildi. Umarız elbisenizi çok seversiniz 💛 Bir sorun varsa bize her zaman yazabilirsiniz.",
    cancelled:
      "Siparişiniz iptal edildi. Tahsil edilmiş bir ödeme varsa en geç 14 gün içinde ödeme yönteminize iade edilir. Sorularınız için bize ulaşabilirsiniz.",
  };

  const cargo = status === "shipped" && (o.carrier || o.tracking_no)
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;background:#faf9f7;border-radius:6px;margin:16px 0 0;">
        <tr><td style="padding:14px 16px;font-size:14px;color:#666;">Kargo Firması</td>
            <td style="padding:14px 16px;font-size:14px;color:#1a1a1a;font-weight:600;text-align:right;">${
      esc(o.carrier || "—")
    }</td></tr>
        <tr><td style="padding:0 16px 14px;font-size:14px;color:#666;">Takip Numarası</td>
            <td style="padding:0 16px 14px;font-size:14px;color:#1a1a1a;font-weight:600;text-align:right;">${
      esc(o.tracking_no || "—")
    }</td></tr>
      </table>`
    : "";

  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">${esc(SUBJECT[status](o).split(" — ")[0])}</h1>
    <p style="font-size:15px;color:#555;margin:0 0 4px;">Merhaba ${esc(o.full_name)},</p>
    <p style="font-size:15px;color:#555;margin:0 0 12px;">${lead[status]}</p>

    <table role="presentation" width="100%" style="border-collapse:collapse;background:#faf9f7;border-radius:6px;">
      <tr>
        <td style="padding:14px 16px;font-size:14px;color:#666;">Sipariş No</td>
        <td style="padding:14px 16px;font-size:14px;color:#1a1a1a;font-weight:600;text-align:right;">${esc(o.order_no)}</td>
      </tr>
      <tr>
        <td style="padding:0 16px 14px;font-size:14px;color:#666;">Tutar</td>
        <td style="padding:0 16px 14px;font-size:14px;color:#1a1a1a;text-align:right;">${tl(o.total)}</td>
      </tr>
    </table>

    ${timelineHtml(status)}
    ${cargo}

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${trackUrl}"
         style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:4px;font-size:14px;letter-spacing:2px;">
        SİPARİŞİMİ TAKİP ET
      </a>
    </div>
  `);
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
  const log = createLogger("order-status-email", req);

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

  // --- siparişi DB'den oku (durum/kargo bilgisi panel az önce kaydetti) ---
  const { data: order, error: oErr } = await admin
    .from("orders")
    .select("id,order_no,status,full_name,email,carrier,tracking_no,total,last_status_emailed")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr) {
    log.error("order_read_error", { detail: oErr.message });
    return json({ error: "Sunucu hatası." }, 500);
  }
  if (!order) return json({ error: "Sipariş bulunamadı." }, 404);

  const status = order.status as Status;
  if (!NOTIFIABLE.includes(status)) {
    return json({ ok: true, sent: false, reason: "status-not-notifiable" });
  }
  const email = String(order.email || "").trim();
  if (!email || email.indexOf("@") < 1) {
    return json({ ok: true, sent: false, reason: "no-email" });
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  if (!apiKey || !from) {
    log.warn("email_skipped", { order_no: order.order_no, reason: "no-config" });
    return json({ ok: true, sent: false, reason: "no-config" });
  }

  // --- ATOMİK claim: aynı durum için ikinci e-postayı engelle ---
  // status NOTIFIABLE whitelist'inden geldiği için .or() içine gömmek güvenli.
  const { data: claimedRow } = await admin
    .from("orders")
    .update({ last_status_emailed: status })
    .eq("id", order.id)
    .or(`last_status_emailed.is.null,last_status_emailed.neq.${status}`)
    .select("id")
    .maybeSingle();
  if (!claimedRow) {
    log.info("status_email_dup_skip", { order_no: order.order_no, status });
    return json({ ok: true, sent: false, reason: "already-sent" });
  }

  const siteUrl = (Deno.env.get("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");
  try {
    await sendViaResend(
      apiKey,
      from,
      email,
      SUBJECT[status](order as OrderRow),
      bodyHtml(order as OrderRow, status, siteUrl),
    );
  } catch (e) {
    log.error("status_email_failed", { order_no: order.order_no, status, detail: errMsg(e) });
    // claim'i geri al → admin yeniden kaydedince tekrar denenir
    await admin.from("orders")
      .update({ last_status_emailed: order.last_status_emailed })
      .eq("id", order.id);
    return json({ ok: true, sent: false, reason: "send-failed" });
  }

  log.info("status_email_sent", { order_no: order.order_no, status });
  return json({ ok: true, sent: true });
});
