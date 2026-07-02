// deno test backend/edge-functions/_shared/rate-limit_test.ts
import { assertEquals } from "jsr:@std/assert";
import {
  checkRateLimit,
  type DbClient,
  rateLimitCutoffs,
  recordRateLimit,
} from "./rate-limit.ts";

Deno.test("rateLimitCutoffs: pencere ve 24s temizlik eşiği", () => {
  const now = Date.parse("2026-07-02T12:00:00.000Z");
  const { cutoff, purgeBefore } = rateLimitCutoffs(now, 10);
  assertEquals(cutoff, "2026-07-02T11:50:00.000Z"); // 10 dk önce
  assertEquals(purgeBefore, "2026-07-01T12:00:00.000Z"); // 24 saat önce
});

// Supabase query builder'ın kullanılan alt kümesini taklit eden sahte istemci.
function mockDb(result: { count?: number; error?: { message: string } | null }) {
  const calls = { deletes: 0, inserts: [] as Record<string, unknown>[] };
  const res = { count: result.count ?? 0, error: result.error ?? null };
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => Promise.resolve(res),
  };
  const db: DbClient = {
    from: () => ({
      delete: () => ({ lt: () => { calls.deletes++; return Promise.resolve({ error: null }); } }),
      select: () => builder,
      insert: (row: Record<string, unknown>) => { calls.inserts.push(row); return Promise.resolve({ error: null }); },
    }),
  } as unknown as DbClient;
  return { db, calls };
}

Deno.test("checkRateLimit: sınır altında izin verir + eski kayıtları temizler", async () => {
  const { db, calls } = mockDb({ count: 2 });
  const r = await checkRateLimit(db, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 10 }, Date.now());
  assertEquals(r.allowed, true);
  assertEquals(r.count, 2);
  assertEquals(calls.deletes, 1); // purge çağrıldı
});

Deno.test("checkRateLimit: sınıra ulaşınca reddeder", async () => {
  const { db } = mockDb({ count: 3 });
  const r = await checkRateLimit(db, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 10 });
  assertEquals(r.allowed, false);
  assertEquals(r.count, 3);
});

Deno.test("checkRateLimit: DB hatasında allowed=false + error taşınır", async () => {
  const { db } = mockDb({ error: { message: "boom" } });
  const r = await checkRateLimit(db, { table: "t", ip: "1.1.1.1", max: 3, windowMin: 10 });
  assertEquals(r.allowed, false);
  assertEquals(r.error, "boom");
});

Deno.test("recordRateLimit: ip (+kind) satırı ekler", async () => {
  const { db, calls } = mockDb({});
  await recordRateLimit(db, "t", "2.2.2.2", "order");
  assertEquals(calls.inserts, [{ ip: "2.2.2.2", kind: "order" }]);

  const { db: db2, calls: c2 } = mockDb({});
  await recordRateLimit(db2, "t", "3.3.3.3");
  assertEquals(c2.inserts, [{ ip: "3.3.3.3" }]); // kind yoksa eklenmez
});
