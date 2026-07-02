// ============================================================
//  Esse Jeffe — Sentry hata iletimi (paylaşılan modül)
//  Logger (log.ts) `error` seviyesinde bir olay ürettiğinde, SENTRY_DSN
//  tanımlıysa olay buraya iletilir. Böylece hatalar Supabase log ekranının
//  yanı sıra Sentry'de gruplanır, sıklığı görülür ve alarm kurulabilir.
//
//  KURAL: Sentry'ye de kişisel veri (ad, telefon, adres, e-posta) GÖNDERİLMEZ.
//  Yalnız operasyonel alanlar (fn, event, request_id, order_no, ip, detay).
//
//  Ağ çağrısı (fetch) yalnız captureError içinde; parse/build saf ve
//  test edilebilir → Deno API'si kullanmaz, Node testlerinde de import edilebilir.
// ============================================================

export interface ParsedDsn {
  storeUrl: string; // Sentry "store" endpoint'i
  publicKey: string;
}

export interface SentryParams {
  fn: string;
  event: string;
  requestId: string;
  level?: "error" | "warning" | "info";
  fields?: Record<string, unknown>;
}

/**
 * Sentry DSN'ini store endpoint'ine ve public key'e çözer.
 * DSN biçimi: {protocol}://{public_key}@{host}{path}/{project_id}
 * Geçersizse null döner (çağıran gönderimi atlar).
 */
export function parseSentryDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    if (!publicKey) return null;
    const segments = u.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!projectId) return null;
    const prefix = segments.length ? "/" + segments.join("/") : "";
    return {
      storeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/store/`,
      publicKey,
    };
  } catch {
    return null;
  }
}

/** Sentry kimlik doğrulama başlığı (X-Sentry-Auth). */
export function sentryAuthHeader(publicKey: string): string {
  return `Sentry sentry_version=7, sentry_client=esse-edge/1.0, sentry_key=${publicKey}`;
}

/**
 * Sentry "store" olay gövdesini üretir (saf → test edilebilir).
 * eventId ve timestamp enjekte edilebilir; verilmezse çağıran üretir.
 */
export function buildSentryEvent(
  p: SentryParams,
  eventId: string,
  timestampIso: string,
): Record<string, unknown> {
  return {
    event_id: eventId,
    timestamp: timestampIso,
    platform: "other",
    level: p.level || "error",
    logger: p.fn,
    server_name: p.fn,
    transaction: p.event,
    message: { formatted: `${p.fn}: ${p.event}` },
    tags: { fn: p.fn, event: p.event, request_id: p.requestId },
    extra: p.fields || {},
  };
}

function randomHex32(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export interface CaptureDeps {
  fetchImpl?: typeof fetch;
  eventId?: string;
  timestampIso?: string;
}

/**
 * Hatayı Sentry'ye iletir. ASLA fırlatmaz (gönderim başarısızsa false döner);
 * çağıran akışı bloklamamalı — mümkünse EdgeRuntime.waitUntil ile arka planda çalıştır.
 */
export async function captureError(
  dsn: string,
  params: SentryParams,
  deps: CaptureDeps = {},
): Promise<boolean> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return false;

  const eventId = deps.eventId ?? randomHex32();
  const timestampIso = deps.timestampIso ?? new Date().toISOString();
  const body = JSON.stringify(buildSentryEvent(params, eventId, timestampIso));
  const doFetch = deps.fetchImpl ?? fetch;

  try {
    const res = await doFetch(parsed.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": sentryAuthHeader(parsed.publicKey),
      },
      body,
    });
    return res.ok;
  } catch {
    return false; // ağ hatası hatayı gizlemesin; zaten console'a da yazıldı
  }
}
