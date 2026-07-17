// Esse Jeffe — _shared/discount.ts testleri (sahte Supabase client ile)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimDiscount,
  computeDiscount,
  makeDiscountCode,
  normCode,
  releaseDiscount,
  releaseDiscountByOrder,
  setDiscountOrder,
} from "../backend/edge-functions/_shared/discount.ts";

// Supabase query-builder'ının discount.ts'te kullanılan alt kümesini taklit
// eder. select().eq().maybeSingle() `kindRow`, update().eq...maybeSingle()
// `claimRow`, rpc() `rpcResult` döner; tüm çağrılar kaydedilir.
function fakeAdmin(claimRow, opts = {}) {
  const kindRow = "kindRow" in opts ? opts.kindRow : { kind: "single" };
  const rpcResult = opts.rpcResult || { data: null, error: null };
  const calls = { updates: [], selects: [], rpcs: [] };
  const admin = {
    calls,
    from(table) {
      return {
        select(cols) {
          const q = {
            filters: {},
            eq(col, val) { this.filters[col] = val; return this; },
            maybeSingle() {
              calls.selects.push({ table, cols, filters: { ...this.filters } });
              return Promise.resolve({ data: kindRow, error: null });
            },
          };
          return q;
        },
        update(values) {
          const q = {
            filters: {},
            eq(col, val) { this.filters[col] = val; return this; },
            is(col, val) { this.filters["is_" + col] = val; return this; },
            gt(col, val) { this.filters["gt_" + col] = val; return this; },
            select() { return this; },
            maybeSingle() {
              calls.updates.push({ table, values, filters: { ...this.filters } });
              return Promise.resolve({ data: claimRow, error: null });
            },
            then(resolve) {
              // select'siz update zinciri (releaseDiscount/setDiscountOrder) — thenable
              calls.updates.push({ table, values, filters: { ...this.filters } });
              resolve({ data: null, error: null });
            },
          };
          return q;
        },
      };
    },
    rpc(fn, args) {
      calls.rpcs.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  };
  return admin;
}

test("makeDiscountCode: SEPET-XXXXXX biçimi, karışan harfler (0/O/1/I/L) yok", () => {
  for (let i = 0; i < 50; i++) {
    const code = makeDiscountCode();
    assert.match(code, /^SEPET-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test("makeDiscountCode: enjekte edilen rand ile deterministik", () => {
  assert.equal(makeDiscountCode(() => 0), "SEPET-AAAAAA");
});

test("makeDiscountCode: özel önek (hoş geldin kuponu ailesi)", () => {
  assert.equal(makeDiscountCode(() => 0, "HOSGELDIN-"), "HOSGELDIN-AAAAAA");
  for (let i = 0; i < 20; i++) {
    assert.match(
      makeDiscountCode(Math.random, "HOSGELDIN-"),
      /^HOSGELDIN-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
    );
  }
});

test("normCode: boşlukları atar, büyük harfe çevirir", () => {
  assert.equal(normCode("  sepet-ab 12cd "), "SEPET-AB12CD");
  assert.equal(normCode(null), "");
});

// ---------- computeDiscount (TL tavanı) ----------

test("computeDiscount: tavansız = floor(subtotal*percent/100), subtotal'ı aşmaz", () => {
  assert.equal(computeDiscount(1699, 10), 169);
  assert.equal(computeDiscount(1699, 10, null), 169);
  assert.equal(computeDiscount(1699, 10, 0), 169); // 0 = limitsiz
  assert.equal(computeDiscount(1, 90), 0); // floor(0.9)
  assert.equal(computeDiscount(100, 200, null), 100); // asla subtotal üstü değil
});

test("computeDiscount: max_discount TL tavanı ham indirimi keser", () => {
  assert.equal(computeDiscount(10000, 50, 1500), 1500); // 5000 → tavan 1500
  assert.equal(computeDiscount(2000, 50, 1500), 1000); // ham 1000 < tavan → ham
  assert.equal(computeDiscount(500, 50, 1500), 250);
});

test("computeDiscount: negatif/bozuk girdide 0'ın altına inmez", () => {
  assert.equal(computeDiscount(1000, 0), 0);
  assert.equal(computeDiscount(0, 50, 1500), 0);
  assert.equal(computeDiscount(1000, -10), 0);
});

// ---------- tek kullanımlık (single) yol ----------

test("claimDiscount(single): max_discount'lı kod (SADAKAT) → indirim tavanla sınırlı", async () => {
  const admin = fakeAdmin({ id: "d1", percent: 50, email: null, max_discount: 1500 });
  const r = await claimDiscount(admin, "SADAKAT-ABCDEF", "x@y.com", 10000);
  assert.equal(r.ok, true);
  assert.equal(r.percent, 50);
  assert.equal(r.discount, 1500); // 5000 değil
});

test("claimDiscount(single): geçerli kod → discount = floor(subtotal*percent/100)", async () => {
  const admin = fakeAdmin({ id: "d1", percent: 10, email: null });
  const r = await claimDiscount(admin, "SEPET-ABCDEF", "x@y.com", 1699);
  assert.equal(r.ok, true);
  assert.equal(r.discount, 169); // floor(169.9)
  assert.equal(r.percent, 10);
  assert.equal(r.kind, "single");
  assert.equal(r.redemptionId, null);
  assert.equal(r.freeShipping, false);
});

test("claimDiscount(single): atomik update yalnız aktif kodu claim eder (active filtresi)", async () => {
  const admin = fakeAdmin({ id: "d1", percent: 10, email: null });
  await claimDiscount(admin, "SEPET-ABCDEF", null, 1000);
  const claim = admin.calls.updates.find((u) => u.values && u.values.used_at);
  assert.ok(claim, "claim update bekleniyordu");
  assert.equal(claim.filters.active, true);
  assert.equal(claim.filters.is_used_at, null);
});

test("claimDiscount(single): kullanılmış kod (satır dönmez) → ok:false", async () => {
  const admin = fakeAdmin(null);
  const r = await claimDiscount(admin, "SEPET-ABCDEF", null, 1000);
  assert.equal(r.ok, false);
});

test("claimDiscount: bilinmeyen kod (kind sorgusu boş) → ok:false, update yok", async () => {
  const admin = fakeAdmin(null, { kindRow: null });
  const r = await claimDiscount(admin, "YOKBOYLE", null, 1000);
  assert.equal(r.ok, false);
  assert.equal(admin.calls.updates.length, 0);
});

test("claimDiscount(single): e-posta bağlı kod yanlış e-postayla reddedilir ve release edilir", async () => {
  const admin = fakeAdmin({ id: "d1", percent: 10, email: "sahip@x.com" });
  const r = await claimDiscount(admin, "SEPET-ABCDEF", "baskasi@y.com", 1000);
  assert.equal(r.ok, false);
  // ikinci update = releaseDiscount (used_at geri null)
  const release = admin.calls.updates.find((u) => u.values && u.values.used_at === null);
  assert.ok(release, "release update bekleniyordu");
});

test("claimDiscount(single): e-posta bağlı kod doğru e-postayla (case duyarsız) geçer", async () => {
  const admin = fakeAdmin({ id: "d1", percent: 15, email: "Sahip@X.com" });
  const r = await claimDiscount(admin, "sepet-abcdef", "sahip@x.com", 200);
  assert.equal(r.ok, true);
  assert.equal(r.discount, 30);
});

test("claimDiscount(single): indirim subtotal'ı aşamaz (toplam eksiye düşmez)", async () => {
  const admin = fakeAdmin({ id: "d1", percent: 90, email: null });
  const r = await claimDiscount(admin, "SEPET-ABCDEF", null, 1);
  assert.equal(r.ok, true);
  assert.ok(r.discount <= 1);
});

test("claimDiscount: boş kod → ok:false, DB'ye gidilmez", async () => {
  const admin = fakeAdmin({ id: "d1", percent: 10, email: null });
  const r = await claimDiscount(admin, "   ", null, 1000);
  assert.equal(r.ok, false);
  assert.equal(admin.calls.updates.length, 0);
  assert.equal(admin.calls.selects.length, 0);
});

// ---------- kampanya (campaign) yolu ----------

test("claimDiscount(campaign): RPC'ye normalize kod + küçük harf e-posta + subtotal gider", async () => {
  const admin = fakeAdmin(null, {
    kindRow: { kind: "campaign" },
    rpcResult: { data: { ok: true, id: "c1", redemption_id: "r1", percent: 20, free_shipping: true }, error: null },
  });
  const r = await claimDiscount(admin, " yaz 20 ", "Musteri@X.com", 5000);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "campaign");
  assert.equal(r.redemptionId, "r1");
  assert.equal(r.discount, 1000); // floor(5000*20/100)
  assert.equal(r.freeShipping, true);
  assert.deepEqual(admin.calls.rpcs, [{
    fn: "claim_campaign_coupon",
    args: { p_code: "YAZ20", p_email: "musteri@x.com", p_subtotal: 5000 },
  }]);
});

test("claimDiscount(campaign): RPC ok:false → hata mesajı aynen geçer", async () => {
  const admin = fakeAdmin(null, {
    kindRow: { kind: "campaign" },
    rpcResult: { data: { ok: false, error: "Bu kodun kullanım limiti doldu." }, error: null },
  });
  const r = await claimDiscount(admin, "YAZ20", "a@b.com", 5000);
  assert.equal(r.ok, false);
  assert.equal(r.error, "Bu kodun kullanım limiti doldu.");
});

test("claimDiscount(campaign): RPC max_discount dönerse indirim tavanla sınırlı", async () => {
  const admin = fakeAdmin(null, {
    kindRow: { kind: "campaign" },
    rpcResult: {
      data: { ok: true, id: "c1", redemption_id: "r1", percent: 20, free_shipping: false, max_discount: 500 },
      error: null,
    },
  });
  const r = await claimDiscount(admin, "YAZ20", "a@b.com", 5000);
  assert.equal(r.ok, true);
  assert.equal(r.discount, 500); // floor(1000) → tavan 500
});

test("claimDiscount(campaign): %0 + kargo bedava → discount 0, freeShipping true", async () => {
  const admin = fakeAdmin(null, {
    kindRow: { kind: "campaign" },
    rpcResult: { data: { ok: true, id: "c1", redemption_id: "r1", percent: 0, free_shipping: true }, error: null },
  });
  const r = await claimDiscount(admin, "KARGO", "a@b.com", 3000);
  assert.equal(r.ok, true);
  assert.equal(r.discount, 0);
  assert.equal(r.freeShipping, true);
});

// ---------- release / order bağlama ----------

test("releaseDiscount(single): used_at ve order_id null'a çekilir", async () => {
  const admin = fakeAdmin(null);
  await releaseDiscount(admin, { id: "d1", kind: "single", redemptionId: null });
  const u = admin.calls.updates[0];
  assert.equal(u.table, "discount_codes");
  assert.deepEqual(u.values, { used_at: null, order_id: null });
  assert.equal(u.filters.id, "d1");
});

test("releaseDiscount(campaign): release_campaign_redemption RPC'si çağrılır", async () => {
  const admin = fakeAdmin(null);
  await releaseDiscount(admin, { id: "c1", kind: "campaign", redemptionId: "r1" });
  assert.deepEqual(admin.calls.rpcs, [{
    fn: "release_campaign_redemption",
    args: { p_redemption_id: "r1" },
  }]);
  assert.equal(admin.calls.updates.length, 0);
});

test("setDiscountOrder: single → discount_codes, campaign → coupon_redemptions", async () => {
  const a1 = fakeAdmin(null);
  await setDiscountOrder(a1, { id: "d1", kind: "single", redemptionId: null }, "o1");
  assert.equal(a1.calls.updates[0].table, "discount_codes");
  assert.deepEqual(a1.calls.updates[0].values, { order_id: "o1" });

  const a2 = fakeAdmin(null);
  await setDiscountOrder(a2, { id: "c1", kind: "campaign", redemptionId: "r1" }, "o2");
  assert.equal(a2.calls.updates[0].table, "coupon_redemptions");
  assert.deepEqual(a2.calls.updates[0].values, { order_id: "o2" });
  assert.equal(a2.calls.updates[0].filters.id, "r1");
});

test("releaseDiscountByOrder: release_coupon_by_order RPC'si çağrılır", async () => {
  const admin = fakeAdmin(null);
  await releaseDiscountByOrder(admin, "o1");
  assert.deepEqual(admin.calls.rpcs, [{
    fn: "release_coupon_by_order",
    args: { p_order_id: "o1" },
  }]);
});
