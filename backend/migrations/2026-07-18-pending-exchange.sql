-- 2026-07-18 — Deterministik değişim onayı: show_exchange_summary çağrısında
-- HAM tool girdisi buraya yazılır; widget'ın "Talebi Onayla" butonu (veya
-- "onaylıyorum" kısa mesajı) Gemini'ye uğramadan confirm_exchange ile işler
-- (pending_order deseninin değişim karşılığı). Her serbest kullanıcı mesajı
-- ve onay/vazgeçme kaydı temizler; 30 dk sonra bayat sayılır (TTL EF'te).
-- RLS değişikliği yok: chat_conversations'a zaten yalnız service_role erişir.
alter table chat_conversations add column if not exists pending_exchange    jsonb;
alter table chat_conversations add column if not exists pending_exchange_at timestamptz;
