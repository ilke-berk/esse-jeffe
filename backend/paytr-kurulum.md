# PayTR Online Kart Ödemesi — Kurulum & Aktivasyon

Esse Jeffe için PayTR iFrame entegrasyonu **kuruldu ve test edildi.** Kod hazır;
PayTR mağaza hesabı onaylanınca aşağıdaki 4 adımı yapınca canlıya çıkar.

## Mimarî (özet)

```
sepet.html (Kart seç)
   │  EJData.client().functions.invoke('paytr-token', {form, items, origin})
   ▼
Edge Function: paytr-token
   - Fiyatı DB'den hesaplar (client'a GÜVENMEZ), siparişi 'pending' yazar
   - merchant_oid = order_no, gizli anahtarlarla imzalar → PayTR token
   ▼
sepet.html → PayTR güvenli iframe (kart bilgisi BİZE GELMEZ)
   ▼
PayTR sunucusu → Edge Function: paytr-callback (POST, hash doğrulanır)
   - Sipariş 'paid'/'failed' güncellenir, "OK" döner
   ▼
Müşteri sepet.html?paytr=ok&no=... ekranına döner (sipariş onayı)
```

## Yapılanlar

- **DB:** `orders` tablosuna `paid_at`, `payment_ref` kolonları eklendi (migration `orders_paytr_columns`).
- **Edge Functions** (deploy edildi, ACTIVE):
  - `paytr-token` — `backend/edge-functions/paytr-token/index.ts`
  - `paytr-callback` — `backend/edge-functions/paytr-callback/index.ts`
- **Frontend:** `sepet.html` kart seçeneği aktif + iframe akışı; `ej.js` sepete eklerken gerçek DB slug'ını taşıyor.
- **Test edildi:** callback imza doğrulama, başarılı ödeme (`paid`+`preparing`+`paid_at`), başarısız ödeme, bozuk-imza reddi ve idempotency — hepsi geçti.

## Aktivasyon (hesap onaylanınca)

### 1. PayTR anahtarlarını al
PayTR mağaza paneli → **Bilgi** bölümünden:
`Mağaza No (merchant_id)`, `Mağaza Parola (merchant_key)`, `Mağaza Gizli Anahtar (merchant_salt)`.

### 2. Supabase'e secret olarak gir
Supabase paneli → **Edge Functions → Secrets** (veya Project Settings → Edge Functions):

| Secret | Değer |
|---|---|
| `PAYTR_MERCHANT_ID` | (mağaza no) |
| `PAYTR_MERCHANT_KEY` | (mağaza parola) |
| `PAYTR_MERCHANT_SALT` | (gizli anahtar) |
| `PAYTR_TEST_MODE` | `1` (test) — canlıya geçince `0` |

> `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` otomatik gelir, girmene gerek yok.
> Bu anahtarlar **asla** frontend'e / git'e konmaz; yalnızca Edge Function secret'ında durur.

### 3. PayTR paneline Bildirim URL'i tanımla
PayTR paneli → **Ayarlar → Bildirim URL** alanına:

```
https://grdinhjtsmoograktgge.supabase.co/functions/v1/paytr-callback
```

### 4. Test et (test_mode=1)
- Siteyi aç → sepete ürün ekle → Sepet & Ödeme → **Kredi / Banka Kartı** → Siparişi Ver.
- PayTR güvenli ekranı açılır; PayTR'nin **test kartlarıyla** öde (gerçek para çekilmez).
- `orders` tablosunda ilgili siparişin `payment_status='paid'`, `status='preparing'` olduğunu doğrula.
- Hata olursa: Supabase → Edge Functions → `paytr-token` / `paytr-callback` → **Logs**.

### 5. Canlıya geç
Her şey çalışınca `PAYTR_TEST_MODE` secret'ını **`0`** yap. Bu kadar.

## ⚠️ Yapılacak temizlik (şimdi)
Test sırasında geçici bir `paytr-callback-test` fonksiyonu kullanıldı ve **etkisiz bırakıldı**
(artık `410 gone` dönüyor). Yine de panelden tamamen sil:
**Supabase → Edge Functions → `paytr-callback-test` → Delete.**

## Notlar
- **Güvenlik:** Ödeme tutarı her zaman sunucuda DB fiyatından hesaplanır; kullanıcı sepetteki
  fiyatı değiştirse bile geçerli olan DB fiyatıdır. Siparişi "ödendi" yapan **tek** yer
  imzası doğrulanmış callback'tir — tarayıcı yönlendirmesine güvenilmez.
- **E-posta zorunlu:** Kart ödemesinde PayTR geçerli e-posta ister; sepet formu bunu kontrol eder.
- **Kargo:** Şu an `shipping_fee = 0` (ücretsiz). Değişirse hem `paytr-token` hem özet güncellenmeli.
- **Taksit:** Açık (`no_installment=0`, `max_installment=0` → PayTR'nin izin verdiği tüm taksitler).
  Taksiti kapatıp yalnız tek çekim istenirse `paytr-token` içinde `no_installment="1"` yapılır;
  taksit sayısını sınırlamak için `max_installment` (örn. `"6"`) verilir.
