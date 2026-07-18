// ============================================================
//  Esse Jeffe — indirim kodu yardımcıları (chat KOPYASI)
//  KAYNAK: backend/edge-functions/_shared/discount.ts — chat farklı
//  deploy ağacında olduğundan _shared import edilemez; claim/release/
//  setDiscountOrder/computeDiscount/normCode oradan birebir kopyadır.
//  Kaynak değişirse BURAYI DA güncelleyin.
//
//  BİLİNÇLİ EKSİK: makeDiscountCode bu kopyaya ALINMADI — sohbet
//  asistanı YENİ kupon üretemez; bu modülde kod üretme yeteneği
//  bulunmaması o kuralın kod düzeyindeki karşılığıdır.
//
//  CHAT'E ÖZGÜ EKLER (kaynakta yok):
//   · listPersonalCoupons — müşteriye TANIMLI (email'e bağlı, single,
//     kullanılmamış, süresi geçmemiş) kuponları listeler. Filtreler
//     claimDiscount'un single claim koşullarını BİREBİR aynalar ki
//     önerilen kupon claim anında reddedilmesin.
//   · validateCouponReadOnly — sipariş özeti anında salt-okuma kupon
//     kontrolü (HİÇBİR ŞEY YAZMAZ); atomik claim yalnız sipariş
//     oluşturulurken yapılır.
//   · fmtCouponOffer — modele verilecek kupon listesi metni (saf).
// ============================================================

// Supabase client'ının burada kullanılan alt kümesi (testlerde taklit edilir).
export interface DbClient {
  from(table: string): any;
  rpc?(fn: string, args?: Record<string, unknown>): any;
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
 * İndirim tutarı: floor(subtotal * percent / 100), asla subtotal'ı aşmaz,
 * maxDiscount (TL tavanı) verilmişse onu da aşmaz. maxDiscount 0/null/
 * undefined = tavansız.
 */
export function computeDiscount(
  subtotal: number,
  percent: number,
  maxDiscount?: number | null,
): number {
  let d = Math.floor((subtotal * percent) / 100);
  const cap = Number(maxDiscount) || 0;
  if (cap > 0) d = Math.min(d, cap);
  return Math.max(0, Math.min(subtotal, d));
}

/**
 * Kodu ATOMİK olarak claim et ve indirim tutarını hesapla.
 * single   → used_at deseni; e-posta bağlıysa yalnız o e-posta kullanır.
 * campaign → claim_campaign_coupon RPC'si.
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
    const discount = computeDiscount(subtotal, percent, data.max_discount);
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
    .select("id, percent, email, max_discount")
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
  const discount = computeDiscount(subtotal, percent, data.max_discount);
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

// ============================================================
//  CHAT'E ÖZGÜ EKLER
// ============================================================

export type PersonalCoupon = {
  code: string;
  percent: number;
  max_discount: number | null;
  min_subtotal: number | null;
  free_shipping: boolean;
  expires_at: string | null;
};

/**
 * Müşteriye TANIMLI, şu an kullanılabilir kuponlar. Yalnız kind='single'
 * (kişiye üretilmiş SEPET-/HOSGELDIN-/SADAKAT- aileleri) listelenir;
 * kampanya kodları herkese açık olduğundan "tanımlı kupon" değildir ve
 * ASLA proaktif önerilmez. expires_at > now() koşulu claimDiscount'la
 * birebir aynıdır (süresiz single kod claim edilemez → önerilmez de).
 */
export async function listPersonalCoupons(
  admin: DbClient,
  email: string,
): Promise<PersonalCoupon[]> {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return [];
  const { data, error } = await admin
    .from("discount_codes")
    .select("code, percent, max_discount, min_subtotal, free_shipping, expires_at")
    .eq("email", e)
    .eq("kind", "single")
    .eq("active", true)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("percent", { ascending: false })
    .limit(5);
  if (error || !data) return [];
  return data as PersonalCoupon[];
}

export type CouponPreview =
  | { ok: true; percent: number; discount: number; freeShipping: boolean }
  | { ok: false; error: string };

/**
 * Sipariş ÖZETİ anında salt-okuma kupon kontrolü — HİÇBİR ŞEY YAZMAZ.
 * Atomik claim yalnız sipariş oluşturulurken (handleCreateOrder / paytr-token)
 * yapılır; böylece onaylanmayan özet hiçbir kodu kilitlemez.
 * single: claimDiscount'un koşulları + e-posta bağı.
 * campaign: aktiflik/süre/min sepet/kullanım limiti + e-posta-başına-tek.
 */
export async function validateCouponReadOnly(
  admin: DbClient,
  code: unknown,
  email: string | null,
  subtotal: number,
): Promise<CouponPreview> {
  const c = normCode(code);
  if (!c) return { ok: false, error: "İndirim kodu boş." };
  const given = String(email || "").trim().toLowerCase();

  const { data, error } = await admin
    .from("discount_codes")
    .select("id, kind, percent, email, max_discount, min_subtotal, max_uses, used_count, free_shipping, active, used_at, expires_at")
    .eq("code", c)
    .maybeSingle();
  if (error) return { ok: false, error: "İndirim kodu doğrulanamadı. Lütfen tekrar deneyin." };
  if (!data || !data.active) return { ok: false, error: "İndirim kodu geçersiz, kullanılmış veya süresi dolmuş." };

  const minSub = Number(data.min_subtotal) || 0;
  if (minSub > 0 && subtotal < minSub) {
    return { ok: false, error: `Bu kupon en az ${minSub.toLocaleString("tr-TR")} TL sepet tutarında geçerli.` };
  }

  if (data.kind === "campaign") {
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return { ok: false, error: "İndirim kodunun süresi dolmuş." };
    }
    if (data.max_uses != null && Number(data.used_count) >= Number(data.max_uses)) {
      return { ok: false, error: "İndirim kodunun kullanım limiti dolmuş." };
    }
    if (given) {
      const { data: red, error: redErr } = await admin
        .from("coupon_redemptions")
        .select("id")
        .eq("coupon_id", data.id)
        .eq("email", given)
        .limit(1)
        .maybeSingle();
      if (redErr) return { ok: false, error: "İndirim kodu doğrulanamadı. Lütfen tekrar deneyin." };
      if (red) return { ok: false, error: "Bu kampanya kodu bu e-posta ile daha önce kullanılmış." };
    }
  } else {
    // single: claim koşullarının salt-okuma karşılığı
    if (data.used_at) return { ok: false, error: "İndirim kodu geçersiz, kullanılmış veya süresi dolmuş." };
    if (!data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
      return { ok: false, error: "İndirim kodu geçersiz, kullanılmış veya süresi dolmuş." };
    }
    const bound = String(data.email || "").trim().toLowerCase();
    if (bound && bound !== given) {
      return { ok: false, error: "Bu indirim kodu başka bir e-posta adresine tanımlı." };
    }
  }

  const percent = Number(data.percent) || 0;
  return {
    ok: true,
    percent,
    discount: computeDiscount(subtotal, percent, data.max_discount),
    freeShipping: !!data.free_shipping,
  };
}

/** Modele verilecek kupon listesi metni (saf). Örn: "SEPET-ABC123 (%10, en fazla 200 TL, son gün 2026-07-30)" */
export function fmtCouponOffer(coupons: PersonalCoupon[]): string {
  return coupons.map((c) => {
    const bits = [`%${c.percent}`];
    if (Number(c.max_discount) > 0) bits.push(`en fazla ${Number(c.max_discount).toLocaleString("tr-TR")} TL`);
    if (Number(c.min_subtotal) > 0) bits.push(`min. sepet ${Number(c.min_subtotal).toLocaleString("tr-TR")} TL`);
    if (c.free_shipping) bits.push("kargo bedava");
    if (c.expires_at) bits.push(`son gün ${String(c.expires_at).slice(0, 10)}`);
    return `${c.code} (${bits.join(", ")})`;
  }).join("; ");
}
