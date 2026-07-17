# Kapıda Ödeme Risk Kontrolü — Kurulum & İşletme

Kuruluş: 2026-07-17. EKLENTILER.md "Kapıda ödeme risk kontrolü" maddesinin
uygulaması: aynı telefonla geçmişte iptal edilmiş siparişi olan COD
siparişleri oluşturulurken skorlanır, admin-siparisler'de rozetlenir ve
eşik aşımında "Onay bekliyor" (bekletme) işareti alır.

> **Ürünleşme notu:** Bu özellik ileride bağımsız bir SaaS ürününe
> dönüştürülecek şekilde katmanlı yazıldı — yol haritası:
> `docs/PLAN-kapida-risk-urun.md`.

## Mimari

```
sepet.html ──> create-order EF (yalnız method=cod)
      ├─ codrisk_signals RPC (SECURITY DEFINER, yalnız service_role)
      │    └─ son 180 günde aynı NORMALİZE telefonla:
      │       iptal sayısı / teslim sayısı / açık COD sipariş sayısı
      ├─ scoreCodRisk (_shared/cod-risk.ts — SAF politika, DB'siz)
      │    +40/iptal (tavan 80) · +15 (≥2 açık COD) · −10/teslimat (taban 0)
      │    seviye: ≥60 high · ≥30 medium · altı low
      └─ orders'a snapshot: risk_score / risk_level / risk_reasons / risk_hold
         (risk_hold = skor ≥ 60 → admin onayı beklenir; status DEĞİŞMEZ)

admin-siparisler.html
      ├─ listede rozet: "Onay bekliyor" (hold) / "Riskli" (high) / "Dikkat" (medium)
      ├─ "Riskli" filtresi
      └─ detayda Risk kartı: skor + Türkçe gerekçeler + "Onayı kaldır" butonu
         (orders_admin_update RLS politikasıyla risk_hold=false yazar)
```

**İlkeler:**
- **Fail-soft:** RPC/skorlama hatası siparişi ASLA engellemez — risk
  kolonları null kalır, `codrisk_unavailable` log'lanır, satış sürer.
- **Müşteri hiçbir şey görmez:** yeni status YOK; `status='pending'` kalır,
  onay maili normal gider. `track-order` ve `hesap.html` explicit kolon
  seçtiği için `risk_*` müşteri tarafına sızmaz. Yanıt gövdesi değişmedi.
- **Normalizasyon sözleşmesi:** `codrisk_norm_phone` (SQL) ≡ `normPhone`
  (util.ts) — yalnız rakam, son 10 hane. Testte fixture ile kilitli.
- **Ayrılabilirlik:** DB nesneleri `codrisk_` önekli; RPC yalnız HAM sinyal
  döner, tüm politika (ağırlık/eşik) `_shared/cod-risk.ts`'te tek yerde.

## Ne değişti

| Parça | Değişiklik |
|---|---|
| `backend/schema.sql` | "COD RİSK KONTROLÜ" bölümü: `codrisk_norm_phone` fonksiyonu, `idx_codrisk_orders_phone` fonksiyonel index, `orders.risk_score/risk_level/risk_reasons/risk_hold` kolonları, `codrisk_signals` RPC (revoke → yalnız service_role) |
| `backend/edge-functions/_shared/cod-risk.ts` | YENİ — `scoreCodRisk` (saf skorlama) + `assessCodRisk` (RPC orkestratörü, fail-soft) + ayar sabitleri |
| `backend/edge-functions/create-order/index.ts` | COD siparişlerde insert öncesi risk değerlendirmesi; sonuç insert'e ve `order_created` loguna eklendi |
| `admin-siparisler.html` | Liste rozeti, "Riskli" filtresi, detayda Risk kartı + "Onayı kaldır" |
| Testler | `_shared/cod-risk_test.ts` (Deno) + `tests/cod-risk.test.mjs` (Node aynası) |

## Kurulum adımları

1. **SQL** — `schema.sql`'in "COD RİSK KONTROLÜ" bölümünü Supabase SQL
   Editor'de çalıştır (idempotent; tamamı da güvenle tekrar koşulabilir).
2. **Edge Function** — `supabase functions deploy create-order`
   (veya dashboard'a yapıştır). Yeni secret GEREKMEZ.
3. Bitti — admin panel değişikliği statik dosyada, deploy'la birlikte gider.

## Ayar (tuning)

Tüm sabitler `_shared/cod-risk.ts` başında:

| Sabit | Varsayılan | Anlamı |
|---|---|---|
| `CODRISK_WINDOW_DAYS` | 180 | geçmişe bakış penceresi (gün) |
| `CODRISK_W_CANCELLED` | 40 | iptal başına puan |
| `CODRISK_CANCELLED_CAP` | 80 | iptal puanı tavanı |
| `CODRISK_W_OPEN_COD` | 15 | ≥2 açık COD siparişine ek puan |
| `CODRISK_W_DELIVERED` | 10 | teslimat başına düşülen puan |
| `CODRISK_LEVEL_HIGH` / `_MEDIUM` | 60 / 30 | seviye eşikleri |
| `CODRISK_HOLD_MIN` | 60 | bekletme (risk_hold) eşiği |

Örnek: 1 iptal = 40 (Dikkat) · 2 iptal = 80 (Riskli + bekletme) ·
2 iptal + 3 teslimat = 50 (Dikkat, bekletme yok).

**Acil kapatma:** Supabase secret `CODRISK_HOLD=0` → bekletme durur
(skor/rozet yazılmaya devam eder). Silince tekrar açılır.
Değişiklik sonrası `create-order`'ı yeniden deploy et.

## İşletme

- **"Onay bekliyor" rozeti** çıkan siparişte kargoya vermeden önce müşteriyi
  arayıp teyit al; sonra detaydaki **"Onayı kaldır"** butonuna bas.
  (Buton yalnız `risk_hold` işaretini temizler; sipariş durumunu ayrıca
  "Hazırlanıyor" yapmayı unutma.)
- **"Riskli" filtresi** yalnız yüklenmiş sayfalardaki siparişlerde arar
  (mevcut arama/filtre davranışıyla aynı).
- Eski (özellik öncesi) siparişlerde rozet çıkmaz — `risk_*` kolonları null.
  Geriye dönük skorlama istenirse `codrisk_recompute` yolu ileride eklenebilir.

## Doğrulama (e2e reçetesi)

1. Normal telefonla COD sipariş → admin'de rozet yok, `risk_level='low'`.
2. Aynı telefonla 2 sipariş aç, admin'den ikisini de "İptal" yap.
3. Aynı telefonla (farklı biçimde yaz: `+90 …` / `0…`) yeni COD sipariş →
   `risk_score=80, risk_level='high', risk_hold=true`; listede "Onay
   bekliyor", "Riskli" filtresinde görünür; detayda "Son 6 ayda 2 iptal".
4. "Onayı kaldır" → rozet düşer; siparis-takip.html siparişi normal gösterir.
