# Esse Jeffe — UI/UX İnceleme Raporu

**Tarih:** 2026-07-09
**Kapsam:** Satın alma hunisi, formlar, mobil, erişilebilirlik, geri bildirim/boş durumlar, tutarlılık, performans algısı, güven sinyalleri, e-ticaret kalıpları.

---

## EN DEĞERLİ 5 İYİLEŞTİRME (öncelik sırası)

1. **Mobil dokunma hedeflerini 44px'e çıkarın** (`ej.css:51`, `:427`) — en yaygın kullanıcı olan mobil alışverişçinin sepet/menü/hesap erişimini doğrudan iyileştirir, düşük maliyet.
2. **Ürün kartı bağlantılarını slug ile düzeltin** (`index.html:178,191`; `koleksiyon.html:66-74`) — koleksiyon→ürün hunisi statik halde kırık; yanlış ürün sayfası dönüşümü öldürür.
3. **Checkout'a zorunlu Mesafeli Satış / Ön Bilgilendirme onayı ekleyin** (`sepet.html:130`) — yasal zorunluluk + güven; eksikliği ciddi risk.
4. **Checkout form doğrulamasını alan-bazlı + erişilebilir yapın** (`sepet.html:337`) — telefon/e-posta format kontrolü, inline hata, hatalı alana focus, `aria-live`; terk oranını düşürür.
5. **Genel geri bildirim: toast + `aria-live` ve şifre göster/gizle** (`ej.js:596`, `ej-supabase.js:452`, `giris.html:39`) — sepete eklendi/hata/başarı durumlarını hem görsel hem ekran okuyucu için duyurur.

---

## YÜKSEK ETKİ

### 1. Mobil dokunma hedefleri çok küçük (WCAG ihlali)
`ej.css:51-52` — Header ikonları (Ara, Hesap, Sepet) `22px`, iç SVG `19px`; `ej.css:427` hamburger `30px`. WCAG 2.5.5 minimum 44×44px önerir. Mobilde en kritik işlevlere parmakla isabet ettirmek zor; yanlış dokunuşlar hunide sürtünme yaratır.
**Öneri:** `.icon` ve `.hamburger` için `min-width:44px;min-height:44px` (görsel boyut sabit kalabilir, tıklama alanı padding ile büyütülür).

### 2. Ürün kartı bağlantıları tutarsız ve slug taşımıyor — huni kırık
`index.html:165` Pera → `urun.html`; ama `index.html:178` (Karya) ve `:191` (Efes) → `koleksiyon.html`. `koleksiyon.html:66-74` tüm kartlar `href="urun.html"` (slug yok). Statik halde her kart aynı sabit "Pera" sayfasını açar. Supabase aktifken `renderGrids` slug basıyor; ama DB gecikir/kapalıysa geçiş yanlış ürüne gider.
**Öneri:** Tüm statik kartlara `urun.html?slug=<slug>`; index'teki iki kartı da ürün sayfasına yönlendirin.

### 3. Checkout'ta yasal onay kutuları eksik (Mesafeli Satış / Ön Bilgilendirme)
`sepet.html:100-134` — Sipariş formunda yalnızca teslimat + ödeme alanları var; **Mesafeli Satış Sözleşmesi ve Ön Bilgilendirme Formu onay checkbox'ı yok**. Kayıt formunda KVKK onayı var (`kayit.html:42`) ama sipariş anında zorunlu onay yok. Mesafeli Sözleşmeler Yönetmeliği gereği zorunlu; hem yasal hem güven riski.
**Öneri:** "Siparişi Ver" üstüne, işaretlenmeden submit engelleyen zorunlu onay kutusu (sözleşme linkleriyle).

### 4. Checkout form doğrulaması yüzeysel; erişilebilir hata bildirimi yok
`sepet.html:337-341` — `novalidate` ile HTML5 doğrulama kapalı, JS yalnızca boşluk kontrolü yapıyor. Telefon/e-posta format kontrolü yok; alan-bazlı (inline) hata yok, hatalı alana `aria-invalid`/otomatik focus yok. `.form-err` (`sepet.html:132`) `aria-live` taşımadığından ekran okuyucuya duyurulmuyor.
**Öneri:** Alan-bazlı inline hata + ilk hatalı alana focus, telefon (10 hane) ve e-posta regex kontrolü, `.form-err`'e `role="alert"`/`aria-live="polite"`.

### 5. Geri bildirim mesajları ekran okuyucuya sessiz (aria-live yok)
`sepet.html:132` (formErr), `giris/kayit/sifre-yenile` `#authMsg` (`ej-supabase.js:452-454`), `siparis-takip.html:46` (trkErr), `iletisim.html:67` (#sent) — hepsi görünür metin ama `aria-live`/`role` yok. Sepete eklemede yalnızca görsel `flyToCart` + panel açılışı var (`ej.js:596`); metinsel/ARIA duyuru ve genel toast sistemi yok.
**Öneri:** Durum mesajı kaplarına `role="status"`/`aria-live`; sepete eklemede görünmez canlı bölge ile "Pera sepete eklendi" duyurusu.

---

## ORTA ETKİ

### 6. Koleksiyon filtreleri işlevsiz
`koleksiyon.html:104-110` — Filtre butonları yalnızca `aria-pressed` toggle ediyor, ürünleri filtrelemiyor. Kullanıcı "İndirimde"/"Askılı" seçer, hiçbir şey değişmez — yanıltıcı.
**Öneri:** Kartlara `data-cat` verip JS ile gerçekten filtreleyin veya boş sonuç durumu gösterin.

### 7. Şifre göster/gizle yok
`giris.html:39` (logPass), `kayit.html:41` (regPass), `sifre-yenile.html:39-40`. Parola alanlarında görünürlük toggle'ı yok — mobilde yanlış girişi artırır.
**Öneri:** Alan içine göz ikonu ile show/hide. `autocomplete` değerleri zaten doğru (`current-password`/`new-password`), korunmalı.

### 8. Odak (focus) görünürlüğü zayıf ve tutarsız
`ej.css:171` inputlarda `outline:none`, tek gösterge hafif `border-color` (`ej.css:172`) — düşük kontrast. `.btn`, `.icon`, `.nav a` için özel focus stili yok; `:focus-visible` hiç tanımlı değil. Klavye kullanıcısı konumunu göremeyebilir.
**Öneri:** Global `:focus-visible{outline:2px solid var(--ink);outline-offset:2px}` ve inputlarda görünür focus halkası.

### 9. Sepet paneli auth linkleri bazı sayfalarda boş (`href="#"`)
`index.html:384-385`, `sepet.html:184-185`, `urun.html:514-515`, `koleksiyon.html:126-127`, `odeme.html:102-103`, `iletisim.html:138-139` → "Giriş Yap"/"Üye Ol" `href="#"`. Oysa `giris/kayit/siparis-takip/sifre-yenile`'de doğru hedefler var. Tutarsız; boş sepette girişe yönlendirme kopuk.
**Öneri:** Tümünü `giris.html`/`kayit.html`'e sabitleyin.

### 10. Eksik e-ticaret kalıpları: favori/istek listesi ve stok göstergesi yok
Site genelinde wishlist yok. Ürün bedenleri (`urun.html:222-229`) her zaman seçilebilir; "tükendi/son X adet" durumu yok. Renk atlıkarıncasında stok bilgisi yok. Aciliyet ve geri-dönüş motivasyonu kayboluyor.
**Öneri:** Kalpli favori butonu (localStorage) + beden bazlı stok/"tükendi" pasif durumu.

### 11. Footer içeriği sayfadan sayfaya tutarsız
`index.html:263-264`, `odeme.html:77-78`, `urun.html:354-355`, `sepet.html:162`, `giris.html:58` — Beden Rehberi/Çerez/Ön Bilgilendirme blokları ve Kurumsal listesi sayfadan sayfaya değişiyor. Aynı footer'ın 3-4 sürümü dolaşıyor.
**Öneri:** Tek footer parçasına indirgeyin (include/şablon) veya elle senkronlayın.

### 12. Hero görsellerinde alt metni boş, koyu overlay kontrastı sınırda
`index.html:116,134,139` hero `alt=""`. `index.html:24` hero etiketi `rgba(255,255,255,.78)` küçük punto + değişken görsel üstünde; overlay yardımcı oluyor ama alt kenarda kontrast düşebilir.
**Öneri:** Anlamlı `alt` ("Esse Jeffe 2026 abiye koleksiyonu"); label için biraz daha koyu overlay veya `text-shadow`.

---

## DÜŞÜK ETKİ

### 13. Fold-altı görsellerde lazy loading eksik
`index.html:210` (about.webp), `:223` (showcase.webp), `:228` (bordo-firfir.jpg) `loading` niteliği yok. Dinamik yerlerde iyi kullanılmış (arama `ej.js:322`, sepet swatch `ej.js:459`). Hero'nun eager kalması doğru (LCP).
**Öneri:** Fold-altı `<img>`lere `loading="lazy" decoding="async"`; hero'ya `fetchpriority="high"`.

### 14. Font yükleme (FOUT)
`display=swap` + `preconnect` var (iyi). Spectral için `preload` yok; ilk boyamada kısa FOUT görülebilir.
**Öneri:** Kritik ağırlık için `<link rel="preload" as="font">` (isteğe bağlı).

### 15. Güven rozetleri metinle sınırlı
`sepet.html:124,127,139` "Kart bilgilerin bize iletilmez / PayTR güvenli ekran" metni var (iyi) ama görsel SSL/PayTR/3D Secure rozeti yok.
**Öneri:** Checkout CTA yakınına küçük "PayTR · 256-bit SSL · 3D Secure" rozet şeridi.

### 16. "Skip to content" bağlantısı yok
Hiçbir sayfada içeriğe atlama linki yok; klavye kullanıcısı her sayfada nav'ı geçmek zorunda. Düşük ama kolay kazanım.

---

## ✅ İyi çalışan noktalar (korunmalı)

- Çift gönderim koruması: submit'te `btn.disabled=true` + metin değişimi (`sepet.html:361,380`; `ej-supabase.js:456`).
- Loading state metinleri ("Gönderiliyor...", "Sorgulanıyor...", "Güvenli ödemeye yönlendiriliyor...").
- Boş durumlar: boş sepet (`sepet.html:82`), arama sonuç yok (`ej.js:339`), sipariş bulunamadı (`siparis-takip.html:154`).
- Sipariş sonrası onay ekranı: sipariş no + takip linki + e-posta notu (`sepet.html:89-96`).
- Beden rehberi ürün sayfasından erişilebilir (drawer, `urun.html:221,275`) + beden seçilmeden sepete eklemeyi engelleyen modal (`urun.html:489`, `ej.js:562`).
- Form autocomplete doğru: `email`, `current-password`, `new-password`, `name`, `tel`.
- Input `type` doğru: `tel`, `email` her yerde.
- Honeypot spam koruması (`index.html:247`, `iletisim.html:45`).
- KVKK çerez bandı + kayıt KVKK onayı (`index.html:301`, `kayit.html:42`).
- `lang="tr"` ve viewport meta tüm sayfalarda mevcut.
