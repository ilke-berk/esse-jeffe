-- ============================================================
-- 2026-07-17 — RLS performans düzeltmesi + mükerrer policy + FK indeksleri
-- Supabase SQL Editor'de bir kez çalıştırın (tamamı tekrar çalıştırmaya güvenli).
-- Kaynak: Supabase advisor uyarıları (lint 0003 auth_rls_initplan,
--         0006 multiple_permissive_policies, 0001 unindexed_foreign_keys)
-- Not: Policy adları CANLI veritabanındaki adlardır (bazıları ASCII,
--      schema.sql'deki Türkçe karakterli adlardan farklı olabilir).
-- ============================================================

begin;

-- 1) profiles: mükerrer UPDATE policy'sini kaldır.
--    "kendi profilini guncelle" (ASCII) WITH CHECK'siz eski sürümdü;
--    güvenlik denetimi #1 ile eklenen "kendi profilini güncelle" kalıyor.
drop policy if exists "kendi profilini guncelle" on public.profiles;

-- 2) RLS initplan: auth.uid() → (select auth.uid())
--    Böylece her satır için yeniden hesaplanmaz; büyük tablolarda
--    sorgu süresi belirgin düşer.
alter policy "kendi profilini gor" on public.profiles
  using ((select auth.uid()) = id);

alter policy "kendi profilini güncelle" on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

alter policy "kendi adreslerim" on public.addresses
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "kendi siparislerim" on public.orders
  using ((select auth.uid()) = user_id);

alter policy "kendi siparis kalemlerim" on public.order_items
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.user_id = (select auth.uid())
  ));

-- 3) İndekssiz foreign key'lere covering index (lint 0001)
create index if not exists idx_discount_codes_abandoned_cart on public.discount_codes(abandoned_cart_id);
create index if not exists idx_discount_codes_order          on public.discount_codes(order_id);
create index if not exists idx_loyalty_status_current_code   on public.loyalty_status(current_code_id);
create index if not exists idx_newsletter_welcome_code       on public.newsletter_subscribers(welcome_code_id);
create index if not exists idx_order_items_product           on public.order_items(product_id);

commit;

-- Doğrulama (isteğe bağlı): aşağıdaki sorgu 0 satır dönmeli
-- select policyname from pg_policies
--  where tablename='profiles' and policyname='kendi profilini guncelle';
