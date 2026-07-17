# Esse Jeffe — Eklentiler (Özellik Fikirleri)

**Tarih:** 2026-07-15
**Durum:** Fikir havuzu — hiçbiri başlanmadı. Hepsi mevcut mimariyle (statik HTML + Supabase + Resend + PayTR) yapılabilir, dış bağımlılık gerektirmez.
**Kaynak:** Shopify karşılaştırması sonrası çıkan öneri listesi.

---

## 1. Dönüşümü doğrudan artıranlar

### WhatsApp entegrasyonu
- **Ne:** Sipariş onayı / kargo bildirimi WhatsApp'tan; resmi WhatsApp Business API veya basit `wa.me` danışma butonu.
- **Neden:** Türkiye'de e-postadan çok daha yüksek açılma oranı.
- **Nasıl:** Kolay yol: sitede `wa.me` butonu (yalnız frontend). İleri yol: sipariş e-postası gönderen edge function'lara (create-order, chat) WhatsApp Business API çağrısı eklenir.
- **Efor:** Buton = çok küçük; API entegrasyonu = orta (API onay süreci dahil).

### Müşteri fotoğraflı yorumlar
- **Ne:** Yorum sistemine Supabase Storage ile fotoğraf yükleme.
- **Neden:** Abiyede "gerçek kişide nasıl duruyor" en güçlü satış argümanı.
- **Nasıl:** `reviews` tablosu + Storage bucket + RLS ("yalnız o ürünü satın almış üye yazabilir"); `urun.html`'de listeleme. Not: önce düz yorum sistemi kurulmalı, fotoğraf onun üstüne gelir.
- **Efor:** Orta-büyük (yorum sistemiyle birlikte).

### Beden asistanı — ✅ YAPILDI (2026-07-16)
- **Ne:** `beden-rehberi.html`'i pasif tablodan interaktife çevirme: boy/kilo/ölçü gir → beden önerisi.
- **Neden:** İade/değişim oranını düşürür; abiyede beden tereddüdü en büyük satın alma engeli.
- **Nasıl yapıldı:** `ej-beden.js` (paylaşımlı; eşikler kilo + ölçü tablolarıyla birebir). `beden-rehberi.html`'de tablo üstünde form; `urun.html`'de "Beden Rehberi →" çekmecesinin en üstünde, "Bu Bedeni Seç" gerçek beden butonunu işaretleyip çekmeceyi kapatır. Tablo dışı değerler WhatsApp'a yönlendirir; önerilen beden tabloda vurgulanır.

### Son görüntülenenler + "bunu alanlar buna da baktı" — ✅ YAPILDI (2026-07-16)
- **Ne:** Ürün sayfasında son gezilen ürünler şeridi + ilişkili ürün önerisi (Shopify recommendation karşılığı).
- **Nasıl yapıldı:** Son görüntülenenler `urun.html`'de zaten vardı (`ej_recent` localStorage); ürün görseli eklendi (yalnız https / `img/` kaynaklarına izin verilir). İlişkili ürünler: katalog küçük olduğundan `order_items` sorgusu yerine `ejRelated()` — canlı katalog `EJData.products()` ile çekilir, aynı kategori (+2) > ortak renk (+1) > yakın fiyat puanlamasıyla ilk 6 ürün `cardHTML` ile basılır. DB yoksa statik kartlar kalır. Katalog büyüyüp sipariş verisi birikince birlikte-satın-alma RPC'sine geçilebilir.

---

## 2. Geri dönüş ve sadakat

### Fiyat düşünce haber ver — ✅ YAPILDI (2026-07-16)
- **Ne:** Ürün sayfasından e-posta bırak → fiyat düşünce otomatik bildirim.
- **Nasıl yapıldı:** `price_alerts` tablosu + yeni `price-alert` EF (subscribe /
  saatlik cron taraması / unsub linki; cron kimliği mevcut `CART_CRON_SECRET`
  ile). `urun.html`'de "Fiyatı düşünce haber ver" formu (yalnız canlı katalog
  ürününde görünür), `EJData.priceAlert`. Bildirim tek seferlik; yeniden
  kayıt alarmı güncel fiyatla sıfırlar. Ayrıntı:
  `backend/fiyat-alarmi-hosgeldin-kurulum.md`.

### İlk sipariş kuponu + bülten kaydı — ✅ YAPILDI (2026-07-16)
- **Ne:** E-posta topla (footer/pop-in formu) → otomatik tek kullanımlık hoş geldin kuponu gönder.
- **Nasıl yapıldı:** submit-form EF, İLK bülten kaydında e-postaya bağlı,
  30 gün geçerli, tek kullanımlık `HOSGELDIN-…` kodu üretip (kind='single',
  `WELCOME_DISCOUNT_PERCENT`, varsayılan %10) Resend ile yollar; tekrar kayıt
  kupon üretmez. `newsletter_subscribers.welcome_code_id/welcome_sent_at`
  izleme kolonları. Ayrıntı: `backend/fiyat-alarmi-hosgeldin-kurulum.md`.

### Sadakat puanı / davet indirimi
- **Ne:** Sipariş başına puan birikimi; "arkadaşını getir" davet kuponu.
- **Nasıl:** Mevcut kupon RPC'lerinin üstüne kurulur: puan tablosu + sipariş tamamlanınca tetiklenen ekleme + puanı kupona çevirme RPC'si.
- **Efor:** Orta-büyük (kural tasarımı dahil).

---

## 3. Operasyon / güven

### Sipariş durumu zaman çizelgesi — ✅ YAPILDI (2026-07-17)
- **Ne:** `siparis-takip.html`'de görsel adımlar: hazırlanıyor → kargoda → teslim; her adım değişiminde otomatik e-posta.
- **Nasıl yapıldı:** Takip sayfasına 4 adımlı timeline (`trk-timeline`; iptalde
  uyarı kutusu). Yeni `order-status-email` EF (verify_jwt açık + `is_admin`
  kontrolü): admin-siparisler durum kaydedince çağırır; müşteriye durum
  e-postası (kargodaysa firma + takip no dahil). Çift gönderim koruması
  `orders.last_status_emailed` atomik claim'i ile. Ayrıntı:
  `backend/siparis-durum-degisim-stok-kurulum.md`.

### Değişim talebi formu — ✅ YAPILDI (2026-07-17)
- **Ne:** `degisim-iptal.html` politika sayfasını self-servis akışa çevirme: sipariş no + neden seç → admin'e düşer.
- **Nasıl yapıldı:** `exchange_requests` tablosu + submit-form EF'ye
  `kind='exchange'` (sipariş no + telefon İKİSİ eşleşmeli — track-order
  deseni; honeypot + IP hız sınırı; mükerrer açık talep engeli).
  `degisim-iptal.html`'e form (değişim/iptal + neden + açıklama),
  `EJData.exchangeRequest`. Talepler admin-siparisler detayında listelenir
  (durum: Yeni/İşlemde/Kapatıldı), listede "Talep var" rozeti; işletmeye
  bildirim e-postası gider. Yalnız değişim/iptal sunulur (iade yok).

### Stok azalınca admin uyarısı — ✅ YAPILDI (2026-07-17)
- **Ne:** Eşik altına düşen ürün/beden için günlük özet e-postası.
- **Nasıl yapıldı:** Yeni `stock-alert` EF (yalnız cron; `CART_CRON_SECRET`) —
  `track=true` ve stok ≤ eşik (`STOCK_ALERT_THRESHOLD`, varsayılan 3) varyantları
  ürün bazında gruplayıp `ORDER_NOTIFY_EMAIL`'e tek özet yollar; TÜKENDİ
  vurgulanır, boş listede e-posta çıkmaz. pg_cron `stock-alert-daily`
  (05:15 UTC = 08:15 TR).

### Kapıda ödeme risk kontrolü — ✅ YAPILDI (2026-07-17)
- **Ne:** Aynı telefonla tekrarlanan iptal geçmişi olan COD siparişlerini admin-siparisler'de işaretleme + eşik aşımında "Onay bekliyor" bekletmesi.
- **Neden:** COD'un en büyük zararını (teslim almama) keser.
- **Nasıl yapıldı:** `codrisk_signals` RPC (normalize telefonla son 180 günde iptal/teslim/açık COD sayısı) + `_shared/cod-risk.ts` saf skorlama (create-order, COD'da insert öncesi çağırır; fail-soft) → `orders.risk_*` snapshot kolonları. Admin'de "Riskli/Dikkat/Onay bekliyor" rozetleri, "Riskli" filtresi, detayda Risk kartı + "Onayı kaldır". Kurulum: `backend/cod-risk-kurulum.md`. Ürünleşme yol haritası: `docs/PLAN-kapida-risk-urun.md`.

---

## 4. Vitrin cilası

| Özellik | Not | Efor |
|---------|-----|------|
| Ürün videosu / 360° görsel | Supabase Storage'da video, `urun.html` galerisine ekleme | Orta |
| "Yakında gelecek" koleksiyon ön kaydı | Yeni koleksiyon sayfası + e-posta bırakma (bülten altyapısıyla ortak) | Küçük |
| Instagram akışı bölümü | API yerine statik yenilenen görsellerle (elle/script'le güncellenen grid) | Küçük |

---

## Bağımlılık notları

- **Fotoğraflı yorumlar** → önce düz yorum sistemi gerekir.
- **Fiyat alarmı / bülten / ön kayıt / stok uyarısı** → hepsi aynı cron + Resend desenini paylaşır; fiyat alarmı + bülten kuponu yapıldı (2026-07-16) → ön kayıt ve stok uyarısı artık bu deseni kopyalar.
- **Sadakat / hoş geldin kuponu** → mevcut kupon sistemine (`kupon-sistemi.md`) dayanır.
