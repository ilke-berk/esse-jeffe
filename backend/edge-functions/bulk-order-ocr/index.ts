// ============================================================
//  Esse Jeffe — Toplu kargo/durum güncellemesi: ekran görüntüsü OCR (Edge Function)
//  Akış: admin-siparisler.html "Toplu Güncelle" modalı görüntü yükler →
//        bu fonksiyon Gemini Vision ile satırları AYIKLAR → client eşleştirir
//        ve admin JWT + RLS (orders_admin_update) ile kendisi yazar.
//
//  GÜVENLİK (order-status-email deseni):
//   - verify_jwt AÇIK + fonksiyon içinde profiles.is_admin kontrolü; anon key yetmez.
//   - Bu fonksiyon SADECE görüntüden satır ayıklar; siparişlere YAZMAZ.
//     Yazma yüzeyi client'ta (admin JWT + RLS) kalır — service_role toplu
//     yazma kapısı açılmaz.
//
//  Girdi : { image_base64: string, mime: "image/png" | "image/jpeg" | ... }
//  Çıktı : { rows: [{ order_no?, tracking_no?, carrier?, status? }] }
//    status sunucuda 5 izinli değere normalize edilir; tanınmayan boş kalır.
//
//  Secret: GEMINI_API_KEY (chat ile ortak), GEMINI_MODEL (ops.).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NOT: Bu fonksiyon bilinçli olarak KENDİ KENDİNE YETER (chat EF emsali):
// _shared zinciri (log→sentry, cors→util) yerine minimal yerleşik logger +
// origin kilidi kullanır; MCP/CLI deploy'u tek dosyayla yapılabilir.
function ocrLog(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, fn: "bulk-order-ocr", event, ...(fields || {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const ALLOWED_ORIGINS = (Deno.env.get("EDGE_ALLOWED_ORIGINS") ||
  Deno.env.get("CHAT_ALLOWED_ORIGINS") ||
  "https://essejeffe.com,https://www.essejeffe.com")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const o = String(origin || "").replace(/\/+$/, "");
  const ok = ALLOWED_ORIGINS.includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return {
    "Access-Control-Allow-Origin": ok ? o : (ALLOWED_ORIGINS[0] || "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const MAX_IMAGE_B64 = 6_000_000;   // ~4.5 MB görüntü (base64 şişkinliği dahil)

// TR durum ifadeleri → orders.status değerleri (admin-bulk.js'teki normalizeStatus
// ile aynı eşleme; OCR çıktısı da buradan geçer — model ne dönerse dönsün
// yalnız 5 izinli değer ya da boş çıkar)
const STATUS_MAP: Record<string, string> = {
  "pending": "pending", "bekliyor": "pending", "alindi": "pending", "alındı": "pending",
  "preparing": "preparing", "hazirlaniyor": "preparing", "hazırlanıyor": "preparing",
  "shipped": "shipped", "kargoda": "shipped", "kargoya verildi": "shipped",
  "kargoya-verildi": "shipped", "yolda": "shipped", "cikis yapildi": "shipped", "çıkış yapıldı": "shipped",
  "delivered": "delivered", "teslim": "delivered", "teslim edildi": "delivered", "teslimat tamamlandi": "delivered", "teslimat tamamlandı": "delivered",
  "cancelled": "cancelled", "iptal": "cancelled", "iptal edildi": "cancelled", "iade": "cancelled",
};
function normStatus(v: unknown): string | null {
  const s = String(v ?? "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (STATUS_MAP[s]) return STATUS_MAP[s];
  for (const k of Object.keys(STATUS_MAP)) {
    if (s.includes(k)) return STATUS_MAP[k];
  }
  return null;
}

const EXTRACT_PROMPT =
  "Bu görüntü bir kargo firması raporu, kargo fişi ya da sipariş listesi ekran görüntüsüdür. " +
  "Görüntüdeki HER satır/kayıt için şu alanları ayıkla (görünmüyorsa alanı hiç yazma):\n" +
  '- order_no: "EJ" ile başlayan sipariş numarası (örn. EJ26071712345)\n' +
  "- tracking_no: kargo takip numarası (uzun rakam/harf dizisi; EJ ile başlamaz)\n" +
  '- carrier: kargo firması adı (örn. "Aras Kargo", "Yurtiçi", "MNG")\n' +
  '- status: satırda görünen sipariş/kargo durumu, aynen yazıldığı gibi (örn. "Kargoya verildi", "Teslim edildi")\n' +
  "Yalnızca görüntüde GERÇEKTEN görünen bilgiyi yaz; tahmin etme, uydurma. " +
  "Tablo başlıklarını ve toplam/özet satırlarını dahil etme.";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          order_no: { type: "string" },
          tracking_no: { type: "string" },
          carrier: { type: "string" },
          status: { type: "string" },
        },
      },
    },
  },
  required: ["rows"],
};

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const log = {
    info: (e: string, f?: Record<string, unknown>) => ocrLog("info", e, f),
    warn: (e: string, f?: Record<string, unknown>) => ocrLog("warn", e, f),
    error: (e: string, f?: Record<string, unknown>) => ocrLog("error", e, f),
  };

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- kimlik: JWT'den kullanıcı → profiles.is_admin (order-status-email deseni) ---
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (uErr || !uid) return json({ error: "Oturum gerekli." }, 401);
  const { data: prof } = await admin
    .from("profiles").select("is_admin").eq("id", uid).maybeSingle();
  if (!prof || prof.is_admin !== true) {
    log.warn("not_admin", { uid });
    return json({ error: "Yetkisiz." }, 403);
  }

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "OCR yapılandırılmamış (GEMINI_API_KEY eksik)." }, 500);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }
  const b64 = String(payload?.image_base64 || "").replace(/^data:[^,]+,/, "");
  const mime = String(payload?.mime || "image/png");
  if (!b64) return json({ error: "Görüntü gerekli." }, 400);
  if (b64.length > MAX_IMAGE_B64) return json({ error: "Görüntü çok büyük (en fazla ~4 MB)." }, 413);
  if (!/^image\/(png|jpe?g|webp)$/i.test(mime)) return json({ error: "Desteklenmeyen görüntü türü." }, 400);

  // --- Gemini Vision: yapılandırılmış JSON çıktı ---
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: EXTRACT_PROMPT },
          { inlineData: { mimeType: mime, data: b64 } },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    log.error("gemini_error", { status: res.status, detail: (await res.text()).slice(0, 300) });
    return json({ error: "Görüntü okunamadı (OCR hatası). Lütfen tekrar deneyin." }, 502);
  }
  const data = await res.json();
  const text = ((data.candidates || [])[0]?.content?.parts || [])
    .filter((p: { text?: string }) => typeof p.text === "string")
    .map((p: { text: string }) => p.text).join("");
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* aşağıda ele alınır */ }
  const rawRows: any[] = Array.isArray(parsed?.rows) ? parsed.rows : [];

  // --- sunucu tarafı temizlik: yalnız beklenen alanlar + durum normalizasyonu ---
  const rows = rawRows.slice(0, 200).map((r) => {
    const orderNo = String(r?.order_no || "").toUpperCase().replace(/\s+/g, "").trim();
    const tracking = String(r?.tracking_no || "").replace(/\s+/g, "").trim();
    const out: Record<string, string> = {};
    if (/^EJ\d{11,12}$/.test(orderNo)) out.order_no = orderNo;
    if (tracking && !/^EJ\d+/i.test(tracking)) out.tracking_no = tracking.slice(0, 60);
    const carrier = String(r?.carrier || "").trim();
    if (carrier) out.carrier = carrier.slice(0, 80);
    const st = normStatus(r?.status);
    if (st) out.status = st;
    return out;
  }).filter((r) => r.order_no || r.tracking_no);

  log.info("ocr_done", { uid, raw: rawRows.length, usable: rows.length });
  return json({ rows });
});
