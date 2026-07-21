// ============================================================
//  Esse Jeffe — Yapılandırılmış loglama (paylaşılan modül)
//  Edge Function'lar düz console.error yerine bu logger'ı kullanır.
//
//  NEDEN: Supabase Dashboard → Edge Functions → Logs ekranı satır
//  bazlı arama yapar. Tek satırlık JSON loglar; fonksiyon adı, olay,
//  istek kimliği ve süre alanlarıyla filtrelenebilir hata izleme sağlar
//  (ör. arama kutusuna `"level":"error"` veya `"fn":"create-order"` yaz).
//
//  KURAL: Loglara kişisel veri (ad, telefon, adres, e-posta) YAZILMAZ.
//  Sipariş no / IP gibi operasyonel alanlar yeterlidir.
//
//  HATA ALARMI: SENTRY_DSN tanımlıysa `error` seviyesi olaylar Sentry'ye de
//  iletilir (sentry.ts). Gönderim EdgeRuntime.waitUntil ile arka plandadır;
//  yoksa fire-and-forget. Deno/EdgeRuntime erişimi typeof ile korunur →
//  modül Node testlerinde de sorunsuz import edilir (saf yardımcılar test edilebilir).
// ============================================================
import { captureError } from "./sentry.ts";
import { xffShape } from "./util.ts";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  fn: string; // fonksiyon adı: "create-order", "submit-form" ...
  event: string; // olay: "order_created", "rate_limited", "db_error" ...
  request_id: string;
  elapsed_ms: number;
  [key: string]: unknown; // ek alanlar (order_no, ip, status ...)
}

export interface Logger {
  requestId: string;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOpts {
  // Test/özel kullanım için enjekte edilebilir; verilmezse ortamdan okunur.
  sentryDsn?: string;
  waitUntil?: (p: Promise<unknown>) => void;
  // Y-1 gölge ölçümü; testlerde kapatmak için false verilir.
  xffShadow?: boolean;
}

// Ortam erişimi typeof ile korunur (Node/test'te Deno tanımsızsa patlamaz).
function envSentryDsn(): string | undefined {
  try {
    // @ts-ignore — Deno yalnız runtime'da var
    return typeof Deno !== "undefined" ? Deno.env.get("SENTRY_DSN") ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

// Y-1 gölge logu varsayılan AÇIK; ölçüm bitince EJ_XFF_SHADOW=0 ile kapatılır
// (kapatmak yeniden deploy değil, yalnız secret değişimi gerektirir).
function envXffShadow(): boolean {
  try {
    // @ts-ignore — Deno yalnız runtime'da var
    if (typeof Deno === "undefined") return false; // Node testlerinde sessiz
    // @ts-ignore
    return !/^(0|false|off|no)$/i.test(Deno.env.get("EJ_XFF_SHADOW") ?? "1");
  } catch {
    return false;
  }
}

function edgeWaitUntil(): ((p: Promise<unknown>) => void) | undefined {
  try {
    // @ts-ignore — EdgeRuntime yalnız Supabase Edge'de var
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      return (p: Promise<unknown>) => EdgeRuntime.waitUntil(p);
    }
  } catch { /* yoksa yok */ }
  return undefined;
}

// Saf yardımcı: tek bir log kaydı üret (test edilebilir).
export function buildLogEntry(
  level: LogLevel,
  fn: string,
  event: string,
  requestId: string,
  elapsedMs: number,
  fields?: Record<string, unknown>,
): LogEntry {
  return {
    level,
    fn,
    event,
    request_id: requestId,
    elapsed_ms: elapsedMs,
    ...(fields || {}),
  };
}

// Hata nesnesini loglanabilir kısa metne indir (stack loga taşmasın).
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "").slice(0, 300);
}

/**
 * İstek başına bir logger oluştur. Her kayıt tek satır JSON olarak
 * console'a yazılır; Supabase log ekranında filtrelenebilir.
 */
export function createLogger(fn: string, req?: Request, opts?: LoggerOpts): Logger {
  const requestId =
    req?.headers.get("x-request-id") ||
    (globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const t0 = Date.now();
  const sentryDsn = opts?.sentryDsn ?? envSentryDsn();
  const waitUntil = opts?.waitUntil ?? edgeWaitUntil();

  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify(
      buildLogEntry(level, fn, event, requestId, Date.now() - t0, fields),
    );
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);

    // Yalnız hatalar Sentry'ye — gürültüyü (rate_limited vb. warn) dışarı taşımaz.
    if (level === "error" && sentryDsn) {
      const p = captureError(sentryDsn, { fn, event, requestId, level: "error", fields })
        .catch(() => {}); // Sentry gönderimi asıl akışı ASLA bozmaz
      if (waitUntil) waitUntil(p); // yanıt sonrası tamamlansın (fonksiyon erken bitmesin)
    }
  };

  // --- Y-1 gölge ölçümü ---
  // Logger her fonksiyonda EN BAŞTA kurulur; kaydı buraya koymak, ölçümün
  // gövde/secret doğrulamasından ÖNCE düşmesini garanti eder (400/401 dönen
  // istekler de sayılır → yanlış negatif olmaz).
  if (req && (opts?.xffShadow ?? envXffShadow())) {
    try {
      emit("info", "xff_shape", xffShape(req));
    } catch { /* ölçüm asıl akışı ASLA bozmaz */ }
  }

  return {
    requestId,
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
