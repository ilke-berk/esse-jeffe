-- 2026-07-21: rate-limit sayaç tablolarının otomatik temizliği (ölçek: binlerce/gün).
--
-- form_rate_limit / chat_rate_limit / order_track_rate_limit / fn_rate_limit
-- tabloları YALNIZCA pencere-içi sayım için tutulur (bill amplification +
-- enumeration savunması). Hiçbir yer eski satırları budamıyordu → binlerce
-- kullanıcıda tablolar sınırsız büyür, autovacuum yükü ve COUNT gecikmesi artar.
--
-- En uzun pencere chat 'start' günlük kotası (86400 sn = 24 s). 25 saati aşan
-- satırlar hiçbir sınır hesabına girmez → güvenle silinir. pg_cron saat başı
-- (dk 20) çalışır; tablolar en fazla ~25 saatlik veri tutar.
--
-- AYRICA: chat_rate_limit tablosu schema.sql'de tanımlı olmasına rağmen canlı
-- veritabanına HİÇ uygulanmamıştı → chat seviyesi IP hız sınırları (start/send/
-- resume/confirm) sessizce çalışmıyordu (rateHit insert'i tablo yok diye yutuluyor,
-- rateLimited COUNT'u hata dönüp 0 sayıyordu = bloklama yok = fatura şişirme açığı).
-- Bu migration tabloyu da oluşturur (schema.sql ile birebir).

create table if not exists public.chat_rate_limit (
  id         bigint generated always as identity primary key,
  ip         text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_crl_ip_kind_time on public.chat_rate_limit(ip, kind, created_at);
create index if not exists idx_crl_time on public.chat_rate_limit(created_at);
alter table public.chat_rate_limit enable row level security;
-- politika YOK → yalnız chat Edge Function (service_role) erişir.

create or replace function public.prune_rate_limits() returns void
language sql
security definer
set search_path = public
as $$
  delete from form_rate_limit        where created_at < now() - interval '25 hours';
  delete from chat_rate_limit        where created_at < now() - interval '25 hours';
  delete from order_track_rate_limit where created_at < now() - interval '25 hours';
  delete from fn_rate_limit          where created_at < now() - interval '25 hours';
$$;

-- idempotent: aynı isimli iş varsa cron.schedule günceller (pg_cron >= 1.4).
select cron.schedule('prune-rate-limits', '20 * * * *', $$select public.prune_rate_limits()$$);
