# PLAN — "KapıdaRisk": COD risk kontrolünün bağımsız ürüne dönüşümü

Durum: vizyon / yol haritası (2026-07-17). Demo, Esse Jeffe'ye entegre edildi
(`backend/cod-risk-kurulum.md`). Bu doküman demodan bağımsız SaaS ürününe
giden yolu tarif eder: **kapıda ödeme alan her işletmenin, sipariş öncesi
telefon bazlı iptal-riski sorgulayabildiği bir API**.

## Demoda kurulan (bilinçli) sınır

| Katman | Demoda nerede | Üründe neye dönüşür |
|---|---|---|
| Veri düzlemi (ham sinyal) | `codrisk_signals` RPC — kendi `orders` tablosunu sayar | Servis-sahipli `codrisk_events` tablosu — üye işletmelerin bildirdiği sonuçlar |
| Politika düzlemi (skor) | `_shared/cod-risk.ts` `scoreCodRisk` — SAF fonksiyon, DB'siz | **Değişmeden** servise taşınır; ileride işletme başına ağırlık |
| Tüketici (merchant tarafı) | `assessCodRisk` → sonuç `orders.risk_*` snapshot + admin rozeti | Aynı obje; yalnız kaynağı HTTP API olur |

Bu sınır sayesinde geçiş, `assessCodRisk` fonksiyonunun İÇİNİ RPC çağrısından
HTTP çağrısına çevirmekten ibaret — Esse Jeffe, ürünün 1 numaralı müşterisi olur.

## Ürün API şekli (v1)

```
POST /v1/assess          (API key ile)
  { "phone": "+90 532 123 45 67", "city": "İstanbul", "order_value": 4200 }
  → { "assessment_id": "…", "score": 80, "level": "high",
      "reasons": [ {"code":"cancelled_orders","count":2,"window_days":180} ] }

POST /v1/outcomes        (ağı besleyen geri bildirim)
  { "assessment_id": "…", "outcome": "delivered" | "cancelled" | "refused" }
```

- Yanıt objesi, demoda `create-order`'ın bugün `orders.risk_*`'a yazdığı
  objenin aynısı — entegrasyon sözleşmesi şimdiden sahada test ediliyor.
- Öneri davranışı da aynı kalır: `level=high` → "beklet/ara", engelleme yok.
  Karar her zaman işletmenin.

## Merchant-arası ağ ve KVKK/GDPR

Ürünün asıl değeri tek işletmenin kendi geçmişi değil, **ağ etkisi**:
X mağazasında 3 kez teslim almayan telefon, Y mağazasının ilk siparişinde
de görünür olmalı. Bunun için:

- Ham telefon ASLA merkezde tutulmaz/paylaşılmaz. İşletme SDK'sı telefonu
  normalize eder (demodaki `codrisk_norm_phone` ≡ `normPhone` sözleşmesi —
  yalnız rakam, son 10 hane) ve `hmac_sha256(phone_norm, network_salt)`
  gönderir. Eşleşme hash üzerinden yapılır; PII paylaşımı olmaz.
- Normalizasyon sözleşmesi iki tarafın ortak parçasıdır — demoda test
  fixture'ı ile kilitlendi (`tests/cod-risk.test.mjs`).
- Sonuç bildirimleri (`/v1/outcomes`) işletme bazında imzalı tutulur;
  kötü niyetli işletmenin ağı zehirlemesine karşı işletme-itibar ağırlığı
  (yeni üyenin bildirimi düşük ağırlıkla sayılır) eklenir.

## Ancak o aşamada gelecek parçalar (demoya BİLEREK konmadı)

- `merchants` + `api_keys` tabloları, anahtar rotasyonu
- İşletme başına ağırlık/eşik konfigürasyonu (bugün `cod-risk.ts` sabitleri)
- API rate limit + kullanım sayacı → faturalama (aylık sorgu paketi)
- Yönetim paneli: işletmenin kendi sorgu/isabet istatistikleri
- İtiraz akışı: müşterinin "beni yanlış işaretlediniz" başvurusu (KVKK md.11)

## Yapılacaklar (sıralı)

1. **Şimdi (bitti):** Demo canlıda — sinyal/politika/tüketici katmanları ayrık.
2. **Doğrulama dönemi:** Esse Jeffe'de 1-2 ay gerçek veri: kaç sipariş
   "Dikkat/Riskli" çıkıyor, bekletilenlerin kaçı gerçekten iade dönüyor
   (isabet oranı). Ağırlıklar bu veriyle ayarlanır.
3. **Ekstraksiyon:** `scoreCodRisk` + normalizasyon sözleşmesi ayrı repoya;
   `/v1/assess` + `/v1/outcomes` + `codrisk_events`; Esse Jeffe
   `assessCodRisk` içini HTTP'ye çevirerek ilk müşteri olur.
4. **Ağ:** hash tabanlı merchant-arası eşleşme + itibar ağırlığı + faturalama.
