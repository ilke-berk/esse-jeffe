-- Guvenlik denetimi kalan fazlar — FAZ 3 (2026-07-22)
-- Kaynak: docs/PLAN-guvenlik-kalan-fazlar.md

-- 1) prune_rate_limits: projedeki REVOKE desenine uydur (yalniz service_role)
revoke all on function public.prune_rate_limits() from public, anon, authenticated;
grant execute on function public.prune_rate_limits() to service_role;

-- 2) products bucket: genis SELECT (listeleme) politikasini kaldir.
-- Public bucket'ta nesne URL erisimi icin SELECT politikasi gerekmiyor;
-- admin erisimi products_obj_admin_write (ALL + is_admin) ile devam eder.
drop policy if exists products_obj_public_read on storage.objects;

-- 3) Double opt-in tablosu (EF akisi ayri is; simdilik yalniz tablo + RLS)
-- Politika yok = yalniz service_role erisir.
create table if not exists public.email_confirmations (
  token uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
alter table public.email_confirmations enable row level security;
