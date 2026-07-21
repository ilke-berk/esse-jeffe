-- 2026-07-21 — Faz 2 (kart kalıcılığı): onay öncesi GÖRSEL kart payload'unu
-- kalıcı kolonda tut. Bugüne dek kart yalnız send/confirm_* HTTP yanıt gövdesinde
-- (ephemeral) taşınıyordu; poll/resume/start pending taşımadığı için timeout,
-- panel yeniden-açma, 2. sekme ya da resume durumlarında "metin var, buton yok"
-- semptomu doğuyordu (bkz. docs/PLAN-chat-guvenlik-fazlari.md, kök neden B).
--
-- pending_order / pending_exchange (HAM tool girdisi) KORUNUR: onay anında
-- resolveOrder fiyat/stok/kupon yeniden-doğrulaması ve kısa-onay kısayolu için
-- gereklidir. Render-hazır kart payload'u AYRI kolona yazılır; poll/resume/start
-- taze pending'i bu kolondan yeniden kurar (widget re-derive).
-- RLS değişikliği yok: chat_conversations'a zaten yalnız service_role erişir.
alter table chat_conversations add column if not exists pending_order_card    jsonb;
alter table chat_conversations add column if not exists pending_exchange_card jsonb;
