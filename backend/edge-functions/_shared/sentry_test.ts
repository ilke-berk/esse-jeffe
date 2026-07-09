// deno test backend/edge-functions/_shared/sentry_test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildSentryEvent,
  captureError,
  parseSentryDsn,
  sentryAuthHeader,
} from "./sentry.ts";

Deno.test("parseSentryDsn: store endpoint + public key çözer", () => {
  const p = parseSentryDsn("https://abc123@o55.ingest.sentry.io/456");
  assertEquals(p, {
    storeUrl: "https://o55.ingest.sentry.io/api/456/store/",
    publicKey: "abc123",
  });
});

Deno.test("parseSentryDsn: geçersiz/eksik → null", () => {
  assertEquals(parseSentryDsn(""), null);
  assertEquals(parseSentryDsn(null), null);
  assertEquals(parseSentryDsn("düz metin"), null);
  assertEquals(parseSentryDsn("https://o55.ingest.sentry.io/456"), null); // public key yok
});

Deno.test("sentryAuthHeader: sürüm + key içerir", () => {
  const h = sentryAuthHeader("mykey");
  assertStringIncludes(h, "sentry_version=7");
  assertStringIncludes(h, "sentry_key=mykey");
});

Deno.test("buildSentryEvent: alanlar doğru yerleşir", () => {
  const ev = buildSentryEvent(
    { fn: "create-order", event: "db_error", requestId: "r1", fields: { order_no: "EJ26070212345" } },
    "eventid32",
    "2026-07-02T12:00:00.000Z",
  );
  assertEquals(ev.event_id, "eventid32");
  assertEquals(ev.level, "error");
  assertEquals(ev.transaction, "db_error");
  assertEquals((ev.tags as Record<string, unknown>).fn, "create-order");
  assertEquals((ev.extra as Record<string, unknown>).order_no, "EJ26070212345");
});

Deno.test("captureError: DSN varken enjekte fetch'e POST atar", async () => {
  let calledUrl = "";
  let authHeader = "";
  const fakeFetch = ((url: string, init: RequestInit) => {
    calledUrl = String(url);
    authHeader = String((init.headers as Record<string, string>)["X-Sentry-Auth"]);
    return Promise.resolve({ ok: true } as Response);
  }) as unknown as typeof fetch;

  const ok = await captureError(
    "https://abc@o1.ingest.sentry.io/9",
    { fn: "f", event: "e", requestId: "r" },
    { fetchImpl: fakeFetch, eventId: "x", timestampIso: "2026-01-01T00:00:00Z" },
  );
  assertEquals(ok, true);
  assertEquals(calledUrl, "https://o1.ingest.sentry.io/api/9/store/");
  assertStringIncludes(authHeader, "sentry_key=abc");
});

Deno.test("captureError: DSN geçersizse fetch çağrılmaz, false döner", async () => {
  let called = false;
  const fakeFetch = (() => { called = true; return Promise.resolve({ ok: true } as Response); }) as unknown as typeof fetch;
  const ok = await captureError("", { fn: "f", event: "e", requestId: "r" }, { fetchImpl: fakeFetch });
  assertEquals(ok, false);
  assertEquals(called, false);
});

Deno.test("captureError: ağ hatası yutulur (false), fırlatmaz", async () => {
  const fakeFetch = (() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
  const ok = await captureError(
    "https://abc@o1.ingest.sentry.io/9",
    { fn: "f", event: "e", requestId: "r" },
    { fetchImpl: fakeFetch },
  );
  assertEquals(ok, false);
});
