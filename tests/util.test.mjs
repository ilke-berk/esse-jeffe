// Esse Jeffe — _shared/util.ts saf yardımcılarının testleri
// Çalıştır: npm test  (node --experimental-strip-types --test tests/)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientIp,
  normPhone,
  makeOrderNo,
  isValidOrderNo,
  parseOriginList,
  isAllowedOrigin,
  resolveOrigin,
  normVariant,
  canonVariant,
} from "../backend/edge-functions/_shared/util.ts";

const reqWith = (headers) => ({ headers: { get: (n) => headers[n.toLowerCase()] ?? null } });

test("clientIp: x-forwarded-for zincirinin ilk halkasını alır", () => {
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
  assert.equal(clientIp(reqWith({ "x-forwarded-for": " 9.9.9.9 " })), "9.9.9.9");
});

test("clientIp: başlık yoksa 'unknown'", () => {
  assert.equal(clientIp(reqWith({})), "unknown");
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "" })), "unknown");
});

test("normPhone: 0 / +90 / boşluk / tire farklarını yok sayar", () => {
  // Aynı numaranın dört yazımı da aynı sonuca inmeli (track-order eşleşmesi)
  assert.equal(normPhone("0532 123 45 67"), "5321234567");
  assert.equal(normPhone("+90 532 123 45 67"), "5321234567");
  assert.equal(normPhone("90-532-123-4567"), "5321234567");
  assert.equal(normPhone("5321234567"), "5321234567");
});

test("normPhone: boş/geçersiz girişte kısa string döner (10 haneden az)", () => {
  assert.equal(normPhone(null), "");
  assert.equal(normPhone("abc"), "");
  assert.ok(normPhone("123").length < 10);
});

test("makeOrderNo: EJ + YYAAGG + 5 rakam = EJ + 11 rakam", () => {
  const oid = makeOrderNo(new Date(Date.UTC(2026, 6, 2)), () => 0.5);
  assert.equal(oid, "EJ26070250000");
  assert.match(oid, /^EJ\d{11}$/);
});

test("makeOrderNo: ay/gün tek haneliyse sıfırla doldurur, rastgele uçlarda 5 hane kalır", () => {
  assert.match(makeOrderNo(new Date(Date.UTC(2026, 0, 5)), () => 0), /^EJ260105\d{5}$/);
  assert.equal(makeOrderNo(new Date(Date.UTC(2026, 0, 5)), () => 0).slice(-5), "00000");
  // 0.999999 * 1e5 → 99999 (5 haneyi asla aşmaz)
  assert.equal(makeOrderNo(new Date(Date.UTC(2026, 0, 5)), () => 0.999999).slice(-5), "99999");
});

test("isValidOrderNo: 11 (standart) ve 12 (eski kart siparişi) rakamı kabul eder", () => {
  assert.ok(isValidOrderNo("EJ26070112345"));       // 11 rakam — create-order/schema
  assert.ok(isValidOrderNo("EJ260701123456"));      // 12 rakam — eski paytr-token
  assert.ok(!isValidOrderNo("EJ2607011234"));       // 10 rakam — kısa
  assert.ok(!isValidOrderNo("EJ2607011234567"));    // 13 rakam — uzun
  assert.ok(!isValidOrderNo("XX26070112345"));      // yanlış önek
  assert.ok(!isValidOrderNo(""));
  assert.ok(!isValidOrderNo(null));
});

test("üretilen sipariş no'su doğrulamadan geçer (create-order ↔ track-order sözleşmesi)", () => {
  for (const r of [0, 0.123, 0.5, 0.999999]) {
    assert.ok(isValidOrderNo(makeOrderNo(new Date(), () => r)));
  }
});

test("parseOriginList: virgülle böler, sondaki / atar, boşları eler", () => {
  assert.deepEqual(
    parseOriginList("https://essejeffe.com/, https://www.essejeffe.com ,,"),
    ["https://essejeffe.com", "https://www.essejeffe.com"],
  );
  assert.deepEqual(parseOriginList(null), []);
  assert.deepEqual(parseOriginList(""), []);
});

test("isAllowedOrigin: listedekiler + localhost kabul, diğerleri ret", () => {
  const allowed = ["https://essejeffe.com"];
  assert.ok(isAllowedOrigin("https://essejeffe.com", allowed));
  assert.ok(isAllowedOrigin("http://localhost:8080", allowed));
  assert.ok(isAllowedOrigin("http://127.0.0.1:3000", allowed));
  assert.ok(!isAllowedOrigin("https://kotu-site.com", allowed));
  assert.ok(!isAllowedOrigin("", allowed));
  // localhost görünümlü sahte alan adları reddedilmeli
  assert.ok(!isAllowedOrigin("https://localhost.kotu-site.com", allowed));
});

test("resolveOrigin: izinsiz origin ilk izinliye sabitlenir (açık yönlendirme savunması)", () => {
  const allowed = ["https://essejeffe.com", "https://www.essejeffe.com"];
  assert.equal(resolveOrigin("https://kotu-site.com", allowed), "https://essejeffe.com");
  assert.equal(resolveOrigin("https://www.essejeffe.com/", allowed), "https://www.essejeffe.com");
  assert.equal(resolveOrigin(undefined, allowed), "https://essejeffe.com");
  assert.equal(resolveOrigin("https://kotu-site.com", []), "");
});

test("normVariant: baş/son boşluk atılır, iç boşluk teklenir", () => {
  assert.equal(normVariant("  M "), "M");
  assert.equal(normVariant("Gece   Mavisi"), "Gece Mavisi");
  assert.equal(normVariant(null), "");
});

test("canonVariant: listedeki kanonik değere sabitler (case/boşluk/TR duyarsız)", () => {
  // "M " / "m" gibi uydurma yazımlar stok korumasını atlatamamalı
  assert.equal(canonVariant("m", ["S", "M", "L"]), "M");
  assert.equal(canonVariant(" M ", ["S", "M", "L"]), "M");
  assert.equal(canonVariant("gece mavisi", ["Gece Mavisi", "Bordo"]), "Gece Mavisi");
  assert.equal(canonVariant("BORDO", ["Gece Mavisi", "Bordo"]), "Bordo");
  // TR harf: "sİyah" → "Siyah" (toLocaleLowerCase('tr') İ→i)
  assert.equal(canonVariant("sİyah", ["Siyah"]), "Siyah");
});

test("canonVariant: listede olmayan varyant null döner (istek reddedilmeli)", () => {
  assert.equal(canonVariant("XL", ["S", "M", "L"]), null);
  assert.equal(canonVariant("Kırmızı", ["Gece Mavisi", "Bordo"]), null);
});

test("canonVariant: boş giriş '' (varyantsız), boş liste normalize edilmiş girişi döner", () => {
  assert.equal(canonVariant("", ["S", "M"]), "");
  assert.equal(canonVariant(null, ["S", "M"]), "");
  assert.equal(canonVariant(" 36 ", []), "36");
  assert.equal(canonVariant("36", null), "36");
});
