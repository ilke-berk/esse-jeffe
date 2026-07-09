// ============================================================
//  Esse Jeffe — küçük saf yardımcılar (paylaşılan modül)
//  Edge Function'larda tekrarlanan mantık tek yerde; Deno API'si
//  kullanmaz → Node testlerinde de import edilebilir.
// ============================================================

/** İstemci IP'si: x-forwarded-for zincirinin ilk halkası. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

/** Telefonu yalnız rakamlara indir, son 10 haneyi al (0 / +90 farkını yok say). */
export function normPhone(v: unknown): string {
  const digits = String(v ?? "").replace(/\D+/g, "");
  return digits.slice(-10);
}

/**
 * Sipariş numarası: EJ + YYAAGG + 5 rakam = EJ + 11 rakam.
 * create-order, paytr-token ve schema.sql varsayılanı AYNI biçimi kullanır;
 * track-order bu biçimi doğrular (bkz. isValidOrderNo). Tarih/rastgelelik
 * test edilebilirlik için enjekte edilebilir.
 */
export function makeOrderNo(now: Date = new Date(), rand: () => number = Math.random): string {
  const ymd =
    String(now.getUTCFullYear()).slice(2) +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0");
  const rnd = Math.floor(rand() * 1e5).toString().padStart(5, "0");
  return "EJ" + ymd + rnd; // yalnız harf+rakam → PayTR merchant_oid kuralına uygun
}

/**
 * Sipariş no biçim kontrolü. EJ + 11 rakam (standart) kabul edilir;
 * EJ + 12 rakam da kabul edilir çünkü eski paytr-token 6 haneli rastgele
 * ek üretiyordu — o dönemki kart siparişleri de takip edilebilsin.
 */
export function isValidOrderNo(v: unknown): boolean {
  return /^EJ\d{11,12}$/.test(String(v ?? ""));
}

/** Varyant adı normalize: baş/son boşluk at, iç boşlukları tekle. */
export function normVariant(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Client'tan gelen renk/beden değerini ürünün GERÇEK listesine sabitle
 * (case + boşluk duyarsız, TR harf kuralları). Dönüş:
 *   ""     → varyant seçilmemiş (boş giriş) — geçerli
 *   string → listedeki kanonik değer (liste boşsa normalize edilmiş giriş)
 *   null   → listede YOK — çağıran isteği reddetmeli.
 * Neden: reserve_stock_bulk satır bulamazsa "takipsiz → sınırsız" sayar;
 * "M " / "m" gibi uydurma varyant stok korumasını atlatırdı.
 */
export function canonVariant(v: unknown, allowed: unknown): string | null {
  const val = normVariant(v);
  if (!val) return "";
  const list = Array.isArray(allowed) ? allowed : [];
  if (!list.length) return val;
  const want = val.toLocaleLowerCase("tr");
  for (const a of list) {
    const c = normVariant(a);
    if (c && c.toLocaleLowerCase("tr") === want) return c;
  }
  return null;
}

/** "a, b , c" → ["a","b","c"] — origin listesi (sondaki / atılır, boşlar elenir). */
export function parseOriginList(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Origin izinli mi? Liste + yerel geliştirme (localhost/127.0.0.1). */
export function isAllowedOrigin(origin: string, allowed: string[]): boolean {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** Client origin'i allowlist'e sabitle: izinliyse kendisi, değilse ilk izinli. */
export function resolveOrigin(clientOrigin: unknown, allowed: string[]): string {
  const o = String(clientOrigin || "").trim().replace(/\/+$/, "");
  if (isAllowedOrigin(o, allowed)) return o;
  return allowed[0] || "";
}
