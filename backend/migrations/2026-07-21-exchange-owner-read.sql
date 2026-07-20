-- 2026-07-21 — Değişim talebi müşteri görünürlüğü: girişli kullanıcı KENDİ
-- siparişine bağlı talepleri okuyabilsin (hesap.html sipariş kartı rozeti).
-- Yazma yine yalnız service_role; misafir görünürlüğü track-order EF üzerinden
-- (sipariş no + telefon doğrulamalı) sağlanır, RLS'e dokunmaz.
drop policy if exists exchange_requests_owner_read on exchange_requests;
create policy exchange_requests_owner_read on exchange_requests
  for select to authenticated
  using (exists (
    select 1 from orders o
    where o.id = exchange_requests.order_id and o.user_id = (select auth.uid())
  ));
