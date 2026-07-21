# Cihaz Uyumluluğu (Responsive) Raporu ve Yol Haritası

> Amaç: Siteyi telefon, tablet ve masaüstü dahil her ekran boyutunda düzgün
> çalışır hale getirmek. Bu belge mevcut durumu ölçer, "yeni arayüz gerekiyor mu?"
> sorusunu yanıtlar ve yapılacakları öncelik sırasıyla listeler.
> Tarih: 2026-07-21 · Durum: Rapor (henüz uygulama yapılmadı)

---

## Özet: Sanıldığından iyi durumdayız

Site "bilgisayar için yapıldı" endişesiyle incelendi. **Yeni arayüz gerekmiyor,
sıfırdan tasarım gerekmiyor.** Site zaten modern ve büyük ölçüde responsive bir
temel üzerine kurulu:

- **31 HTML sayfasının tamamında** `<meta name="viewport">` var → mobil ölçekleme çalışıyor.
- Yerleşim `float`/`absolute` değil, **grid + flexbox** ve kesirli birimlerle (`1fr`) → küçük ekranda temiz akıyor.
- Başlıklar `clamp()` ile viewport'a göre küçülüyor (akışkan tipografi).
- **Hamburger menü, mobil çekmece menü, arama katmanı** JS ile enjekte ediliyor (`ej.js`).
- Ürün ızgarası doğru kırılıyor: 3 kolon → 2 (≤900px) → 1 (≤560px).
- Ödeme sayfası (`sepet.html`) ve gerçek sohbet widget'ı (`ej-chat.js`) telefonda düzgün.

**Gerçek durum:** Site ~%80 responsive. Gereken şey birkaç bozuk noktayı düzeltmek
ve dokunmatik (touch) kullanımı iyileştirmek — sistemi yeniden kurmak değil.

---

## Cihaz stratejisi: Nasıl "her cihaza uyumlu" oluyoruz?

Ayrı telefon/tablet/masaüstü **sürümleri yapmıyoruz.** Tek bir akışkan (fluid)
yerleşim var; belirli **kırılma noktalarında (breakpoint)** yeniden düzenleniyor.
Mevcut sistem:

| Kırılma | Ne oluyor |
|---|---|
| `≤900px` (tablet/telefon) | Menü → hamburger, ızgara 3→2 kolon, bölünmüş bloklar tek kolona iner |
| `≤560px` (küçük telefon) | Izgara → 1 kolon, form alanları tek kolon |
| `≤480px` (dar telefon) | Sohbet paneli tam ekran sayfa olur |

Bu yaklaşım doğru. Hedef: bu sistemdeki **boşlukları kapatmak** (özellikle
560–900px tablet aralığı ve dokunmatik hedefler), yeni sistem kurmak değil.

Hedef test genişlikleri: **375px** (telefon) · **768px** (tablet) · **1280px** (masaüstü).

---

## BÖLÜM 1 — Kritik telefon hataları (önce bunlar)

Telefonda gözle görülür bozukluk / kullanılamazlık. En yüksek öncelik.

### 1.1 "Sepete Ekle" butonu dokunmatikte ölü (`.card .add`)
- **Sorun:** Ürün kartındaki buton yalnızca `:hover` ile beliriyor
  ([ej.css:128-129](../ej.css#L128)). Telefonda hover yok → buton **hiç görünmüyor**;
  sadece karta dokununca ürün sayfası açılıyor. Hızlı-ekle özelliği touch'ta kayıp.
- **Çözüm:** `≤900px` içinde `.card .add`'i kalıcı görünür yap
  (`transform:none; position:static`) — kartın altında sabit buton. Masaüstünde
  mevcut hover animasyonu korunur.

### 1.2 Hızlı sepet çekmecesi telefonda taşıyor (`.bag-panel`)
- **Sorun:** Çekmece `right:40px`'e sabit ([ej.css:291-302](../ej.css#L291)); 375px'de
  sol kenarından ~8px kırpılıyor, `top:90px` boş alan bırakıyor. Mobil kuralı yok.
- **Çözüm:** `≤560px` için alttan çıkan tam-genişlik sayfa (bottom sheet) yap:
  `left:0;right:0;bottom:0;top:auto;width:auto;max-height:85vh;border-radius:16px 16px 0 0`.
  Miktar butonlarını (`.bag-step` 22px → 36px, [ej.css:327](../ej.css#L327)) büyüt.

### 1.3 index.html / demo.html'de ÇİFT sohbet butonu
- **Sorun:** İki ayrı sohbet var: (a) `ej-chat.js`'in enjekte ettiği **çalışan**
  widget (`#ejChatBtn`), (b) `index.html`'e gömülü **statik demo** widget
  (`.chat-fab`/`.ej-chat`, [index.html:340-364](../index.html#L340)). Sayfa
  kaydırılınca ikisi de sağ-altta belirip **üst üste biniyor**; statik olanın
  telefon tam-ekran kuralı da yok.
- **Çözüm:** `index.html` ve `demo.html`'deki statik `.chat-fab`/`.ej-chat` markup'ını
  ve süren inline script'i ([index.html:383-399](../index.html#L383)) **kaldır**;
  her yerde tek gerçek widget (`ej-chat.js`) kalsın. Hem responsive hem mükerrer
  buton sorununu çözer.

### 1.4 Ürün modalında beden butonları taşabiliyor (`.pd-modal-sizes`)
- **Sorun:** `flex-wrap:nowrap` bedenleri tek satıra zorluyor
  ([urun.html:153](../urun.html#L153)); çok bedenli üründe dar ekranda yatay taşma.
- **Çözüm:** `flex-wrap:wrap`.

---

## BÖLÜM 2 — Dokunmatik hedef ve tablet cilası (tam yol haritası)

Kritik değil ama "her cihazda iyi hissettiren" farkı bunlar yaratır.
Dokunmatik hedef rehberi: **min 44×44px**.

### 2.1 Küçük dokunmatik hedefleri büyüt (tek `≤900px` bloğunda)
- `.card-fav` favori kalbi 36px → 44px ([ej.css:32](../ej.css#L32)).
- `.mega-arr` karusel okları 36px → 44px ([ej.css:429](../ej.css#L429)).
- `.bag-step` / `.bag-rm` gibi minik metin/kontrol düğmelerine dokunmatik dolgu.

### 2.2 Tablet aralığı (560–900px) boşluğu
- 700–900px'de bazı bloklar (`hero min-height:620px`, `.split min-height:600px`)
  **boş dikey bant** bırakabiliyor. `min-height`'leri `clamp()`/`auto`'ya çek.
- İsteğe bağlı ~680px ara kırılması ile ızgaranın 2→1 geçişini yumuşat.

### 2.3 Global gutter/padding
- `.wrap` yan boşluğu 900px altında 40→24px iniyor; çok dar telefonlarda (≤380px)
  16px'e indirilebilir.

### 2.4 Genel doğrulama taraması
- Tüm ana sayfalarda 375px'de **yatay kaydırma (overflow-x) sıfır** olmalı.
- Hover'a bağlı görsel ipuçlarının dokunmatikte işlevsel karşılığı olsun.

---

## BÖLÜM 3 — Admin sayfaları (kapsam dışı, not)

Admin masaüstü öncelikli kalıyor. Zaten `.tblwrap{overflow-x:auto}` ile tablolar
yatay kayıyor, app-shell tek kolona iniyor → telefonda "acil durumda kullanılabilir".
Kart-düzeni dönüşümü ileride ayrı iş; bu turda yapılmayacak.

---

## Uygulama zamanı değiştirilecek dosyalar (özet)

| Dosya | Ne yapılacak |
|---|---|
| `ej.css` | Ana iş: `.card .add` mobil görünürlük, `.bag-panel` bottom-sheet, `.bag-step`/`.card-fav`/`.mega-arr` hedef büyütme, tablet `min-height` cilası |
| `index.html` | Statik `.chat-fab`/`.ej-chat` markup (340-364) + inline script (383-399) kaldır |
| `demo.html` | Aynı statik sohbet bloğu varsa kaldır |
| `urun.html` | `.pd-modal-sizes` → `flex-wrap:wrap` (153) |

**Notlar:**
- `ej.css` `?v=11` ile cache-bust'lı; değişiklikten sonra tüm sayfalardaki
  `ej.css?v=11` → `?v=12` (tarayıcı eski stili göstermesin).
- PowerShell'de dosya yazarken UTF-8 BOM tuzağına dikkat → `System.IO.File` API kullan.

---

## Doğrulama planı (gerçek cihaz boyutlarında)

`verify` skill'i (yerel sunucu + Playwright) ile:

1. Yerel statik sunucuyu başlat, siteyi aç.
2. Üç viewport'ta ekran görüntüsü + göz denetimi: **375×812**, **768×1024**, **1280×800**.
3. Denetlenecek sayfalar: `index.html`, `koleksiyon.html`, `urun.html`, `sepet.html`,
   `odeme.html`, `hesap.html`.
4. Kontrol listesi (her viewport):
   - [ ] Yatay kaydırma yok.
   - [ ] index'te tek sohbet butonu, taşma yok.
   - [ ] Çanta çekmecesi 375px'de kırpılmadan (bottom-sheet) açılıyor.
   - [ ] Kartta "Sepete Ekle" telefonda görünür ve tıklanabilir.
   - [ ] Hamburger menü açılıp kapanıyor; linkler büyük.
   - [ ] Beden/miktar butonları ≥44px, rahat dokunulabilir.
5. Kritik akış elle: ürün → sepete ekle → sepet → ödeme (375px'de).
