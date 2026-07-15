# Terk Edilmiş Sepet Hatırlatma Sistemi — Kurulum & İşletme

Shopify'ın "Abandoned checkout recovery" özelliğinin Esse Jeffe karşılığı:
müşteri sepete ürün ekler, e-postasını verip hatırlatma onayı işaretler ama
siparişi tamamlamazsa **~3 saat sonra** ona indirim kodlu bir hatırlatma
e-postası gider. Maildeki "Sepetime Dön" linki sepeti aynen geri getirir ve
kupon otomatik uygulanır.

## Mimari

```
Tarayıcı (EJCart, ej.js) ──ej:cart-changed──> ej-supabase.js (2.5 sn debounce)
        └─> cart-sync EF ──> abandoned_carts tablosu

pg_cron (her 15 dk) ──x-cron-secret──> cart-reminder EF
        ├─ 3 saattir dokunulmamış + onaylı + siparişsiz sepetleri bulur
        ├─ tek kullanımlık %10 kod üretir (discount_codes, 72 saat, e-postaya bağlı)
        └─ Resend ile hatırlatma maili gönderir (reminded_at atomik claim → çift mail yok)

E-posta linkleri:
  sepet.html?sepet=<token>&kupon=<KOD>  → sepet DB fiyatlarıyla geri yüklenir, kupon dolu gelir
  cart-reminder?unsub=<token>           → hatırlatmalar kapanır (reminder_optout)

create-order / paytr-token: kuponu ATOMİK claim eder, indirimi sunucu toplamına uygular,
  sepeti "recovered" işaretler. Başarısız akışlarda kupon + stok geri açılır.
paytr-callback: ödeme başarılı → recovered; başarısız → kupon serbest bırakılır.
```

**Güvenlik ilkeleri** (mevcut düzenle aynı):
- Yeni tablolara (`abandoned_carts`, `discount_codes`, `reminder_optout`)
  client RLS erişimi YOK — yalnız Edge Function'lar (service_role).
- Client fiyatına asla güvenilmez: sepette saklanan `price` yalnız görüntüdür;
  restore ve sipariş fiyatı her zaman `products` tablosundan okunur.
- Misafir e-postası ancak KVKK onay kutusu işaretliyse saklanır (`consent`,
  `consent_at`). Her mailde çıkış linki; 60 günden eski satırlar otomatik silinir.

## Kurulum durumu (2026-07-15)

| Adım | Durum |
|---|---|
| SQL migration (tablolar + orders.discount kolonları) | ✅ uygulandı |
| `cart-sync` EF deploy (verify_jwt kapalı) | ✅ v1 |
| `cart-reminder` EF deploy (verify_jwt kapalı) | ✅ v1 |
| `create-order` / `paytr-token` / `paytr-callback` kupon destekli redeploy | ✅ |
| pg_cron görevi `cart-reminder-15min` (*/15) + Vault `cart_cron_secret` | ✅ |
| **`CART_CRON_SECRET` Edge Function secret'ı** | ⚠️ **ELLE EKLENMELİ** (aşağıda) |
| Frontend (ej.js v11, ej-supabase.js v12, sepet.html) | ✅ kodda; siteye yayınlanınca aktif |

## ⚠️ Tek manuel adım: CART_CRON_SECRET

Fonksiyon secret'ları API'den yazılamadığı için Dashboard'dan eklenmeli:

1. Supabase Dashboard → Edge Functions → **Secrets** → Add secret
2. Ad: `CART_CRON_SECRET`
   Değer: Vault'taki `cart_cron_secret` ile AYNI olmalı. Değeri görmek için SQL Editor'da:
   ```sql
   select decrypted_secret from vault.decrypted_secrets where name = 'cart_cron_secret';
   ```
3. Kaydet. Bu eklenene kadar cart-reminder her cron çağrısına **401** döner
   (fail-closed — mail gitmez, veri bozulmaz). Eklenince sistem kendiliğinden çalışır.

## Secret'lar

| Secret | Zorunlu | Açıklama |
|---|---|---|
| `CART_CRON_SECRET` | evet | pg_cron → cart-reminder kimlik doğrulaması (yukarıda) |
| `CART_DISCOUNT_PERCENT` | hayır | Hatırlatma kuponu yüzdesi. Varsayılan **10** |
| `RESEND_API_KEY`, `ORDER_FROM_EMAIL`, `SITE_URL` | mevcut | Sipariş mailleriyle ortak; yoksa hatırlatma sessizce atlanır |
| `EDGE_ALLOWED_ORIGINS` | mevcut | cart-sync CORS listesi (diğer fonksiyonlarla ortak) |

## Ayarlar (kod içinde sabit — değiştirmek istersen)

`backend/edge-functions/cart-reminder/index.ts` başında:
- `ABANDON_HOURS = 3` — son sepet hareketinden kaç saat sonra mail
- `CODE_VALID_HOURS = 72` — kupon geçerlilik süresi
- `MAX_AGE_DAYS = 7` — bundan eski sepetlere mail atılmaz (ilk kurulum/uzun kesinti koruması)
- `BATCH = 25` — koşu başına en çok mail
- `PURGE_DAYS = 60` — KVKK veri minimizasyonu (eski satırlar silinir)

## İzleme / işletme

```sql
-- cron çalışıyor mu?
select * from cron.job;
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;

-- bekleyen / gönderilen sepetler
select email, jsonb_array_length(items) items, updated_at, reminded_at, clicked_at, recovered_at
from abandoned_carts order by updated_at desc limit 20;

-- kupon kullanımı (dönüşüm ölçümü)
select code, percent, created_at, used_at, order_id from discount_codes order by created_at desc limit 20;

-- hatırlatmadan dönen siparişler
select order_no, discount_code, discount, total from orders where discount > 0 order by created_at desc;
```

Loglar: Dashboard → Edge Functions → Logs → arama: `"fn":"cart-reminder"` /
`"fn":"cart-sync"`. Önemli olaylar: `reminder_sent`, `reminder_send_failed`,
`cart_synced`, `cart_restored`, `bad_cron_secret`.

## Elle test

```bash
# taramayı hemen tetikle (cron'u beklemeden)
curl -X POST https://grdinhjtsmoograktgge.supabase.co/functions/v1/cart-reminder \
  -H "x-cron-secret: <CART_CRON_SECRET>"
# → {"ok":true,"due":N,"sent":N,"skipped":N}

# bir sepeti "3 saat önce güncellenmiş" yap (test)
# update abandoned_carts set updated_at = now() - interval '4 hours' where email = '...';
```

## WhatsApp / SMS eklemek (ileride)

`cart-reminder/index.ts` içindeki kanal soyutlaması hazır:
```ts
const senders: Record<string, Sender> = { email: sendEmailReminder };
// senders.whatsapp = ...; senders.sms = ...;  → abandoned_carts.channel'a göre seçilir
```
Yeni bir `Sender` fonksiyonu yazıp map'e eklemek ve ilgili sepetlerin
`channel` kolonunu ayarlamak yeterli; tarama/claim/kupon mantığı değişmez.

## Yeniden deploy

```
supabase functions deploy cart-sync                    # verify_jwt kapalı kalmalı
supabase functions deploy cart-reminder --no-verify-jwt
```
(MCP/Dashboard'dan deploy ediliyorsa kaynak düzeni: `<fonksiyon>/index.ts` +
`_shared/` + `deno.json`, import map = `deno.json`.)
