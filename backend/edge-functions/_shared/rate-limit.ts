// ============================================================
//  Esse Jeffe — IP başına hız sınırı (paylaşılan modül)
//  submit-form / track-order'daki sayaç-tablosu desenini tek yerde toplar.
//
//  Desen: her istekte
//   1) 24 saatten eski sayaç kayıtları silinir (tablo şişmesin),
//   2) pencere içindeki kayıt sayısı sayılır; sınır aşıldıysa reddedilir,
//   3) çağıran uygun anda recordRateLimit ile sayaca 1 kayıt ekler
//      (kimi fonksiyon her denemeyi, kimi yalnız başarılı işlemi sayar).
//
//  Tablolar: form_rate_limit (kind'lı), order_track_rate_limit (kind'sız),
//  fn_rate_limit (genel amaçlı, kind'lı — sipariş & istemci hata raporu).
//  Hepsinde RLS açık ve client politikası YOK → yalnız service_role erişir.
//
//  Deno API'si kullanmaz → Node testlerinde de import edilebilir.
// ============================================================

export interface RateLimitOpts {
  table: string; // sayaç tablosu adı
  ip: string;
  kind?: string; // tabloda kind kolonu varsa filtre/etiket
  max: number; // pencere içinde izin verilen istek sayısı
  windowMin: number; // pencere süresi (dakika)
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  error?: string; // DB hatası (çağıran 500 dönebilir)
}

// Supabase client'ının burada kullanılan alt kümesi (testlerde taklit edilir).
export interface DbClient {
  from(table: string): any;
}

// Saf yardımcı: pencere ve temizlik eşiği (test edilebilir).
export function rateLimitCutoffs(
  nowMs: number,
  windowMin: number,
): { cutoff: string; purgeBefore: string } {
  return {
    cutoff: new Date(nowMs - windowMin * 60 * 1000).toISOString(),
    purgeBefore: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * IP'nin pencere içindeki istek sayısını kontrol et.
 * Sayaç kaydı EKLEMEZ — çağıran, saymak istediği anda recordRateLimit çağırır.
 */
export async function checkRateLimit(
  admin: DbClient,
  opts: RateLimitOpts,
  nowMs: number = Date.now(),
): Promise<RateLimitResult> {
  const { cutoff, purgeBefore } = rateLimitCutoffs(nowMs, opts.windowMin);

  // eski kayıtları temizle (tablo şişmesin) — 24 saat öncesi
  await admin.from(opts.table).delete().lt("created_at", purgeBefore);

  let q = admin
    .from(opts.table)
    .select("id", { count: "exact", head: true })
    .eq("ip", opts.ip);
  if (opts.kind) q = q.eq("kind", opts.kind);
  const { count, error } = await q.gte("created_at", cutoff);

  if (error) return { allowed: false, count: 0, error: error.message };
  const n = count ?? 0;
  return { allowed: n < opts.max, count: n };
}

/** Sayaç tablosuna 1 deneme kaydı ekle. */
export async function recordRateLimit(
  admin: DbClient,
  table: string,
  ip: string,
  kind?: string,
): Promise<void> {
  const row: Record<string, unknown> = { ip };
  if (kind) row.kind = kind;
  await admin.from(table).insert(row);
}
