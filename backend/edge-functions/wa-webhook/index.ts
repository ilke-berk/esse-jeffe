// ============================================================
//  Esse Jeffe — WhatsApp Cloud API webhook (Edge Function) — FAZ 2
//  Akış: Meta (müşteri mesajı) → bu fonksiyon → chat EF (Gemini +
//        sipariş araçları) → cevap Graph API ile müşteriye döner.
//
//  MİMARİ: Bu fonksiyon bir KÖPRÜ — beyin, sitedeki chat widget'ına da
//  hizmet eden `chat` fonksiyonudur (start/send aksiyonları). Böylece
//  iade filtresi, kupon korumaları, deterministik onay, hız sınırları
//  tek yerde kalır. WhatsApp tarafına özgü işler burada:
//   - telefon ↔ chat oturumu eşlemesi (wa_sessions tablosu)
//   - Gemini cevabını chat_messages'tan okuyup WhatsApp'a gönderme
//   - kart payload'larını (ürün/özet/değişim) WhatsApp metnine çevirme
//
//  ZAMANLAMA: Meta ~10 sn içinde 200 bekler, gecikirse AYNI mesajı
//  yeniden gönderir. Gemini turu ise 5-30 sn sürebilir. Bu yüzden POST
//  hemen 200 ile kapatılır; işleme EdgeRuntime.waitUntil ile arka
//  planda sürer. Ek olarak instance-içi mesaj-id dedup seti, olası
//  retry'ların aynı mesajı iki kez işlemesini keser (best-effort).
//
//  HIZ SINIRI ANAHTARI: chat EF, IP'yi x-forwarded-for[0]'dan okur.
//  Buradan yapılan iç çağrılarda XFF'e telefon hash'inden türetilmiş
//  sentetik bir 10.x.y.z yazılır → chat'in IP sınırları müşteri BAŞINA
//  işler; tüm WhatsApp trafiği tek IP sayılıp boğulmaz.
//
//  GÜVENLİK: GET doğrulama + HMAC imza Faz 1'deki gibi. WA_APP_SECRET
//  tanımlıysa imzasız istek 401; tanımsızsa yalnız uyarı loglanır
//  (test fazı) — CANLIYA GEÇMEDEN WA_APP_SECRET ZORUNLU.
//
//  SECRET'LAR: WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN,
//  WA_APP_SECRET (ops.), SITE_URL (ops., ürün linkleri için).
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY platformdan gelir.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { createLogger, type Logger } from "../_shared/log.ts";
import { timingSafeEqualStr } from "../_shared/util.ts";

const GRAPH = "https://graph.facebook.com/v23.0";
const SITE = (Deno.env.get("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");
const WA_TEXT_MAX = 3500; // güvenli parça boyu (resmî sınır 4096)
const CAPTION_MAX = 1000; // medya caption sınırı 1024

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---------- yardımcılar ----------

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Telefondan sentetik hız-sınırı anahtarı: FNV-1a → 10.x.y.z */
function synthIp(phone: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < phone.length; i++) {
    h ^= phone.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${h & 255}`;
}

/** Cloud API çağrısı (mesaj gönder / okundu işaretle). Hata fırlatmaz. */
async function waSend(payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string }> {
  const token = Deno.env.get("WA_ACCESS_TOKEN") ?? "";
  const phoneId = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

/**
 * Site-markdown'ını WhatsApp biçimine çevir. Esin'in cevapları widget için
 * yazılıyor: **kalın** → *kalın*, [metin](url) → "metin: url", başlık/`kod`
 * işaretleri düz metne iner. WhatsApp kendi tek-yıldız/alt-çizgi biçimini
 * zaten destekler; onlara dokunulmaz.
 */
function mdToWhatsApp(s: string): string {
  return String(s || "")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")            // **kalın** → *kalın*
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2")  // [metin](url) → metin: url
    .replace(/^#{1,6}\s+/gm, "")                     // # başlık işaretleri
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1");          // `kod` işaretleri
}

/** Uzun metni WhatsApp sınırına göre parçalar halinde gönder. */
async function waText(to: string, text: string, log: Logger): Promise<void> {
  const t = mdToWhatsApp(String(text || "")).trim();
  if (!t) return;
  for (let i = 0; i < t.length; i += WA_TEXT_MAX) {
    const part = t.slice(i, i + WA_TEXT_MAX);
    const r = await waSend({ to, type: "text", text: { body: part, preview_url: false } });
    if (!r.ok) log.error("wa_send_failed", { status: r.status, detail: r.body.slice(0, 300) });
  }
}

/** chat EF'ine iç çağrı. Origin başlığı YOK (tarayıcı-dışı yol), XFF sentetik. */
async function chatCall(action: string, payload: Record<string, unknown>, ip: string): Promise<any> {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ action, ...payload }),
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* boş gövde */ }
  return { status: res.status, ...((body && typeof body === "object") ? body : {}) };
}

const fmtTL = (n: unknown): string =>
  Number(n ?? 0).toLocaleString("tr-TR") + " TL";

const PM_TR: Record<string, string> = {
  cod: "Kapıda Ödeme", card: "Kredi Kartı", transfer: "Havale/EFT", havale: "Havale/EFT",
};

/** Sipariş özet kartını (mode:'summary') WhatsApp metnine çevir. */
function renderSummary(card: any): string {
  const L: string[] = ["🧾 *Sipariş Özeti*", ""];
  for (const it of card?.items ?? []) {
    const variant = [it?.color, it?.size].filter(Boolean).join(" / ");
    L.push(`• ${it?.qty || 1} × ${it?.name || "?"}${variant ? ` (${variant})` : ""} — ${fmtTL(it?.line_total)}`);
  }
  L.push("");
  L.push(`Ara toplam: ${fmtTL(card?.subtotal)}`);
  if (Number(card?.shipping) > 0) L.push(`Kargo: ${fmtTL(card.shipping)}`);
  else L.push("Kargo: Ücretsiz");
  if (Number(card?.discount) > 0) {
    L.push(`İndirim${card?.discount_code ? ` (${card.discount_code})` : ""}: −${fmtTL(card.discount)}`);
  }
  L.push(`*Toplam: ${fmtTL(card?.total)}*`);
  L.push("");
  const f = card?.form ?? {};
  L.push(`Ödeme: ${PM_TR[String(card?.payment_method)] || card?.payment_method || "?"}`);
  const addr = [f?.address, f?.district, f?.city].filter(Boolean).join(", ");
  if (f?.name) L.push(`Alıcı: ${f.name}`);
  if (addr) L.push(`Adres: ${addr}`);
  if (card?.geo?.display) L.push(`📍 Adres teyidi: ${card.geo.display}`);
  L.push("");
  L.push("Onaylamak için *Onaylıyorum* yazmanız yeterli. Değişiklik isterseniz yazın, düzeltelim.");
  return L.join("\n");
}

/** Değişim/iptal özet kartını (mode:'exchange_summary') metne çevir. */
function renderExchange(card: any): string {
  const L: string[] = [`🔄 *${card?.type_tr || "Talep"} Özeti*`, ""];
  if (card?.order_no) L.push(`Sipariş: ${card.order_no}`);
  const p = card?.product;
  if (p?.name) {
    const cur = [p?.current_color, p?.current_size].filter(Boolean).join(" / ");
    L.push(`Ürün: ${p.name}${cur ? ` (${cur})` : ""}`);
  }
  const yeni = [card?.new_color, card?.new_size].filter(Boolean).join(" / ");
  if (yeni) L.push(`Yeni tercih: ${yeni}`);
  if (card?.reason_tr) L.push(`Sebep: ${card.reason_tr}`);
  L.push("");
  L.push("Onaylamak için *Onaylıyorum* yazmanız yeterli.");
  return L.join("\n");
}

/** Ürün kartını (mode:'product') görsel + caption olarak gönder. */
async function sendProductCard(to: string, card: any, log: Logger): Promise<void> {
  const p = card?.product ?? {};
  const L: string[] = [`✨ *${p?.name || "Ürün"}*`];
  if (p?.model_desc) L.push(String(p.model_desc));
  L.push(p?.old_price
    ? `~${fmtTL(p.old_price)}~  *${fmtTL(p.price)}*`
    : `*${fmtTL(p?.price)}*`);
  if (Array.isArray(p?.colors) && p.colors.length) L.push(`Renkler: ${p.colors.join(", ")}`);
  if (Array.isArray(p?.sizes) && p.sizes.length) L.push(`Bedenler: ${p.sizes.join(", ")}`);
  if (p?.slug) {
    const link = `${SITE}/urun.html?slug=${encodeURIComponent(p.slug)}` +
      (p?.color ? `&renk=${encodeURIComponent(p.color)}` : "");
    L.push(link);
  }
  const caption = L.join("\n").slice(0, CAPTION_MAX);
  if (p?.image && /^https?:\/\//.test(String(p.image))) {
    const r = await waSend({ to, type: "image", image: { link: p.image, caption } });
    if (r.ok) return;
    log.warn("wa_image_failed_fallback_text", { status: r.status });
  }
  await waText(to, caption, log);
}

// ---------- oturum eşlemesi ----------

interface WaSession { conversation_id: string; visitor_token: string }

async function getSession(phone: string): Promise<WaSession | null> {
  const { data } = await admin.from("wa_sessions")
    .select("conversation_id,visitor_token").eq("phone", phone).maybeSingle();
  return (data as WaSession) ?? null;
}

async function newSession(phone: string, profileName: string, ip: string, log: Logger): Promise<WaSession | null> {
  const name = `${profileName || "WhatsApp"} (WA +${phone})`.slice(0, 120);
  const r = await chatCall("start", { name, page: "whatsapp" }, ip);
  if (!r?.conversation_id || !r?.visitor_token) {
    log.error("chat_start_failed", { status: r?.status, error: r?.error });
    return null;
  }
  const s = { conversation_id: r.conversation_id, visitor_token: r.visitor_token };
  const { error } = await admin.from("wa_sessions")
    .upsert({ phone, ...s, updated_at: new Date().toISOString() });
  if (error) log.warn("wa_session_save_error", { detail: error.message });
  return s;
}

// ---------- mesaj işleme (arka plan) ----------

// Meta retry dedup'u (best-effort, instance ömrüyle sınırlı)
const seenIds = new Set<string>();

async function processMessage(msg: any, profileName: string, log: Logger): Promise<void> {
  const from = String(msg?.from ?? "");
  if (!from) return;

  // Okundu + "yazıyor..." göstergesi: Gemini turu sürerken müşteri boşlukta kalmasın
  if (msg?.id) {
    await waSend({ status: "read", message_id: msg.id, typing_indicator: { type: "text" } })
      .catch(() => {});
  }

  if (msg?.type !== "text") {
    const type = String(msg?.type ?? "unknown");
    log.info("message_in", { type });
    const nudge: Record<string, string> = {
      audio: "Sesli mesajınızı aldım ama henüz dinleyemiyorum 🙈 Sorunuzu yazıyla iletirseniz hemen yardımcı olayım.",
      image: "Görselinizi aldım ama henüz göremiyorum 🙈 Hangi ürün ya da konu hakkında olduğunu yazarsanız hemen yardımcı olayım.",
      video: "Videonuzu aldım ama henüz izleyemiyorum 🙈 Konuyu kısaca yazarsanız hemen yardımcı olayım.",
      document: "Dosyanızı aldım ama henüz açamıyorum 🙈 İçeriğini kısaca yazarsanız hemen yardımcı olayım.",
      sticker: "🙂 Size nasıl yardımcı olabilirim? Ürünlerimiz, siparişiniz ya da değişim konularında yazabilirsiniz.",
      location: "Konumunuzu aldım, teşekkürler! Nasıl yardımcı olabilirim — sipariş mi vermek istiyorsunuz?",
    };
    await waText(from,
      nudge[type] ?? "Şu an yalnızca yazılı mesajları anlayabiliyorum. Lütfen sorunuzu metin olarak yazar mısınız? 🙏", log);
    return;
  }
  const text = String(msg?.text?.body ?? "").trim().slice(0, 2000);
  if (!text) return;
  log.info("message_in", { type: "text", len: text.length });

  const ip = synthIp(from);
  let session = await getSession(from);
  if (!session) session = await newSession(from, profileName, ip, log);
  if (!session) {
    await waText(from, "Şu an bir yoğunluk yaşıyoruz, lütfen birkaç dakika sonra tekrar yazın. 🙏", log);
    return;
  }

  // Cevabı DB'den ayıklayabilmek için gönderim ÖNCESİ son mesaj zamanı
  const { data: lastRow } = await admin.from("chat_messages")
    .select("created_at").eq("conversation_id", session.conversation_id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const baseline = lastRow?.created_at ?? "1970-01-01T00:00:00Z";

  let r = await chatCall("send", {
    conversation_id: session.conversation_id,
    visitor_token: session.visitor_token,
    text,
  }, ip);

  // Oturum düşmüş (KVKK temizliği vb.) ya da konuşma mesaj tavanına ulaşmış
  // → yeni konuşma açıp AYNI mesajı bir kez daha dene.
  if (r?.error === "unauthorized" || r?.error === "conv_limit") {
    log.info("session_recycle", { reason: r.error });
    session = await newSession(from, profileName, ip, log);
    if (session) {
      r = await chatCall("send", {
        conversation_id: session.conversation_id,
        visitor_token: session.visitor_token,
        text,
      }, ip);
    }
  }

  if (r?.error === "rate") {
    await waText(from, r?.message || "Çok hızlı yazıyorsunuz, lütfen birkaç saniye bekleyin. 🙏", log);
    return;
  }
  if (!r?.ok) {
    log.error("chat_send_failed", { status: r?.status, error: r?.error });
    await waText(from, "Şu an yanıt veremiyorum, lütfen birazdan tekrar deneyin. 🙏", log);
    return;
  }

  // Kart payload'u: ürün kartı görsel olarak, özetler metin olarak gider.
  // Sıra widget'takiyle aynı: önce kart, sonra modelin kısa cümlesi.
  const order = r?.order;
  if (order?.mode === "product") await sendProductCard(from, order, log);
  else if (order?.mode === "summary") await waText(from, renderSummary(order), log);
  else if (order?.mode === "exchange_summary") await waText(from, renderExchange(order), log);
  else if (order?.mode === "card") {
    // PayTR ekranı WhatsApp'ta açılamaz — siteye yönlendir (model metni ne
    // derse desin müşteri doğru yolu görsün).
    await waText(from,
      `Kredi kartıyla ödemeyi güvenli ödeme sayfamız üzerinden tamamlayabilirsiniz: ${SITE}/sepet.html\n` +
      "Dilerseniz kapıda ödeme veya havale ile buradan da siparişinizi tamamlayabilirim.", log);
  }

  // Modelin metin cevabı (ve deterministik akışların yazdığı ai/system
  // satırları) chat_messages'a yazıldı → baseline sonrasını oku, gönder.
  const { data: newMsgs } = await admin.from("chat_messages")
    .select("role,content,created_at")
    .eq("conversation_id", session.conversation_id)
    .gt("created_at", baseline)
    .order("created_at", { ascending: true });
  const replies = (newMsgs ?? []).filter((m: any) => m.role === "ai" || m.role === "system");
  if (replies.length) {
    await waText(from, replies.map((m: any) => m.content).join("\n\n"), log);
  } else if (!order) {
    // ne kart ne metin — chat bir şey üretmedi (beklenmez ama sessiz kalma)
    log.warn("no_reply_produced", {});
    await waText(from, "Bunu tam anlayamadım, biraz daha açar mısınız? 🙏", log);
  }
}

async function processEvents(body: any, log: Logger): Promise<void> {
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const value = change?.value ?? {};
      const profileName = String(value?.contacts?.[0]?.profile?.name ?? "");
      for (const msg of value?.messages ?? []) {
        const id = String(msg?.id ?? "");
        if (id) {
          if (seenIds.has(id)) { log.info("dedup_skip", {}); continue; }
          seenIds.add(id);
          if (seenIds.size > 500) seenIds.delete(seenIds.values().next().value!);
        }
        try {
          await processMessage(msg, profileName, log);
        } catch (e) {
          log.error("process_error", { detail: e instanceof Error ? e.message : String(e).slice(0, 300) });
        }
      }
    }
  }
}

// ---------- HTTP giriş ----------

Deno.serve(async (req) => {
  const log = createLogger("wa-webhook", req);
  const url = new URL(req.url);

  // GET: Meta webhook doğrulaması
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const expected = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
    if (mode === "subscribe" && expected && timingSafeEqualStr(token, expected)) {
      log.info("webhook_verified", {});
      return new Response(challenge, { status: 200 });
    }
    log.warn("webhook_verify_failed", { mode });
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const raw = await req.text();

  // HMAC imza doğrulaması (ham gövde üzerinde)
  const appSecret = Deno.env.get("WA_APP_SECRET") ?? "";
  if (appSecret) {
    const header = req.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + await hmacSha256Hex(appSecret, raw);
    if (!timingSafeEqualStr(header, expected)) {
      log.warn("bad_signature", {});
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    log.warn("signature_check_skipped_no_secret", {});
  }

  let body: any;
  try { body = JSON.parse(raw); } catch {
    log.warn("bad_json", {});
    return new Response("ok", { status: 200 });
  }

  // Meta'ya HEMEN 200 dön; Gemini turunu arka planda işle (retry fırtınasını önler)
  const task = processEvents(body, log);
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(task);
  else await task; // waitUntil yoksa (lokal test) bekle
  return new Response("ok", { status: 200 });
});
