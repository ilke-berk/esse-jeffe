// ============================================================
//  Esse Jeffe — küçük saf yardımcılar (paylaşılan modül)
//  Edge Function'larda tekrarlanan mantık tek yerde; Deno API'si
//  kullanmaz → Node testlerinde de import edilebilir.
// ============================================================

// ---------- Y-1: istemci IP'si + gölge ölçüm ----------

export interface HeaderBag {
  headers: { get(name: string): string | null };
}

/**
 * Kaç GÜVENİLİR proxy hop'una güvendiğimiz (Y-1).
 *   0 → KAPALI: bugünkü davranış birebir korunur (xff[0]) + yalnız ölçüm.
 *   N → cf-connecting-ip → x-real-ip → xff[len-N] → xff[0] önceliği.
 * Env-sürücülü olması kasıtlı: N'i uygulamak yeniden DEPLOY gerektirmez,
 * secret değişimi worker'ı yeniden başlatır → geri alma da saniyeler sürer.
 */
function envInt(name: string, dflt: number): number {
  try {
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    return Math.max(0, parseInt(env?.get?.(name) ?? String(dflt), 10) || 0);
  } catch {
    return dflt; // env izni yok (Node testleri) → güvenli varsayılan
  }
}

const EJ_XFF_TRUSTED_HOPS = envInt("EJ_XFF_TRUSTED_HOPS", 0);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Değer IP BİÇİMİNDE mi? (sahiplik/doğruluk iddiası DEĞİL — yalnız şekil.)
 * Amaç: "unknown", "  ", "<script>" gibi çöp bir halkayı hız sınırı anahtarı
 * ya da PayTR user_ip alanı olarak kullanmamak.
 */
export function looksLikeIp(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (!s || s.length > 45) return false;
  const m4 = IPV4_RE.exec(s);
  if (m4) return m4.slice(1).every((o) => o.length <= 3 && Number(o) <= 255);
  // IPv6: kaba şekil kontrolü (en az bir ':' + yalnız hex/':'/IPv4 kuyruğu)
  return s.includes(":") && /^[0-9a-f:.]+$/i.test(s);
}

/** XFF zincirini temiz parçalara ayır. */
function xffParts(req: HeaderBag): string[] {
  return (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * İstemci IP'si (hız sınırı anahtarı).
 *
 * Y-1 — SORUN: x-forwarded-for'u istemcinin KENDİSİ uydurabilir. Soldan-ilk
 * halkayı okumak, her istekte farklı bir sol halka yazan bir botun IP hız
 * sınırını tamamen atlatmasına izin verir.
 *
 * GÖLGE MODU (varsayılan, hops=0): davranış DEĞİŞMEZ — bugünkü gibi xff[0].
 * cf-connecting-ip / x-real-ip okunur ama YALNIZCA `xff_shape` logunda
 * raporlanır; seçimi etkilemez. Böylece mevcut fn_rate_limit sayaç anahtarları
 * kaymaz (aksi halde canlı sayaçlar bir kez sıfırlanmış gibi olurdu).
 *
 * hops = N > 0: öncelik zinciri devreye girer. Her adımda ŞEKİL doğrulaması
 * yapılır; seçilen değer IP biçiminde değilse zincirde bir sonrakine düşülür.
 * xff[len-N] → N doğrudan "kaç proxy'ye güveniyoruz" demektir (1 = Supabase
 * Edge'in beklenen tek-proxy hali). Zincir N'den kısaysa xff[0]'a clamp edilir.
 */
export function clientIp(
  req: HeaderBag,
  trustedHops: number = EJ_XFF_TRUSTED_HOPS,
): string {
  const parts = xffParts(req);
  const n = Math.max(0, Math.floor(trustedHops) || 0);

  // hops=0 → GÖLGE: bugünkü davranış, şekil kontrolü bile yok (birebir uyum).
  if (n <= 0) return parts[0] || "unknown";

  const cf = (req.headers.get("cf-connecting-ip") || "").trim();
  if (looksLikeIp(cf)) return cf;
  const real = (req.headers.get("x-real-ip") || "").trim();
  if (looksLikeIp(real)) return real;

  const idx = parts.length - n;
  if (idx >= 0 && idx < parts.length && looksLikeIp(parts[idx])) return parts[idx];
  if (looksLikeIp(parts[0])) return parts[0]; // zincir kısa/bozuk → clamp
  return "unknown";
}

/**
 * Gölge ölçüm kaydı: gerçek zincirin ŞEKLİ. Bu veriye bakarak N'i
 * güvenle seçeriz (kaç hop var, son halka sabit mi, cf/x-real geliyor mu).
 * PII değil — IP zaten operasyonel alan olarak loglanıyor.
 */
export function xffShape(
  req: HeaderBag,
  trustedHops: number = EJ_XFF_TRUSTED_HOPS,
): Record<string, unknown> {
  const parts = xffParts(req);
  return {
    len: parts.length, // zincirdeki halka sayısı
    hops: trustedHops, // o an ayarlı N (0 = gölge)
    first: parts[0] ?? null, // bugün kullanılan değer
    last: parts.length ? parts[parts.length - 1] : null, // N=1'de kullanılacak
    cf: req.headers.get("cf-connecting-ip") || null,
    real: req.headers.get("x-real-ip") || null,
  };
}

/**
 * IP'yi dış servise gönderilebilir hale getir. "unknown" gibi değerler
 * PayTR'de geçersiz alan sayılır → IP biçimli bir varsayılana düşülür.
 */
export function ipOrDefault(ip: unknown, fallback = "127.0.0.1"): string {
  return looksLikeIp(ip) ? String(ip).trim() : fallback;
}

/**
 * Sabit zamanlı string karşılaştırma (secret / HMAC doğrulaması için).
 * `!==` ilk farklı baytta döner; yanıt süresi secret'ı bayt bayt sızdırabilir.
 * Uzunluk farkı erken dönüş yapmadan XOR'a katılır (uzunluk zaten gizli değil).
 */
export function timingSafeEqualStr(a: unknown, b: unknown): boolean {
  const s1 = String(a ?? "");
  const s2 = String(b ?? "");
  let diff = s1.length ^ s2.length;
  const n = Math.max(s1.length, s2.length);
  for (let i = 0; i < n; i++) {
    // aralık dışında charCodeAt → NaN; `| 0` ile 0'a iner
    diff |= (s1.charCodeAt(i) | 0) ^ (s2.charCodeAt(i) | 0);
  }
  return diff === 0;
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

/**
 * Origin izinli mi? Liste + (isteğe bağlı) yerel geliştirme.
 * allowLocal=false ile localhost/127.0.0.1 muafiyeti kapanır; prod'da
 * gereksiz bir izin yüzeyi bırakmamak için cors.ts bunu env'den yönetir.
 * Regex iki uçtan çapalı → "https://localhost.kotu-site.com" eşleşmez.
 */
export function isAllowedOrigin(
  origin: string,
  allowed: string[],
  allowLocal = true,
): boolean {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  if (!allowLocal) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** Client origin'i allowlist'e sabitle: izinliyse kendisi, değilse ilk izinli. */
export function resolveOrigin(clientOrigin: unknown, allowed: string[]): string {
  const o = String(clientOrigin || "").trim().replace(/\/+$/, "");
  if (isAllowedOrigin(o, allowed)) return o;
  return allowed[0] || "";
}
