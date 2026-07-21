// deno test backend/edge-functions/_shared/util_test.ts
import { assertEquals, assertMatch } from "jsr:@std/assert";
import {
  canonVariant,
  clientIp,
  isAllowedOrigin,
  isValidOrderNo,
  makeOrderNo,
  normPhone,
  normVariant,
  parseOriginList,
  ipOrDefault,
  looksLikeIp,
  resolveOrigin,
  timingSafeEqualStr,
  xffShape,
} from "./util.ts";

Deno.test("normVariant: trim + iç boşluk teklenir", () => {
  assertEquals(normVariant("  M "), "M");
  assertEquals(normVariant("Gece   Mavisi"), "Gece Mavisi");
  assertEquals(normVariant(null), "");
});

Deno.test("canonVariant: kanonik değere sabitler; listede yoksa null", () => {
  assertEquals(canonVariant("m", ["S", "M", "L"]), "M");
  assertEquals(canonVariant(" M ", ["S", "M", "L"]), "M");
  assertEquals(canonVariant("gece mavisi", ["Gece Mavisi", "Bordo"]), "Gece Mavisi");
  assertEquals(canonVariant("XL", ["S", "M", "L"]), null);
  assertEquals(canonVariant("", ["S", "M"]), "");
  assertEquals(canonVariant(" 36 ", []), "36");
});

Deno.test("normPhone: yalnız rakam, son 10 hane", () => {
  assertEquals(normPhone("0532 123 45 67"), "5321234567");
  assertEquals(normPhone("+90 532 123 45 67"), "5321234567");
  assertEquals(normPhone("(532) 123-4567"), "5321234567");
  assertEquals(normPhone(null), "");
  assertEquals(normPhone(undefined), "");
});

Deno.test("isValidOrderNo: EJ + 11 veya 12 rakam", () => {
  assertEquals(isValidOrderNo("EJ26070212345"), true); // 11 rakam
  assertEquals(isValidOrderNo("EJ260702123456"), true); // 12 (eski kart)
  assertEquals(isValidOrderNo("EJ123"), false);
  assertEquals(isValidOrderNo("XX26070212345"), false);
  assertEquals(isValidOrderNo(""), false);
  assertEquals(isValidOrderNo(null), false);
});

Deno.test("makeOrderNo: enjekte edilen tarih/rastgelelikle deterministik", () => {
  const d = new Date("2026-07-02T10:00:00Z");
  assertEquals(makeOrderNo(d, () => 0.5), "EJ26070250000");
  assertEquals(makeOrderNo(d, () => 0), "EJ26070200000");
  // biçim her zaman EJ + 11 rakam
  assertMatch(makeOrderNo(d, () => 0.99999), /^EJ\d{11}$/);
});

Deno.test("parseOriginList: böl, trim, sondaki / at, boşları ele", () => {
  assertEquals(parseOriginList("https://a.com, https://b.com/ ,https://c.com"), [
    "https://a.com",
    "https://b.com",
    "https://c.com",
  ]);
  assertEquals(parseOriginList(""), []);
  assertEquals(parseOriginList(null), []);
});

Deno.test("isAllowedOrigin: liste + yerel geliştirme", () => {
  const allow = ["https://essejeffe.com"];
  assertEquals(isAllowedOrigin("https://essejeffe.com", allow), true);
  assertEquals(isAllowedOrigin("https://evil.com", allow), false);
  assertEquals(isAllowedOrigin("http://localhost:5500", []), true);
  assertEquals(isAllowedOrigin("http://127.0.0.1:3000", []), true);
  assertEquals(isAllowedOrigin("", allow), false);
  // allowLocal=false (prod varsayılanı): yerel muafiyet kapanır, liste çalışır
  assertEquals(isAllowedOrigin("http://localhost:5500", [], false), false);
  assertEquals(isAllowedOrigin("http://127.0.0.1:3000", [], false), false);
  assertEquals(isAllowedOrigin("https://essejeffe.com", allow, false), true);
});

Deno.test("resolveOrigin: izinliyse kendisi, değilse ilk izinli", () => {
  const allow = ["https://a.com", "https://b.com"];
  assertEquals(resolveOrigin("https://b.com", allow), "https://b.com");
  assertEquals(resolveOrigin("https://evil.com", allow), "https://a.com");
  assertEquals(resolveOrigin("http://localhost:5500", allow), "http://localhost:5500");
  assertEquals(resolveOrigin("https://evil.com", []), "");
});

const xffReq = (xff: string | null) => ({
  headers: { get: (n: string) => (n === "x-forwarded-for" ? xff : null) },
});

Deno.test("clientIp: varsayılan (N=0) x-forwarded-for zincirinin ilk halkası", () => {
  assertEquals(clientIp(xffReq("1.2.3.4, 5.6.7.8")), "1.2.3.4");
  assertEquals(clientIp(xffReq("9.9.9.9")), "9.9.9.9");
  assertEquals(clientIp(xffReq(null)), "unknown");
});

// cf-connecting-ip / x-real-ip de verebilen istek taklidi
const hdrReq = (h: Record<string, string>) => ({
  headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
});

Deno.test("clientIp: hops=0 GÖLGE — cf/x-real varken bile sayaç anahtarı kaymaz", () => {
  assertEquals(
    clientIp(hdrReq({ "x-forwarded-for": "1.1.1.1, 9.9.9.9", "cf-connecting-ip": "8.8.8.8" }), 0),
    "1.1.1.1",
  );
  assertEquals(clientIp(hdrReq({ "x-real-ip": "8.8.8.8" }), 0), "unknown");
});

Deno.test("clientIp: hops>0 öncelik zinciri + şekil doğrulaması (Y-1)", () => {
  const xff = "1.1.1.1, 9.9.9.9";
  assertEquals(clientIp(hdrReq({ "x-forwarded-for": xff, "cf-connecting-ip": "8.8.8.8" }), 1), "8.8.8.8");
  assertEquals(clientIp(hdrReq({ "x-forwarded-for": xff, "x-real-ip": "7.7.7.7" }), 1), "7.7.7.7");
  // Saldırgan sol halkayı değiştirse de anahtar sabit kalır
  assertEquals(clientIp(xffReq("1.1.1.1, 9.9.9.9"), 1), "9.9.9.9");
  assertEquals(clientIp(xffReq("2.2.2.2, 9.9.9.9"), 1), "9.9.9.9");
  assertEquals(clientIp(xffReq("1.1.1.1, 9.9.9.9, 10.0.0.1"), 2), "9.9.9.9");
  // Zincir N'den kısa → xff[0]'a clamp
  assertEquals(clientIp(xffReq("9.9.9.9"), 3), "9.9.9.9");
  // Çöp halka atlanır
  assertEquals(clientIp(hdrReq({ "cf-connecting-ip": "unknown", "x-real-ip": "7.7.7.7" }), 1), "7.7.7.7");
  assertEquals(clientIp(xffReq("1.1.1.1, bozuk"), 1), "1.1.1.1");
  assertEquals(clientIp(xffReq("bozuk, cöp"), 1), "unknown");
  assertEquals(clientIp(xffReq(null), 1), "unknown");
});

Deno.test("looksLikeIp / ipOrDefault: şekil kontrolü ve dış servis varsayılanı", () => {
  assertEquals(looksLikeIp("9.9.9.9"), true);
  assertEquals(looksLikeIp("2001:db8::1"), true);
  assertEquals(looksLikeIp("256.1.1.1"), false);
  assertEquals(looksLikeIp("unknown"), false);
  assertEquals(ipOrDefault("9.9.9.9"), "9.9.9.9");
  assertEquals(ipOrDefault("unknown"), "127.0.0.1"); // PayTR'ye çöp gitmez
});

Deno.test("xffShape: ölçüm kaydı zincirin şeklini taşır", () => {
  const s = xffShape(hdrReq({ "x-forwarded-for": "1.1.1.1, 9.9.9.9", "cf-connecting-ip": "8.8.8.8" }), 0);
  assertEquals(s.len, 2);
  assertEquals(s.hops, 0);
  assertEquals(s.first, "1.1.1.1");
  assertEquals(s.last, "9.9.9.9");
  assertEquals(s.cf, "8.8.8.8");
  assertEquals(s.real, null);
});

Deno.test("timingSafeEqualStr: eşitlik/uzunluk/tip", () => {
  assertEquals(timingSafeEqualStr("secret", "secret"), true);
  assertEquals(timingSafeEqualStr("secret", "secrft"), false);
  assertEquals(timingSafeEqualStr("secret", "secre"), false); // kısa
  assertEquals(timingSafeEqualStr("secret", "secrets"), false); // uzun
  assertEquals(timingSafeEqualStr(null, "secret"), false);
  assertEquals(timingSafeEqualStr(undefined, "secret"), false);
  // ilk bayt farkı ile son bayt farkı AYNI sonucu verir (erken dönüş yok)
  assertEquals(timingSafeEqualStr("xecret", "secret"), false);
  assertEquals(timingSafeEqualStr("secrex", "secret"), false);
});
