# Senin Eklemen Gerekenler — Dış Servis / Bilgi Listesi

Son güncelleme: 2026-07-21

Bu liste **kod tarafında hazır olan ama senin dışarıdan bir değer girmeni bekleyen** her şeyi içerir.
Kod yazılması gereken işler bu listede değil — burada olanlar "hesap aç / numara al / secret'a yapıştır" işleri.

Kısaltmalar: **Secret** = Supabase Dashboard → Project Settings → Edge Functions → Secrets.

---

## 0. ÖNCE BU: Domain (her şeyin ön koşulu)

Site henüz yayında değil, `essejeffe.com` alınmamış. Ama **tüm kod bu domain'e göre yazılmış**:

- `sitemap.xml` — 20+ `<loc>https://essejeffe.com/...`
- `robots.txt:18` — sitemap satırı
- Her sayfada `<link rel="canonical" href="https://essejeffe.com/...">`
- 6 edge function `SITE_URL` yoksa `https://essejeffe.com` fallback'ine düşüyor

**Yapılacak:** domain satın al → Netlify'a custom domain olarak ekle (`netlify.toml` hazır) → SSL otomatik gelir.

Bu olmadan: Resend domain doğrulaması, Meta Pixel domain doğrulaması, Search Console, PayTR bildirim URL'si — hiçbiri yapılamaz.

---

## 1. Banka / Havale — EN KRİTİK EKSİK

`odeme.html:72` müşteriye **"banka hesabımıza havale yapabilirsiniz"** diyor ama sitede hiçbir IBAN yok.
Havale seçeneği `admin-siparisler.html:210`'da da aktif. Yani şu an bir müşteri havale seçerse **parayı nereye yatıracağını öğrenemiyor.**

| Ne | Nereye |
|---|---|
| Gerçek IBAN + banka adı + hesap sahibi unvanı | `ORDER_BANK_INFO` secret'ı |

Şu an dokümanda duran örnek değer sahte: `IBAN: TR00 0000 0000 0000 0000 0000 00` (`backend/siparis-eposta-kurulum.md:44-48`).

Okunduğu yer: `backend/edge-functions/_shared/order-email.ts:154`, `backend/functions/chat/order-email.ts:156`.
**Secret boşsa sipariş e-postasında IBAN bloğu hiç basılmıyor.**

Format önerisi (tek satır, `\n` ile):
```
Alıcı: BEBEGEL TEKSTİL E-TİCARET SAN. VE DIŞ TİC. LTD. ŞTİ.
Banka: <banka adı>
IBAN: TR__ ____ ____ ____ ____ ____ __
```

---

## 2. Kredi kartı — PayTR anahtarları

Kod tamamen hazır ve test edilmiş. Bekleyen sadece 3 anahtar + 1 panel ayarı.

| Secret | Nereden alınır |
|---|---|
| `PAYTR_MERCHANT_ID` | PayTR mağaza paneli |
| `PAYTR_MERCHANT_KEY` | PayTR mağaza paneli |
| `PAYTR_MERCHANT_SALT` | PayTR mağaza paneli |
| `PAYTR_TEST_MODE` | Şu an `1` (test). **Canlıya geçince `0` yap.** |
| `PAYTR_ALLOWED_ORIGINS` | `https://essejeffe.com,https://www.essejeffe.com` |

**PayTR panelinde Bildirim (callback) URL tanımla:**
`https://grdinhjtsmoograktgge.supabase.co/functions/v1/paytr-callback`

Küçük temizlik: Supabase'de kalmış `paytr-callback-test` fonksiyonunu panelden sil (etkisiz ama duruyor).

---

## 3. E-posta (Resend) — hesap var, domain doğrulanmamış

Resend **test modunda**: sadece `ilkeberkkutluk@hotmail.com` adresine mail gidiyor, başka adrese 403.

**Bu yüzden şu an müşteriye çalışmayan sistemler:** sipariş onay maili, sepet hatırlatma, hoş geldin kuponu, fiyat alarmı, stok uyarısı, sipariş durum maili.

Yapılacaklar:
1. Resend'de `essejeffe.com` domain'ini ekle
2. DNS'e **SPF + DKIM** kayıtlarını gir (Resend sana verir), `_dmarc` TXT kaydını da ekle
3. Secret'ları güncelle:

| Secret | Değer |
|---|---|
| `RESEND_API_KEY` | `re_...` |
| `ORDER_FROM_EMAIL` | `Esse Jeffe <siparis@essejeffe.com>` — doğrulanmış domain'den olmak **zorunda** |
| `ORDER_NOTIFY_EMAIL` | işletme bildirim kutusu, ör. `info@essejeffe.com` |
| `SITE_URL` | `https://essejeffe.com` |

**Ayrıca kurumsal posta kutusu gerekiyor:** sitede her yerde `info@essejeffe.com` yazıyor ama gerçek bir gelen kutusu yok. Google Workspace veya Zoho Mail aç.

Detay: `docs/PLAN-prod-oncesi-eposta.md`

---

## 4. Reklam / Analitik — hepsi boş

Kod hazır: `view_item`, `add_to_cart`, `begin_checkout`, `purchase` olayları bağlı ve çerez onayına saygılı. Sadece ID bekliyor.

| Ne | Nereye | Nereden alınır |
|---|---|---|
| GA4 Measurement ID (`G-XXXXXXXXXX`) | [ej-analytics.js:10](ej-analytics.js#L10) `ga4: ''` | analytics.google.com |
| Meta Pixel ID (15-16 hane) | [ej-analytics.js:11](ej-analytics.js#L11) `metaPixel: ''` | business.facebook.com → Events Manager |

ID'ler boşken hiçbir script yüklenmiyor — çerez onayı verilse bile **ölçüm sıfır.**

**Google Merchant Center feed'i hazır**, sadece hesaba yapıştıracaksın:
`https://grdinhjtsmoograktgge.supabase.co/functions/v1/merchant-feed`

**Henüz kodda olmayan, istersen eklenecekler** (söyle, yazayım):
- Google Ads conversion etiketi (`AW-...`)
- TikTok Pixel
- Google Tag Manager
- Search Console doğrulama (DNS ile de yapılabilir, kod gerekmez)

---

## 5. Yasal / Kurumsal — künye dolu, 4 eksik var

Dolu olanlar: Ticari unvan (BEBEGEL TEKSTİL...), MERSİS `0160186037000001`, VKN `1601860370`, KEP `bebegeltekstil@hs01.kep.tr`.

Eksikler:

1. **Açık adres yok** — her yerde sadece `ESENLER / İSTANBUL` yazıyor (`iletisim.html:109`, `gizlilik.html:71`, `mesafeli-satis.html:85`). 6563 sayılı kanun ve Mesafeli Satış Yönetmeliği **tam adres** ister: mahalle, cadde/sokak, no, kat/daire, posta kodu.
   `on-bilgilendirme.html:60` daha da belirsiz: *"Adres: Online satış · Türkiye geneli kargo"* — bu geçersiz.

2. **Ticaret Sicil No + sicil müdürlüğü hiçbir yerde yok.**

3. **ETBİS karekodu boş:** `iletisim.html:120`'de `placeholder="ETBİS karekodunu buraya bırakın"` duruyor. ETBİS kaydını yaptır, karekod görselini yükle. (Yasal zorunluluk.)

4. **Müşteriye görünen "hukukçuya onaylat" uyarıları var, yayına çıkmadan kaldırılmalı:**
   - `mesafeli-satis.html:147`
   - `degisim-iptal.html:118`

---

## 6. Kargo — API entegrasyonu yok, elle yönetiliyor

Şu anki durum:
- **Kargo ücreti `0` olarak sabit kodlanmış**, koşulsuz ücretsiz. Ücretli kargoya veya "X TL üzeri ücretsiz" eşiğine geçersen **kod değişikliği gerekir** (`paytr-token` + sipariş özeti birlikte).
- **"Kargo bedava" kuponu bilinçli olarak no-op** — admin panelinde seçenek görünüyor ama bir şey yapmıyor (kargo zaten bedava olduğu için).
- **Kargo firması API'si yok.** Takip no ve firma adı `admin-siparisler.html`'den elle giriliyor (veya Excel/CSV/OCR ile toplu).
- **Takip linki üretilmiyor** — müşteriye sadece takip numarası metni gösteriliyor, tıklanabilir link yok.

Senden gerekenler:
| Ne | Not |
|---|---|
| Anlaşmalı kargo firması teyidi | `hizmetler.html:69` **"Aras Kargo'ya teslim edilir"** diye taahhüt ediyor. Gerçek firma bu mu? |
| Kargo ücret politikası kararı | Bedava kalacak mı, eşik mi olacak? Eşik istersen kod yazmam gerek. |
| İade/değişim kargo adresi | `EXCHANGE_RETURN_ADDRESS` secret'ı. **Boş olduğu için chat şu an müşteriye iade adresi veremiyor**, "ekip iletecek" deyip geçiyor. |

Kargo firması API'si (otomatik takip no çekme, tıklanabilir takip linki) istersen ayrıca geliştirme işi — söyle.

---

## 7. WhatsApp — dolu, sadece teyit gerekiyor

Numara her yerde tutarlı: **`+90 850 255 12 37`**

Bulunduğu yerler: `ej.js:378`, `ej-beden.js:16`, `backend/functions/chat/index.ts:65` ve ~20 HTML footer'ı.

**Teyit et:** 0850 sanal santral numarası — WhatsApp Business hesabı gerçekten bu numaraya bağlı mı? Değilse numara değişecek ve 3 JS/TS sabiti + ~20 HTML güncellenmeli (merkezi config yok, istersen tek yere toplayayım).

WhatsApp Business **API** entegrasyonu yok, sadece link. (Otomatik sipariş bildirimi vb. isteniyorsa ayrı iş.)

---

## 8. Sosyal medya — dolu, teyit et

- Instagram: `https://www.instagram.com/esse_jeffe/`
- TikTok: `https://www.tiktok.com/@esse_jeffe`
- Facebook: `https://www.facebook.com/essejeffe.tr`

Bunlar footer'larda ve `index.html:33` JSON-LD `sameAs` dizisinde. **Bu hesapların gerçekten açık olduğunu doğrula** — yoksa Google'a yanlış sinyal gider.

---

## 9. Diğer secret'lar (opsiyonel / varsayılanı var)

| Secret | Durum | Not |
|---|---|---|
| `GEMINI_API_KEY` | **zorunlu** | Yoksa chat + toplu sipariş OCR çalışmaz |
| `CART_CRON_SECRET` | ✅ girilmiş, cron 200 dönüyor | Eski dokümanda "bekliyor" yazıyor, o bilgi eski |
| `EDGE_ALLOWED_ORIGINS` | prod domain'e çevir | |
| `CHAT_ALLOWED_ORIGINS` | prod domain'e çevir | |
| `SENTRY_DSN` | opsiyonel | Girilmezse hata izleme yok |
| `CODRISK_HOLD` / `CODRISK_HOLD_MIN` | varsayılan açık | COD risk eşiği |
| `WELCOME_DISCOUNT_PERCENT` | varsayılan 10 | Hoş geldin kuponu % |
| `CART_DISCOUNT_PERCENT` | varsayılan 10 | Sepet hatırlatma kuponu % |
| `STOCK_ALERT_THRESHOLD` | varsayılan 3 | Kaç adet kalınca uyarı |
| `LOYALTY_STEP_PERCENT` | varsayılan 5 | Sadakat puanı % |
| `GEMINI_MODEL` | varsayılanı var | |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` otomatik gelir, girmene gerek yok.

---

## 10. Küçük notlar

- **Bülten unsubscribe mekanizması yok.** ETK/KVKK gereği pazarlama bülteni atmadan önce eklenmeli — kod işi, söyle yazayım.
- **`sitemap.xml`'de ürün slug'ları elle listelenmiş** (pera, asos, efes, karya, likya, side, truva, milet, lidya). Katalog değişince elle güncelle veya otomatikleştirelim.
- **29 dosya commit edilmemiş durumda** — yayına çıkmadan önce commit'le.
- `ej.js:559-572`'de backend öncesinden kalma WhatsApp sipariş fallback'i var; backend hazır olduğu için bu ölü yol temizlenebilir.

---

## Sıralama (bağımlılığa göre)

1. **Domain al** — diğer her şeyin önkoşulu
2. **Gerçek IBAN → `ORDER_BANK_INFO`** — havale müşteriye zaten vaat edilmiş, şu an ödeme yapılamıyor
3. **Resend domain doğrula** (SPF/DKIM/DMARC) — tek hamlede 6 e-posta sistemi açılır
4. **PayTR 3 anahtar + bildirim URL** → sonra `PAYTR_TEST_MODE=0`
5. **GA4 + Meta Pixel ID** → reklam ölçümü başlar
6. **Yasal:** tam adres + ticaret sicil no + ETBİS karekodu + hukukçu uyarı kutularını kaldır
7. `EXCHANGE_RETURN_ADDRESS`, `EDGE_ALLOWED_ORIGINS`, `CHAT_ALLOWED_ORIGINS`, `SENTRY_DSN`
8. Kargo firması teyidi + ücret politikası kararı
