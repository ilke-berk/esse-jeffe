// Esse Jeffe — _shared/rate-limit.ts testleri (sahte Supabase client ile)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  recordRateLimit,
  rateLimitCutoffs,
} from "../backend/edge-functions/_shared/rate-limit.ts";

// Supabase query-builder'ının burada kullanılan alt kümesini taklit eder.
// Yapılan çağrıları `calls`e kaydeder; count sorgusuna `countResult` döner.
function fakeAdmin(countResult) {
  const calls = { deletes: [], counts: [], inserts: [] };
  const admin = {
    from(table) {
      return {
        delete() {
          return { lt(col, val) { calls.deletes.push({ table, col, val }); return Promise.resolve({}); } };
        },
        select(_cols, _opts) {
          const q = {
            filters: {},
            eq(col, val) { this.filters[col] = val; return this; },
            gte(col, val) {
              this.filters["gte_" + col] = val;
              calls.counts.push({ table, filters: { ...this.filters } });
              return Promise.resolve(countResult);
            },
          };
          return q;
        },
        insert(row) { calls.inserts.push({ table, row }); return Promise.resolve({}); },
      };
    },
  };
  return { admin, calls };
}

const NOW = Date.UTC(2026, 6, 2, 12, 0, 0);

test("rateLimitCutoffs: pencere ve 24 saatlik temizlik eşiği", () => {
  const { cutoff, purgeBefore } = rateLimitCutoffs(NOW, 60);
  assert.equal(cutoff, new Date(NOW - 60 * 60 * 1000).toISOString());
  assert.equal(purgeBefore, new Date(NOW - 24 * 60 * 60 * 1000).toISOString());
});

test("checkRateLimit: sınırın altında izin verir", async () => {
  const { admin } = fakeAdmin({ count: 2, error: null });
  const r = await checkRateLimit(admin, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 60 }, NOW);
  assert.deepEqual({ allowed: r.allowed, count: r.count }, { allowed: true, count: 2 });
});

test("checkRateLimit: sınıra ulaşınca reddeder (max dahil)", async () => {
  const { admin } = fakeAdmin({ count: 3, error: null });
  const r = await checkRateLimit(admin, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 60 }, NOW);
  assert.equal(r.allowed, false);
});

test("checkRateLimit: count null gelirse 0 sayılır (boş tablo)", async () => {
  const { admin } = fakeAdmin({ count: null, error: null });
  const r = await checkRateLimit(admin, { table: "t", ip: "1.1.1.1", max: 1, windowMin: 60 }, NOW);
  assert.deepEqual({ allowed: r.allowed, count: r.count }, { allowed: true, count: 0 });
});

test("checkRateLimit: DB hatasında allowed=false + error döner (fail-closed)", async () => {
  const { admin } = fakeAdmin({ count: null, error: { message: "boom" } });
  const r = await checkRateLimit(admin, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 60 }, NOW);
  assert.equal(r.allowed, false);
  assert.equal(r.error, "boom");
});

test("checkRateLimit: kind verilirse filtreye eklenir, verilmezse eklenmez", async () => {
  const a = fakeAdmin({ count: 0, error: null });
  await checkRateLimit(a.admin, { table: "t", ip: "1.1.1.1", kind: "order", max: 3, windowMin: 60 }, NOW);
  assert.equal(a.calls.counts[0].filters.kind, "order");
  assert.equal(a.calls.counts[0].filters.ip, "1.1.1.1");

  const b = fakeAdmin({ count: 0, error: null });
  await checkRateLimit(b.admin, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 60 }, NOW);
  assert.ok(!("kind" in b.calls.counts[0].filters));
});

test("checkRateLimit: pencere doğru hesaplanır ve eski kayıtlar temizlenir", async () => {
  const { admin, calls } = fakeAdmin({ count: 0, error: null });
  await checkRateLimit(admin, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 10 }, NOW);
  const { cutoff, purgeBefore } = rateLimitCutoffs(NOW, 10);
  assert.equal(calls.counts[0].filters.gte_created_at, cutoff);
  assert.deepEqual(calls.deletes[0], { table: "t", col: "created_at", val: purgeBefore });
});

test("recordRateLimit: kind'lı ve kind'sız satır ekler", async () => {
  const { admin, calls } = fakeAdmin({ count: 0, error: null });
  await recordRateLimit(admin, "t", "1.1.1.1", "order");
  await recordRateLimit(admin, "t2", "2.2.2.2");
  assert.deepEqual(calls.inserts[0], { table: "t", row: { ip: "1.1.1.1", kind: "order" } });
  assert.deepEqual(calls.inserts[1], { table: "t2", row: { ip: "2.2.2.2" } });
});
