// ============================================================
// Esse Jeffe — Chat Edge Function  (AI motoru: Google Gemini)
// Ziyaretçi chat'i: AI yanıtı (Gemini) + canlı destek köprüsü
// + sohbet içinde SİPARİŞ OLUŞTURMA (Gemini function calling).
//
// Ziyaretçiler tabloya DOĞRUDAN erişmez; bu fonksiyon service_role
// ile yazar/okur ve tahmin edilemez `visitor_token` ile yetkilendirir.
//
// Sipariş akışı:
//   - AI sohbette ürün + ad/soyad + telefon + il/ilçe + adres + ödeme
//     yöntemini toplar, müşteri onayını alır ve `create_order` fonksiyonunu çağırır.
//   - KAPIDA ÖDEME (cod): sipariş burada (service_role) oluşturulur.
//   - KART (card): sipariş burada oluşturulmaz; fonksiyon doğrulanmış sepeti
//     ve teslimat bilgisini döner; widget mevcut `paytr-token`
//     fonksiyonunu çağırıp PayTR güvenli ödeme iframe'ini açar.
//   - Fiyat ASLA AI/clienttan alınmaz; her zaman DB'den (service_role) okunur.
//
// Gerekli secrets (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY   → Google AI Studio API anahtarınız (https://aistudio.google.com/apikey)
//   GEMINI_MODEL     → (opsiyonel) varsayılan "gemini-2.5-flash"
//   (SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY otomatik gelir)
//
// Model: gemini-2.5-flash (hızlı + uygun maliyetli, function-calling destekli).
// Daha güçlü yanıt için GEMINI_MODEL'i "gemini-2.5-pro" yapabilirsiniz.
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const WHATSAPP = "0850 255 12 37";

// ---- CORS: origin kilidi (maliyet istismarına karşı) ----
// İzinli origin'leri CHAT_ALLOWED_ORIGINS secret'ında virgülle verin
// (ör. "https://essejeffe.com,https://www.essejeffe.com"). Yerel geliştirme için
// localhost/127.0.0.1 otomatik kabul edilir. NOT: CORS yalnız TARAYICI kaynaklı
// çağrıları (başka siteye gömme) durdurur; curl/bot script'i Origin göndermez —
// asıl bot koruması aşağıdaki IP hız sınırıdır.
const ALLOWED_ORIGINS = (Deno.env.get("CHAT_ALLOWED_ORIGINS") ||
  "https://essejeffe.com,https://www.essejeffe.com")
  .split(",").map((s) => s.trim()).filter(Boolean);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  // İzinliyse origin'i yansıt; değilse ilk izinli origin'i koy (tarayıcı yine de bloklar).
  const allow = isAllowedOrigin(origin) ? origin! : (ALLOWED_ORIGINS[0] || "null");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200, cors: Record<string, string> = corsHeaders(null)) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ---- IP başına hız sınırı (bill amplification savunması) ----
// chat_rate_limit tablosunda pencere içi sayım (form_rate_limit ile aynı desen).
// Yalnız bu fonksiyon (service_role) yazar/okur; client erişimi yok (RLS).
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

// her aksiyon için pencereler: [max istek, pencere saniye]. Biri bile aşılırsa engelle.
// NOT: paylaşımlı IP (mobil CGNAT, ofis/kafe) mağdur olmasın diye IP sınırları GENİŞ
// ve kısa-pencereli (burst) tutuldu. Asıl "oturum başına" sınır CONV_SEND_MAX ile
// visitor_token'a bağlıdır → NAT'tan bağımsız, masum kullanıcıyı hiç etkilemez.
const RATE_LIMITS: Record<string, { max: number; sec: number }[]> = {
  start: [{ max: 5, sec: 600 }, { max: 40, sec: 86400 }],    // 10 dk'da 5, günde 40 yeni konuşma
  send: [{ max: 20, sec: 60 }],                              // dakikada 20 (yalnız burst guard)
};
// Tek bir konuşmada izin verilen kullanıcı mesajı (oturum sınırı; IP'den bağımsız).
// Gerçek destek sohbeti ~30'u geçmez; 50'de nazikçe WhatsApp/temsilciye yönlendiririz.
const CONV_SEND_MAX = 50;

async function rateLimited(ip: string, kind: "start" | "send"): Promise<boolean> {
  for (const w of RATE_LIMITS[kind]) {
    const cutoff = new Date(Date.now() - w.sec * 1000).toISOString();
    const { count } = await admin
      .from("chat_rate_limit")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip).eq("kind", kind).gte("created_at", cutoff);
    if ((count ?? 0) >= w.max) return true;
  }
  return false;
}
async function rateHit(ip: string, kind: "start" | "send"): Promise<void> {
  await admin.from("chat_rate_limit").insert({ ip, kind });
}

// ---- ürün kataloğu (cold-start cache, 10 dk) ----
// AI'a metin olarak verilir; sipariş fonksiyonunda ad → ürün eşleşmesi için de kullanılır.
type ColorImage = { name: string; url: string };
type Product = { id: string; slug: string; name: string; price: number; old_price: number | null; category: string | null; model_desc: string | null; sizes: string[] | null; colors: string[]; image: string | null; colorImages: ColorImage[] };
let catalogRows: Product[] = [];
let catalogText = "";
let catalogAt = 0;
async function loadCatalog(): Promise<void> {
  const now = Date.now();
  if (catalogText && now - catalogAt < 600_000) return;
  const { data } = await admin
    .from("products")
    .select("id,slug,name,price,old_price,category,model_desc,sizes,product_colors(name,sort,image_url),product_images(url,sort)")
    .eq("active", true)
    .order("sort");
  const bySort = (a: any, b: any) => (a.sort || 0) - (b.sort || 0);
  catalogRows = (data || []).map((p: any) => {
    const pcolors = (p.product_colors || []).slice().sort(bySort);
    const imgs = (p.product_images || []).slice().sort(bySort);
    let image: string | null = imgs.length ? imgs[0].url : null;
    if (!image) { const c = pcolors.find((x: any) => x.image_url); if (c) image = c.image_url; }
    return {
      id: p.id, slug: p.slug, name: p.name, price: p.price || 0, old_price: p.old_price,
      category: p.category, model_desc: p.model_desc, sizes: p.sizes || [],
      colors: pcolors.map((c: any) => c.name),
      image,
      colorImages: pcolors.filter((c: any) => c.image_url).map((c: any) => ({ name: c.name, url: c.image_url })),
    };
  });
  const lines = catalogRows.map((p) => {
    const colors = p.colors.join(", ");
    const price = `${p.price.toLocaleString("tr-TR")} TL`;
    return `- ${p.name}${p.model_desc ? " (" + p.model_desc + ")" : ""} — ${p.category || "abiye"}, ${price}` +
      `, bedenler: ${(p.sizes || []).join("/")}` + (colors ? `, renkler: ${colors}` : "");
  });
  catalogText = lines.join("\n") || "(katalog şu an yüklenemedi)";
  catalogAt = now;
}

function systemPrompt(cat: string): string {
  return `Sen "Esse Jeffe" markasının web sitesindeki müşteri danışmanısın. Esse Jeffe; abiye, davet ve gece elbiseleri satan butik bir Türk e-ticaret markasıdır.

KONUŞMA TARZIN (çok önemli):
- Gerçek bir insan müşteri danışmanı gibi konuş; robot/şablon gibi DEĞİL. Sıcak, samimi ama KURUMSAL ve profesyonel bir dil kullan — markanın güvenilir yüzüsün.
- Doğal aksın: müşteriyi "siz" diye, nazikçe karşıla. Gerçek bir sohbet gibi, akıcı ve insani cümleler kur. Ezbere/maddeler hâlinde değil, konuşur gibi yaz.
- Adını biliyorsan ara sıra ismiyle hitap et (ör. "Tabii Ayşe Hanım"). Empati göster ("çok güzel bir seçim", "merak etmeyin, hallederiz").
- Net ve öz ol ama SORUYU GERÇEKTEN ÇÖZ — gerektiğinde 2-4 cümle kullan. Gereksiz uzatma, lafı dolandırma.
- Emoji'yi çok ölçülü kullan (mesaj başına en fazla bir tane, çoğu mesajda hiç). Asla yapay/abartılı satış dili kullanma.
- Her zaman Türkçe yanıt ver.

GÖREVİN: Ürünler, bedenler, renkler, kumaş/stil önerileri, kargo, ödeme, değişim ve iade gibi konularda müşterinin sorununu BİZZAT ÇÖZMEK VE müşteri isterse sohbetin içinde sipariş oluşturmak. Aşağıdaki bilgi tabanı ve katalog senin elindeki gerçek kaynaklar — bunları kullanarak doğrudan cevap ver.

ÇOK ÖNEMLİ — YÖNLENDİRME DEĞİL, ÇÖZÜM: Müşteriyi "Beden Rehberi sayfasına / şu sayfaya bakın" diye GEÇİŞTİRME. Cevabı sen biliyorsun; bilgiyi doğrudan ver. Örneğin beden sorusunda kiloyu (gerekirse boyu) sor, aşağıdaki tablodan uygun bedeni KENDİN öner.

GÜNCEL ÜRÜN KATALOĞU:
${cat}

MARKA BİLGİ TABANI (bunları biliyorsun, doğrudan kullan):

• BEDEN TABLOSU (kilo → önerilen beden, referans 164 cm boy):
  - 50–55 kg → S
  - 56–61 kg → M
  - 62–66 kg → L
  - 67–72 kg → XL
  - 73–80 kg → 2XL
  - 81–90 kg → 3XL
  Kalıp standart (regular) ama HAFİF DARDIR. İki beden arasında kalan ya da daha rahat kullanım isteyen müşteriye BİR ÜST bedeni öner. Çok ince/narin yapı için (≈50 kg altı) XS uygundur. Beden önerirken önce kiloyu sor, sonra net bir beden söyle.

• STOK DURUMU: Katalogda AKTİF olarak listelenen her ürün ve onun listelenen bedenleri/renkleri şu an mevcuttur (satışa açıktır). Katalogda olmayan bir ürün/renk/beden için "şu an mevcut değil" de. Belirli bir adet/sayı sözü VERME (stok adedi takip edilmez); "mevcut" / "stoklarımızda var" demen yeterli.

• KARGO: Tüm siparişlerde kargo ÜCRETSİZDİR (tutar fark etmez). Cumartesi dâhil saat 14:00'e kadar verilen siparişler AYNI GÜN Aras Kargo'ya teslim edilir; bulunduğunuz şehre göre 1–3 iş günü içinde elinizde olur. Kargoya verilince SMS ve e-posta ile takip kodu paylaşılır.

• ÖDEME: Kapıda ödeme (nakit veya kart), havale/EFT ve online kredi/banka kartı. Kapıda ödemede ürünü görerek alırsınız.

• DEĞİŞİM: Teslimden itibaren 14 gün içinde, etiketi çıkarılmamış ve kullanılmamış üründe beden/renk değişimi yapılır; değişim her zaman vardır. Değişimde gidiş-geliş kargo bedeli müşteriye aittir. Talep WhatsApp'tan başlatılır.

• İADE & CAYMA HAKKI: Teslimden itibaren 14 gün içinde gerekçesiz cayma hakkı vardır. Koşullar: ürün etiketli, kullanılmamış/yıkanmamış, leke-parfüm-makyaj bulaşmamış, orijinal ambalajıyla ve fatura/sipariş bilgisiyle. Etiketi çıkarılmış/kullanılmış/kişiye özel ölçüye göre üretilmiş ürünlerde cayma kullanılamaz. Geçerli iadelerde bedel, ürün ulaşıp incelendikten sonra en geç 14 gün içinde aynı ödeme yöntemine iade edilir (kart iadesinin yansıma süresi bankaya bağlıdır).

• SİPARİŞ İPTALİ: Henüz kargoya verilmemiş sipariş WhatsApp'tan ücretsiz iptal edilir; kargoya verilmişse cayma hakkı uygulanır.

• İLETİŞİM & SAATLER: WhatsApp ${WHATSAPP} (Pazartesi–Cumartesi 08:00–19:00), e-posta info@essejeffe.com, Instagram @esse_jeffe.

SİPARİŞ ALMA (çok önemli):
- Müşteri "sipariş vermek/oluşturmak istiyorum" derse ya da bir ürünü almak istediğini belirtirse, sohbeti doğal şekilde yönlendirerek şu bilgileri TEK TEK, kibarca topla:
  1) Hangi ürün(ler), beden ve renk (katalogdaki bir ürün olmalı), adet
  2) Ad soyad
  3) Telefon
  4) İl ve ilçe
  5) Açık adres (mahalle, sokak, kapı no)
  6) Ödeme yöntemi: "kapıda ödeme" mi yoksa "kredi/banka kartı" mı?
  7) Kart ödemesi seçilirse e-posta adresi (kart için ZORUNLU)
- Bilgileri kısa kısa iste; hepsini tek mesajda dökme. Eksik kalanları nazikçe tamamlat.
- Tüm zorunlu bilgiler tamamlanınca METİN olarak özet YAZMA. Bunun yerine \`show_order_summary\` fonksiyonunu çağır — bu, müşteriye ürün görseli, teslimat bilgileri ve toplam tutarı içeren GÖRSEL bir özet kartı gösterir. Ardından yalnızca kısa bir cümleyle onay iste (ör. "Aşağıda siparişinizin özeti var, onaylıyor musunuz?"); ürün/adres/tutar gibi detayları metinde TEKRARLAMA.
- Müşteri onaylayınca \`create_order\` fonksiyonunu çağır. ASLA fiyat/toplam uydurma; tutarı sistem hesaplar.
- Fonksiyonun sonucunu müşteriye sıcak bir dille aktar. Kapıda ödemede sipariş numarasını söyle. Kart ödemesinde "güvenli ödeme ekranı şimdi açılıyor, kart bilgilerinizi orada gireceksiniz" de.
- Müşteri vazgeçerse ya da bilgisi katalogla uyuşmuyorsa nazikçe düzelt; fonksiyonu eksik/yanlış bilgiyle çağırma.

OPERASYONEL NOTLAR:
- Sohbette KAPIDA ÖDEME ve KART ile sipariş alabilirsin. Müşteri HAVALE/EFT ile ödemek isterse siparişi sohbette tamamlama; nazikçe sepet/ödeme sayfasından devam etmesini söyle.
- Fiyat ve toplamı ASLA uydurma; sipariş tutarını sistem (create_order) hesaplar. Katalogdaki fiyatlar dışında rakam verme.

SINIRLARIN (yalnız bunlarda temsilciye yönlendir):
- Müşterinin MEVCUT/GEÇMİŞ bir siparişine özel konular: o siparişin durumu/kargo takip kodu, ödemesinde yaşanan arıza, kişisel iade/değişim talebinin BAŞLATILMASI ve onayı. Bunları sen çözemezsin (kişisel kayıtlara erişimin yok). Politikayı/koşulları açıklayabilirsin ama işlemi başlatamazsın.
- Bu durumlarda ya da müşteri bir insanla görüşmek isterse: kibarca alt köşedeki "Temsilciye Bağlan" butonunu öner veya WhatsApp ${WHATSAPP} hattını (Pazartesi–Cumartesi 08:00–19:00) ver.
- Bilgi tabanında VE katalogda olmayan bir şeyi uydurma; gerçekten emin değilsen temsilciye yönlendir. Ama yukarıdaki bilgi tabanındaki her şeyi (beden, kargo, ödeme, değişim, iade, stok mantığı) BİZZAT ve net biçimde yanıtla — bunları temsilciye atma.`;
}

// ---- create_order fonksiyon tanımı (Gemini function calling) ----
const ORDER_TOOL = {
  name: "create_order",
  description:
    "Müşterinin sohbet içinde verdiği bilgilerle siparişi oluşturur. SADECE tüm zorunlu bilgiler " +
    "(ürün(ler)+beden+adet, ad soyad, telefon, il, ilçe, açık adres, ödeme yöntemi) eksiksiz toplandıktan " +
    "VE müşteri özeti onayladıktan sonra çağır. Kart ödemesinde e-posta da zorunludur. Fiyatları sistem hesaplar.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Sipariş edilen ürünler",
        items: {
          type: "object",
          properties: {
            product_name: { type: "string", description: "Katalogdaki ürün adı (birebir veya çok yakın)" },
            size: { type: "string", description: "Beden, ör. M, L, 42" },
            color: { type: "string", description: "Renk (varsa)" },
            qty: { type: "integer", description: "Adet (en az 1)" },
          },
          required: ["product_name", "qty"],
        },
      },
      full_name: { type: "string", description: "Müşterinin ad soyadı" },
      phone: { type: "string", description: "Telefon numarası" },
      email: { type: "string", description: "E-posta (kart ödemesinde zorunlu)" },
      city: { type: "string", description: "İl" },
      district: { type: "string", description: "İlçe" },
      address: { type: "string", description: "Açık adres" },
      postal_code: { type: "string", description: "Posta kodu (opsiyonel)" },
      note: { type: "string", description: "Sipariş notu (opsiyonel)" },
      payment_method: { type: "string", enum: ["cod", "card"], description: "cod = kapıda ödeme, card = kredi/banka kartı" },
    },
    required: ["items", "full_name", "phone", "city", "district", "address", "payment_method"],
  },
};

// ---- show_order_summary: onay öncesi görsel özet kartı (sipariş OLUŞTURMAZ) ----
const SUMMARY_TOOL = {
  name: "show_order_summary",
  description:
    "Tüm zorunlu sipariş bilgileri (ürün(ler)+beden+adet, ad soyad, telefon, il, ilçe, açık adres, ödeme yöntemi; " +
    "kart ödemesinde e-posta) toplandıktan SONRA, müşteriden onay İSTEMEDEN HEMEN ÖNCE çağır. Müşterinin sohbetinde " +
    "ürün görseli, teslimat bilgileri ve toplam tutarı içeren GÖRSEL bir özet kartı gösterir. Sipariş OLUŞTURMAZ; " +
    "bu fonksiyonu çağırınca özeti metin olarak yazma, yalnızca kısa bir onay sorusu sor.",
  parameters: ORDER_TOOL.parameters,
};

function orderNo(): string {
  const d = new Date();
  const ymd = String(d.getUTCFullYear()).slice(2) +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 1e5).toString().padStart(5, "0");
  return "EJ" + ymd + rnd;
}

// ürün adından kataloğu eşle (birebir → küçük harf → içerir)
function matchProduct(name: string): Product | null {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  let p = catalogRows.find((x) => x.name.toLowerCase() === n);
  if (p) return p;
  p = catalogRows.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
  return p || null;
}

type OrderResult = {
  message: string;                 // AI'a (functionResponse) dönecek metin
  order?: Record<string, unknown>; // widget'a iletilecek (kartta PayTR tetikler)
};

// sohbetten gelen sipariş girdisini doğrula + DB kataloğundan çöz (fiyat client'tan ALINMAZ).
// Hem create_order hem show_order_summary buradaki tek doğrulama/fiyatlama mantığını kullanır.
type ResolvedOrder = {
  pm: "cod" | "card";
  orderItems: any[];     // orders/order_items insert için
  cartForPaytr: any[];   // paytr-token formatı: {id:slug, qty, color, size, name}
  cardItems: any[];      // widget özet kartı: {name, model_desc, image, color, size, qty, unit_price, line_total}
  summary: string[];     // metin özet parçaları
  form: any;
  subtotal: number;
  shipping: number;
  total: number;
};
function resolveOrder(input: any): { error?: string; data?: ResolvedOrder } {
  const items = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) return { error: "HATA: Sipariş için en az bir ürün gerekli. Müşteriden hangi ürünü istediğini sor." };

  const pm = input?.payment_method === "card" ? "card" : input?.payment_method === "cod" ? "cod" : null;
  if (!pm) return { error: "HATA: Ödeme yöntemi belirsiz. Müşteriye 'kapıda ödeme' mi 'kart' mı diye sor." };

  // zorunlu teslimat alanları
  for (const [f, label] of [["full_name", "ad soyad"], ["phone", "telefon"], ["city", "il"], ["district", "ilçe"], ["address", "açık adres"]] as const) {
    if (!String(input?.[f] || "").trim()) return { error: `HATA: Eksik bilgi (${label}). Müşteriden iste.` };
  }

  const email = String(input?.email || "").trim();
  if (pm === "card" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "HATA: Kart ödemesi için geçerli bir e-posta adresi gerekli. Müşteriden e-posta iste." };
  }

  // ürünleri DB kataloğundan çöz
  let subtotal = 0;
  const orderItems: any[] = [];
  const cartForPaytr: any[] = [];
  const cardItems: any[] = [];
  const summary: string[] = [];
  for (const it of items) {
    const p = matchProduct(it.product_name);
    if (!p) return { error: `HATA: "${it.product_name}" kataloğda bulunamadı. Müşteriye mevcut ürünleri öner ve doğru adı al.` };
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const line = p.price * qty;
    subtotal += line;
    orderItems.push({
      product_id: p.id, product_name: p.name, model_desc: p.model_desc || null,
      color: it.color || null, size: it.size || null, unit_price: p.price, qty,
    });
    cartForPaytr.push({ id: p.slug, name: p.name, qty, color: it.color || null, size: it.size || null });
    // renge özel görsel varsa onu kullan, yoksa ürünün birincil görseli
    let image = p.image;
    if (it.color) {
      const ci = p.colorImages.find((c) => c.name.toLowerCase() === String(it.color).toLowerCase());
      if (ci) image = ci.url;
    }
    cardItems.push({
      name: p.name, model_desc: p.model_desc || null, image,
      color: it.color || null, size: it.size || null, qty, unit_price: p.price, line_total: line,
    });
    summary.push(`${qty} x ${p.name}${it.size ? " (" + it.size + (it.color ? ", " + it.color : "") + ")" : it.color ? " (" + it.color + ")" : ""}`);
  }
  const shipping = 0;
  const total = subtotal + shipping;

  const form = {
    full_name: String(input.full_name).trim(),
    phone: String(input.phone).trim(),
    email: email || null,
    city: String(input.city).trim(),
    district: String(input.district).trim(),
    address: String(input.address).trim(),
    postal_code: String(input?.postal_code || "").trim() || null,
    note: String(input?.note || "").trim() || null,
  };

  return { data: { pm, orderItems, cartForPaytr, cardItems, summary, form, subtotal, shipping, total } };
}

// show_order_summary: onay öncesi görsel özet kartı için veri döner (sipariş OLUŞTURMAZ)
async function handleSummary(input: any): Promise<OrderResult> {
  await loadCatalog();
  const { error, data } = resolveOrder(input);
  if (error || !data) return { message: error || "HATA: Sipariş özeti hazırlanamadı." };
  const totalTxt = data.total.toLocaleString("tr-TR") + " TL";
  return {
    message:
      `BAŞARILI: Sipariş özeti müşteriye GÖRSEL bir kart olarak gösterildi (ürün görseli, teslimat bilgileri, ` +
      `ödeme yöntemi ve ${totalTxt} toplam dâhil). Şimdi SADECE kısa bir cümleyle onay iste (ör. "Aşağıda siparişinizin ` +
      `özeti var, onaylıyor musunuz?"). Ürün/adres/tutar gibi detayları metinde TEKRARLAMA. Müşteri onaylayınca create_order'ı çağır.`,
    order: {
      mode: "summary", payment_method: data.pm, items: data.cardItems,
      form: data.form, subtotal: data.subtotal, shipping: data.shipping, total: data.total,
    },
  };
}

// create_order fonksiyonunu çalıştır
async function handleCreateOrder(input: any, conv: any): Promise<OrderResult> {
  await loadCatalog();
  const { error, data } = resolveOrder(input);
  if (error || !data) return { message: error || "HATA: Sipariş oluşturulamadı." };
  const { pm, orderItems, cartForPaytr, summary, form, subtotal, shipping, total } = data;
  const totalTxt = total.toLocaleString("tr-TR") + " TL";

  // ---- KART: siparişi burada OLUŞTURMA; widget paytr-token'ı çağırsın ----
  if (pm === "card") {
    return {
      message:
        `BAŞARILI (kart): Sipariş bilgileri alındı ve doğrulandı. Toplam ${totalTxt}. ` +
        `Güvenli kart ödeme ekranı müşterinin sohbetinde ŞİMDİ açılıyor — müşteriye kart bilgilerini o ekrana girmesini, ` +
        `ödeme tamamlanınca siparişinin onaylanacağını söyle. (Sipariş, ödeme onaylanınca kesinleşir.)`,
      order: { mode: "card", total, items: cartForPaytr, form },
    };
  }

  // ---- KAPIDA ÖDEME: siparişi service_role ile oluştur ----
  const oid = orderNo();
  const { data: orderRow, error: oErr } = await admin.from("orders").insert({
    order_no: oid, status: "pending", user_id: conv?.user_id || null,
    payment_method: "cod", payment_status: "cod",
    subtotal, shipping_fee: shipping, total,
    full_name: form.full_name, phone: form.phone, email: form.email,
    city: form.city, district: form.district, address: form.address,
    postal_code: form.postal_code, note: form.note,
  }).select("id").single();
  if (oErr || !orderRow) {
    console.error("[chat] cod order insert", oErr);
    return { message: "HATA: Sipariş kaydedilemedi (sistem hatası). Müşteriden özür dile ve birazdan tekrar denemesini ya da temsilciye bağlanmasını öner." };
  }
  const rows = orderItems.map((r) => ({ ...r, order_id: orderRow.id }));
  const { error: iErr } = await admin.from("order_items").insert(rows);
  if (iErr) console.error("[chat] cod order_items insert", iErr);

  return {
    message:
      `BAŞARILI (kapıda ödeme): Sipariş oluşturuldu. Sipariş No: ${oid}. ` +
      `Ürünler: ${summary.join(", ")}. Toplam ${totalTxt} (kargo ücretsiz), kapıda ödenecek. ` +
      `Müşteriye sipariş numarasını ve özetini söyle, teşekkür et; siparişin hazırlanıp kargoya verileceğini belirt.`,
    order: { mode: "cod", order_no: oid, total },
  };
}

// chat geçmişini Gemini "contents" formatına çevir
function toGeminiContents(rows: any[]) {
  const out: { role: string; parts: { text: string }[] }[] = [];
  for (const r of rows) {
    if (r.role === "system") continue;
    const role = r.role === "user" ? "user" : "model";   // ai + agent → model
    out.push({ role, parts: [{ text: r.content }] });
  }
  // Gemini ilk içeriğin "user" olmasını ister → baştaki model mesajlarını at
  while (out.length && out[0].role === "model") out.shift();
  return out;
}

type AiResult = { text: string; order?: Record<string, unknown> };

async function askGemini(history: any[], conv: any): Promise<AiResult> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    return { text: `Yapay zekâ asistanı şu an yapılandırılmamış. Lütfen "Temsilciye Bağlan" butonuna basın veya WhatsApp ${WHATSAPP} hattından yazın.` };
  }
  const contents = toGeminiContents(history);
  if (!contents.length) return { text: "Merhaba! Size nasıl yardımcı olabilirim?" };
  await loadCatalog();
  const sys = systemPrompt(catalogText);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  let order: Record<string, unknown> | undefined;
  // function-calling döngüsü (en fazla birkaç tur)
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents,
        tools: [{ functionDeclarations: [SUMMARY_TOOL, ORDER_TOOL] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      }),
    });
    if (!res.ok) {
      console.error("[chat] Gemini hata", res.status, await res.text());
      return { text: `Şu an yanıt veremiyorum. Lütfen "Temsilciye Bağlan" butonunu kullanın.`, order };
    }
    const data = await res.json();
    const cand = (data.candidates || [])[0];
    const parts = cand?.content?.parts || [];
    const fcPart = parts.find((p: any) => p.functionCall);

    if (fcPart) {
      const fname = fcPart.functionCall.name;
      const result = fname === "show_order_summary"
        ? await handleSummary(fcPart.functionCall.args || {})
        : await handleCreateOrder(fcPart.functionCall.args || {}, conv);
      if (result.order) order = result.order;
      // modelin function-call turunu + bizim function-response'umuzu geçmişe ekle, tekrar sor
      contents.push({ role: "model", parts });
      contents.push({
        role: "function",
        parts: [{ functionResponse: { name: fcPart.functionCall.name, response: { result: result.message } } }],
      } as any);
      continue;
    }

    const text = parts
      .filter((p: any) => typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
      .trim();
    return { text: text || "Bunu tam anlayamadım, biraz daha açabilir misiniz?", order };
  }
  return { text: "İşleminizi tamamlayamadım, lütfen tekrar dener misiniz?", order };
}

// visitor_token ile konuşmayı doğrula
async function verify(conversationId: string, token: string) {
  if (!conversationId || !token) return null;
  const { data } = await admin
    .from("chat_conversations")
    .select("id,status,visitor_name,visitor_email,user_id")
    .eq("id", conversationId)
    .eq("visitor_token", token)
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405, cors);

  // Tarayıcıdan (Origin başlığı olan) gelen ama izinli olmayan origin'leri reddet.
  // Origin'siz istekleri (curl/sunucu) burada eleyemeyiz; onları IP hız sınırı tutar.
  if (origin && !isAllowedOrigin(origin)) return json({ error: "forbidden origin" }, 403, cors);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, cors); }
  const action = body.action;
  const ip = clientIp(req);

  try {
    // ---- yeni konuşma başlat ----
    if (action === "start") {
      // günlük konuşma kotası + saatlik sınır (bot spam'i yeni konuşma açarak aşamasın)
      if (await rateLimited(ip, "start")) {
        return json({ error: "rate", message: "Çok fazla yeni sohbet açıldı. Lütfen biraz sonra tekrar deneyin." }, 429, cors);
      }
      // tablo şişmesin: 25 saatten eski hız-sınırı kayıtlarını temizle (günlük pencere 24s)
      await admin.from("chat_rate_limit").delete()
        .lt("created_at", new Date(Date.now() - 25 * 3600 * 1000).toISOString());

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
      await rateHit(ip, "start");
      const greeting = "Merhaba, ben Esse Jeffe asistanı 👗 Abiye seçimi, beden, renk veya kargo gibi her konuda yardımcı olabilirim; dilerseniz sohbetin içinde siparişinizi de oluşturabilirim. Size nasıl yardımcı olabilirim?";
      await admin.from("chat_messages").insert({
        conversation_id: conv.id, role: "ai", content: greeting,
      });
      return json({ conversation_id: conv.id, visitor_token: conv.visitor_token }, 200, cors);
    }

    // ---- mesaj gönder ----
    if (action === "send") {
      const conv = await verify(body.conversation_id, body.visitor_token);
      if (!conv) return json({ error: "unauthorized" }, 403, cors);
      const text = String(body.text || "").trim().slice(0, 2000);
      if (!text) return json({ error: "empty" }, 400, cors);

      // IP başına burst sınırı (kısa pencere → paylaşımlı IP'yi zorlamaz, botu yavaşlatır)
      if (await rateLimited(ip, "send")) {
        return json({ error: "rate", message: "Çok hızlı mesaj gönderiyorsunuz. Lütfen birkaç saniye sonra tekrar deneyin." }, 429, cors);
      }
      // oturum (konuşma) başına mesaj sınırı — visitor_token'a bağlı, NAT/paylaşımlı IP'yi mağdur ETMEZ
      const { count: convMsgs } = await admin.from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conv.id).eq("role", "user");
      if ((convMsgs ?? 0) >= CONV_SEND_MAX) {
        return json({ error: "conv_limit", message: `Bu sohbet epey uzadı 🙂 Dilerseniz WhatsApp ${WHATSAPP} hattından ya da "Temsilciye Bağlan" ile devam edelim.` }, 429, cors);
      }
      await rateHit(ip, "send");

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
        const { text: reply, order } = await askGemini(hist || [], conv);
        await admin.from("chat_messages").insert({
          conversation_id: conv.id, role: "ai", content: reply,
        });
        await admin.from("chat_conversations")
          .update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);
        // order: kapıda ödemede {mode:'cod',...}, kartta {mode:'card',items,form,total}
        return json({ ok: true, status: conv.status, order: order || null }, 200, cors);
      }
      return json({ ok: true, status: conv.status }, 200, cors);
    }

    // ---- temsilciye bağlan ----
    if (action === "request_agent") {
      const conv = await verify(body.conversation_id, body.visitor_token);
      if (!conv) return json({ error: "unauthorized" }, 403, cors);
      await admin.from("chat_conversations")
        .update({ status: "waiting", unread_admin: true, last_message_at: new Date().toISOString() })
        .eq("id", conv.id);
      await admin.from("chat_messages").insert({
        conversation_id: conv.id, role: "system",
        content: "Bir müşteri temsilcisine bağlanmak istediniz. En kısa sürede size dönüş yapılacaktır. (Çalışma saatleri dışında yanıt gecikebilir.)",
      });
      return json({ ok: true, status: "waiting" }, 200, cors);
    }

    // ---- yeni mesajları çek (polling) ----
    if (action === "poll") {
      const conv = await verify(body.conversation_id, body.visitor_token);
      if (!conv) return json({ error: "unauthorized" }, 403, cors);
      let q = admin.from("chat_messages")
        .select("id,role,content,created_at")
        .eq("conversation_id", conv.id).order("created_at");
      if (body.after) q = q.gt("created_at", body.after);
      const { data: msgs } = await q;
      return json({ messages: msgs || [], status: conv.status }, 200, cors);
    }

    return json({ error: "unknown action" }, 400, cors);
  } catch (e) {
    console.error("[chat] hata", e);
    return json({ error: "server" }, 500, cors);
  }
});
