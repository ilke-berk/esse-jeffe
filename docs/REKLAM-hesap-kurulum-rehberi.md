# Reklam İçin Senin Alman Gerekenler — Kurulum Rehberi

Kod tarafı hazır. Aşağıdaki her kalem senin açacağın bir hesaptan gelecek;
"nereye yazılacak" sütunundaki yere girildiği an sistem çalışmaya başlar.
Sıra önemli: **önce domain**, gerisi ona bağlı.

| # | Alınacak şey | Neden gerekli | Nereye yazılacak |
|---|---|---|---|
| 1 | **Domain** (essejeffe.com) | Tüm doğrulamaların ön koşulu; site, mail ve reklam hesapları buna bağlanır | Netlify'a custom domain olarak (kod hazır, değişiklik gerekmez) |
| 2 | **GA4 Measurement ID** (`G-XXXXXXXXXX`) | Trafik + dönüşüm ölçümü; reklam optimizasyonunun veri kaynağı | `ej-analytics.js` → `CONFIG.ga4` |
| 3 | **Meta Pixel ID** (15-16 haneli sayı) | Instagram/Facebook reklamı hedefleme + dönüşüm takibi | `ej-analytics.js` → `CONFIG.metaPixel` |
| 4 | **Merchant Center hesabı** | Google Shopping ücretsiz listeleme + AI alışveriş yüzeyleri | Feed URL'sini Merchant Center'a yapıştıracaksın (aşağıda) |
| 5 | **Search Console doğrulaması** | Google indexleme + sitemap bildirimi | Sadece hesapta işlem; koda bir şey yazılmaz |

## Adım adım

### 1. Domain (her şeyin kapısı)
Bir kayıt firmasından (ör. GoDaddy, isimtescil, Cloudflare) `essejeffe.com`'u
al → Netlify panelinde siteye custom domain olarak ekle. Koddaki tüm linkler
zaten `https://essejeffe.com` üzerine kurulu.

### 2. GA4 (Google Analytics)
1. [analytics.google.com](https://analytics.google.com) → hesap oluştur →
   "Web" veri akışı ekle, site adresini gir.
2. Sana `G-` ile başlayan bir **Measurement ID** verecek.
3. Bu ID'yi bana ilet ya da kendin yaz: [ej-analytics.js](../ej-analytics.js)
   dosyasının en başında:
   ```js
   ga4: '',        →  ga4: 'G-XXXXXXXXXX',
   ```
Başka hiçbir değişiklik gerekmez; purchase / add_to_cart / view_item /
begin_checkout olayları zaten bağlı. ID girilince **bir test siparişi** verip
GA4 "Gerçek zamanlı" ekranında purchase olayını görmeliyiz.

### 3. Meta Pixel (Instagram/Facebook reklamı)
1. [business.facebook.com](https://business.facebook.com) → Business Manager
   hesabı aç (işletme adı: Esse Jeffe).
2. Olaylar Yöneticisi → **Pixel oluştur** → sana sayısal bir Pixel ID verecek.
3. Aynı dosyaya yaz:
   ```js
   metaPixel: ''   →  metaPixel: '1234567890123456',
   ```
4. Business Manager → Marka Güvenliği → **Alan adları** → essejeffe.com'u
   doğrula (domain alınmış olmalı).

### 4. Google Merchant Center (ücretsiz Shopping listeleme)
1. [merchants.google.com](https://merchants.google.com) → hesap aç →
   essejeffe.com'u doğrula.
2. Ürünler → Feed ekle → **Zamanlanmış getirme** seç ve şu URL'yi yapıştır:
   ```
   https://grdinhjtsmoograktgge.supabase.co/functions/v1/merchant-feed
   ```
   Feed otomatik günceldir: ürün ekleyip çıkardıkça kendisi yenilenir,
   elle iş yok.

### 5. Google Search Console (ücretsiz, 5 dakika)
1. [search.google.com/search-console](https://search.google.com/search-console)
   → essejeffe.com'u ekle (domain doğrulaması DNS kaydıyla).
2. Sitemap bölümüne `https://essejeffe.com/sitemap.xml` gönder.
Bu, Google'ın (ve dolayısıyla AI asistanlarının) siteyi hızlı indexlemesini
sağlar.

## İsteğe bağlı / sonraya kalabilir

- **Google Ads hesabı + dönüşüm etiketi** — arama/Shopping reklamı vermeye
  karar verirsek; Merchant bağlandıktan sonra anlamlı.
- **TikTok Pixel** — TikTok reklamı düşünülürse (kod tarafına eklenmesi kolay).

## Kontrol listesi (bittikçe işaretle)

- [ ] Domain alındı + Netlify'a bağlandı
- [ ] GA4 ID → `ej-analytics.js`'e yazıldı
- [ ] Meta Pixel ID → `ej-analytics.js`'e yazıldı
- [ ] Test siparişiyle purchase olayı GA4 + Pixel'de görüldü
- [ ] Meta'da domain doğrulandı
- [ ] Merchant Center'a feed URL eklendi, ürünler onaylandı
- [ ] Search Console'a sitemap gönderildi
