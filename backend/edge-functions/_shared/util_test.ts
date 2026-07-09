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
  resolveOrigin,
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
});

Deno.test("resolveOrigin: izinliyse kendisi, değilse ilk izinli", () => {
  const allow = ["https://a.com", "https://b.com"];
  assertEquals(resolveOrigin("https://b.com", allow), "https://b.com");
  assertEquals(resolveOrigin("https://evil.com", allow), "https://a.com");
  assertEquals(resolveOrigin("http://localhost:5500", allow), "http://localhost:5500");
  assertEquals(resolveOrigin("https://evil.com", []), "");
});

Deno.test("clientIp: x-forwarded-for zincirinin ilk halkası", () => {
  const req = (xff: string | null) => ({ headers: { get: (n: string) => (n === "x-forwarded-for" ? xff : null) } });
  assertEquals(clientIp(req("1.2.3.4, 5.6.7.8")), "1.2.3.4");
  assertEquals(clientIp(req("9.9.9.9")), "9.9.9.9");
  assertEquals(clientIp(req(null)), "unknown");
});
