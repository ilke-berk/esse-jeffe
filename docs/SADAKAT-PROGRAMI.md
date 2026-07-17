# Sadakat Programı (SADAKAT- kuponları)

Ödemesi alınan her sipariş müşteriye **+%5** birikimli indirim kazandırır
(5 → 10 → 15 … en çok **%50**, indirim tutarı en çok **1.500 TL**). Kupon
kullanılınca ya da 6 ay boyunca yeni birikim olmayınca merdiven 5'ten başlar.

## Nasıl çalışır

- **Tetik:** ödeme onayı. Kart → `paytr-callback` içinden; kapıda ödeme/havale →
  admin panelde ödeme durumu **ödendi** yapılınca `loyalty-accrue` EF çağrılır.
- **Kayıt:** `loyalty_accrue` SQL RPC'si (atomik) — `orders.loyalty_accrued_at`
  damgası sipariş başına tek birikim garantiler; `loyalty_status` (e-posta
  başına ledger) + yeni `discount_codes` satırı (`kind='single'`, e-postaya
  bağlı, `note='sadakat'`, `max_discount` TL tavanı, 180 gün geçerli).
  Eski kullanılmamış kod `active=false` yapılır (supersede).
- **E-posta:** `_shared/loyalty.ts` → Resend; mail hatası birikimi bozmaz,
  kod admin-kuponlar.html'de görünür kalır.
- **Kullanım:** müşteri kodu sepette girer — mevcut tek-kullanımlık kupon
  claim yolu aynen çalışır; kod e-postaya bağlı olduğundan yalnız sahibi
  kullanabilir. Kullanım sonrası ilk birikimde merdiven otomatik 5'e döner
  (lazy reset; cron/hook yok).

## Ayarlar (Edge Function secrets — hepsi opsiyonel)

| Secret | Varsayılan | Anlamı |
|---|---|---|
| `LOYALTY_STEP_PERCENT` | 5 | Sipariş başına artış (%) |
| `LOYALTY_MAX_PERCENT` | 50 | Yüzde üst limiti |
| `LOYALTY_MIN_SUBTOTAL` | 1000 | Birikim için min. sepet (TL) |
| `LOYALTY_MAX_DISCOUNT` | 1500 | İndirim TL tavanı (0 = limitsiz) |
| `LOYALTY_VALID_DAYS` | 180 | Kod geçerliliği (gün) |

Secret değiştirince **paytr-callback** ve **loyalty-accrue** yeniden deploy
gerekmez (env çalışma anında okunur).

## Operasyon notları

- **Ödenmiş sipariş iptali:** birikim otomatik geri alınmaz. Kazandırdığı
  SADAKAT kodunu **admin-kuponlar.html → Otomatik Kodlar** bölümünden iptal et.
- **Süistimal önlemleri:** birikim yalnız `payment_status='paid'` siparişte
  (sahte kapıda-ödeme kasması işlemez), min. sepet tutarı altı kazandırmaz,
  TL tavanı yüksek yüzdenin maruziyetini sınırlar, kod yalnız sahibinin
  e-postasına gönderilir (griefing kapalı).
- **Loglar:** `loyalty_skip` (neden: below-min / no-email / not-paid /
  already-accrued / cancelled), `loyalty_accrued`, `loyalty_email_failed`.

## Dosyalar

- SQL: `backend/schema.sql` → "SADAKAT PROGRAMI" bölümü (`loyalty_status`,
  `loyalty_accrue`, `discount_codes.max_discount`, `orders.loyalty_accrued_at`)
- Paylaşılan: `backend/edge-functions/_shared/loyalty.ts`,
  `discount.ts` (`computeDiscount` TL tavanı)
- EF: `backend/edge-functions/loyalty-accrue/`, `paytr-callback` (birikim çağrısı)
- Admin: `admin-siparisler.html` (ödendi → EF çağrısı),
  `admin-kuponlar.html` (SADAKAT önek koruması + liste notu)
- Test: `tests/loyalty.test.mjs`, `tests/discount.test.mjs` (tavan testleri)
