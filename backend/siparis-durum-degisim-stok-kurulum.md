# Sipariş Durum E-postası + Değişim Talebi + Stok Uyarısı — Kurulum & İşletme

Kuruluş: 2026-07-17. EKLENTILER.md'deki üç maddenin uygulaması:

1. **Sipariş durumu zaman çizelgesi** — `siparis-takip.html`'de görsel adımlar
   (Alındı → Hazırlanıyor → Kargoda → Teslim) + admin durumu değiştirince
   müşteriye otomatik durum e-postası.
2. **Değişim talebi formu** — `degisim-iptal.html` self-servis: sipariş no +
   telefon doğrulamalı değişim/iptal talebi → admin-siparisler'e düşer.
3. **Stok azalınca admin uyarısı** — eşik altındaki takipli varyantlar için
   günlük özet e-postası.

Hepsi mevcut desenleri paylaşır: order-email/Resend, submit-form
(honeypot + IP hız sınırı), track-order (sipariş no + telefon eşleşmesi),
cart-reminder cron (`CART_CRON_SECRET`).

## Mimari

```
SİPARİŞ DURUM E-POSTASI
  admin-siparisler.html (durum kaydet) ──durum DEĞİŞTİYSE──> order-status-email EF
        ├─ verify_jwt AÇIK + fonksiyon içi is_admin kontrolü (anon key yetmez)
        ├─ siparişi order_id ile service_role okur (içerik client'tan gelmez)
        ├─ orders.last_status_emailed ATOMİK claim → aynı durum için tek e-posta
        └─ preparing/shipped/delivered/cancelled → Resend müşteri maili
           (kargodaysa firma + takip no; mailde mini zaman çizelgesi + takip linki)
  siparis-takip.html → track-order yanıtındaki status ile timeline UI (yalnız frontend)

DEĞİŞİM / İPTAL TALEBİ
  degisim-iptal.html formu ──> submit-form EF {kind:'exchange'} ──> exchange_requests
        ├─ sipariş no + telefon İKİSİ eşleşmeli (track-order deseni; 404 tek mesaj)
        ├─ honeypot + IP hız sınırı (form_rate_limit kind='exchange' 5/60dk,
        │  HER deneme sayılır → enumeration yavaşlar)
        ├─ aynı türde açık talep varsa yenisi açılmaz ({already:true})
        └─ işletmeye bildirim e-postası (fail-soft)
  admin-siparisler.html: sipariş detayında talep listesi + durum güncelleme
  (Yeni/İşlemde/Kapatıldı); sol listede açık talepli siparişe "Talep var" rozeti.

STOK UYARISI
  pg_cron (günlük 05:15 UTC = 08:15 TR) ──x-cron-secret──> stock-alert EF
        ├─ product_stock: track=true AND stock <= eşik AND ürün aktif
        ├─ ürün bazında gruplu TEK özet e-postası → ORDER_NOTIFY_EMAIL
        │  (stok 0 satırlar "TÜKENDİ" vurgulu)
        └─ eşik altı satır yoksa e-posta çıkmaz; stok girilene dek her gün yineler
```

**Güvenlik ilkeleri** (mevcut düzenle aynı):
- `exchange_requests`: client insert politikası YOK → yazma yalnız submit-form
  EF (service_role); okuma/güncelleme yalnız admin (`is_admin()`).
- Talep formunda PII tutulmaz (ad/telefon/e-posta yok) — sipariş kaydında zaten
  var; talep `order_id` ile bağlanır (KVKK veri minimizasyonu).
- order-status-email: verify_jwt + `profiles.is_admin` çifte kontrol; sipariş
  içeriği asla client'tan alınmaz.
- stock-alert: verify_jwt KAPALI ama secret'sız istek 401; GET ucu yok.
- Fail-soft: hiçbir e-posta hatası kaydı/durum güncellemesini bozmaz; durum
  maili gönderilemezse `last_status_emailed` claim'i geri alınır.

## Kurulum durumu (2026-07-17) — TAMAMLANDI ✅

| Adım | Durum |
|---|---|
| SQL migration `order_status_email_and_exchange_requests` | ✅ uygulandı |
| `order-status-email` v1 deploy (verify_jwt AÇIK) | ✅ canlı; anon 401 testi geçti |
| `stock-alert` v1 deploy (verify_jwt kapalı) | ✅ canlı; cron tetikli e-posta testi geçti (sent:true) |
| `submit-form` v11 redeploy (kind='exchange') | ✅ canlı; yanlış tel 404 / doğru 200 / tekrar already testi geçti |
| pg_cron `stock-alert-daily` ('15 5 * * *', Vault `cart_cron_secret`) | ✅ kuruldu |
| Frontend (siparis-takip, degisim-iptal, admin-siparisler, ej-supabase.js) | ✅ kodda; siteye yayınlanınca aktif |

## Kurulum adımları (yeniden kurulum / başka ortam için)

### 1. SQL migration

`backend/schema.sql` sonundaki bölüm (tek başına çalıştırılabilir):

```sql
alter table orders add column if not exists last_status_emailed text;

create table if not exists exchange_requests (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references orders(id) on delete set null,
  order_no     text not null,
  request_type text not null check (request_type in ('exchange','cancel')),
  reason       text not null,
  details      text,
  status       text not null default 'new' check (status in ('new','in_progress','closed')),
  created_at   timestamptz not null default now()
);
-- indeksler + RLS + admin select/update politikaları: bkz. schema.sql
```

### 2. Edge function deploy

```
supabase functions deploy order-status-email                 # verify_jwt AÇIK kalmalı
supabase functions deploy stock-alert --no-verify-jwt        # cron JWT taşıyamaz
supabase functions deploy submit-form --no-verify-jwt        # exchange kind eklendi
```

### 3. pg_cron görevi (günlük stok taraması)

```sql
select cron.schedule(
  'stock-alert-daily',
  '15 5 * * *',            -- 05:15 UTC = 08:15 TR
  $$
  select net.http_post(
    url := 'https://grdinhjtsmoograktgge.supabase.co/functions/v1/stock-alert',
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
| `CART_CRON_SECRET` | mevcut | stock-alert cron kimliği de bunu kullanır |
| `STOCK_ALERT_THRESHOLD` | hayır | Stok eşiği (≤). Varsayılan **3** |
| `RESEND_API_KEY`, `ORDER_FROM_EMAIL`, `ORDER_NOTIFY_EMAIL`, `SITE_URL` | mevcut | Yoksa gönderim sessizce atlanır (fail-soft) |

## İzleme / işletme

```sql
-- açık değişim/iptal talepleri
select order_no, request_type, reason, status, created_at
from exchange_requests where status != 'closed' order by created_at desc;

-- hangi siparişe hangi durum maili gitti
select order_no, status, last_status_emailed from orders
where last_status_emailed is not null order by created_at desc limit 20;

-- cron çalışıyor mu?
select jobname, schedule, active from cron.job;
```

Loglar: Dashboard → Edge Functions → Logs. Önemli olaylar:
`status_email_sent`, `status_email_dup_skip`, `status_email_failed`,
`exchange_saved`, `exchange_no_match`, `exchange_notify_failed`,
`stock_alert_run_done`, `stock_alert_send_failed`, `bad_cron_secret`, `not_admin`.

## Elle test

```bash
# değişim talebi (anon key ile; doğru sipariş no + telefon gerekir)
curl -X POST https://grdinhjtsmoograktgge.supabase.co/functions/v1/submit-form \
  -H "Content-Type: application/json" \
  -d '{"kind":"exchange","order_no":"EJ...","phone":"05...","request_type":"exchange","reason":"beden","details":"M yerine L"}'
# → {"ok":true}  (tekrar: {"ok":true,"already":true}; yanlış tel: 404)

# stok taramasını hemen tetikle
curl -X POST https://grdinhjtsmoograktgge.supabase.co/functions/v1/stock-alert \
  -H "x-cron-secret: <CART_CRON_SECRET>"
# → {"ok":true,"low":N,"out":N,"sent":true|false}

# durum maili: admin-siparisler.html'de durumu değiştirip Kaydet
# → mesaj alanında "müşteriye durum e-postası gönderildi 📧"
```

## Bilinen sınırlar / açık uçlar

- **Resend test modu:** essejeffe.com doğrulanana dek müşteri mailleri yalnız
  hesap sahibinin adresine gider (bkz. resend-domain-dogrulama notu). Domain
  doğrulanınca ek iş gerekmez.
- Durum maili yalnız admin panel üzerinden yapılan değişikliklerde tetiklenir;
  SQL/Dashboard'dan yapılan durum değişikliği e-posta üretmez (bilinçli —
  tetik client'ta, koruma sunucuda).
- Aynı durumdan çıkıp geri dönülürse (shipped → preparing → shipped) ikinci
  "kargoda" maili gider — `last_status_emailed` yalnız SON gönderilen durumu
  tutar; bu senaryo pratikte düzeltme amaçlı olduğundan kabul edildi.
- Stok uyarısı durum tutmaz: eşik altında kaldıkça her gün yinelenir (bilinçli
  hatırlatma). Susturmak için stok girin ya da varyantı `track=false` yapın.
- Talep formu sipariş durumuna bakmaz (teslimden aylar sonra da talep açılabilir);
  14 gün kuralını admin uygular. İstenirse EF'de `delivered + 14 gün` kontrolü
  eklenebilir.

## Dokunulan parçalar

- `backend/schema.sql` — `exchange_requests` + `orders.last_status_emailed` + RLS.
- `backend/edge-functions/order-status-email/index.ts` (yeni) — admin tetikli durum maili.
- `backend/edge-functions/stock-alert/index.ts` (yeni) — günlük düşük stok özeti.
- `backend/edge-functions/submit-form/index.ts` — `kind='exchange'` akışı + işletme bildirimi.
- `backend/edge-functions/deno.json` — fmt listesine yeni fonksiyonlar.
- `backend/ej-supabase.js` — `EJData.exchangeRequest`.
- `siparis-takip.html` — durum zaman çizelgesi (timeline UI + iptal kutusu).
- `degisim-iptal.html` — self-servis talep formu (+ ej-supabase.js yüklemesi).
- `admin-siparisler.html` — durum değişiminde e-posta tetiği, talep listesi + rozet.
