# Prod Öncesi E-posta Planı — Domain + Resend Doğrulama

**Tarih:** 2026-07-17
**Durum:** Beklenen/planlı eksik — site henüz yayında değil, domain açılmadı,
kurumsal mail yok. **Prod'a çıkmadan önce bu plan tamamlanmalı.**

## Mevcut durum

Resend hesabı **test modunda**: domain doğrulanmadığı için yalnız hesap
sahibinin adresine (ilkeberkkutluk@hotmail.com) gönderim yapılabiliyor.
Fiyat alarmı canlı testinde tespit edildi (Resend 403, 2026-07-17).

Kod tarafı **tamamen hazır** — hiçbir kod değişikliği gerekmiyor. Domain
doğrulanıp tek bir secret güncellenince tüm e-posta sistemleri kendiliğinden
çalışmaya başlar.

### Etkilenen sistemler (hepsi aynı Resend + ORDER_FROM_EMAIL'i kullanır)

| Sistem | E-posta | Şu an |
|---|---|---|
| Sipariş onayı (create-order / paytr-callback) | müşteri + işletme bildirimi | ❌ yalnız sahibine gider |
| Sepet hatırlatma (cart-reminder cron) | indirim kodlu hatırlatma | ❌ |
| Hoş geldin kuponu (submit-form) | HOSGELDIN-… kodu | ❌ |
| Fiyat alarmı (price-alert cron) | fiyat düştü bildirimi | ❌ |

Cron'ların 200 dönmesi teslimat demek değildir; gönderim hatası loglanır ve
(sepet/alarm akışlarında) claim geri alınıp sonraki koşuda yeniden denenir —
yani domain doğrulanınca bekleyen alarmlar kendiliğinden gitmeye başlar.

## Plan — sırayla

### 1. Domain (prod kararıyla birlikte)
- `essejeffe.com` (veya seçilecek alan adı) satın al.
- DNS yönetiminin erişilebilir olduğundan emin ol (kayıt firmasının paneli
  veya Cloudflare).

### 2. Resend domain doğrulama
1. [resend.com/domains](https://resend.com/domains) → **Add Domain** →
   `essejeffe.com` (bölge: EU önerilir).
2. Resend'in verdiği DNS kayıtlarını sağlayıcıya gir:
   - **SPF** (TXT, ör. `send` subdomain'i) — Resend'in gönderim yetkisi
   - **DKIM** (TXT, `resend._domainkey…`) — imza doğrulama
   - (Varsa) **MX** kaydı — bounce yönetimi için Resend'in istediği değer
3. Panelde **Verify** → durum "Verified" olana kadar bekle (DNS yayılımı
   birkaç dakika–birkaç saat).
4. **DMARC** ekle (Resend zorunlu tutmaz ama teslimat oranı için önemli):
   `_dmarc` TXT → `v=DMARC1; p=none; rua=mailto:ilkeberkkutluk@hotmail.com`
   (ilk ay `p=none` ile izle, sonra `p=quarantine`e sıkılaştır).

### 3. Supabase secret güncellemeleri
Dashboard → Edge Functions → Secrets:

| Secret | Yeni değer |
|---|---|
| `ORDER_FROM_EMAIL` | `Esse Jeffe <siparis@essejeffe.com>` (doğrulanan domain'den olmak ZORUNDA) |
| `SITE_URL` | `https://essejeffe.com` (maillerdeki linklerin tabanı) |
| `EDGE_ALLOWED_ORIGINS` | `https://essejeffe.com,https://www.essejeffe.com` (CORS) |
| `ORDER_NOTIFY_EMAIL` | işletme bildirim adresi (kurumsal kutu açılınca `info@essejeffe.com`) |

Not: Gönderim için posta kutusu GEREKMEZ — Resend doğrulanmış domain'den
kutu olmadan gönderir. Müşteri **yanıtları** alabilmek için ayrı adım (4).

### 4. Kurumsal posta kutusu (alma yönü)
- Sitede `info@essejeffe.com` yazıyor ve sipariş maillerinde reply-to müşteriye
  yönlendiriliyor; müşterilerin yanıt yazabileceği gerçek bir kutu gerekli.
- Seçenekler: Google Workspace (~aylık ücretli), Zoho Mail (küçük ekipler için
  ücretsiz katman), kayıt firmasının mail servisi.
- MX kayıtları bu sağlayıcıya bakar; Resend'in SPF/DKIM kayıtlarıyla çakışmaz
  (Resend gönderimi genelde `send.essejeffe.com` alt alanından yapar).

### 5. Bültenden çıkış (unsubscribe) — pazarlama maili öncesi ZORUNLU
- Şu an bülten listesinden çıkış mekanizması yok. Hoş geldin maili tek seferlik
  işlem maili olduğu için sorun değil; ama **düzenli kampanya bülteni atılmaya
  başlanmadan önce** eklenmeli (ETK/KVKK).
- Desen hazır: price-alert'in `?unsub=<token>` yaklaşımı `newsletter_subscribers`e
  token kolonu eklenerek kopyalanır. (Küçük iş; istenince yapılır.)

### 6. Doğrulama testleri (domain onayı sonrası, ~10 dk)
```bash
# 1) Hoş geldin kuponu — sahibi DIŞINDA bir adresle (örn. gmail):
curl -X POST https://grdinhjtsmoograktgge.supabase.co/functions/v1/submit-form \
  -H "Content-Type: application/json" \
  -d '{"kind":"newsletter","email":"<test-gmail>"}'
# beklenen: {"ok":true,"coupon":true} + mail gelen kutusunda

# 2) Fiyat alarmı — alarm kur, fiyatı düşür, taramayı tetikle:
curl -X POST .../functions/v1/price-alert \
  -d '{"action":"subscribe","slug":"pera","email":"<test-gmail>"}'
# SQL: update products set price = price - 100 where slug='pera';
# cron'u bekle veya x-cron-secret ile tetikle → sent:1 beklenir
# SQL: fiyatı geri al.

# 3) Sipariş onayı — sitede test COD siparişi ver, müşteri + işletme maili düşmeli.
```
Mailin spam'e düşmediğini ve SPF/DKIM/DMARC'ın "pass" olduğunu kontrol et
(Gmail'de "mesaj kaynağını göster").

## Özet kontrol listesi (prod kapısı)

- [ ] Domain alındı, DNS erişimi var
- [ ] Resend'de domain **Verified** (SPF + DKIM), DMARC eklendi
- [ ] `ORDER_FROM_EMAIL` doğrulanan domain'e çevrildi
- [ ] `SITE_URL` + `EDGE_ALLOWED_ORIGINS` prod URL'lerine çevrildi
- [ ] Kurumsal kutu (info@) açıldı, `ORDER_NOTIFY_EMAIL` güncellendi
- [ ] 6. bölümdeki üç test geçti (sahibi dışında adrese teslim + SPF/DKIM pass)
- [ ] (Pazarlama bülteni öncesi) bülten unsubscribe mekanizması eklendi
