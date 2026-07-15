# Kampanya Kupon Sistemi

Kuruluş: 2026-07-15. Admin panelden yönetilen çok kullanımlı kampanya
kuponları + mevcut tek kullanımlık sepet hatırlatma kodlarının yönetimi.

## İki kod türü (`discount_codes.kind`)

| | `single` | `campaign` |
|---|---|---|
| Üretim | cart-reminder cron'u (SEPET-XXXXXX) | Admin panel (örn. YAZ20) |
| Kullanım | tek sefer (`used_at`) | çok kez; e-posta başına 1 (`coupon_redemptions`) |
| Kısıtlar | e-postaya bağlı, 72 saat | min. sepet tutarı, toplam limit (`max_uses`), son geçerlilik (boş=süresiz) |
| İndirim | yüzde | yüzde ve/veya kargo bedava (`free_shipping`) |
| Claim | atomik `update ... where used_at is null` | `claim_campaign_coupon` RPC (FOR UPDATE + unique redemption) |

Sabit tutar indirimi bilinçli olarak YOK. `SEPET-` öneki kampanya
kodlarında yasaktır (otomatik kodlara ayrılmıştır).

## Sunucu tarafı (güvenlik)

- Tutar ASLA client'tan alınmaz; claim ve indirim hesabı
  create-order/paytr-token içinde, service_role ile yapılır.
- RPC'ler (`claim_campaign_coupon`, `release_campaign_redemption`,
  `release_coupon_by_order`) yalnız service_role'den çağrılabilir;
  anon/authenticated'a EXECUTE verilmez.
- Yarış koşulları: FOR UPDATE satır kilidi + `unique(coupon_id, email)`
  aynı işlemde → son kullanım hakkı / aynı e-posta iki kez kullanamaz.
- Başarısız sipariş/ödeme akışı kuponu iade eder: create-order &
  paytr-token hata yollarında `releaseDiscount`, başarısız kart
  ödemesinde paytr-callback → `release_coupon_by_order` (idempotent).
- cart-sync `action:"coupon"` yalnız ÖN İZLEMEdir (mutasyon yok,
  10/60dk IP limiti); gerçek claim siparişte olur.

## Admin paneli — admin-kuponlar.html

`profiles.is_admin` + RLS (`discount_codes_admin_all`,
`coupon_redemptions_admin_read`) ile anon key üzerinden CRUD.
Kampanya kuponu oluştur/düzenle/pasifleştir; kullanılmış kupon
silinemez (raporlama bozulur), pasifleştirilir. Otomatik SEPET
kodları listelenir, kullanılmamışlar iptal edilebilir (`active=false`).

## Bilinen sınırlar / açık uçlar

- Kargo ücreti sitede şu an 0 TL (`SHIPPING_FEE` sabiti) → "kargo
  bedava" kuponu bugün fiilen fark yaratmaz; ücretli kargoya geçince
  otomatik devreye girer.
- Admin panelden COD sipariş iptali kuponu iade ETMEZ (single'da da
  öyleydi). Gerekirse admin akışından `release_coupon_by_order`
  çağrılarak eklenebilir.

## Dokunulan parçalar

- `backend/schema.sql` — kolonlar, `coupon_redemptions`, 3 RPC, RLS
  (canlıya `campaign_coupons` migration'ı olarak uygulandı).
- `backend/edge-functions/_shared/discount.ts` — kind ayrımlı claim/release.
- Edge functions: create-order, paytr-token, paytr-callback, cart-sync,
  cart-reminder (temizlik artık yalnız `kind='single'` kodları siler).
- `sepet.html` + `backend/ej-supabase.js` — kupon ön izlemesi
  (min. tutar uyarısı, "Ücretsiz (kupon)" kargo satırı, e-posta şartı).
- `admin-kuponlar.html` (yeni) + 3 admin sayfasının menüsüne link.
- `tests/discount.test.mjs` — kampanya claim/release testleri (63 test).
