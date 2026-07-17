// deno test backend/edge-functions/_shared/cod-risk_test.ts
import { assertEquals } from "jsr:@std/assert";
import {
  assessCodRisk,
  CODRISK_HOLD_MIN,
  CODRISK_WINDOW_DAYS,
  scoreCodRisk,
} from "./cod-risk.ts";
import { normPhone } from "./util.ts";

Deno.test("scoreCodRisk: iptal yoksa low / skor 0", () => {
  const r = scoreCodRisk({ cancelled_count: 0, delivered_count: 0, open_cod_count: 0 });
  assertEquals(r.score, 0);
  assertEquals(r.level, "low");
  assertEquals(r.reasons, []);
});

Deno.test("scoreCodRisk: 1 iptal → medium, 2 iptal → high (hold eşiği)", () => {
  const bir = scoreCodRisk({ cancelled_count: 1 });
  assertEquals(bir.score, 40);
  assertEquals(bir.level, "medium");

  const iki = scoreCodRisk({ cancelled_count: 2 });
  assertEquals(iki.score, 80);
  assertEquals(iki.level, "high");
  assertEquals(iki.score >= CODRISK_HOLD_MIN, true);
});

Deno.test("scoreCodRisk: iptal puanı 80'de tavanlanır", () => {
  assertEquals(scoreCodRisk({ cancelled_count: 5 }).score, 80);
});

Deno.test("scoreCodRisk: teslimatlar skoru düşürür (taban 0)", () => {
  // 2 iptal (80) − 3 teslimat (30) = 50 → medium
  const r = scoreCodRisk({ cancelled_count: 2, delivered_count: 3 });
  assertEquals(r.score, 50);
  assertEquals(r.level, "medium");
  // yalnız teslimat → negatife inmez
  assertEquals(scoreCodRisk({ delivered_count: 9 }).score, 0);
});

Deno.test("scoreCodRisk: ≥2 açık COD siparişi +15 ekler, 1 tanesi eklemez", () => {
  assertEquals(scoreCodRisk({ open_cod_count: 2 }).score, 15);
  assertEquals(scoreCodRisk({ open_cod_count: 1 }).score, 0);
});

Deno.test("scoreCodRisk: gerekçeler yapısal kodlarla döner", () => {
  const r = scoreCodRisk({
    cancelled_count: 2,
    delivered_count: 1,
    open_cod_count: 2,
    window_days: 180,
  });
  assertEquals(r.reasons, [
    { code: "cancelled_orders", count: 2, window_days: 180 },
    { code: "open_cod_orders", count: 2 },
    { code: "delivered_orders", count: 1 },
  ]);
});

Deno.test("scoreCodRisk: bozuk/eksik sinyaller 0 sayılır", () => {
  const r = scoreCodRisk({});
  assertEquals(r.score, 0);
  assertEquals(r.level, "low");
});

Deno.test("assessCodRisk: RPC'ye normalize edilmemiş telefon + pencere gider, ok:true skorlanır", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({
        data: { ok: true, window_days: 180, cancelled_count: 1, delivered_count: 0, open_cod_count: 0 },
        error: null,
      });
    },
  };
  const r = await assessCodRisk(admin, { phone: "0532 123 45 67" });
  assertEquals(calls, [{
    fn: "codrisk_signals",
    args: { p_phone: "0532 123 45 67", p_window_days: CODRISK_WINDOW_DAYS },
  }]);
  assertEquals(r?.level, "medium");
});

Deno.test("assessCodRisk: RPC hatası ve ok:false → null (fail-soft)", async () => {
  const hata = {
    rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
  };
  assertEquals(await assessCodRisk(hata, { phone: "05321234567" }), null);

  const kisa = {
    rpc: () => Promise.resolve({ data: { ok: false, reason: "phone_too_short" }, error: null }),
  };
  assertEquals(await assessCodRisk(kisa, { phone: "123" }), null);

  const patlayan = {
    rpc: () => Promise.reject(new Error("ağ koptu")),
  };
  assertEquals(await assessCodRisk(patlayan, { phone: "05321234567" }), null);
});

Deno.test("normPhone ↔ codrisk_norm_phone sözleşmesi: aynı örnekler aynı sonucu vermeli", () => {
  // SQL karşılığı: right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 10)
  const fixtures: Array<[string, string]> = [
    ["0532 123 45 67", "5321234567"],
    ["+90 532 123 45 67", "5321234567"],
    ["(532) 123-4567", "5321234567"],
    ["90 532 123 45 67", "5321234567"],
    ["532", "532"],
    ["", ""],
  ];
  for (const [girdi, beklenen] of fixtures) {
    assertEquals(normPhone(girdi), beklenen);
    // SQL ifadesinin JS eşleniği — sözleşme değişirse bu test kırılmalı
    assertEquals(girdi.replace(/\D/g, "").slice(-10), beklenen);
  }
});
