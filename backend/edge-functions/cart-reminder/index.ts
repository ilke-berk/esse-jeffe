// ============================================================
//  Esse Jeffe — Terk edilmiş sepet hatırlatıcısı (Edge Function)
//
//  İki giriş:
//   POST (pg_cron, her 15 dk) — 3 saattir dokunulmamış, onaylı,
//     hatırlatılmamış ve siparişe dönmemiş sepetlere indirim kodlu
//     e-posta gönderir. Kimlik doğrulama: x-cron-secret başlığı ==
//     CART_CRON_SECRET secret'ı (pg_cron JWT gönderemez).
//   GET ?unsub=<restore_token> — maildeki "hatırlatmaları kapat" linki.
//     Onayı kapatır, sepeti boşaltır, reminder_optout'a yazar.
//
//  Deploy: verify_jwt KAPALI (paytr-callback gibi) — cron ve tarayıcı
//  linki JWT taşıyamaz; güvenlik secret/token iledir.
//
//  KANAL SOYUTLAMASI: senders map'i. Bugün yalnız e-posta; WhatsApp/SMS
//  eklemek = yeni bir Sender yazıp map'e koymak + abandoned_carts.channel.
//
//  ÇİFT GÖNDERİM KORUMASI: reminded_at ATOMİK claim edilir
//  (update ... where reminded_at is null returning). Çakışan iki cron
//  koşusundan yalnız biri gönderir. Gönderim hatasında claim geri alınır
//  → sonraki koşu yeniden dener.
//
//  Secret'lar: CART_CRON_SECRET (zorunlu), CART_DISCOUNT_PERCENT (ops.,
//  varsayılan 10), RESEND_API_KEY, ORDER_FROM_EMAIL, SITE_URL.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger, errMsg, type Logger } from "../_shared/log.ts";
import { makeDiscountCode } from "../_shared/discount.ts";
import { sendCartReminder } from "../_shared/cart-email.ts";

const ABANDON_HOURS = 3; // son güncellemeden sonra bekleme
const MAX_AGE_DAYS = 7; // bundan eski sepetlere (ilk kurulum/duraklama) mail atma
const CODE_VALID_HOURS = 72; // indirim kodu geçerliliği
const BATCH = 25; // koşu başına en çok gönderim
const PURGE_DAYS = 60; // KVKK veri minimizasyonu: eski satırları sil

interface CartRow {
  id: string;
  user_id: string | null;
  email: string;
  channel: string;
  items: any[];
  restore_token: string;
  updated_at: string;
}

type Sender = (cart: CartRow, code: string, percent: number) => Promise<void>;

function unsubUrl(token: string): string {
  const base = Deno.env.get("SUPABASE_URL") || "";
  return `${base}/functions/v1/cart-reminder?unsub=${encodeURIComponent(token)}`;
}

const sendEmailReminder: Sender = async (cart, code, percent) => {
  const r = await sendCartReminder({
    email: cart.email,
    items: (cart.items || []).map((it: any) => ({
      name: String(it?.name || it?.id || "Ürün"),
      desc: String(it?.desc || ""),
      color: String(it?.color || ""),
      size: String(it?.size || ""),
      qty: Math.max(1, parseInt(it?.qty, 10) || 1),
    })),
    code,
    percent,
    codeValidHours: CODE_VALID_HOURS,
    restoreToken: cart.restore_token,
    unsubUrl: unsubUrl(cart.restore_token),
  });
  if (!r.sent) throw new Error("email atlandı: " + (r.skipped || "bilinmiyor"));
};

// İleride: senders.whatsapp / senders.sms eklenir; sepet channel'ına göre seçilir.
const senders: Record<string, Sender> = { email: sendEmailReminder };

// Markalı minicik HTML sayfa (unsub onayı — tarayıcıda açılır).
function unsubPage(msg: string): Response {
  return new Response(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1"><title>Esse Jeffe</title></head>
     <body style="margin:0;background:#f6f4f1;font-family:'Segoe UI',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
       <div style="background:#fff;border-radius:8px;padding:40px 48px;text-align:center;max-width:420px;">
         <div style="font-size:20px;letter-spacing:3px;font-weight:600;color:#1a1a1a;">ESSE JEFFE</div>
         <div style="font-size:11px;letter-spacing:2px;color:#b08d57;margin:2px 0 24px;">ABİYE &amp; DAVET</div>
         <p style="font-size:15px;color:#555;line-height:1.7;margin:0;">${msg}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function handleUnsub(admin: any, token: string, log: Logger): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return unsubPage("Geçersiz bağlantı.");
  const { data: cart } = await admin
    .from("abandoned_carts")
    .select("id, email")
    .eq("restore_token", token)
    .maybeSingle();
  if (!cart) return unsubPage("Bağlantı bulunamadı veya süresi dolmuş.");
  if (cart.email) {
    await admin.from("reminder_optout").upsert({ email: cart.email }, { onConflict: "email" });
  }
  await admin
    .from("abandoned_carts")
    .update({ consent: false, items: [] })
    .eq("id", cart.id);
  log.info("reminder_optout", { cart_id: cart.id });
  return unsubPage(
    "Sepet hatırlatmaları kapatıldı. Fikriniz değişirse sepet sayfasındaki onay kutusunu yeniden işaretleyebilirsiniz.",
  );
}

Deno.serve(async (req) => {
  const log = createLogger("cart-reminder", req);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---------- GET ?unsub=... : hatırlatmalardan çık ----------
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("unsub") || "";
    if (!token) return new Response("Not found", { status: 404 });
    return handleUnsub(admin, token, log);
  }
  if (req.method !== "POST") return new Response("POST bekleniyor", { status: 405 });

  // ---------- POST: cron taraması ----------
  const secret = Deno.env.get("CART_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    log.warn("bad_cron_secret");
    return new Response(JSON.stringify({ error: "yetkisiz" }), { status: 401 });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const nowMs = Date.now();
  const cutoff = new Date(nowMs - ABANDON_HOURS * 3600_000).toISOString();
  const floor = new Date(nowMs - MAX_AGE_DAYS * 86400_000).toISOString();

  // Temizlik (KVKK veri minimizasyonu + tablo şişmesi): ucuz, her koşuda.
  await admin.from("abandoned_carts").delete()
    .lt("updated_at", new Date(nowMs - PURGE_DAYS * 86400_000).toISOString());
  // Yalnız otomatik (single) kodlar temizlenir — kampanya kuponlarında
  // used_at hep null'dır; onları silmek redemption geçmişini de kaybettirirdi.
  await admin.from("discount_codes").delete()
    .eq("kind", "single")
    .is("used_at", null)
    .lt("expires_at", new Date(nowMs - 30 * 86400_000).toISOString());

  // Uygun sepetler: onaylı, e-postalı, gönderilmemiş, kurtarılmamış, dolu,
  // 3 saat – 7 gün penceresinde.
  const { data: due, error: dErr } = await admin
    .from("abandoned_carts")
    .select("id, user_id, email, channel, items, restore_token, updated_at")
    .eq("consent", true)
    .not("email", "is", null)
    .is("reminded_at", null)
    .is("recovered_at", null)
    .lt("updated_at", cutoff)
    .gt("updated_at", floor)
    .order("updated_at", { ascending: true })
    .limit(BATCH);
  if (dErr) {
    log.error("due_read_error", { detail: dErr.message });
    return json({ error: "tarama başarısız" }, 500);
  }

  const percent = Math.min(90, Math.max(1, parseInt(Deno.env.get("CART_DISCOUNT_PERCENT") || "10", 10) || 10));
  let sent = 0, skipped = 0;
  // Operasyonel hata özetleri (PII yok) — yanıt yalnız secret'la alınabildiği
  // için güvenli; Dashboard log ekranına bakmadan teşhis sağlar.
  const errors: string[] = [];

  for (const cart of (due || []) as CartRow[]) {
    const items = Array.isArray(cart.items) ? cart.items : [];
    if (!items.length || !cart.email) {
      skipped++;
      continue;
    }

    // Sepet güncellemesinden SONRA sipariş verilmiş mi? (bastırma)
    // user_id ve email AYRI sorgularda kontrol edilir; .or() içine değer
    // gömmek PostgREST filtre sözdizimini bozabilirdi (virgüllü e-posta).
    let orderCount = 0;
    let checkFailed = false;
    for (const filt of [
      cart.user_id ? { col: "user_id", val: cart.user_id } : null,
      { col: "email", val: cart.email },
    ]) {
      if (!filt || orderCount > 0) continue;
      // orders.email girildiği gibi saklanır (case karışık olabilir) →
      // ilike ile harf duyarsız eşle; like joker karakterleri kaçışlanır.
      let q = admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .gt("created_at", cart.updated_at)
        .neq("payment_status", "failed");
      q = filt.col === "email"
        ? q.ilike("email", String(filt.val).replace(/([%_\\])/g, "\\$1"))
        : q.eq(filt.col, filt.val);
      const { count, error: oErr } = await q;
      if (oErr) {
        log.error("order_check_error", { cart_id: cart.id, detail: oErr.message });
        checkFailed = true;
        break;
      }
      orderCount = count || 0;
    }
    if (checkFailed) {
      skipped++;
      continue;
    }
    if (orderCount > 0) {
      await admin.from("abandoned_carts")
        .update({ recovered_at: new Date().toISOString() })
        .eq("id", cart.id);
      skipped++;
      continue;
    }

    // Opt-out kontrolü.
    const { data: opt } = await admin
      .from("reminder_optout")
      .select("email")
      .eq("email", cart.email)
      .maybeSingle();
    if (opt) {
      skipped++;
      continue;
    }

    // ATOMİK claim: çakışan cron koşusunda çift gönderimi engeller.
    const { data: claimed } = await admin
      .from("abandoned_carts")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", cart.id)
      .is("reminded_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) {
      skipped++;
      continue;
    }

    // Kod üret (unique çakışmasında bir kez yeniden dene).
    let code = makeDiscountCode();
    let codeId: string | null = null;
    for (let attempt = 0; attempt < 2 && !codeId; attempt++) {
      const { data: codeRow, error: cErr } = await admin
        .from("discount_codes")
        .insert({
          code,
          percent,
          email: cart.email,
          abandoned_cart_id: cart.id,
          expires_at: new Date(nowMs + CODE_VALID_HOURS * 3600_000).toISOString(),
        })
        .select("id")
        .maybeSingle();
      if (codeRow) codeId = codeRow.id;
      else if (cErr && (cErr as any).code === "23505") code = makeDiscountCode();
      else {
        log.error("code_insert_error", { cart_id: cart.id, detail: cErr?.message });
        errors.push("code_insert: " + (cErr?.message || "bilinmiyor"));
        break;
      }
    }
    if (!codeId) {
      // kod üretilemedi → claim'i geri al, sonraki koşu dener
      await admin.from("abandoned_carts").update({ reminded_at: null }).eq("id", cart.id);
      skipped++;
      continue;
    }

    // Gönder (kanal soyutlaması). Hata → claim + kod geri alınır.
    const send = senders[cart.channel] ?? senders.email;
    try {
      await send(cart, code, percent);
      sent++;
      log.info("reminder_sent", { cart_id: cart.id, channel: cart.channel || "email" });
    } catch (e) {
      log.error("reminder_send_failed", { cart_id: cart.id, detail: errMsg(e) });
      errors.push("send: " + errMsg(e));
      await admin.from("abandoned_carts").update({ reminded_at: null }).eq("id", cart.id);
      await admin.from("discount_codes").delete().eq("id", codeId);
      skipped++;
    }
  }

  log.info("reminder_run_done", { due: (due || []).length, sent, skipped });
  return json({ ok: true, due: (due || []).length, sent, skipped, errors });
});
