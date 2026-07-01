# Bülten & İletişim — Spam Korumalı Form Gönderimi (submit-form) Kurulumu

Açık insert açığı kapatıldı. `newsletter_subscribers` ve `contact_messages`
tablolarına artık **doğrudan client insert'i yapılamaz**. Yazma yalnızca
`submit-form` Edge Function'ı üzerinden (service_role) olur; honeypot + IP başına
hız sınırı burada uygulanır. `create-order` ile aynı mimari desen.

## Neyi çözer

Önceden RLS `with check (true)` idi → herhangi bir anon bot anon key ile tablolara
sınırsız satır yazabiliyordu (bülten/iletişim spam'i, DB şişmesi). Artık:

1. **RLS kilidi** — açık insert politikaları kaldırıldı; anon/authenticated rol yazamaz.
2. **Honeypot** — formlarda gizli `website` alanı; bir bot doldurursa istek sessizce yok sayılır.
3. **IP hız sınırı** — `form_rate_limit` tablosunda pencere içi sayım
   (bülten: saatte 3, iletişim: saatte 5 / IP). Aşılırsa `429`.

## Akış

```
index.html (bülten)  /  iletisim.html (iletişim)
   │  EJData.subscribe(email, hp)  /  EJData.sendMessage({...})
   │  → client.functions.invoke('submit-form', { kind, ... , hp })
   ▼
Edge Function: submit-form
   - honeypot dolu mu? → sessizce ok dön, yazma
   - IP hız sınırı (form_rate_limit) → aşıldıysa 429
   - doğrula + newsletter_subscribers | contact_messages insert (service_role)
```

## Deploy adımları

### 1. SQL'i güncelle (açığı asıl kapatan adım)
`backend/schema.sql` güncellendi. Supabase → SQL Editor'de çalıştır (tüm dosyayı
yeniden çalıştırmak güvenli; yoksa şu parçayı çalıştır):

```sql
-- hız sınırı sayaç tablosu
create table if not exists form_rate_limit (
  id         bigint generated always as identity primary key,
  ip         text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_frl_ip_kind_time on form_rate_limit(ip, kind, created_at);
create index if not exists idx_frl_time on form_rate_limit(created_at);
alter table form_rate_limit enable row level security;   -- politika yok → yalnız service_role

-- eski açık insert politikalarını kaldır (yerine yeni EKLENMEZ)
drop policy if exists "bültene abone ol"     on newsletter_subscribers;
drop policy if exists "iletişim mesajı bırak" on contact_messages;
```

Bundan sonra anon/authenticated rol bu tablolara **doğrudan yazamaz**.

### 2. Edge Function'ı deploy et
- Kaynak: `backend/edge-functions/submit-form/index.ts`
- Supabase CLI: `supabase functions deploy submit-form`
  (veya panelden yeni fonksiyon oluşturup içeriği yapıştır).
- Ekstra secret **gerekmez**: `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` otomatik gelir.

### 3. Frontend (zaten repoda)
- `ej-supabase.js` → `subscribe`/`sendMessage` artık `submit-form`'u çağırıyor ve honeypot iletiyor.
- `index.html` (bülten) ve `iletisim.html` (iletişim) formlarına gizli `website` honeypot alanı eklendi.

### 4. Test
- **Bülten:** index.html'de e-posta gir → "Abone olundu". Aynı e-posta tekrar → "Zaten abonesiniz".
- **İletişim:** iletisim.html formunu gönder → "talebiniz alındı".
- **Honeypot:** DevTools'ta gizli `website` alanına değer yaz, gönder → kullanıcı başarı görür ama
  `contact_messages`/`newsletter_subscribers`'a satır **eklenmez**.
- **Hız sınırı:** aynı IP'den bülteni hızlıca 4+ kez dene → 4.'de "Çok fazla deneme" (429).
- **Doğrudan insert:** anon key ile `newsletter_subscribers`'a insert → RLS **reddetmeli**.

## Bakım (opsiyonel)
`form_rate_limit` her istekte 24 saatten eski satırları temizler; yine de istersen
düzenli tam temizlik için pg_cron ekleyebilirsin:

```sql
select cron.schedule('frl-cleanup','0 4 * * *',
  $$delete from form_rate_limit where created_at < now() - interval '2 days'$$);
```

## Ayar
Limitler `submit-form/index.ts` içindeki `LIMITS` sabitinden değiştirilir
(bülten `{max:3, windowMin:60}`, iletişim `{max:5, windowMin:60}`).
