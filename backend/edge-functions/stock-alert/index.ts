// ============================================================
//  Esse Jeffe — Düşük stok uyarısı (Edge Function, yalnız cron)
//
//  pg_cron (günlük) → POST + x-cron-secret (CART_CRON_SECRET ile AYNI;
//  cart-reminder/price-alert deseni) → track=true ve stok eşiğin altına
//  inmiş varyantlar (ürün + renk + beden) tek ÖZET e-postada işletmeye
//  (ORDER_NOTIFY_EMAIL) gönderilir.
//
//  Deploy: verify_jwt KAPALI — cron JWT taşıyamaz; güvenlik secret iledir.
//  Tarayıcı/istemci girişi YOKTUR: GET yok, secret'sız POST 401.
//
//  Tasarım notları:
//   - Durum tablosu tutulmaz: stok eşiğin altında kaldığı sürece her günlük
//     koşuda özet yeniden gönderilir (bilinçli — stok girilene dek hatırlatır).
//     Eşiğin altında satır yoksa e-posta çıkmaz.
//   - track=false (sınırsız) varyantlar ve pasif ürünler taranmaz.
//
//  Secret'lar: CART_CRON_SECRET (zorunlu), RESEND_API_KEY, ORDER_FROM_EMAIL,
//  ORDER_NOTIFY_EMAIL (alıcı), STOCK_ALERT_THRESHOLD (ops., varsayılan 3).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger, errMsg } from "../_shared/log.ts";
import { esc, sendViaResend, shell } from "../_shared/order-email.ts";

const MAX_ROWS = 500; // koşu başına taranan varyant üst sınırı (güvenlik supabı)

interface StockRow {
  color: string;
  size: string;
  stock: number;
  products: { name: string; slug: string; model_desc: string | null } | null;
}

function summaryHtml(rows: StockRow[], threshold: number, siteUrl: string): string {
  // ürün bazında grupla (e-postada okunaklı bloklar)
  const byProduct = new Map<string, StockRow[]>();
  for (const r of rows) {
    const key = r.products?.name || "?";
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(r);
  }

  const blocks = [...byProduct.entries()].map(([name, list]) => {
    const lines = list
      .sort((a, b) => a.stock - b.stock)
      .map((r) => {
        const variant = [r.color, r.size].filter(Boolean).join(" · ") || "tek varyant";
        const badge = r.stock === 0
          ? `<span style="color:#9a3b3b;font-weight:700;">TÜKENDİ</span>`
          : `<b>${r.stock} adet</b>`;
        return `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#444;">${esc(variant)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;text-align:right;">${badge}</td>
        </tr>`;
      }).join("");
    const first = list[0];
    const desc = first.products?.model_desc ? ` — ${esc(first.products.model_desc)}` : "";
    return `
      <h2 style="font-size:15px;color:#1a1a1a;margin:24px 0 4px;">${esc(name)}${desc}</h2>
      <table role="presentation" width="100%" style="border-collapse:collapse;">${lines}</table>`;
  }).join("");

  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">Düşük stok uyarısı ⚠️</h1>
    <p style="font-size:15px;color:#555;margin:0 0 4px;">
      Stok takibi açık <b>${rows.length}</b> varyantta stok eşiğin
      (≤ ${threshold} adet) altına indi. Stok girilene dek bu özet her gün yinelenir.
    </p>
    ${blocks}
    <p style="font-size:13px;color:#888;margin:24px 0 0;">
      Stokları <a href="${siteUrl}/admin-urunler.html" style="color:#b08d57;">admin panelinden</a>
      güncelleyebilirsiniz. Adet girilen varyant bu listeden otomatik düşer.
    </p>
  `);
}

Deno.serve(async (req) => {
  const log = createLogger("stock-alert", req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (req.method !== "POST") return new Response("POST bekleniyor", { status: 405 });

  // --- cron kimlik doğrulaması (cart-reminder deseni) ---
  const secret = Deno.env.get("CART_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    log.warn("bad_cron_secret");
    return json({ error: "yetkisiz" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const threshold = Math.max(
    0,
    parseInt(Deno.env.get("STOCK_ALERT_THRESHOLD") || "3", 10) || 3,
  );

  // Eşik altındaki, takipli, YAYINDAKİ ürün varyantları (inner join → pasif
  // ürünler elenir).
  const { data: rows, error: qErr } = await admin
    .from("product_stock")
    .select("color, size, stock, products!inner(name, slug, model_desc, active)")
    .eq("track", true)
    .lte("stock", threshold)
    .eq("products.active", true)
    .order("stock", { ascending: true })
    .limit(MAX_ROWS);
  if (qErr) {
    log.error("stock_read_error", { detail: qErr.message });
    return json({ error: "tarama başarısız" }, 500);
  }

  const low = (rows || []) as unknown as StockRow[];
  if (!low.length) {
    log.info("stock_alert_run_done", { low: 0, sent: false });
    return json({ ok: true, low: 0, sent: false });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  const notify = String(Deno.env.get("ORDER_NOTIFY_EMAIL") || "").trim();
  if (!apiKey || !from || !notify) {
    log.warn("stock_alert_skipped", { reason: "no-config", low: low.length });
    return json({ ok: true, low: low.length, sent: false, reason: "no-config" });
  }

  const siteUrl = (Deno.env.get("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");
  const outCount = low.filter((r) => r.stock === 0).length;
  try {
    await sendViaResend(
      apiKey,
      from,
      notify,
      `Düşük stok: ${low.length} varyant eşiğin altında` +
        (outCount ? ` (${outCount} tükendi)` : ""),
      summaryHtml(low, threshold, siteUrl),
    );
  } catch (e) {
    log.error("stock_alert_send_failed", { detail: errMsg(e) });
    return json({ ok: false, low: low.length, sent: false, error: errMsg(e) }, 500);
  }

  log.info("stock_alert_run_done", { low: low.length, out: outCount, sent: true });
  return json({ ok: true, low: low.length, out: outCount, sent: true });
});
