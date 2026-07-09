// Esse Jeffe — _shared/log.ts + _shared/sentry.ts testleri
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLogEntry, createLogger, errMsg } from "../backend/edge-functions/_shared/log.ts";
import {
  parseSentryDsn,
  buildSentryEvent,
  sentryAuthHeader,
  captureError,
} from "../backend/edge-functions/_shared/sentry.ts";

// console çıktısını yakala
function capture(fnName, run) {
  const orig = console[fnName];
  const lines = [];
  console[fnName] = (msg) => lines.push(msg);
  try { run(); } finally { console[fnName] = orig; }
  return lines;
}

test("buildLogEntry: zorunlu alanlar + ek alanlar birleşir", () => {
  const e = buildLogEntry("error", "create-order", "db_error", "rid-1", 42, { order_no: "EJ1" });
  assert.equal(e.level, "error");
  assert.equal(e.fn, "create-order");
  assert.equal(e.event, "db_error");
  assert.equal(e.request_id, "rid-1");
  assert.equal(e.elapsed_ms, 42);
  assert.equal(e.order_no, "EJ1");
});

test("createLogger: her seviye tek satır GEÇERLİ JSON yazar", () => {
  const log = createLogger("test-fn");
  const errLines = capture("error", () => log.error("kaboom", { detail: "x" }));
  const warnLines = capture("warn", () => log.warn("dikkat"));
  const infoLines = capture("log", () => log.info("olay"));

  for (const lines of [errLines, warnLines, infoLines]) {
    assert.equal(lines.length, 1);
    const obj = JSON.parse(lines[0]); // geçersizse fırlatır
    assert.equal(obj.fn, "test-fn");
    assert.ok(typeof obj.elapsed_ms === "number");
    assert.ok(obj.request_id);
  }
  assert.equal(JSON.parse(errLines[0]).detail, "x");
});

test("createLogger: x-request-id başlığı request_id olarak kullanılır", () => {
  const req = { headers: { get: (n) => (n === "x-request-id" ? "abc-123" : null) } };
  const log = createLogger("t", req);
  assert.equal(log.requestId, "abc-123");
  const lines = capture("log", () => log.info("e"));
  assert.equal(JSON.parse(lines[0]).request_id, "abc-123");
});

test("errMsg: Error mesajını, diğerlerini kısaltılmış string döner", () => {
  assert.equal(errMsg(new Error("patladı")), "patladı");
  assert.equal(errMsg("düz metin"), "düz metin");
  assert.equal(errMsg(null), "");
  assert.equal(errMsg("x".repeat(500)).length, 300);
});

// ---- Sentry ----

test("parseSentryDsn: geçerli DSN'i store URL + public key'e çözer", () => {
  const p = parseSentryDsn("https://abc123@o450.ingest.sentry.io/1234567");
  assert.equal(p.publicKey, "abc123");
  assert.equal(p.storeUrl, "https://o450.ingest.sentry.io/api/1234567/store/");
});

test("parseSentryDsn: geçersiz/boş DSN'de null (gönderim atlanır)", () => {
  assert.equal(parseSentryDsn(null), null);
  assert.equal(parseSentryDsn(""), null);
  assert.equal(parseSentryDsn("bozuk-dsn"), null);
  assert.equal(parseSentryDsn("https://host.io/123"), null); // public key yok
});

test("buildSentryEvent: fn/event/request_id etiketlenir, alanlar extra'ya gider", () => {
  const ev = buildSentryEvent(
    { fn: "create-order", event: "db_error", requestId: "rid", fields: { order_no: "EJ1" } },
    "e".repeat(32),
    "2026-07-02T12:00:00.000Z",
  );
  assert.equal(ev.level, "error");
  assert.deepEqual(ev.tags, { fn: "create-order", event: "db_error", request_id: "rid" });
  assert.deepEqual(ev.extra, { order_no: "EJ1" });
  assert.equal(ev.message.formatted, "create-order: db_error");
});

test("sentryAuthHeader: sentry_key'i içerir", () => {
  assert.match(sentryAuthHeader("pk1"), /sentry_key=pk1/);
});

test("captureError: doğru URL'ye POST atar, başarıda true döner", async () => {
  let got = null;
  const ok = await captureError(
    "https://pk@host.io/42",
    { fn: "f", event: "e", requestId: "r" },
    {
      fetchImpl: async (url, init) => { got = { url, init }; return { ok: true }; },
      eventId: "id", timestampIso: "2026-07-02T12:00:00.000Z",
    },
  );
  assert.equal(ok, true);
  assert.equal(got.url, "https://host.io/api/42/store/");
  assert.equal(got.init.method, "POST");
  assert.match(got.init.headers["X-Sentry-Auth"], /sentry_key=pk/);
});

test("captureError: ağ hatasında fırlatmaz, false döner (fail-soft)", async () => {
  const ok = await captureError(
    "https://pk@host.io/42",
    { fn: "f", event: "e", requestId: "r" },
    { fetchImpl: async () => { throw new Error("ağ yok"); } },
  );
  assert.equal(ok, false);
});

test("createLogger: error seviyesi Sentry'ye iletilir, info iletilmez", async () => {
  const sent = [];
  // fetch'i geçici olarak yakala (captureError global fetch kullanır)
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { sent.push(url); return { ok: true }; };
  try {
    const waited = [];
    const log = createLogger("t", undefined, {
      sentryDsn: "https://pk@host.io/42",
      waitUntil: (p) => waited.push(p),
    });
    capture("log", () => log.info("olay"));
    capture("error", () => log.error("kaboom"));
    await Promise.all(waited);
    assert.equal(sent.length, 1);
    assert.equal(sent[0], "https://host.io/api/42/store/");
  } finally {
    globalThis.fetch = origFetch;
  }
});
