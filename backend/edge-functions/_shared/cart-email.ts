// ============================================================
//  Esse Jeffe — Terk edilmiş sepet hatırlatma e-postası (paylaşılan modül)
//  cart-reminder Edge Function'ı çağırır. Gönderim Resend REST API ile,
//  marka kabuğu (shell) ve para biçimi order-email.ts'ten gelir.
//
//  TASARIM İLKESİ: order-email.ts ile aynı — gönderim hatası ASLA
//  fırlatılmaz denmez; burada İSTİSNA olarak hata FIRLATILIR çünkü
//  çağıran (cart-reminder) başarısız gönderimde reminded_at'ı geri alıp
//  sonraki koşuda yeniden denemek ister. Fail-soft kararı çağırandadır.
//
//  Satır fiyatı bilerek GÖSTERİLMEZ: sepet saatler önce kaydedildi,
//  fiyat değişmiş olabilir; bayat fiyat şikâyet üretir. Güncel fiyat
//  sepette görünür.
//
//  Gerekli secret'lar: RESEND_API_KEY, ORDER_FROM_EMAIL, SITE_URL.
// ============================================================
import { esc, sendViaResend, shell } from "./order-email.ts";

export interface CartReminderItem {
  name: string;
  desc?: string | null;
  color?: string | null;
  size?: string | null;
  qty: number;
}

export interface CartReminderData {
  email: string;
  items: CartReminderItem[];
  code: string; // indirim kodu (SEPET-XXXXXX)
  percent: number; // indirim yüzdesi
  codeValidHours: number; // kodun geçerlilik süresi (saat)
  restoreToken: string; // sepeti geri getiren link token'ı
  unsubUrl: string; // "bu hatırlatmaları kapat" linki (zorunlu)
}

function reminderItemRows(items: CartReminderItem[]): string {
  return items
    .map((it) => {
      const bits = [it.color, it.size].filter(Boolean).map(esc).join(" · ");
      const sub = [it.desc ? esc(it.desc) : "", bits].filter(Boolean).join(" — ");
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:600;color:#1a1a1a;">${esc(it.name)}</div>
            ${sub ? `<div style="font-size:13px;color:#888;margin-top:2px;">${sub}</div>` : ""}
            <div style="font-size:13px;color:#888;margin-top:2px;">Adet: ${esc(it.qty)}</div>
          </td>
        </tr>`;
    })
    .join("");
}

export function cartReminderHtml(d: CartReminderData, siteUrl: string): string {
  const cartUrl = `${siteUrl}/sepet.html?sepet=${encodeURIComponent(d.restoreToken)}&kupon=${
    encodeURIComponent(d.code)
  }`;
  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;">Sepetiniz sizi bekliyor 🛍️</h1>
    <p style="font-size:15px;color:#555;margin:0 0 20px;">
      Beğendiğiniz ürünleri sepetinizde bıraktınız. Onları sizin için ayırdık —
      üstelik size özel bir indirimle.
    </p>

    <div style="margin:0 0 24px;padding:20px;background:#faf6ef;border:1px dashed #b08d57;border-radius:8px;text-align:center;">
      <div style="font-size:13px;letter-spacing:1px;color:#8a6d2f;">SİZE ÖZEL %${d.percent} İNDİRİM KODU</div>
      <div style="font-size:26px;letter-spacing:3px;color:#1a1a1a;font-weight:700;margin:8px 0;">${esc(d.code)}</div>
      <div style="font-size:12px;color:#8a6d2f;">${d.codeValidHours} saat geçerlidir · tek kullanımlık</div>
    </div>

    <h2 style="font-size:15px;color:#1a1a1a;margin:0 0 4px;">Sepetinizdekiler</h2>
    <table role="presentation" width="100%" style="border-collapse:collapse;">${
    reminderItemRows(d.items)
  }</table>

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${cartUrl}"
         style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:4px;font-size:14px;letter-spacing:2px;">
        SEPETİME DÖN
      </a>
    </div>
    <p style="font-size:12px;color:#999;text-align:center;margin:8px 0 0;">
      Bu bağlantı sepetinizi olduğu gibi geri getirir; indirim kodu otomatik uygulanır.
    </p>

    <p style="font-size:11px;color:#bbb;text-align:center;margin:28px 0 0;">
      Bu e-postayı, sepet hatırlatmalarına onay verdiğiniz için aldınız.
      <a href="${d.unsubUrl}" style="color:#999;">Bu hatırlatmaları almak istemiyorum</a>
    </p>
  `);
}

/**
 * Hatırlatma e-postasını gönder. Yapılandırma eksikse sessizce atlar
 * ({sent:false}); Resend hatası FIRLATILIR — çağıran reminded_at'ı geri
 * alıp sonraki cron koşusunda yeniden dener.
 */
export async function sendCartReminder(
  d: CartReminderData,
): Promise<{ sent: boolean; skipped?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");
  if (!apiKey || !from) return { sent: false, skipped: "no-config" };

  await sendViaResend(
    apiKey,
    from,
    d.email,
    `Sepetiniz sizi bekliyor — %${d.percent} indirim kodunuz içeride 🛍️`,
    cartReminderHtml(d, siteUrl),
  );
  return { sent: true };
}
