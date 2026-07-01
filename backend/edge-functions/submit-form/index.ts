// ============================================================
//  Esse Jeffe — Bülten & İletişim form gönderimi (Edge Function)
//  Akış: index.html (bülten) / iletisim.html (iletişim)
//        → bu fonksiyon → newsletter_subscribers | contact_messages
//
//  GÜVENLİK / ANTI-SPAM:
//   1) RLS: her iki tabloya doğrudan client insert'i KAPALIDIR
//      (schema.sql — açık "with check (true)" politikaları kaldırıldı).
//      Yazma yalnızca bu fonksiyonun service_role'ü ile olur.
//   2) Honeypot: gizli "website" alanı doluysa istek sessizce yok sayılır
//      (bot forma yazmış demektir; kullanıcıya başarı döneriz, kayıt açılmaz).
//   3) IP başına hız sınırı: form_rate_limit tablosunda pencere içi sayım.
//
//  SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafından gelir.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// IP başına, pencere (dakika) içinde izin verilen istek sayısı
const LIMITS: Record<string, { max: number; windowMin: number }> = {
  newsletter: { max: 3, windowMin: 60 },
  contact: { max: 5, windowMin: 60 },
};

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Geçersiz istek gövdesi" }, 400);
  }

  const kind = String(payload?.kind || "").trim();
  const limit = LIMITS[kind];
  if (!limit) return json({ error: "Geçersiz form türü." }, 400);

  // --- honeypot: gizli alan doluysa bot say, sessizce başarı dön ---
  if (String(payload?.hp || "").trim()) {
    return json({ ok: true });
  }

  // --- alan doğrulaması ---
  const trim = (v: unknown) => String(v ?? "").trim();
  let email = trim(payload?.email).toLowerCase();
  let row: Record<string, unknown>;
  let table: string;

  if (kind === "newsletter") {
    if (!email || email.indexOf("@") < 1) return json({ error: "Geçerli bir e-posta girin." }, 400);
    table = "newsletter_subscribers";
    row = { email };
  } else {
    const name = trim(payload?.name);
    const message = trim(payload?.message);
    if (!name || !email || email.indexOf("@") < 1) {
      return json({ error: "Ad ve geçerli e-posta zorunlu." }, 400);
    }
    if (!message) return json({ error: "Mesaj boş olamaz." }, 400);
    table = "contact_messages";
    row = {
      name,
      email,
      phone: trim(payload?.phone) || null,
      subject: trim(payload?.subject) || null,
      order_no: trim(payload?.order_no) || null,
      message: message.slice(0, 4000),
    };
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- IP başına hız sınırı ---
  const ip = clientIp(req);
  const cutoff = new Date(Date.now() - limit.windowMin * 60 * 1000).toISOString();

  // eski kayıtları temizle (tablo şişmesin) — pencere dışı + 24s öncesi
  await admin.from("form_rate_limit").delete().lt("created_at",
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const { count, error: cErr } = await admin
    .from("form_rate_limit")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("kind", kind)
    .gte("created_at", cutoff);
  if (cErr) return json({ error: "Sunucu hatası." }, 500);
  if ((count ?? 0) >= limit.max) {
    return json({ error: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
  }

  // --- asıl kaydı yaz ---
  const { error: insErr } = await admin.from(table).insert(row);
  if (insErr) {
    if ((insErr as any).code === "23505") {
      // bülten: e-posta zaten kayıtlı
      return json({ ok: true, already: true });
    }
    return json({ error: "Kaydedilemedi." }, 500);
  }

  // başarı → hız sınırı sayacına ekle
  await admin.from("form_rate_limit").insert({ ip, kind });

  return json({ ok: true });
});
