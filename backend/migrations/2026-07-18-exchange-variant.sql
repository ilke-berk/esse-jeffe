-- 2026-07-18 — Sohbetten uçtan uca değişim: exchange_requests'e yapılandırılmış
-- yeni-varyant alanları. Hepsi nullable: eski kayıtlar ve degisim-iptal.html
-- form kanalının insert'i (submit-form EF) etkilenmez. RLS değişikliği yok
-- (yazma zaten yalnız service_role, okuma/update yalnız admin).
alter table exchange_requests add column if not exists product_name text;        -- değişecek kalemin adı (order_items'tan kopya)
alter table exchange_requests add column if not exists new_color    text;        -- istenen YENİ renk (katalog kanonik adı)
alter table exchange_requests add column if not exists new_size     text;        -- istenen YENİ beden
alter table exchange_requests add column if not exists updated_at   timestamptz; -- sohbetten son güncelleme anı
