// ============================================================
//  Esse Jeffe — sadakat programı yardımcıları (paylaşılan modül)
//
//  Kullananlar: paytr-callback (kart ödemesi onaylanınca) ve
//  loyalty-accrue EF (admin COD/havale 'ödendi' işaretleyince).
//
//  Akış: loyalty_accrue RPC'si (atomik: sipariş damgası + ledger +
//  yeni SADAKAT-… kodu) → başarıysa müşteriye kupon e-postası.
//  FAIL-SOFT: hiçbir hata çağıranı (ödeme callback'i / admin yanıtı)
//  bozmaz. Mail gönderilemezse kod SİLİNMEZ (hoş geldinden farklı:
//  ilerleme kaydedildi ve eski kod kapatıldı; silmek merdiveni yok
//  ederdi) — kod admin-kuponlar.html'de görünür, destek iletebilir.
//
//  loyaltyConfig/loyaltyHtml Deno API'si kullanmaz → Node testlerinde
//  de çalışır (env getter parametreyle enjekte edilir).
// ============================================================

import { esc, sendViaResend, shell, tl } from "./order-email.ts";
import { errMsg, type Logger } from "./log.ts";
import type { DbClient } from "./discount.ts";

export interface LoyaltyConfig {
  step: number; // her ödenen sipariş +% (varsayılan 5)
  maxPercent: number; // yüzde üst limiti (varsayılan 50)
  minSubtotal: number; // birikim için min. sepet TL (varsayılan 1000)
  maxDiscount: number; // indirim TL tavanı, 0 = limitsiz (varsayılan 1500)
  validDays: number; // kod geçerliliği gün (varsayılan 180)
}

type EnvGetter = (key: string) => string | undefined;

/** LOYALTY_* env değişkenlerini varsayılan + clamp ile oku. */
export function loyaltyConfig(env: EnvGetter): LoyaltyConfig {
  const int = (key: string, def: number): number => {
    const v = parseInt(env(key) || "", 10);
    return Number.isFinite(v) ? v : def;
  };
  return {
    step: Math.min(90, Math.max(1, int("LOYALTY_STEP_PERCENT", 5))),
    maxPercent: Math.min(90, Math.max(1, int("LOYALTY_MAX_PERCENT", 50))),
    minSubtotal: Math.max(0, int("LOYALTY_MIN_SUBTOTAL", 1000)),
    maxDiscount: Math.max(0, int("LOYALTY_MAX_DISCOUNT", 1500)),
    validDays: Math.max(1, int("LOYALTY_VALID_DAYS", 180)),
  };
}

export interface LoyaltyAccrued {
  code: string;
  percent: number;
  ordersCount: number;
  email: string;
  expiresAt: string; // ISO
  maxDiscount: number | null;
}

export type AccrueResult =
  | ({ accrued: true } & LoyaltyAccrued)
  | { accrued: false; reason: string };

/** Kupon e-postası gövdesi (saf fonksiyon — testlerde doğrudan çağrılır). */
export function loyaltyHtml(d: LoyaltyAccrued, siteUrl: string): string {
  const expiry = new Date(d.expiresAt).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const capNote = d.maxDiscount && d.maxDiscount > 0
    ? ` (en fazla ${tl(d.maxDiscount)} indirim)`
    : "";
  return shell(`
    <h1 style="font-size:20px;color:#1a1a1a;margin:0 0 16px;">Teşekkürler! Sadakat indiriminiz: %${esc(d.percent)}</h1>
    <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 20px;">
      Siparişiniz için teşekkür ederiz. Sadakat programımızda
      ${d.ordersCount > 1 ? `üst üste <b>${esc(d.ordersCount)}. siparişinizle</b> indiriminiz <b>%${esc(d.percent)}</b>'e yükseldi` : `<b>%${esc(d.percent)}</b> indirim kazandınız`}.
      Aşağıdaki kodu bir sonraki siparişinizde sepette kullanabilirsiniz${capNote}.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <div style="display:inline-block;background:#faf7f2;border:2px dashed #b08d57;border-radius:6px;padding:16px 32px;">
        <div style="font-size:12px;letter-spacing:2px;color:#8a6d2f;margin-bottom:6px;">İNDİRİM KODUNUZ</div>
        <div style="font-size:24px;letter-spacing:3px;color:#1a1a1a;font-weight:700;">${esc(d.code)}</div>
      </div>
    </div>
    <p style="font-size:13px;color:#888;line-height:1.7;margin:0 0 20px;">
      Kupon kullanılmadıkça her yeni siparişinizde indiriminiz artmaya devam eder;
      kuponu kullandığınızda birikim yeniden başlar. Bu kod
      <b>${esc(expiry)}</b> tarihine kadar geçerlidir ve yalnız bu e-posta
      adresiyle verilen siparişlerde kullanılabilir.
    </p>
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${siteUrl}/koleksiyon.html"
         style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:4px;font-size:14px;letter-spacing:2px;">
        KOLEKSİYONU KEŞFET
      </a>
    </div>
  `);
}

/**
 * Siparişin sadakat birikimini işle + müşteriye kupon e-postası gönder.
 * FAIL-SOFT: her hata loglanır ve accrued:false döner; çağıran akış
 * asla bozulmaz. opts.env / opts.send testlerde enjekte edilir.
 */
export async function accrueLoyalty(
  admin: DbClient,
  orderId: string,
  log: Logger,
  opts: { env?: EnvGetter; send?: typeof sendViaResend } = {},
): Promise<AccrueResult> {
  const env: EnvGetter = opts.env ?? ((k) => Deno.env.get(k));
  const send = opts.send ?? sendViaResend;
  const cfg = loyaltyConfig(env);
  try {
    const { data, error } = await admin.rpc!("loyalty_accrue", {
      p_order_id: orderId,
      p_step: cfg.step,
      p_max_percent: cfg.maxPercent,
      p_min_subtotal: cfg.minSubtotal,
      p_max_discount: cfg.maxDiscount,
      p_valid_days: cfg.validDays,
    });
    if (error || !data) {
      log.error("loyalty_rpc_error", { detail: error?.message || "no-data" });
      return { accrued: false, reason: "rpc-error" };
    }
    if (!data.ok) {
      log.info("loyalty_skip", { reason: String(data.reason || "unknown") });
      return { accrued: false, reason: String(data.reason || "unknown") };
    }

    const result: LoyaltyAccrued = {
      code: String(data.code),
      percent: Number(data.percent) || 0,
      ordersCount: Number(data.orders_count) || 1,
      email: String(data.email),
      expiresAt: String(data.expires_at),
      maxDiscount: data.max_discount == null ? null : Number(data.max_discount),
    };

    const apiKey = env("RESEND_API_KEY");
    const from = env("ORDER_FROM_EMAIL");
    if (!apiKey || !from) {
      log.warn("loyalty_email_skipped", { reason: "no-config" });
      return { accrued: true, ...result };
    }
    const siteUrl = (env("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");
    try {
      await send(
        apiKey,
        from,
        result.email,
        `Sadakat indiriminiz: %${result.percent} 🎁 — bir sonraki siparişinizde geçerli`,
        loyaltyHtml(result, siteUrl),
      );
      log.info("loyalty_accrued", { percent: result.percent, orders: result.ordersCount });
    } catch (e) {
      // Kod SİLİNMEZ — ilerleme kaydedildi, admin panelden iletilebilir.
      log.error("loyalty_email_failed", { detail: errMsg(e) });
    }
    return { accrued: true, ...result };
  } catch (e) {
    log.error("loyalty_error", { detail: errMsg(e) });
    return { accrued: false, reason: "error" };
  }
}
