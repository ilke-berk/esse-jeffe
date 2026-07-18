// ============================================================
//  Esse Jeffe — Google Merchant Center ürün feed'i (RSS 2.0 XML)
//  GET /merchant-feed  →  aktif ürünler, renk görselleri ve stok
//  durumuyla. Merchant Center'a "zamanlanmış getirme" URL'si olarak
//  verilir; ChatGPT alışveriş yüzeyleri de aynı feed formatını okur.
//
//  Kimlik doğrulama yok (Google botu çeker) — yalnız aktif ürünlerin
//  zaten sitede görünen verisi döner. 1 saat CDN cache'i ile ucuz.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = (Deno.env.get("SITE_URL") || "https://essejeffe.com").replace(/\/+$/, "");

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [prods, colors, stock] = await Promise.all([
    supa.from("products")
      .select("id, slug, name, model_desc, description, price, old_price, category")
      .eq("active", true).order("sort"),
    supa.from("product_colors").select("product_id, name, image_url, sort").order("sort"),
    supa.from("product_stock").select("product_id, stock, track"),
  ]);
  if (prods.error) return new Response("feed error", { status: 500 });

  const colorsByProduct = new Map<string, { name: string; image_url: string | null }[]>();
  for (const c of colors.data ?? []) {
    const arr = colorsByProduct.get(c.product_id) ?? [];
    arr.push(c);
    colorsByProduct.set(c.product_id, arr);
  }
  // stok satırı hiç yoksa veya takip edilmeyen/pozitif satır varsa: stokta
  const hasStock = (pid: string) => {
    const rows = (stock.data ?? []).filter((r) => r.product_id === pid);
    if (!rows.length) return true;
    return rows.some((r) => r.track === false || (r.stock ?? 0) > 0);
  };

  const items = (prods.data ?? []).map((p) => {
    const pc = colorsByProduct.get(p.id) ?? [];
    const imgs = pc.map((c) => c.image_url).filter(Boolean) as string[];
    const url = `${SITE}/urun.html?slug=${encodeURIComponent(p.slug)}`;
    const desc = p.description || `${p.name} — özgün tasarım abiye. Ücretsiz kargo, kapıda ödeme.`;
    // old_price varsa: liste fiyatı old_price, indirimli fiyat price
    const priceTag = p.old_price
      ? `<g:price>${p.old_price}.00 TRY</g:price><g:sale_price>${p.price}.00 TRY</g:sale_price>`
      : `<g:price>${p.price}.00 TRY</g:price>`;
    const extraImgs = imgs.slice(1, 11)
      .map((u) => `<g:additional_image_link>${esc(u)}</g:additional_image_link>`).join("");
    return `<item>
<g:id>${esc(p.slug)}</g:id>
<g:title>${esc(p.name + " — Abiye Elbise")}</g:title>
<g:description>${esc(desc)}</g:description>
<g:link>${esc(url)}</g:link>
<g:image_link>${esc(imgs[0] || SITE + "/img/og-cover.jpg")}</g:image_link>
${extraImgs}
${priceTag}
<g:availability>${hasStock(p.id) ? "in_stock" : "out_of_stock"}</g:availability>
<g:condition>new</g:condition>
<g:brand>Esse Jeffe</g:brand>
<g:google_product_category>2271</g:google_product_category>
<g:product_type>${esc(p.category || "Abiye")}</g:product_type>
<g:gender>female</g:gender>
<g:age_group>adult</g:age_group>
<g:identifier_exists>false</g:identifier_exists>
<g:shipping><g:country>TR</g:country><g:price>0.00 TRY</g:price></g:shipping>
</item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Esse Jeffe</title>
<link>${SITE}/</link>
<description>Esse Jeffe abiye ve davet elbiseleri ürün feed'i</description>
${items.join("\n")}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
