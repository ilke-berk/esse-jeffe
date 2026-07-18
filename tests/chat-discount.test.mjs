// Esse Jeffe — chat kupon yardımcıları (backend/functions/chat/discount.ts).
// Kaynak _shared/discount.ts kopyasının chat'e ÖZGÜ ekleri test edilir
// (kopyalanan claim/release zaten tests/discount.test.mjs'te);
// ayrıca "bot kupon üretemez" ilkesi: makeDiscountCode export EDİLMEMELİ.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as chatDiscount from "../backend/functions/chat/discount.ts";

const { fmtCouponOffer, listPersonalCoupons, validateCouponReadOnly } = chatDiscount;

test("GÜVENLİK: chat kopyası makeDiscountCode İÇERMEZ (bot kupon üretemez)", () => {
  assert.equal(chatDiscount.makeDiscountCode, undefined);
});

// ---- esnek sahte query-builder ----
// Zincirin tüm metodları this döner; maybeSingle()/then() tabloya göre
// ayarlanan sonucu verir. Filtreler kaydedilir (assert için).
function fakeAdmin(results) {
  const calls = [];
  function makeQuery(table) {
    const q = {
      table, filters: [],
      select() { return q; },
      update() { return q; },
      eq(c, v) { q.filters.push(["eq", c, v]); return q; },
      is(c, v) { q.filters.push(["is", c, v]); return q; },
      gt(c, v) { q.filters.push(["gt", c, v]); return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() {
        calls.push(q);
        return Promise.resolve(results[table + ".single"] ?? { data: null, error: null });
      },
      then(resolve) {
        calls.push(q);
        resolve(results[table] ?? { data: null, error: null });
      },
    };
    return q;
  }
  return { calls, from: (t) => makeQuery(t), rpc: () => Promise.resolve({ data: null, error: null }) };
}

// ---- listPersonalCoupons ----
test("listPersonalCoupons: filtreler claim koşullarını aynalar (email/kind/active/used_at/expires_at)", async () => {
  const admin = fakeAdmin({
    discount_codes: { data: [{ code: "SEPET-ABC123", percent: 10, max_discount: null, min_subtotal: null, free_shipping: false, expires_at: "2026-08-01" }], error: null },
  });
  const r = await listPersonalCoupons(admin, "  Musteri@X.com ");
  assert.equal(r.length, 1);
  const f = admin.calls[0].filters;
  assert.deepEqual(f.find((x) => x[1] === "email"), ["eq", "email", "musteri@x.com"]); // lower+trim
  assert.deepEqual(f.find((x) => x[1] === "kind"), ["eq", "kind", "single"]);
  assert.deepEqual(f.find((x) => x[1] === "active"), ["eq", "active", true]);
  assert.deepEqual(f.find((x) => x[0] === "is"), ["is", "used_at", null]);
  assert.equal(f.find((x) => x[0] === "gt")[1], "expires_at");
});

test("listPersonalCoupons: boş e-posta → DB'ye gitmeden []", async () => {
  const admin = fakeAdmin({});
  assert.deepEqual(await listPersonalCoupons(admin, "  "), []);
  assert.equal(admin.calls.length, 0);
});

test("listPersonalCoupons: sorgu hatasında fail-soft []", async () => {
  const admin = fakeAdmin({ discount_codes: { data: null, error: { message: "boom" } } });
  assert.deepEqual(await listPersonalCoupons(admin, "a@b.com"), []);
});

// ---- validateCouponReadOnly ----
const BASE = {
  id: "d1", kind: "single", percent: 10, email: "sahip@x.com", max_discount: null,
  min_subtotal: null, max_uses: null, used_count: 0, free_shipping: false,
  active: true, used_at: null, expires_at: "2099-01-01T00:00:00Z",
};

test("single: geçerli kod + doğru e-posta → ok, indirim hesaplı, YAZMA YOK", async () => {
  const admin = fakeAdmin({ "discount_codes.single": { data: { ...BASE }, error: null } });
  const r = await validateCouponReadOnly(admin, "sepet-abc", "Sahip@X.com", 1699);
  assert.equal(r.ok, true);
  assert.equal(r.discount, 169);
  // hiçbir update çağrısı yapılmadığını doğrula (salt-okuma sözleşmesi)
  assert.ok(admin.calls.every((q) => !q.filters.some((f) => f[0] === "update")));
});

test("single: yanlış e-posta → 'başka e-postaya tanımlı'", async () => {
  const admin = fakeAdmin({ "discount_codes.single": { data: { ...BASE }, error: null } });
  const r = await validateCouponReadOnly(admin, "SEPET-ABC", "baskasi@y.com", 1000);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("başka bir e-posta"));
});

test("single: kullanılmış / süresiz / süresi geçmiş / pasif → red", async () => {
  for (const patch of [{ used_at: "2026-01-01" }, { expires_at: null }, { expires_at: "2020-01-01" }, { active: false }]) {
    const admin = fakeAdmin({ "discount_codes.single": { data: { ...BASE, ...patch }, error: null } });
    const r = await validateCouponReadOnly(admin, "SEPET-ABC", "sahip@x.com", 1000);
    assert.equal(r.ok, false, JSON.stringify(patch));
  }
});

test("min_subtotal altında kalan sepet → red (tutar mesajda)", async () => {
  const admin = fakeAdmin({ "discount_codes.single": { data: { ...BASE, min_subtotal: 2000 }, error: null } });
  const r = await validateCouponReadOnly(admin, "SEPET-ABC", "sahip@x.com", 1500);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("2.000"));
});

test("campaign: limit dolmuş → red; e-postayla önce kullanılmış → red", async () => {
  const camp = { ...BASE, kind: "campaign", email: null, max_uses: 5, used_count: 5 };
  const a1 = fakeAdmin({ "discount_codes.single": { data: camp, error: null } });
  assert.equal((await validateCouponReadOnly(a1, "YAZ20", "a@b.com", 1000)).ok, false);

  const a2 = fakeAdmin({
    "discount_codes.single": { data: { ...camp, used_count: 1 }, error: null },
    "coupon_redemptions.single": { data: { id: "r1" }, error: null },
  });
  const r2 = await validateCouponReadOnly(a2, "YAZ20", "a@b.com", 1000);
  assert.equal(r2.ok, false);
  assert.ok(r2.error.includes("daha önce kullanılmış"));
});

test("campaign: geçerli (süresiz olabilir) → ok + max_discount tavanı", async () => {
  const camp = { ...BASE, kind: "campaign", email: null, percent: 50, max_discount: 500, expires_at: null };
  const admin = fakeAdmin({
    "discount_codes.single": { data: camp, error: null },
    "coupon_redemptions.single": { data: null, error: null },
  });
  const r = await validateCouponReadOnly(admin, "YAZ50", "a@b.com", 5000);
  assert.equal(r.ok, true);
  assert.equal(r.discount, 500); // 2500 → tavan 500
});

test("bilinmeyen kod → belirsiz red", async () => {
  const admin = fakeAdmin({ "discount_codes.single": { data: null, error: null } });
  const r = await validateCouponReadOnly(admin, "YOKBOYLE", "a@b.com", 1000);
  assert.equal(r.ok, false);
});

// ---- fmtCouponOffer ----
test("fmtCouponOffer: yüzde + tavan + min sepet + kargo + son gün", () => {
  const s = fmtCouponOffer([
    { code: "SADAKAT-AAA", percent: 15, max_discount: 1500, min_subtotal: null, free_shipping: false, expires_at: "2026-08-01T00:00:00Z" },
    { code: "KARGO-BBB", percent: 0, max_discount: null, min_subtotal: 1000, free_shipping: true, expires_at: null },
  ]);
  assert.ok(s.includes("SADAKAT-AAA (%15, en fazla 1.500 TL, son gün 2026-08-01)"));
  assert.ok(s.includes("KARGO-BBB (%0, min. sepet 1.000 TL, kargo bedava)"));
});
