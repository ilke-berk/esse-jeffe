# Reklam + Tasarım Hazırlık Planı

**Tarih:** 2026-07-17
**Durum:** Kod tarafı büyük ölçüde tamam (2026-07-18) — A1 olaylar bağlı,
A2+D2 bitti, A3 feed CANLI, B favicon/404/OG bitti, D3'ün ilk 3 rehberi
yayında. Bekleyen: hesap/domain işleri (GA4+Pixel ID, Merchant hesabı),
D4 dijital PR, kreatif çekimler.
**Bağlantılı plan:** [PLAN-prod-oncesi-eposta.md](PLAN-prod-oncesi-eposta.md) — buradaki
hesap/doğrulama adımlarının çoğu domain alınmış olmasını gerektirir; sıralama
**önce domain**, sonra bu plan.

## Mevcut durum (2026-07-17 taraması)

Sitede şu an **hiçbiri yok**:

| Eksik | Etkisi |
|---|---|
| GA4 / Meta Pixel / Ads dönüşüm etiketi | Hangi üründen kaç satış geldiği görülemez; reklam optimize edilemez |
| `meta description` (hiçbir sayfada) | Google sonuçlarında rastgele metin görünür |
| OG / Twitter kartları | WhatsApp/Instagram'da paylaşılan link çıplak görünür |
| `sitemap.xml` + `robots.txt` | Google indexlemesi yavaş/eksik olur |
| Ürün sayfasında schema.org Product JSON-LD | Zengin sonuç (fiyat/stok) çıkmaz; Merchant Center ücretsiz listeleme kullanılamaz |
| Favicon + apple-touch-icon | Sekmede boş ikon, her ziyarette konsola 404 |
| 404.html | `netlify.toml` engellenen yolları `/404.html`'e yönlendiriyor ama dosya yok |
| OG paylaşım görseli (1200×630) | Link paylaşımları görselsiz |

Var olanlar (avantaj): çerez onay barı (ama şu an hiçbir scripti şartlamıyor —
pixel/GA4 eklenirken onaya bağlanmalı, KVKK gereği), yasal sayfalar (mesafeli
satış, KVKK, gizlilik, çerez politikası), `img/logo.png` (22 KB), 6 ürün
fotoğrafı + Supabase Storage görselleri.

---

## A. Reklam gereklilikleri

### A1. Ölçüm altyapısı (reklamdan ÖNCE şart) — iskelet hazır (2026-07-17)
- [x] **`ej-analytics.js`** — çerez onayına bağlı GA4 + Meta Pixel yükleyici;
      ID'ler dosyanın başındaki `CONFIG`'e yazılınca aktifleşir. Onay yoksa
      hiçbir üçüncü taraf isteği atılmaz (KVKK). Çerez bandı artık tüm
      sayfalarda (yoksa JS enjekte ediyor; index'teki eski inline script kaldırıldı)
- [x] `view_item` olayı otomatik (`ej:product-loaded`); genel API: `ejTrack(ad, params)`
- [ ] GA4 mülkü + Measurement ID (kullanıcı) → `CONFIG.ga4`
- [ ] Meta Pixel ID (kullanıcı) → `CONFIG.metaPixel`
- [x] **purchase / add_to_cart / begin_checkout** akışa bağlandı (2026-07-18):
      add_to_cart → EJCart.add (ej.js), begin_checkout + purchase (COD/havale
      ve PayTR başarı ekranı) → sepet.html. ID'ler girilince test siparişiyle
      GA4/Pixel tarafında doğrulanacak
- [ ] **Google Ads dönüşüm etiketi** — arama reklamı düşünülürse

### A2. SEO temelleri — ✅ YAPILDI (2026-07-17)
- [x] Tüm sayfalara `meta description` (+ canonical; admin/hesap/sepet noindex)
- [x] OG + Twitter kartları (title, description, image)
- [x] `sitemap.xml` (9 ürün URL'si dahil) + `robots.txt` (AI botları izinli)
- [x] `urun.html`'e schema.org **Product JSON-LD** — `applyProductSeo()`
      DB verisiyle enjekte ediyor; ayrıca index'e Organization+WebSite,
      sss.html'e FAQPage JSON-LD eklendi

### A3. Google Merchant Center + ürün feed'i
- [x] **merchant-feed edge function CANLI** (2026-07-18): aktif ürünler +
      renk görselleri + stok + indirimli fiyat, RSS 2.0 / g: namespace.
      Feed URL: `https://grdinhjtsmoograktgge.supabase.co/functions/v1/merchant-feed`
      (gateway Content-Type'ı text/plain gösterir; Google içeriği parse eder, sorun değil)
- [ ] Merchant Center hesabı + domain doğrulaması → feed URL'sini "zamanlanmış
      getirme" olarak ekle
- [ ] Feed bağlanınca: Google Shopping ücretsiz listeleme + Performance Max reklamı

### A4. Meta Business tarafı
- [ ] Business Manager hesabı + domain doğrulama
- [ ] İstenirse Instagram Shop → katalog olarak A3'teki feed kullanılır

---

## B. Tasarım gereklilikleri

- [x] **Favicon seti** — üretildi (2026-07-17): favicon.ico + img/favicon-32/192/512.png,
      apple-touch-icon.png, site.webmanifest; tüm sayfalara link eklendi
- [x] **404.html** — markalı hata sayfası eklendi
- [x] **OG paylaşım görseli** — `img/og-cover.jpg` (1200×630, hero'dan kadraj)
- [ ] **Vektör logo (SVG)** — reklam hesapları, Merchant Center, sosyal
      profiller için; eldeki PNG başlangıç için yeterli
- [ ] **Ürün/kreatif fotoğrafçılığı** — reklam performansını en çok belirleyen
      kalem. Instagram formatları: 1:1, 4:5, story/reel 9:16; mümkünse manken
      üstü lifestyle çekimler

---

## C. Görev dağılımı

### Claude yapabilir (kod işi, ~1 oturum)
- Favicon seti + 404.html
- Tüm sayfalara meta description + OG/Twitter kartları
- sitemap.xml + robots.txt
- urun.html'e Product JSON-LD
- Çerez onayına bağlı GA4/Pixel yükleyici (ID'ler sonradan tek satırla eklenir)
- Merchant feed edge function'ı

### Kullanıcı yapacak (hesap/domain işi)
- GA4 mülkü aç → Measurement ID'yi ilet
- Meta Business Manager + Pixel oluştur → Pixel ID'yi ilet
- Google Ads / Merchant Center hesapları + ödeme yöntemi
- Domain doğrulamaları (Google + Meta) — **domain alınmış olmalı**
- Ürün/kreatif çekimleri

---

## D. AI asistanlarında görünürlük (AEO/GEO)

**Hedef:** ChatGPT / Gemini / Claude'da "abiye nereden alınır" tarzı sorularda
öneri olarak çıkmak. Mekanizma: asistanlar cevabı web aramasından (Bing/Google)
ve ürün feed'lerinden derliyor → klasik SEO + feed + üçüncü taraf marka
bahisleri = AI görünürlüğü. Satın alınamaz, kazanılır; etkisi aylar içinde.

### D1. Ön koşullar (zaten planda)
- [x] A2 SEO temelleri — Google/Bing indexi olmadan AI cevabına girilmez (✅ 2026-07-17)
- [ ] A3 Merchant feed — ChatGPT alışveriş sonuçları ve Google AI modu
      feed/Shopping Graph'tan besleniyor

### D2. Teknik AEO — ✅ YAPILDI (2026-07-17)
- [x] robots.txt AI tarayıcılarını engellemiyor (yalnız admin/hesap sayfaları kapalı)
- [x] Organization + WebSite (index) ve FAQPage (sss) JSON-LD
- [x] `llms.txt` — site özeti + sayfalar + ürün slug'ları

### D3. İçerik hattı (alıntılanabilir sayfalar)
- [x] İlk 3 rehber CANLI (2026-07-18), hepsi Article+FAQPage şemalı, footer
      "Stil Rehberi" sütunuyla tüm siteden linkli, sitemap+llms.txt'te:
      `dugune-davetli-ne-giyilir.html`, `kina-gecesi-ne-giyilir.html`,
      `mezuniyet-elbisesi-secimi.html`
- [ ] Sonraki adaylar: "nişanda ne giyilir", "davete saç-aksesuar kombini",
      "abiye kumaş rehberi", renk odaklı sayfalar ("bordo abiye kombini")

### D4. Dijital PR / üçüncü taraf bahisler (kullanıcı işi, en etkili kalem)
- [ ] "En iyi abiye siteleri" tarzı liste/blog içeriklerine girme çalışması
- [ ] Google Yorumlar / Trustpilot benzeri doğrulanabilir müşteri yorumu birikimi
- [ ] Ekşi Sözlük, kadın forumları, Reddit'te organik marka varlığı
- [ ] Instagram dışında crawl edilebilir (herkese açık web) marka izi

### D5. Ölçüm
- [ ] GA4'te referral kaynakları: chatgpt.com, gemini.google.com,
      perplexity.ai ayrı kanal grubu olarak işaretle
- [ ] Ayda bir elle test: 3 asistana "türkiye'de abiye nereden alınır" sor,
      markanın geçip geçmediğini not et

---

## E. Önerilen sıra

0. **Konumlandırma notu (1 gün, kullanıcı):** kime satıyoruz, fiyat bandı,
   bizi ayıran özellik, marka tonu — kreatiflerin ve içerik hattının girdisi
1. Domain al ([PLAN-prod-oncesi-eposta.md](PLAN-prod-oncesi-eposta.md) 1. adım)
2. Claude'un kod paketi (A2 + B'nin favicon/404/OG kısmı + A1 iskeleti +
   D2 teknik AEO) — domain beklemeden yapılabilir, ID'ler sonra eklenir
3. Resend + Netlify + Supabase Pro (prod planındaki adımlar)
4. GA4 + Pixel hesapları → ID'ler koda işlenir → test siparişiyle purchase
   olayı doğrulanır
5. Merchant Center + feed → Google Shopping (+ AI alışveriş yüzeyleri)
6. Kreatif çekimler → ilk kampanya (öneri: Meta/Instagram ile başla)
7. Paralel uzun vade hattı: D3 içerik sayfaları + D4 dijital PR — reklamla
   eş zamanlı yürür, AI önerilerine girişin asıl motoru budur
