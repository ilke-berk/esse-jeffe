// ============================================================
// Esse Jeffe — Chat Edge Function
// Ziyaretçi chat'i: AI yanıtı (Claude) + canlı destek köprüsü.
// Ziyaretçiler tabloya DOĞRUDAN erişmez; bu fonksiyon service_role
// ile yazar/okur ve tahmin edilemez `visitor_token` ile yetkilendirir.
//
// Gerekli secrets (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   → Anthropic API anahtarınız
//   (SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY otomatik gelir)
//
// AI modeli: claude-opus-4-8 (en yetenekli Opus). Yoğun/maliyet
// hassas bir destek hattı için CLAUDE_MODEL'i 'claude-haiku-4-5'
// yaparak ~5x ucuza düşürebilirsiniz (kaliteyi siz seçin).
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLAUDE_MODEL = "claude-opus-4-8";
const WHATSAPP = "0850 255 12 37";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ---- ürün kataloğu (cold-start cache, 10 dk) ----
let catalogText = "";
let catalogAt = 0;
async function catalog(): Promise<string> {
  const now = Date.now();
  if (catalogText && now - catalogAt < 600_000) return catalogText;
  const { data } = await admin
    .from("products")
    .select("name,price,old_price,category,model_desc,sizes,product_colors(name)")
    .eq("active", true)
    .order("sort");
  const lines = (data || []).map((p: any) => {
    const colors = (p.product_colors || []).map((c: any) => c.name).join(", ");
    const price = `${(p.price || 0).toLocaleString("tr-TR")} TL`;
    return `- ${p.name}${p.model_desc ? " (" + p.model_desc + ")" : ""} — ${p.category || "abiye"}, ${price}` +
      `, bedenler: ${(p.sizes || []).join("/")}` + (colors ? `, renkler: ${colors}` : "");
  });
  catalogText = lines.join("\n") || "(katalog şu an yüklenemedi)";
  catalogAt = now;
  return catalogText;
}

function systemPrompt(cat: string): string {
  return `Sen "Esse Jeffe" markasının web sitesindeki yapay zekâ asistanısın. Esse Jeffe; abiye, davet ve gece elbiseleri satan butik bir Türk e-ticaret markasıdır. Zarif, sıcak ve yardımsever bir moda danışmanı gibi konuş. Yanıtların KISA ve net olsun (genelde 1-3 cümle). Her zaman Türkçe yanıt ver.

GÖREVİN: Ürünler, bedenler, renkler, kumaş/stil önerileri, kargo ve iade gibi genel sorularda yardımcı olmak. Müşteriye uygun elbise önerirken aşağıdaki güncel kataloğu kullan.

GÜNCEL ÜRÜN KATALOĞU:
${cat}

GENEL BİLGİLER:
- Bedenler XS'ten 3XL'e kadar mevcuttur. Beden seçiminde emin değilsen "Beden Rehberi" sayfasını öner.
- Ödeme: kapıda ödeme, havale/EFT ve online kart ile yapılabilir.
- İade/değişim talepleri için "İade & İptal" sayfası kullanılır.

SINIRLARIN:
- Belirli bir siparişin durumu, kargo takibi, ödeme sorunları, iade onayı gibi KİŞİYE/SİPARİŞE özel konuları sen çözemezsin. Fiyatları veya stok bilgisini katalog dışında uydurma.
- Böyle durumlarda ya da müşteri bir insanla görüşmek istediğinde, kibarca "Temsilciye Bağlan" butonunu kullanmasını öner (alt köşede) veya WhatsApp ${WHATSAPP} hattını ver.
- Bilmediğin bir şeyi uydurma; emin değilsen temsilciye yönlendir.`;
}

// chat geçmişini Claude mesaj formatına çevir
function toClaudeMessages(rows: any[]) {
  const msgs: { role: string; content: string }[] = [];
  for (const r of rows) {
    if (r.role === "system") continue;
    const role = r.role === "user" ? "user" : "assistant";
    msgs.push({ role, content: r.content });
  }
  // Claude ilk mesajın "user" olmasını ister → baştaki assistant'ları at
  while (msgs.length && msgs[0].role === "assistant") msgs.shift();
  return msgs;
}

async function askClaude(history: any[]): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    return `Yapay zekâ asistanı şu an yapılandırılmamış. Lütfen "Temsilciye Bağlan" butonuna basın veya WhatsApp ${WHATSAPP} hattından yazın.`;
  }
  const messages = toClaudeMessages(history);
  if (!messages.length) return "Merhaba! Size nasıl yardımcı olabilirim?";
  const sys = systemPrompt(await catalog());
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: sys,
      messages,
    }),
  });
  if (!res.ok) {
    console.error("[chat] Anthropic hata", res.status, await res.text());
    return `Şu an yanıt veremiyorum. Lütfen "Temsilciye Bağlan" butonunu kullanın.`;
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  return text || "Bunu tam anlayamadım, biraz daha açabilir misiniz?";
}

// visitor_token ile konuşmayı doğrula
async function verify(conversationId: string, token: string) {
  if (!conversationId || !token) return null;
  const { data } = await admin
    .from("chat_conversations")
    .select("id,status,visitor_name,visitor_email")
    .eq("id", conversationId)
    .eq("visitor_token", token)
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const action = body.action;

  try {
    // ---- yeni konuşma başlat ----
    if (action === "start") {
      const ins = {
        status: "ai",
        visitor_name: (body.name || "").slice(0, 120) || null,
        visitor_email: (body.email || "").slice(0, 160) || null,
        user_id: body.user_id || null,
        page: (body.page || "").slice(0, 200) || null,
      };
      const { data: conv, error } = await admin
        .from("chat_conversations").insert(ins).select("id,visitor_token").single();
      if (error) throw error;
      const greeting = "Merhaba, ben Esse Jeffe asistanı 👗 Abiye seçimi, beden, renk veya kargo gibi her konuda yardımcı olabilirim. Size nasıl yardımcı olabilirim?";
      await admin.from("chat_messages").insert({
        conversation_id: conv.id, role: "ai", content: greeting,
      });
      return json({ conversation_id: conv.id, visitor_token: conv.visitor_token });
    }

    // ---- mesaj gönder ----
    if (action === "send") {
      const conv = await verify(body.conversation_id, body.visitor_token);
      if (!conv) return json({ error: "unauthorized" }, 403);
      const text = String(body.text || "").trim().slice(0, 2000);
      if (!text) return json({ error: "empty" }, 400);

      await admin.from("chat_messages").insert({
        conversation_id: conv.id, role: "user", content: text,
      });
      await admin.from("chat_conversations")
        .update({ last_message_at: new Date().toISOString(), unread_admin: true })
        .eq("id", conv.id);

      // AI modundaysa hemen yanıt üret; canlı destekteyse operatör yanıtlar
      if (conv.status === "ai") {
        const { data: hist } = await admin
          .from("chat_messages").select("role,content")
          .eq("conversation_id", conv.id).order("created_at").limit(30);
        const reply = await askClaude(hist || []);
        await admin.from("chat_messages").insert({
          conversation_id: conv.id, role: "ai", content: reply,
        });
        await admin.from("chat_conversations")
          .update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);
      }
      return json({ ok: true, status: conv.status });
    }

    // ---- temsilciye bağlan ----
    if (action === "request_agent") {
      const conv = await verify(body.conversation_id, body.visitor_token);
      if (!conv) return json({ error: "unauthorized" }, 403);
      await admin.from("chat_conversations")
        .update({ status: "waiting", unread_admin: true, last_message_at: new Date().toISOString() })
        .eq("id", conv.id);
      await admin.from("chat_messages").insert({
        conversation_id: conv.id, role: "system",
        content: "Bir müşteri temsilcisine bağlanmak istediniz. En kısa sürede size dönüş yapılacaktır. (Çalışma saatleri dışında yanıt gecikebilir.)",
      });
      return json({ ok: true, status: "waiting" });
    }

    // ---- yeni mesajları çek (polling) ----
    if (action === "poll") {
      const conv = await verify(body.conversation_id, body.visitor_token);
      if (!conv) return json({ error: "unauthorized" }, 403);
      let q = admin.from("chat_messages")
        .select("id,role,content,created_at")
        .eq("conversation_id", conv.id).order("created_at");
      if (body.after) q = q.gt("created_at", body.after);
      const { data: msgs } = await q;
      return json({ messages: msgs || [], status: conv.status });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[chat] hata", e);
    return json({ error: "server" }, 500);
  }
});
