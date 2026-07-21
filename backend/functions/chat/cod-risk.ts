// ============================================================
//  Esse Jeffe — Kapıda ödeme (COD) risk skorlama (chat KOPYASI)
//  KAYNAK: backend/edge-functions/_shared/cod-risk.ts — chat farklı
//  deploy ağacında olduğundan import edilemez; değişiklik ikisine de
//  uygulanmalı (discount.ts / order-email.ts ile aynı kopya-deseni).
//
//  Katman ayrımı (ileride bağımsız ürüne taşınabilsin diye):
//   · VERİ düzlemi: codrisk_signals RPC'si (schema.sql) yalnız HAM
//     sinyal döner — pencere içinde aynı normalize telefonla iptal /
//     teslim / açık COD sipariş sayıları.
//   · POLİTİKA düzlemi: scoreCodRisk saf fonksiyonu — ağırlıklar,
//     eşikler, seviye eşlemesi tamamen burada. DB'ye dokunmaz.
//   · assessCodRisk ikisini bağlar; RPC hatasında null döner
//     (FAIL-SOFT: risk motoru arızası satışı asla engellemez).
//
//  Deno API'si kullanmaz → Node testlerinde de import edilebilir.
// ============================================================

// --- ayar sabitleri (tuning tek yerde) ---
export const CODRISK_WINDOW_DAYS = 180; // geçmişe bakış penceresi
export const CODRISK_W_CANCELLED = 40; // iptal başına puan
export const CODRISK_CANCELLED_CAP = 80; // iptal puanı tavanı
export const CODRISK_W_OPEN_COD = 15; // ≥2 açık COD siparişi varsa ek puan
export const CODRISK_W_DELIVERED = 10; // teslimat başına düşülen puan (güven)
export const CODRISK_LEVEL_HIGH = 60; // score >= → high
export const CODRISK_LEVEL_MEDIUM = 30; // score >= → medium
export const CODRISK_HOLD_MIN = 60; // score >= → risk_hold (admin onayı)

export interface CodRiskSignals {
  cancelled_count?: number;
  delivered_count?: number;
  open_cod_count?: number;
  window_days?: number;
}

export interface CodRiskReason {
  code: "cancelled_orders" | "delivered_orders" | "open_cod_orders";
  count: number;
  window_days?: number;
}

export interface CodRiskResult {
  score: number;
  level: "low" | "medium" | "high";
  reasons: CodRiskReason[];
}

// Supabase client'ının burada kullanılan alt kümesi (testlerde taklit edilir).
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Saf skorlama: ham sinyaller → skor + seviye + yapısal gerekçeler. */
export function scoreCodRisk(signals: CodRiskSignals): CodRiskResult {
  const cancelled = Math.max(0, Number(signals.cancelled_count) || 0);
  const delivered = Math.max(0, Number(signals.delivered_count) || 0);
  const openCod = Math.max(0, Number(signals.open_cod_count) || 0);
  const windowDays = Math.max(1, Number(signals.window_days) || CODRISK_WINDOW_DAYS);

  let score = Math.min(cancelled * CODRISK_W_CANCELLED, CODRISK_CANCELLED_CAP);
  if (openCod >= 2) score += CODRISK_W_OPEN_COD;
  score = Math.max(0, score - delivered * CODRISK_W_DELIVERED);

  const level = score >= CODRISK_LEVEL_HIGH
    ? "high"
    : score >= CODRISK_LEVEL_MEDIUM
    ? "medium"
    : "low";

  const reasons: CodRiskReason[] = [];
  if (cancelled > 0) {
    reasons.push({ code: "cancelled_orders", count: cancelled, window_days: windowDays });
  }
  if (openCod >= 2) reasons.push({ code: "open_cod_orders", count: openCod });
  if (delivered > 0) reasons.push({ code: "delivered_orders", count: delivered });

  return { score, level, reasons };
}

/**
 * Telefonun iptal geçmişini RPC'den çekip skorla.
 * FAIL-SOFT: RPC hatası ya da ok:false (ör. telefon çok kısa) → null;
 * çağıran log'lar ve risk kolonlarını null bırakır — sipariş engellenmez.
 */
export async function assessCodRisk(
  admin: RpcClient,
  opts: { phone: string; windowDays?: number },
): Promise<CodRiskResult | null> {
  try {
    const { data, error } = await admin.rpc("codrisk_signals", {
      p_phone: String(opts.phone || ""),
      p_window_days: opts.windowDays ?? CODRISK_WINDOW_DAYS,
    });
    if (error) return null;
    const sig = data as (CodRiskSignals & { ok?: boolean }) | null;
    if (!sig || sig.ok !== true) return null;
    return scoreCodRisk(sig);
  } catch {
    return null;
  }
}
