# Fiyat Alarmı + Hoş Geldin Kuponu — Kurulum & İşletme

Kuruluş: 2026-07-16. EKLENTILER.md'deki iki maddenin uygulaması:

1. **Fiyat düşünce haber ver** — ürün sayfasından e-posta bırak → fiyat,
   kayıt anındaki fiyatın altına inince otomatik bildirim e-postası.
2. **İlk sipariş kuponu + bülten kaydı** — bültene İLK kayıtta e-postaya
   bağlı, tek kullanımlık `HOSGELDIN-…` indirim kodu otomatik gönderilir.

İkisi de mevcut desenleri aynen paylaşır: cart-reminder cron altyapısı,
`discount_codes` tek kullanımlık kupon deseni, Resend, honeypot + IP hız sınırı.

## Mimari

```
FİYAT ALARMI
  urun.html ("Fiyatı düşünce haber ver" formu, yalnız canlı katalog ürününde görünür)
        └─> price-alert EF {action:subscribe, slug, email} ──> price_alerts (upsert)
  pg_cron (saatlik) ──x-cron-secret (CART_CRON_SECRET ile AYNI)──> price-alert EF
        ├─ notified_at IS NULL satırları güncel products.price ile karşılaştırır
        ├─ price < price_at_signup → notified_at ATOMİK claim → Resend maili
        └─ temizlik: bildirilen 30 gün, tümü 180 gün sonra silinir (KVKK)
  Maildeki linkler:
    urun.html?slug=…                    → ürüne git
    price-alert?unsub=<unsub_token>     → alarmı kapat (satır silinir)

HOŞ GELDİN KUPONU
  index.html bülten formu ──> submit-form EF (kind=newsletter)
        ├─ newsletter_subscribers'a insert (23505 → already, kupon YOK)
        └─ İLK kayıtta: discount_codes'a kind='single', e-postaya bağlı,
           30 gün geçerli HOSGELDIN-… kodu + Resend hoş geldin maili
  Kupon kullanım/iade akışı mevcut single-kod düzeninin aynısı
  (create-order / paytr-token atomik claim; başarısızlıkta release).
```

**Güvenlik ilkeleri** (mevcut düzenle aynı):
- `price_alerts`e client RLS erişimi YOK — yalnız price-alert EF (service_role).
- Kayıt uçlarında honeypot + IP hız sınırı (`fn_rate_limit` kind=`price_alert`
  5/60dk; bülten `form_rate_limit` 3/60dk).
- Kupon tutarı ASLA client'tan gelmez; claim/indirim hesabı sipariş
  fonksiyonlarında service_role ile yapılır (kupon-sistemi.md).
- Hoş geldin kuponu e-postaya bağlıdır (`discount_codes.email`) → başka
  adres kullanamaz; tekrar bülten kaydı 23505 ile reddedildiğinden ikinci
  kupon üretilmez.
- Fail-soft: kupon/e-posta hatası aboneliği bozmaz; alarm maili gönderim
  hatasında `notified_at` claim'i geri alınır → sonraki koşu yeniden dener.

## Kurulum durumu (2026-07-17) — TAMAMLANDI ✅

| Adım | Durum |
|---|---|
| SQL migration `price_alerts_and_welcome_coupon` | ✅ uygulandı |
| `submit-form` v10 redeploy (hoş geldin kuponu) | ✅ canlı, smoke test 200 |
| `price-alert` v1 deploy (verify_jwt kapalı) | ✅ canlı; subscribe/cron/unsub test edildi |
| pg_cron `price-alert-hourly` ('5 * * * *') | ✅ kuruldu (Vault `cart_cron_secret`) |
| Frontend (urun.html, index.html, ej-supabase.js) | ✅ kodda; siteye yayınlanınca aktif |

Aşağıdaki adımlar yeniden kurulum / başka ortam içindir.

## Kurulum adımları

### 1. SQL migration (Supabase → SQL Editor)

`backend/schema.sql` sonuna eklenen bölümler (tek başına çalıştırılabilir):

```sql
create table if not exists price_alerts (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  email           text not null,
  price_at_signup integer not null,
  unsub_token     uuid unique not null default gen_random_uuid(),
  notified_at     timestamptz,
  notified_price  integer,
  created_at      timestamptz not null default now(),
  unique (product_id, email)
);
create index if not exists idx_pa_due on price_alerts(created_at) where notified_at is null;
alter table price_alerts enable row level security;

alter table newsletter_subscribers
  add column if not exists welcome_code_id uuid references discount_codes(id) on delete set null,
  add column if not exists welcome_sent_at timestamptz;
```

### 2. Edge function deploy

```
supabase functions deploy price-alert --no-verify-jwt   # cron + unsub linki JWT taşıyamaz
supabase functions deploy submit-form                    # hoş geldin kuponu eklendi
```
(MCP/Dashboard'dan deploy ediliyorsa kaynak düzeni: `price-alert/index.ts` +
`_shared/` + `deno.json`, import map = `deno.json`. `price-alert` için
verify_jwt KAPALI olmalı.)

### 3. pg_cron görevi (saatlik tarama)

Vault'taki mevcut `cart_cron_secret` aynen kullanılır — yeni secret gerekmez:

```sql
select cron.schedule(
  'price-alert-hourly',
  '5 * * * *',            -- her saat :05'te
  $$
  select net.http_post(
    url := 'https://grdinhjtsmoograktgge.supabase.co/functions/v1/price-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'cart_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### 4. Secret'lar

| Secret | Zorunlu | Açıklama |
|---|---|---|
| `CART_CRON_SECRET` | mevcut | price-alert cron kimlik doğrulaması da bunu kullanır |
| `WELCOME_DISCOUNT_PERCENT` | hayır | Hoş geldin kuponu yüzdesi. Varsayılan **10** |
| `RESEND_API_KEY`, `ORDER_FROM_EMAIL`, `SITE_URL` | mevcut | Yoksa gönderim sessizce atlanır (fail-soft) |
| `EDGE_ALLOWED_ORIGINS` | mevcut | price-alert subscribe CORS listesi (ortak) |

## Ayarlar (kod içinde sabit)

`price-alert/index.ts`: `BATCH=200` (koşu başına taranan alarm),
`NOTIFIED_PURGE_DAYS=30`, `MAX_AGE_DAYS=180`, kayıt sınırı 5/60dk.
`submit-form/index.ts`: `WELCOME_VALID_DAYS=30`.

## İzleme / işletme

```sql
-- bekleyen / bildirilen alarmlar
select pa.email, p.slug, pa.price_at_signup, p.price as guncel,
       pa.notified_at, pa.notified_price, pa.created_at
from price_alerts pa join products p on p.id = pa.product_id
order by pa.created_at desc limit 20;

-- gönderilen hoş geldin kuponları + kullanım durumu
select ns.email, ns.welcome_sent_at, dc.code, dc.expires_at, dc.used_at, dc.order_id
from newsletter_subscribers ns
left join discount_codes dc on dc.id = ns.welcome_code_id
order by ns.created_at desc limit 20;

-- cron çalışıyor mu?
select jobname, schedule, active from cron.job;
```

Loglar: Dashboard → Edge Functions → Logs → `"fn":"price-alert"` /
`"fn":"submit-form"`. Önemli olaylar: `price_alert_saved`, `price_alert_sent`,
`price_alert_send_failed`, `price_alert_run_done`, `welcome_sent`,
`welcome_send_failed`, `bad_cron_secret`.

## Elle test

```bash
# alarm kaydı (tarayıcı yerine curl)
curl -X POST https://grdinhjtsmoograktgge.supabase.co/functions/v1/price-alert \
  -H "Content-Type: application/json" \
  -d '{"action":"subscribe","slug":"pera","email":"test@example.com"}'

# taramayı hemen tetikle (cron'u beklemeden)
curl -X POST https://grdinhjtsmoograktgge.supabase.co/functions/v1/price-alert \
  -H "x-cron-secret: <CART_CRON_SECRET>"
# → {"ok":true,"pending":N,"due":N,"sent":N,"skipped":N}

# fiyat düşüşünü simüle et (SQL Editor)
# update products set price = price - 100 where slug = 'pera';

# bülten kaydı (hoş geldin kuponu tetiklenir)
curl -X POST https://grdinhjtsmoograktgge.supabase.co/functions/v1/submit-form \
  -H "Content-Type: application/json" -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -d '{"kind":"newsletter","email":"test@example.com"}'
# → {"ok":true,"coupon":true}  (ikinci deneme: {"ok":true,"already":true})
```

## Bilinen sınırlar / açık uçlar

- Bültenden çıkış (unsubscribe) mekanizması bu işten önce de yoktu; hoş geldin
  maili tek seferlik "işlem" maili olduğundan kritik değil ama pazarlama
  bülteni gönderilmeye başlanmadan önce eklenmelidir.
- Fiyat alarmı bildirimi TEK seferliktir; müşteri aynı ürüne yeniden kaydolursa
  satır güncel fiyatla sıfırlanır (upsert) ve yeni düşüşte tekrar mail alır.
- Eski bülten aboneleri (özellik öncesi kayıtlar) geriye dönük kupon ALMAZ.
- `HOSGELDIN-` kodları admin-kuponlar.html'de otomatik (single) kod listesinde
  görünür; kullanılmamışlar oradan iptal edilebilir.

## Dokunulan parçalar

- `backend/schema.sql` — `price_alerts` tablosu + `newsletter_subscribers`
  izleme kolonları (canlıya yukarıdaki migration ile uygulanır).
- `backend/edge-functions/price-alert/index.ts` (yeni) — subscribe + cron + unsub.
- `backend/edge-functions/submit-form/index.ts` — hoş geldin kuponu üretim/gönderim.
- `backend/edge-functions/_shared/discount.ts` — `makeDiscountCode` önek parametresi.
- `backend/ej-supabase.js` — `EJData.priceAlert`, bülten yanıtında `coupon` bayrağı.
- `urun.html` — "Fiyatı düşünce haber ver" formu (yalnız DB ürününde görünür).
- `index.html` — bülten başlığı hoş geldin kuponunu anar.
- `tests/discount.test.mjs` — kod öneki testleri.
