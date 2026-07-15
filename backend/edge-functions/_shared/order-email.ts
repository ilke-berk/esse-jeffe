// ============================================================
//  Esse Jeffe — Sipariş onay e-postası (paylaşılan modül)
//  create-order (COD/havale) ve paytr-callback (kart) fonksiyonları
//  bu modülü çağırır. Gönderim Resend REST API üzerinden yapılır.
//
//  TASARIM İLKESİ: E-posta gönderimi ASLA siparişi bozmaz. Herhangi
//  bir hata (secret yok, Resend down, geçersiz adres) sessizce loglanır;
//  fonksiyon çağıranı hata fırlatmaz. Sipariş zaten DB'ye yazılmıştır.
//
//  Gerekli secret'lar (Supabase → Edge Functions → Secrets):
//    RESEND_API_KEY      Resend API anahtarı (re_...). Yoksa gönderim atlanır.
//    ORDER_FROM_EMAIL    Gönderen, ör. "Esse Jeffe <siparis@essejeffe.com>".
//                        Alan adı Resend'de doğrulanmış olmalı (SPF/DKIM).
//    ORDER_NOTIFY_EMAIL  İşletme bildirim adresi (yeni sipariş buraya düşer).
//    ORDER_BANK_INFO     (opsiyonel) Havale siparişlerinde e-postaya eklenecek
//                        IBAN/banka bilgisi. Satır sonları \n ile.
//    SITE_URL            (opsiyonel) E-postadaki "hesabım" linki için taban URL.
// ============================================================

// Loglama için minimal arayüz (log.ts'teki Logger ile uyumlu). Verilmezse
// console'a düşülür; böylece modül logger'sız da (ör. testte) çalışır.
export interface EmailLogger {
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface OrderEmailItem {
  product_name: string;
  model_desc?: string | null;
  color?: string | null;
  size?: string | null;
  unit_price: number; // TL, tam sayı
  qty: number;
}

export interface OrderEmailData {
  order_no: string;
  payment_method: string; // cod | transfer | card
  full_name: string;
  phone: string;
  email?: string | null;
  city: string;
  district: string;
  address: string;
  postal_code?: string | null;
  note?: string | null;
  subtotal: number;
  discount?: number; // uygulanan indirim (TL, tam sayı); yoksa 0
  discount_code?: string | null;
  shipping_fee: number;
  total: number;
  items: OrderEmailItem[];
}

const METHOD_LABEL: Record<string, string> = {
  cod: "Kapıda Ödeme",
  transfer: "Havale / EFT",
  card: "Kredi / Banka Kartı",
};

export const tl = (n: number): string =>
  new Intl.NumberFormat("tr-TR").format(Math.round(n || 0)) + " ₺";

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function itemRows(items: OrderEmailItem[]): string {
  return items
    .map((it) => {
      const bits = [it.color, it.size].filter(Boolean).map(esc).join(" · ");
      const sub = [it.model_desc ? esc(it.model_desc) : "", bits]
        .filter(Boolean)
        .join(" — ");
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:600;color:#1a1a1a;">${esc(it.product_name)}</div>
            ${sub ? `<div style="font-size:13px;color:#888;margin-top:2px;">${sub}</div>` : ""}
            <div style="font-size:13px;color:#888;margin-top:2px;">Adet: ${esc(it.qty)}</div>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;color:#1a1a1a;">
            ${tl(it.unit_price * it.qty)}
          </td>
        </tr>`;
    })
    .join("");
}

function totalsBlock(o: OrderEmailData): string {
  const shipping = o.shipping_fee > 0 ? tl(o.shipping_fee) : "Ücretsiz";
  const discountRow = (o.discount || 0) > 0
    ? `<tr>
        <td style="padding:4px 0;color:#3c4a3a;">İndirim${o.discount_code ? ` (${esc(o.discount_code)})` : ""}</td>
        <td style="padding:4px 0;text-align:right;color:#3c4a3a;">−${tl(o.discount || 0)}</td>
      </tr>`
    : "";
  return `
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:8px;">
      <tr>
        <td style="padding:4px 0;color:#666;">Ara toplam</td>
        <td style="padding:4px 0;text-align:right;color:#1a1a1a;">${tl(o.subtotal)}</td>
      </tr>
      ${discountRow}
      <tr>
        <td style="padding:4px 0;color:#666;">Kargo</td>
        <td style="padding:4px 0;text-align:right;color:#1a1a1a;">${shipping}</td>
      </tr>
      <tr>
        <td style="padding:10px 0 0;font-weight:700;font-size:16px;color:#1a1a1a;border-top:2px solid #1a1a1a;">Toplam</td>
        <td style="padding:10px 0 0;text-align:right;font-weight:700;font-size:16px;color:#1a1a1a;border-top:2px solid #1a1a1a;">${tl(o.total)}</td>
      </tr>
    </table>`;
}

function addressBlock(o: OrderEmailData): string {
  const line2 = [o.district, o.city, o.postal_code].filter(Boolean).map(esc).join(", ");
  return `
    <div style="font-size:14px;color:#444;line-height:1.6;">
      <div style="font-weight:600;color:#1a1a1a;">${esc(o.full_name)}</div>
      <div>${esc(o.address)}</div>
      <div>${line2}</div>
      <div>Tel: ${esc(o.phone)}</div>
    </div>`;
}

export function shell(inner: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f6f4f1;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" style="border-collapse:collapse;background:#f6f4f1;padding:24px 0;">
        <tr><td align="center">
          <table role="presentation" width="600" style="max-width:600px;width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">
            <tr><td style="background:#1a1a1a;padding:24px 32px;">
              <div style="font-size:22px;letter-spacing:3px;color:#fff;font-weight:600;">ESSE JEFFE</div>
              <div style="font-size:12px;letter-spacing:2px;color:#b08d57;margin-top:2px;">ABİYE &amp; DAVET</div>
            </td></tr>
            <tr><td style="padding:32px;">${inner}</td></tr>
            <tr><td style="padding:20px 32px;background:#faf9f7;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
              Bu e-posta siparişiniz üzerine otomatik gönderilmiştir. Sorularınız için bize yanıtlayabilirsiniz.
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;
}

function customerHtml(o: OrderEmailData): string {
  const method = METHOD_LABEL[o.payment_method] || o.payment_method;
  const bankInfo = Deno.env.get("ORDER_BANK_INFO") || "";
  const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");

  const transferNote =
    o.payment_method === "transfer" && bankInfo
      ? `<div style="margin-top:20px;padding:16px;background:#fff8ec;border:1px solid #f0dcae;border-radius:6px;">
           <div style="font-weight:600;color:#8a6d2f;margin-bottom:6px;">Havale / EFT Bilgileri</div>
           <div style="font-size:14px;color:#5c4a20;line-height:1.7;white-space:pre-line;">${esc(bankInfo)}</div>
           <div style="font-size:13px;color:#8a6d2f;margin-top:8px;">Açıklama kısmına sipariş numaranızı (<b>${esc(o.order_no)}</b>) yazmayı unutmayın.</div>
         </div>`
      : "";

  const codNote =
    o.payment_method === "cod"
      ? `<p style="font-size:14px;color:#666;margin:16px 0 0;">Ödemeyi teslimat sırasında kapıda yapacaksınız.</p>`
      : "";

  const accountLink = siteUrl
    ? `<p style="font-size:14px;color:#666;margin:24px 0 0;">Siparişinizin durumunu <a href="${siteUrl}/hesap.html" style="color:#b08d57;">hesabım</a> sayfasından takip edebilirsiniz.</p>`
    : "";

  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">Siparişiniz alındı 🎉</h1>
    <p style="font-size:15px;color:#555;margin:0 0 4px;">Merhaba ${esc(o.full_name)},</p>
    <p style="font-size:15px;color:#555;margin:0 0 20px;">Siparişiniz başarıyla oluşturuldu. Hazırlanmaya başlandığında sizi bilgilendireceğiz.</p>

    <table role="presentation" width="100%" style="border-collapse:collapse;background:#faf9f7;border-radius:6px;">
      <tr>
        <td style="padding:14px 16px;font-size:14px;color:#666;">Sipariş No</td>
        <td style="padding:14px 16px;font-size:14px;color:#1a1a1a;font-weight:600;text-align:right;">${esc(o.order_no)}</td>
      </tr>
      <tr>
        <td style="padding:0 16px 14px;font-size:14px;color:#666;">Ödeme Yöntemi</td>
        <td style="padding:0 16px 14px;font-size:14px;color:#1a1a1a;text-align:right;">${esc(method)}</td>
      </tr>
    </table>

    <h2 style="font-size:15px;color:#1a1a1a;margin:28px 0 4px;">Ürünler</h2>
    <table role="presentation" width="100%" style="border-collapse:collapse;">${itemRows(o.items)}</table>
    ${totalsBlock(o)}

    ${transferNote}
    ${codNote}

    <h2 style="font-size:15px;color:#1a1a1a;margin:28px 0 8px;">Teslimat Adresi</h2>
    ${addressBlock(o)}
    ${o.note ? `<p style="font-size:13px;color:#888;margin:12px 0 0;"><b>Not:</b> ${esc(o.note)}</p>` : ""}
    ${accountLink}
  `);
}

function businessHtml(o: OrderEmailData): string {
  const method = METHOD_LABEL[o.payment_method] || o.payment_method;
  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 16px;">Yeni sipariş — ${esc(o.order_no)}</h1>

    <table role="presentation" width="100%" style="border-collapse:collapse;background:#faf9f7;border-radius:6px;">
      <tr><td style="padding:12px 16px;font-size:14px;color:#666;">Ödeme</td>
          <td style="padding:12px 16px;font-size:14px;color:#1a1a1a;text-align:right;font-weight:600;">${esc(method)}</td></tr>
      <tr><td style="padding:0 16px 12px;font-size:14px;color:#666;">Tutar</td>
          <td style="padding:0 16px 12px;font-size:14px;color:#1a1a1a;text-align:right;font-weight:600;">${tl(o.total)}</td></tr>
      <tr><td style="padding:0 16px 12px;font-size:14px;color:#666;">E-posta</td>
          <td style="padding:0 16px 12px;font-size:14px;color:#1a1a1a;text-align:right;">${esc(o.email || "—")}</td></tr>
    </table>

    <h2 style="font-size:15px;color:#1a1a1a;margin:24px 0 4px;">Ürünler</h2>
    <table role="presentation" width="100%" style="border-collapse:collapse;">${itemRows(o.items)}</table>
    ${totalsBlock(o)}

    <h2 style="font-size:15px;color:#1a1a1a;margin:24px 0 8px;">Müşteri / Teslimat</h2>
    ${addressBlock(o)}
    ${o.note ? `<p style="font-size:13px;color:#888;margin:12px 0 0;"><b>Not:</b> ${esc(o.note)}</p>` : ""}
  `);
}

export async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  replyTo?: string,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * Sipariş onay e-postalarını gönderir (müşteri + işletme).
 * Hata fırlatmaz; her zaman bir özet döner. Siparişi ASLA bozmaz.
 */
export async function sendOrderEmails(
  o: OrderEmailData,
  log?: EmailLogger,
): Promise<{ customer: boolean; business: boolean; skipped?: string }> {
  const warn = (event: string, f?: Record<string, unknown>) =>
    log ? log.warn(event, f) : console.warn("[order-email]", event, f || "");
  const err = (event: string, f?: Record<string, unknown>) =>
    log ? log.error(event, f) : console.error("[order-email]", event, f || "");

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  if (!apiKey || !from) {
    warn("email_skipped", { order_no: o.order_no, reason: "no-config" });
    return { customer: false, business: false, skipped: "no-config" };
  }

  const result = { customer: false, business: false };

  // --- müşteri ---
  const customerEmail = String(o.email || "").trim();
  if (customerEmail && customerEmail.indexOf("@") > 0) {
    try {
      await sendViaResend(
        apiKey,
        from,
        customerEmail,
        `Siparişiniz alındı — ${o.order_no}`,
        customerHtml(o),
      );
      result.customer = true;
    } catch (e) {
      err("customer_email_failed", { order_no: o.order_no, detail: (e as Error).message });
    }
  }

  // --- işletme ---
  const notify = String(Deno.env.get("ORDER_NOTIFY_EMAIL") || "").trim();
  if (notify) {
    try {
      await sendViaResend(
        apiKey,
        from,
        notify,
        `Yeni sipariş — ${o.order_no} (${tl(o.total)})`,
        businessHtml(o),
        customerEmail || undefined, // yanıtla → müşteriye gitsin
      );
      result.business = true;
    } catch (e) {
      err("business_email_failed", { order_no: o.order_no, detail: (e as Error).message });
    }
  }

  return result;
}
