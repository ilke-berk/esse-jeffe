// deno test backend/edge-functions/_shared/log_test.ts
import { assertEquals } from "jsr:@std/assert";
import { buildLogEntry, errMsg } from "./log.ts";

Deno.test("buildLogEntry: sabit alanlar + ek alanlar birleşir", () => {
  const e = buildLogEntry("error", "create-order", "db_error", "req-1", 42, {
    order_no: "EJ26070212345",
    ip: "1.2.3.4",
  });
  assertEquals(e, {
    level: "error",
    fn: "create-order",
    event: "db_error",
    request_id: "req-1",
    elapsed_ms: 42,
    order_no: "EJ26070212345",
    ip: "1.2.3.4",
  });
});

Deno.test("buildLogEntry: ek alan yoksa yalnız sabitler", () => {
  const e = buildLogEntry("info", "fn", "ev", "r", 0);
  assertEquals(e, { level: "info", fn: "fn", event: "ev", request_id: "r", elapsed_ms: 0 });
});

Deno.test("errMsg: Error → message, diğer → string(kısaltılmış)", () => {
  assertEquals(errMsg(new Error("patladı")), "patladı");
  assertEquals(errMsg("düz metin"), "düz metin");
  assertEquals(errMsg(null), "");
  assertEquals(errMsg(undefined), "");
  assertEquals(errMsg("x".repeat(500)).length, 300); // stack/uzun metin loga taşmasın
});
