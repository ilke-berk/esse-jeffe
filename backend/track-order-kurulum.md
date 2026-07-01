# Misafir Sipariş Takibi (track-order) Kurulumu

Üye olmadan sipariş veren misafirler, sipariş durumunu artık **sipariş no +
telefon** ile sorgulayabilir. Sipariş oluşturma RLS ile client'a kapalı olduğu
gibi geri okuma da kapalıdır (`"kendi siparişlerim"` politikası `auth.uid()`'e
bağlı) — bu yüzden takip, service_role ile okuyan `track-order` Edge Function'ı
üzerinden yapılır.

## Mimarî (özet)

```
siparis-takip.html (Sipariş No + Telefon)
   │  EJData.trackOrder(order_no, phone)
   │  → client.functions.invoke('track-order', {order_no, phone})
   ▼
Edge Function: track-order
   - order_no (benzersiz) ile tek satır çeker
   - telefon rakamlarını normalize edip son 10 haneyi karşılaştırır
   - İKİSİ de eşleşirse yalnız güvenli alanları döner (adres/e-posta DÖNMEZ)
   - IP başına hız sınırı: order_track_rate_limit (15 / 10 dk)
   ▼
siparis-takip.html sonuç kartı (durum, kalemler, varsa kargo takip no)
```

## Güvenlik notları

- **Bilgi sızdırma yok:** sipariş yok da olsa telefon tutmasa da aynı belirsiz
  `404` mesajı döner ("Sipariş no veya telefon eşleşmedi").
- **Enumeration/kaba kuvvet savunması:** `order_no` tahmin edilebilir formatta
  (`EJ`+11 rakam) olduğu için IP başına hız sınırı **başarılı/başarısız her
  denemeyi** sayar. Telefon eşleşmesi zorunlu olduğundan sadece no tahminiyle
  sipariş görülemez.
- **Minimum alan:** yanıt yalnız durum için gerekenleri içerir (order_no, durum,
  ödeme yöntemi/durumu, tutarlar, il/ilçe, kalemler, varsa kargo takip no).
  Tam adres, e-posta ve telefon **geri dönmez**.

## Deploy adımları

### 1. Şemayı güncelle
`backend/schema.sql` çalıştır (idempotent). Yeni tablo:

```sql
create table if not exists order_track_rate_limit (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_otrl_ip_time on order_track_rate_limit(ip, created_at);
create index if not exists idx_otrl_time on order_track_rate_limit(created_at);
alter table order_track_rate_limit enable row level security;
-- client politikası EKLENMEZ → yalnız service_role erişir.
```

> Not: `siparis-takip.html` sonuç kartında kargo firması/takip no da gösterilir
> (`orders.carrier`, `orders.tracking_no`). Bu kolonlar admin sipariş yönetimiyle
> birlikte `schema.sql`'e eklendi; yoksa `alter table orders add column ...`
> satırları onları geriye dönük ekler.

### 2. Edge Function'ı deploy et
- Kaynak: `backend/edge-functions/track-order/index.ts`
- Supabase CLI: `supabase functions deploy track-order`
  (veya panelden yeni fonksiyon oluşturup içeriği yapıştır).
- Ekstra secret **gerekmez**: `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY`
  otomatik gelir.

### 3. Test et
- Misafir olarak (çıkış yapmış) kapıda ödeme siparişi ver → onay ekranındaki
  **Sipariş Takibi** linkine tıkla (no otomatik dolu) → telefonu gir → sipariş
  görünmeli.
- **Yanlış telefon:** doğru no + yanlış telefon → "eşleşmedi" (`404`).
- **Enumeration:** rastgele no'larla art arda 15+ sorgu → `429` (hız sınırı).
- Telefon formatı esnektir: `0 5xx xxx xx xx`, `+90 5xx...`, boşluklu/boşluksuz
  hepsi son 10 haneye indirgenip eşleştirilir.
