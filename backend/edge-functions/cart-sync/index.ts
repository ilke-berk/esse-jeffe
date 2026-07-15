// ============================================================
//  Esse Jeffe — Sepet senkronizasyonu (Edge Function)
//  Akış: ej-supabase.js (debounce'lu) → bu fonksiyon → abandoned_carts
//
//  Üç işlem (body.action):
//   sync    — sepeti kimliğe (üye user_id / misafir e-posta) upsert et.
//             Misafirde KVKK/ETK onayı (consent=true) ZORUNLU; onaysız
//             e-posta saklanmaz. Hatırlatma döngüsü taze sepette sıfırlanır.
//   restore — maildeki token ile sepeti geri getir. Fiyat/isim DB'den
//             YENİDEN okunur (bayat/oynanmış client fiyatına güvenilmez).
//   coupon  — indirim kodunun ön kontrolü (yalnız görüntü; mutasyon yok.
//             Asıl atomik claim create-order/paytr-token içindedir).
//
//  GÜVENLİK:
//   - abandoned_carts'a client RLS erişimi yok; yalnız bu fonksiyon yazar.
//   - items sunucuda sıkı sanitize edilir (satır/uzunluk/tip sınırları);
//     price alanı SAKLANIR ama para hesabında ASLA kullanılmaz.
//   - IP hız sınırı: fn_rate_limit kind='cart_sync' / 'coupon'.
//
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından gelir.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/log.ts";
import { checkRateLimit, recordRateLimit } from "../_shared/rate-limit.ts";
import { clientIp } from "../_shared/util.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { normCode } from "../_shared/discount.ts";

const SYNC_RATE = { table: "fn_rate_limit", kind: "cart_sync", max: 30, windowMin: 60 };
const COUPON_RATE = { table: "fn_rate_limit", kind: "coupon", max: 10, windowMin: 60 };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 40;
const MAX_BODY = 25_000; // bayt — jsonb şişirme savunması

// Client'tan gelen sepet satırını güvenli alanlara indir; bozuksa null.
// price görüntü amaçlı saklanır (mailde bile gösterilmez) — para DEĞİLDİR.
function sanitizeItem(it: any): Record<string, unknown> | null {
  if (!it || typeof it !== "object") return null;
  const id = String(it.id || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return null;
  const qty = Math.min(20, Math.max(1, parseInt(it.qty, 10) || 1));
  const s = (v: unknown, max: number) => String(v ?? "").slice(0, max).trim();
  const img = s(it.img, 500);
  const hex = s(it.color_hex, 9);
  return {
    id,
    qty,
    name: s(it.name, 120),
    desc: s(it.desc, 200),
    color: s(it.color, 40),
    size: s(it.size, 10),
    price: Math.max(0, parseInt(it.price, 10) || 0),
    img: /^https:\/\//.test(img) ? img : "",
    color_hex: /^#[0-9a-fA-F]{3,8}$/.test(hex) ? hex : "",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const log = createLogger("cart-sync", req);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "İstek çok büyük." }, 413);
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }
  const action = String(payload?.action || "sync");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const ip = clientIp(req);

  const limited = async (rate: typeof SYNC_RATE) => {
    const rl = await checkRateLimit(admin, { ...rate, ip });
    if (rl.error) {
      log.error("rate_limit_db_error", { ip, detail: rl.error });
      return json({ error: "Sunucu hatası." }, 500);
    }
    if (!rl.allowed) {
      log.warn("rate_limited", { ip, kind: rate.kind, count: rl.count });
      return json({ error: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
    }
    return null;
  };

  // ---------- coupon: ön kontrol (yalnız görüntü) ----------
  // Kurallar TS'te değerlendirilir (kampanyada expires_at/max_uses null
  // olabilir); asıl atomik claim create-order/paytr-token içindedir.
  if (action === "coupon") {
    const lim = await limited(COUPON_RATE);
    if (lim) return lim;
    const code = normCode(payload?.code);
    if (!code) return json({ valid: false, error: "Kod boş." });
    const email = String(payload?.email || "").trim().toLowerCase();
    const subtotal = Math.max(0, parseInt(payload?.subtotal, 10) || 0); // yalnız görüntü — para DEĞİL
    const { data, error } = await admin
      .from("discount_codes")
      .select("id, kind, percent, email, free_shipping, active, min_subtotal, max_uses, used_count, expires_at, used_at")
      .eq("code", code)
      .maybeSingle();
    await recordRateLimit(admin, COUPON_RATE.table, ip, COUPON_RATE.kind);
    if (error) {
      log.error("coupon_read_error", { ip, detail: error.message });
      return json({ error: "Sunucu hatası." }, 500);
    }
    if (!data) return json({ valid: false, error: "Kod geçersiz, kullanılmış veya süresi dolmuş." });
    const expired = data.expires_at && new Date(data.expires_at) <= new Date();

    if (data.kind === "campaign") {
      if (!data.active) return json({ valid: false, error: "Bu kampanya sona erdi." });
      if (expired) return json({ valid: false, error: "Bu kodun süresi doldu." });
      if (data.max_uses != null && data.used_count >= data.max_uses) {
        return json({ valid: false, error: "Bu kodun kullanım limiti doldu." });
      }
      const minSub = Number(data.min_subtotal) || 0;
      if (subtotal < minSub) {
        return json({ valid: false, error: `Bu kod en az ${minSub} TL sepet tutarında geçerlidir.` });
      }
      if (email) {
        const { data: red } = await admin
          .from("coupon_redemptions")
          .select("id")
          .eq("coupon_id", data.id)
          .eq("email", email)
          .maybeSingle();
        if (red) return json({ valid: false, error: "Bu kodu daha önce kullandınız." });
      }
      return json({
        valid: true,
        percent: data.percent,
        free_shipping: !!data.free_shipping,
        min_subtotal: minSub,
      });
    }

    // tek kullanımlık SEPET-… kodu
    if (!data.active || data.used_at || expired || !data.expires_at) {
      return json({ valid: false, error: "Kod geçersiz, kullanılmış veya süresi dolmuş." });
    }
    const bound = String(data.email || "").trim().toLowerCase();
    if (bound && bound !== email) {
      return json({
        valid: false,
        error: "Bu kod başka bir e-postaya tanımlı. Kodun geldiği e-posta adresini girin.",
      });
    }
    return json({ valid: true, percent: data.percent, free_shipping: false, min_subtotal: 0 });
  }

  // ---------- restore: maildeki linkle sepeti geri getir ----------
  if (action === "restore") {
    const token = String(payload?.token || "").trim();
    if (!UUID_RE.test(token)) return json({ error: "Geçersiz bağlantı." }, 400);
    const { data: cart, error } = await admin
      .from("abandoned_carts")
      .select("id, items, clicked_at")
      .eq("restore_token", token)
      .maybeSingle();
    if (error) {
      log.error("restore_read_error", { ip, detail: error.message });
      return json({ error: "Sunucu hatası." }, 500);
    }
    if (!cart) return json({ error: "Bağlantı bulunamadı veya süresi doldu." }, 404);
    if (!cart.clicked_at) {
      await admin.from("abandoned_carts")
        .update({ clicked_at: new Date().toISOString() })
        .eq("id", cart.id);
    }

    // Fiyat/isim DB'den taze okunur; pasifleşen ürün sepetten düşer.
    const items: any[] = Array.isArray(cart.items) ? cart.items : [];
    const slugs = [...new Set(items.map((it) => String(it?.id || "")))].filter(Boolean);
    let fresh: any[] = [];
    if (slugs.length) {
      const { data: products, error: pErr } = await admin
        .from("products")
        .select("slug, name, model_desc, price")
        .in("slug", slugs)
        .eq("active", true);
      if (pErr) {
        log.error("restore_products_error", { ip, detail: pErr.message });
        return json({ error: "Ürünler okunamadı." }, 500);
      }
      const bySlug = new Map((products || []).map((p: any) => [p.slug, p]));
      fresh = items
        .filter((it) => bySlug.has(String(it?.id)))
        .map((it) => {
          const p: any = bySlug.get(String(it.id));
          return {
            id: p.slug,
            name: p.name,
            desc: p.model_desc || "",
            price: p.price,
            color: String(it.color || ""),
            color_hex: String(it.color_hex || ""),
            size: String(it.size || ""),
            img: String(it.img || ""),
            qty: Math.min(20, Math.max(1, parseInt(it.qty, 10) || 1)),
          };
        });
    }
    log.info("cart_restored", { ip, item_count: fresh.length });
    return json({ items: fresh });
  }

  // ---------- sync: sepeti kimliğe upsert et ----------
  if (action !== "sync") return json({ error: "Geçersiz işlem." }, 400);
  const lim = await limited(SYNC_RATE);
  if (lim) return lim;

  // Kimlik: girişli üye (JWT) > misafir e-postası (onaylı).
  let userId: string | null = null;
  let email = "";
  const authz = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (authz) {
    const { data } = await admin.auth.getUser(authz);
    if (data?.user) {
      userId = data.user.id;
      email = String(data.user.email || "").trim().toLowerCase();
    }
  }
  const consent = payload?.consent === true;
  if (!userId) {
    email = String(payload?.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: "Geçerli bir e-posta gerekli." }, 400);
    // KVKK: misafirin e-postası ancak açık rıza ile saklanır.
    if (!consent) return json({ error: "Hatırlatma için onay gerekli." }, 400);
  }

  const rawItems: any[] = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems.slice(0, MAX_ITEMS).map(sanitizeItem).filter(Boolean);

  // Kimlik başına tek satır: üye user_id ile, misafir email ile bulunur.
  let q = admin.from("abandoned_carts").select("id, consent").limit(1);
  q = userId ? q.eq("user_id", userId) : q.eq("email", email).is("user_id", null);
  const { data: existing, error: exErr } = await q.maybeSingle();
  if (exErr) {
    log.error("cart_read_error", { ip, detail: exErr.message });
    return json({ error: "Sunucu hatası." }, 500);
  }

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    user_id: userId,
    email: email || null,
    items,
    consent,
    updated_at: now,
  };
  if (consent && !(existing && existing.consent)) row.consent_at = now;
  if (items.length) {
    // Taze sepet → taze hatırlatma döngüsü (önceki gönderim/kurtarma sıfırlanır).
    row.reminded_at = null;
    row.recovered_at = null;
    row.clicked_at = null;
  }

  const res = existing
    ? await admin.from("abandoned_carts").update(row).eq("id", existing.id)
    : await admin.from("abandoned_carts").insert(row);
  if (res.error) {
    log.error("cart_upsert_error", { ip, detail: res.error.message });
    return json({ error: "Kaydedilemedi." }, 500);
  }

  // Açık rıza yenilendi → eski opt-out kaydını kaldır.
  if (consent && email) {
    await admin.from("reminder_optout").delete().eq("email", email);
  }

  await recordRateLimit(admin, SYNC_RATE.table, ip, SYNC_RATE.kind);
  log.info("cart_synced", { ip, member: !!userId, item_count: items.length });
  return json({ ok: true });
});
