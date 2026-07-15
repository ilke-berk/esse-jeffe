// ============================================================
//  Esse Jeffe — indirim kodu + terk edilmiş sepet yardımcıları
//  (paylaşılan modül)
//
//  Kullananlar: cart-reminder (kod üretimi), create-order & paytr-token
//  (claim/release), paytr-callback & create-order (recovered işaretleme).
//
//  İKİ KOD TÜRÜ (discount_codes.kind):
//   · 'single'   → tek kullanımlık SEPET-… kodları. ATOMİK claim:
//     `update ... set used_at=now() where used_at is null returning *`.
//     İki eşzamanlı sipariş aynı kodu kullanamaz; kaybeden sorgudan
//     satır dönmez.
//   · 'campaign' → çok kullanımlı kampanya kodları (YAZ20). Claim SQL
//     RPC'sinde yapılır (claim_campaign_coupon): FOR UPDATE satır kilidi
//     + unique(coupon_id,email) redemption → sayaç ve e-posta-başına-tek
//     kuralı yarış koşulsuz.
//  Sipariş akışı sonradan başarısız olursa releaseDiscount ile kod geri
//  açılır (restore_stock_bulk deseninin kupon karşılığı).
//
//  makeDiscountCode Deno API'si kullanmaz → Node testlerinde de çalışır.
// ============================================================

// Supabase client'ının burada kullanılan alt kümesi (testlerde taklit edilir).
export interface DbClient {
  from(table: string): any;
  rpc?(fn: string, args?: Record<string, unknown>): any;
}

// Karışmaya açık karakterler (0/O, 1/I/L) alfabede YOK — telefonla
// okunabilir, elle yazılabilir kod.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "SEPET-XXXXXX" biçiminde rastgele indirim kodu üret. */
export function makeDiscountCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return "SEPET-" + s;
}

/** Kod girdisini normalize et: boşlukları at, büyük harfe çevir. */
export function normCode(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "").toUpperCase();
}

export type ClaimRef = {
  id: string;
  kind: "single" | "campaign";
  redemptionId: string | null; // yalnız campaign'de dolu
};

export type ClaimResult =
  | (ClaimRef & { ok: true; percent: number; discount: number; freeShipping: boolean })
  | { ok: false; error: string };

/**
 * Kodu ATOMİK olarak claim et ve indirim tutarını hesapla.
 * single   → mevcut used_at deseni; e-posta bağlıysa yalnız o e-posta kullanır.
 * campaign → claim_campaign_coupon RPC'si (aktiflik/süre/min sepet/limit/
 *            e-posta-başına-tek kuralları DB işleminde denetlenir).
 * discount = floor(subtotal * percent / 100); toplamı asla eksiye düşürmez.
 */
export async function claimDiscount(
  admin: DbClient,
  code: unknown,
  email: string | null,
  subtotal: number,
): Promise<ClaimResult> {
  const c = normCode(code);
  if (!c) return { ok: false, error: "İndirim kodu boş." };
  const given = String(email || "").trim().toLowerCase();

  // Tür ayrımı: kod hangi yoldan claim edilecek?
  const { data: kindRow, error: kindErr } = await admin
    .from("discount_codes")
    .select("kind")
    .eq("code", c)
    .maybeSingle();
  if (kindErr) return { ok: false, error: "İndirim kodu doğrulanamadı. Lütfen tekrar deneyin." };
  if (!kindRow) return { ok: false, error: "İndirim kodu geçersiz, kullanılmış veya süresi dolmuş." };

  if (kindRow.kind === "campaign") {
    const { data, error } = await admin.rpc!("claim_campaign_coupon", {
      p_code: c,
      p_email: given,
      p_subtotal: subtotal,
    });
    if (error || !data) {
      return { ok: false, error: "İndirim kodu doğrulanamadı. Lütfen tekrar deneyin." };
    }
    if (!data.ok) return { ok: false, error: String(data.error || "İndirim kodu geçersiz.") };
    const percent = Number(data.percent) || 0;
    const discount = Math.max(0, Math.min(subtotal, Math.floor((subtotal * percent) / 100)));
    return {
      ok: true,
      id: String(data.id),
      kind: "campaign",
      redemptionId: String(data.redemption_id),
      percent,
      discount,
      freeShipping: !!data.free_shipping,
    };
  }

  // Atomik claim: yalnız kullanılmamış + süresi geçmemiş + iptal edilmemiş
  // (active) kod satır döndürür.
  const { data, error } = await admin
    .from("discount_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", c)
    .eq("active", true)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, percent, email")
    .maybeSingle();
  if (error) return { ok: false, error: "İndirim kodu doğrulanamadı. Lütfen tekrar deneyin." };
  if (!data) return { ok: false, error: "İndirim kodu geçersiz, kullanılmış veya süresi dolmuş." };

  const ref: ClaimRef = { id: data.id, kind: "single", redemptionId: null };

  // E-posta bağı: kod belirli bir müşteriye üretildiyse yalnız o kullanır.
  const bound = String(data.email || "").trim().toLowerCase();
  if (bound && bound !== given) {
    await releaseDiscount(admin, ref); // yanlış sahip → claim'i geri aç
    return { ok: false, error: "Bu indirim kodu başka bir e-posta adresine tanımlı." };
  }

  const percent = Number(data.percent) || 0;
  const discount = Math.max(0, Math.min(subtotal, Math.floor((subtotal * percent) / 100)));
  return { ok: true, ...ref, percent, discount, freeShipping: false };
}

/** Claim'i geri al (sipariş akışı başarısız oldu) — kod yeniden kullanılabilir. */
export async function releaseDiscount(admin: DbClient, ref: ClaimRef): Promise<void> {
  try {
    if (ref.kind === "campaign") {
      await admin.rpc!("release_campaign_redemption", { p_redemption_id: ref.redemptionId });
    } else {
      await admin.from("discount_codes").update({ used_at: null, order_id: null }).eq("id", ref.id);
    }
  } catch { /* fail-soft: kod kilitli kalırsa en kötü müşteri desteğe yazar */ }
}

/** Kodu, oluşturulan siparişe bağla (raporlama + başarısız kartta geri açma). */
export async function setDiscountOrder(
  admin: DbClient,
  ref: ClaimRef,
  orderId: string,
): Promise<void> {
  try {
    if (ref.kind === "campaign") {
      await admin.from("coupon_redemptions").update({ order_id: orderId }).eq("id", ref.redemptionId);
    } else {
      await admin.from("discount_codes").update({ order_id: orderId }).eq("id", ref.id);
    }
  } catch { /* fail-soft */ }
}

/**
 * Siparişe bağlı kuponu türünden bağımsız geri aç (paytr-callback: ödeme
 * başarısız). RPC idempotenttir; ikinci çağrı hiçbir şey yapmaz.
 */
export async function releaseDiscountByOrder(admin: DbClient, orderId: string): Promise<void> {
  try {
    await admin.rpc!("release_coupon_by_order", { p_order_id: orderId });
  } catch { /* fail-soft */ }
}

/**
 * Sipariş tamamlandı → müşterinin terk edilmiş sepetini "kurtarıldı" işaretle
 * (hatırlatma gitmesin). Üye user_id ile, misafir e-posta ile eşleşir.
 * Fail-soft: hata siparişi ASLA bozmaz.
 */
export async function markCartRecovered(
  admin: DbClient,
  who: { userId?: string | null; email?: string | null },
): Promise<void> {
  const email = String(who.email || "").trim().toLowerCase();
  try {
    if (who.userId) {
      await admin
        .from("abandoned_carts")
        .update({ recovered_at: new Date().toISOString() })
        .eq("user_id", who.userId)
        .is("recovered_at", null);
    }
    if (email) {
      await admin
        .from("abandoned_carts")
        .update({ recovered_at: new Date().toISOString() })
        .eq("email", email)
        .is("recovered_at", null);
    }
  } catch { /* fail-soft */ }
}
