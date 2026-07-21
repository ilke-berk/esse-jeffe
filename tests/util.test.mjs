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
  timingSafeEqualStr,
  looksLikeIp,
  ipOrDefault,
  xffShape,
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

test("clientIp: hops=0 GÖLGE — cf/x-real varken bile davranış değişmez (Y-1)", () => {
  // Gölge modunun tek sözleşmesi: sayaç anahtarı KAYMAZ. cf-connecting-ip
  // gelse bile hops=0'da seçim hâlâ xff[0] — canlı fn_rate_limit sayaçları
  // bir kez sıfırlanmış gibi olmasın diye.
  assert.equal(
    clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 9.9.9.9", "cf-connecting-ip": "8.8.8.8" }), 0),
    "1.1.1.1",
  );
  assert.equal(clientIp(reqWith({ "x-real-ip": "8.8.8.8" }), 0), "unknown");
});

test("clientIp: hops>0 öncelik zinciri cf → x-real → xff[len-N] → xff[0]", () => {
  const xff = "1.1.1.1, 9.9.9.9";
  // cf-connecting-ip her şeyin önünde
  assert.equal(clientIp(reqWith({ "x-forwarded-for": xff, "cf-connecting-ip": "8.8.8.8" }), 1), "8.8.8.8");
  // cf yoksa x-real-ip
  assert.equal(clientIp(reqWith({ "x-forwarded-for": xff, "x-real-ip": "7.7.7.7" }), 1), "7.7.7.7");
  // ikisi de yoksa xff[len-N]; bot sol halkayı değiştirse de anahtar sabit
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" }), 1), "9.9.9.9");
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "2.2.2.2, 9.9.9.9" }), 1), "9.9.9.9");
  // N=2 → iki proxy
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 9.9.9.9, 10.0.0.1" }), 2), "9.9.9.9");
  // zincir N'den kısa → xff[0]'a clamp (herkesi tek anahtara toplamamak için)
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "9.9.9.9" }), 3), "9.9.9.9");
  assert.equal(clientIp(reqWith({}), 1), "unknown");
});

test("clientIp: hops>0 şekil doğrulaması — çöp halka atlanır", () => {
  // cf çöpse x-real'e, o da çöpse xff'e düşülmeli
  assert.equal(
    clientIp(reqWith({ "cf-connecting-ip": "unknown", "x-real-ip": "7.7.7.7" }), 1),
    "7.7.7.7",
  );
  assert.equal(
    clientIp(reqWith({ "cf-connecting-ip": "<script>", "x-forwarded-for": "1.1.1.1, 9.9.9.9" }), 1),
    "9.9.9.9",
  );
  // seçilen xff halkası çöpse xff[0]'a düş
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, bozuk" }), 1), "1.1.1.1");
  // hepsi çöpse "unknown" (çöp değeri sayaç anahtarı yapma)
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "bozuk, cöp" }), 1), "unknown");
  assert.equal(clientIp(reqWith({ "x-forwarded-for": "::1, 2001:db8::1" }), 1), "2001:db8::1");
});

test("looksLikeIp: yalnız IP BİÇİMİ (sahiplik iddiası değil)", () => {
  assert.ok(looksLikeIp("9.9.9.9"));
  assert.ok(looksLikeIp("255.255.255.255"));
  assert.ok(looksLikeIp("::1"));
  assert.ok(looksLikeIp("2001:db8::1"));
  assert.ok(!looksLikeIp("256.1.1.1")); // oktet > 255
  assert.ok(!looksLikeIp("unknown"));
  assert.ok(!looksLikeIp(""));
  assert.ok(!looksLikeIp(null));
  assert.ok(!looksLikeIp("<script>alert(1)</script>"));
});

test("ipOrDefault: çöp IP dış servise gitmez (PayTR user_ip)", () => {
  assert.equal(ipOrDefault("9.9.9.9"), "9.9.9.9");
  assert.equal(ipOrDefault("unknown"), "127.0.0.1");
  assert.equal(ipOrDefault(""), "127.0.0.1");
  assert.equal(ipOrDefault(null), "127.0.0.1");
  assert.equal(ipOrDefault("unknown", "10.0.0.1"), "10.0.0.1");
});

test("xffShape: ölçüm kaydı zincirin şeklini taşır", () => {
  const s = xffShape(
    reqWith({ "x-forwarded-for": "1.1.1.1, 9.9.9.9", "cf-connecting-ip": "8.8.8.8" }),
    0,
  );
  assert.equal(s.len, 2);
  assert.equal(s.hops, 0);
  assert.equal(s.first, "1.1.1.1"); // bugün kullanılan
  assert.equal(s.last, "9.9.9.9"); // N=1'de kullanılacak
  assert.equal(s.cf, "8.8.8.8");
  assert.equal(s.real, null);

  const empty = xffShape(reqWith({}), 0);
  assert.equal(empty.len, 0);
  assert.equal(empty.first, null);
  assert.equal(empty.last, null);
});

test("timingSafeEqualStr: doğru sonuç verir (sabit zamanlı secret karşılaştırma)", () => {
  assert.ok(timingSafeEqualStr("s3cr3t", "s3cr3t"));
  assert.ok(!timingSafeEqualStr("s3cr3t", "s3cr3T"));
  assert.ok(!timingSafeEqualStr("s3cr3t", "s3cr3"));   // kısa
  assert.ok(!timingSafeEqualStr("s3cr3t", "s3cr3tt")); // uzun
  assert.ok(!timingSafeEqualStr(null, "s3cr3t"));
  assert.ok(!timingSafeEqualStr(undefined, "s3cr3t"));
  // farkın konumu sonucu değiştirmez (erken dönüş yok)
  assert.ok(!timingSafeEqualStr("Xs3cr3", "s3cr3t"));
  assert.ok(!timingSafeEqualStr("s3cr3X", "s3cr3t"));
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

test("isAllowedOrigin: allowLocal=false ile yerel muafiyet kapanır (prod)", () => {
  const allowed = ["https://essejeffe.com"];
  assert.ok(!isAllowedOrigin("http://localhost:8080", allowed, false));
  assert.ok(!isAllowedOrigin("http://127.0.0.1:3000", allowed, false));
  assert.ok(isAllowedOrigin("https://essejeffe.com", allowed, false));
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
