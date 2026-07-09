# Sağlamlık: Loglama · Rate limit · Sentry · Test — Kurulum

Denetimdeki "Sağlamlık" maddeleri (yapılandırılmış loglama, Edge Function rate
limit, hata izleme, otomatik test) bu değişiklikle kapatıldı. Özet ve aktivasyon:

## 1. Yapılandırılmış loglama (`_shared/log.ts`)

Tüm Edge Function'lar ham `console.error` yerine istek başına bir logger kullanır:

```ts
const log = createLogger("create-order", req);
log.info("order_created", { ip, order_no, total });
log.warn("rate_limited", { ip, count });
log.error("db_error", { detail });
```

- Her kayıt **tek satır JSON** → Supabase Dashboard → Edge Functions → Logs
  ekranında filtrelenebilir (ör. `"level":"error"`, `"fn":"paytr-callback"`).
- Her isteğe `request_id` ve `elapsed_ms` eklenir.
- **KURAL:** loglara kişisel veri (ad, telefon, adres, e-posta) yazılmaz; yalnız
  operasyonel alanlar (order_no, ip, hata detayı).

Bağlı fonksiyonlar: `create-order`, `paytr-token`, `paytr-callback`,
`submit-form`, `track-order` ve paylaşılan `order-email`.

## 2. Rate limit (`_shared/rate-limit.ts`)

IP başına sayaç-tablosu deseni tek modülde toplandı (`checkRateLimit` /
`recordRateLimit`). Kullanılan sınırlar:

| Fonksiyon | Sayaç tablosu | Sınır |
|---|---|---|
| create-order + paytr-token | `fn_rate_limit` (kind=`order`) | 10 / 60 dk (ORTAK) |
| submit-form (bülten) | `form_rate_limit` | 3 / 60 dk |
| submit-form (iletişim) | `form_rate_limit` | 5 / 60 dk |
| track-order | `order_track_rate_limit` | 15 / 10 dk |
| log-error (istemci hata raporu) | `fn_rate_limit` (kind=`client_error`) | 20 / 60 dk |

> Sayaç tabloları `schema.sql`'de tanımlı, RLS açık ve client politikası **yok**
> (yalnız service_role erişir). `fn_rate_limit` tablosu ekli değilse `schema.sql`'i
> tekrar çalıştır.
>
> Sipariş sayacı yalnız **başarıyla açılan** siparişlerde artar → doğrulama
> hatası/stok yetersizliği dürüst müşteriyi kotadan yemez; 10/saat paylaşımlı
> IP'de (CGNAT) bile bol, bot'un sahte COD yağdırmasını keser.

## 3. Hata izleme — Sentry (`_shared/sentry.ts`)

Logger `error` seviyesi bir olay ürettiğinde, **`SENTRY_DSN` secret'ı tanımlıysa**
olay Sentry'ye de iletilir (gruplama, sıklık, alarm). Gönderim `EdgeRuntime.waitUntil`
ile arka plandadır → yanıtı yavaşlatmaz; başarısız olursa **sessizce yutulur**,
asıl akışı asla bozmaz. DSN yoksa Sentry adımı tümüyle atlanır (yalnız console log).

**Aktivasyon:**
1. https://sentry.io → proje aç (platform: *Deno* veya *Other*).
2. Settings → Client Keys (DSN) → DSN'i kopyala
   (`https://<key>@<org>.ingest.sentry.io/<project_id>`).
3. Supabase → Edge Functions → Secrets → `SENTRY_DSN` olarak gir.
4. Fonksiyonları yeniden deploy et. Bir hata tetikle (ör. geçersiz sipariş) →
   Sentry'de olayın düştüğünü doğrula.

> **PII yok:** Sentry'ye yalnız logger'a verilen operasyonel alanlar (fn, event,
> request_id, order_no, ip, detay) gider; müşteri verisi gitmez.

## 3b. Hata izleme — istemci JS hataları (EJMonitor → `log-error` → `client_errors`)

Sentry sunucu tarafını izler; **ziyaretçi tarayıcısında** patlayan JS hataları
için ek bir katman var:

- `ej.js` başındaki **EJMonitor** IIFE'si `window.onerror` +
  `unhandledrejection` olaylarını yakalar, tekilleyip (sayfa başına en çok 8)
  **`log-error`** Edge Function'ına gönderir. `EJ_CONFIG` yoksa hiç istek atmaz;
  raporlama hatası sayfayı asla etkilemez.
- `log-error` (YENİ fonksiyon) alan boylarını sunucuda da kırpar, IP başına
  20/saat sınırı uygular ve `client_errors` tablosuna yazar.
- **Bakış:** Dashboard → Table Editor → `client_errors`
  (`select * from client_errors order by created_at desc limit 50;`).
  Yazma yalnız service_role; okuma yalnız admin (`is_admin()`).

**Aktivasyon:** `schema.sql`'i çalıştır (bkz. madde 2 notu) + `log-error`
fonksiyonunu `_shared` klasörüyle birlikte deploy et (diğer form fonksiyonları
gibi verify_jwt kapalı; istemci publishable key ile çağırır). Frontend değişikliği
`ej.js?v=7` sürümüyle yayında.

## 4. Otomatik test — iki takım

**a) Node testleri (`tests/*.test.mjs`) — bu makinede çalışır, bağımlılık yok:**

```
npm test        # Node 22+ → 41 test
```

Node'un yerleşik test runner'ı `--experimental-strip-types` ile `_shared/*.ts`
modüllerini doğrudan import eder (Deno gerekmez). Kapsam:

- `util.test.mjs` — sipariş no üretimi/doğrulaması (create-order ↔ track-order
  sözleşmesi), telefon normalizasyonu, origin allowlist (açık yönlendirme savunması), IP çıkarımı.
- `rate-limit.test.mjs` — pencere hesabı, sınır kararı (max dahil), kind filtresi,
  DB hatasında fail-closed, 24 saatlik temizlik (sahte Supabase client ile).
- `log.test.mjs` — tek satır JSON biçimi, request_id, Sentry DSN çözümü,
  yalnız `error` seviyesinin Sentry'ye gitmesi, fail-soft gönderim.
- `order-email.test.mjs` — fail-soft sözleşmesi (mail hatası siparişi bozmaz),
  müşteri+işletme gönderimi, reply_to, HTML escape (XSS).
- `frontend.test.mjs` — tüm JS dosyalarının söz dizimi denetimi,
  `EJ_CATALOG` ↔ `schema.sql` tohum tutarlılığı, EJMonitor kurulu mu,
  sayfalar arası `ej.js?v=` sürüm tutarlılığı.

**b) Deno testleri (`_shared/*_test.ts`) — CI / Deno kurulu ortam için:**

```
cd backend/edge-functions
deno task test          # veya: deno test _shared/
```

Aynı saf yardımcıları Deno çalışma zamanında (Edge Function'ların gerçek
ortamına en yakın) doğrular. İki takım da ağa çıkmaz ve deterministiktir
(tarih/rastgelelik/fetch enjekte edilir).

> NOT: Bu makinede Deno kurulu değil; yerelde `npm test` kullan. CI'da her iki
> adım da (`npm test` + `deno test _shared/`) koşturulabilir.

## 5. Düzeltilen tutarsızlık (testler yazılırken bulundu)

`paytr-token` sipariş numarasını **12 haneli** üretiyordu (`EJ` + 6 tarih +
6 rastgele), `track-order` ise yalnız **11 haneli** kabul ediyordu → **kart ile
ödeyen misafir siparişini takip edemiyordu**. Çözüm:

- Üretim tek yerde: `_shared/util.ts` → `makeOrderNo` (11 hane; create-order ve
  `schema.sql` varsayılanıyla aynı biçim).
- `track-order` → `isValidOrderNo` geriye dönük uyumluluk için mevcut 12 haneli
  eski kart siparişlerini de kabul eder.
