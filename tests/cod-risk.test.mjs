// Esse Jeffe — _shared/cod-risk.ts testleri (sahte Supabase client ile)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessCodRisk,
  CODRISK_HOLD_MIN,
  CODRISK_WINDOW_DAYS,
  scoreCodRisk,
} from "../backend/edge-functions/_shared/cod-risk.ts";
import { normPhone } from "../backend/edge-functions/_shared/util.ts";

test("scoreCodRisk: iptal yoksa low / skor 0 / gerekçe yok", () => {
  const r = scoreCodRisk({ cancelled_count: 0, delivered_count: 0, open_cod_count: 0 });
  assert.deepEqual({ score: r.score, level: r.level, reasons: r.reasons }, { score: 0, level: "low", reasons: [] });
});

test("scoreCodRisk: 1 iptal → medium, 2 iptal → high ve hold eşiğini aşar", () => {
  const bir = scoreCodRisk({ cancelled_count: 1 });
  assert.deepEqual({ score: bir.score, level: bir.level }, { score: 40, level: "medium" });

  const iki = scoreCodRisk({ cancelled_count: 2 });
  assert.deepEqual({ score: iki.score, level: iki.level }, { score: 80, level: "high" });
  assert.ok(iki.score >= CODRISK_HOLD_MIN);
});

test("scoreCodRisk: iptal puanı 80'de tavanlanır", () => {
  assert.equal(scoreCodRisk({ cancelled_count: 5 }).score, 80);
});

test("scoreCodRisk: teslimatlar skoru düşürür, taban 0", () => {
  const r = scoreCodRisk({ cancelled_count: 2, delivered_count: 3 });
  assert.deepEqual({ score: r.score, level: r.level }, { score: 50, level: "medium" });
  assert.equal(scoreCodRisk({ delivered_count: 9 }).score, 0);
});

test("scoreCodRisk: ≥2 açık COD +15, tek açık COD eklemez", () => {
  assert.equal(scoreCodRisk({ open_cod_count: 2 }).score, 15);
  assert.equal(scoreCodRisk({ open_cod_count: 1 }).score, 0);
});

test("scoreCodRisk: gerekçeler yapısal kodlarla döner", () => {
  const r = scoreCodRisk({ cancelled_count: 2, delivered_count: 1, open_cod_count: 2, window_days: 180 });
  assert.deepEqual(r.reasons, [
    { code: "cancelled_orders", count: 2, window_days: 180 },
    { code: "open_cod_orders", count: 2 },
    { code: "delivered_orders", count: 1 },
  ]);
});

test("scoreCodRisk: boş/bozuk sinyaller 0 sayılır", () => {
  const r = scoreCodRisk({});
  assert.deepEqual({ score: r.score, level: r.level }, { score: 0, level: "low" });
});

test("assessCodRisk: RPC argümanları doğru, ok:true skorlanır", async () => {
  const calls = [];
  const admin = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve({
        data: { ok: true, window_days: 180, cancelled_count: 1, delivered_count: 0, open_cod_count: 0 },
        error: null,
      });
    },
  };
  const r = await assessCodRisk(admin, { phone: "0532 123 45 67" });
  assert.deepEqual(calls, [{
    fn: "codrisk_signals",
    args: { p_phone: "0532 123 45 67", p_window_days: CODRISK_WINDOW_DAYS },
  }]);
  assert.equal(r.level, "medium");
});

test("assessCodRisk: RPC hatası / ok:false / reject → null (fail-soft)", async () => {
  const hata = { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  assert.equal(await assessCodRisk(hata, { phone: "05321234567" }), null);

  const kisa = { rpc: () => Promise.resolve({ data: { ok: false, reason: "phone_too_short" }, error: null }) };
  assert.equal(await assessCodRisk(kisa, { phone: "123" }), null);

  const patlayan = { rpc: () => Promise.reject(new Error("ağ koptu")) };
  assert.equal(await assessCodRisk(patlayan, { phone: "05321234567" }), null);
});

test("normPhone ↔ codrisk_norm_phone sözleşmesi: aynı örnek aynı sonucu vermeli", () => {
  // SQL karşılığı: right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 10)
  const fixtures = [
    ["0532 123 45 67", "5321234567"],
    ["+90 532 123 45 67", "5321234567"],
    ["(532) 123-4567", "5321234567"],
    ["90 532 123 45 67", "5321234567"],
    ["532", "532"],
    ["", ""],
  ];
  for (const [girdi, beklenen] of fixtures) {
    assert.equal(normPhone(girdi), beklenen);
    assert.equal(girdi.replace(/\D/g, "").slice(-10), beklenen);
  }
});
