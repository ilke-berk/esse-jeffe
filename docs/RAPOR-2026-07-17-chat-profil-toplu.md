# Rapor — Chat Asistanı + Profil + Toplu Güncelleme Sürümü (2026-07-17)

Kullanıcının 10 maddelik istek listesinin tamamı bu sürümde kapatıldı.
Plan: `~/.claude/plans/bunlar-yap-lmas-gerekiyr-bence-shimmering-hearth.md`

## Canlıya alınanlar

| # | İş | Nerede |
|---|----|--------|
| 1 | Chat bekleme süresi 10 sn → 6 sn | `ej-chat.js` `COALESCE_MS` |
| 2 | **Deterministik sipariş onayı** — "Siparişi Onayla" artık Gemini'ye uğramaz; `show_order_summary`'de saklanan `chat_conversations.pending_order` sunucudaki `confirm_order` aksiyonuyla işlenir (30 dk TTL, her serbest mesaj bayatlatır, çifte tıklama idempotent). "Bunu tam anlayamadım" onay akışını artık düşüremez. Karta **Vazgeç** butonu eklendi (`cancel_order`). | chat EF v17+, `ej-chat.js` `confirmOrder` |
| 3 | **İade filtresi** — prompt sertleştirme + deterministik regex son-kontrol (`guards.ts`): taahhüt kalıbı yakalanırsa 1 düzeltici tur, yine ihlalse sabit güvenli değişim metni. Log: `iade_filter_hit`. Canlı e2e doğrulandı. | `backend/functions/chat/guards.ts`, `tests/iade-guard.test.mjs` |
| 4 | Kart ödemesi chatte zaten vardı (PayTR iframe); onay düzelince fiilen erişilir oldu. Bilinen boşluk: ödeme sonrası üst pencere `sepet.html?paytr=ok`'a taşınır (kabul edildi). | — |
| 5 | **Chatten değişim/iptal talebi** — yeni Gemini tool'u `create_exchange_request`; submit-form `kind='exchange'` kurallarının birebir kopyası (order_no+telefon İKİSİ eşleşmeli, açık talep mükerrer açılmaz, `form_rate_limit` ORTAK sayaç 5/60dk, enumeration sızdırmaz). İşletmeye e-posta gider; admin-siparisler'de görünür. | chat EF v18 |
| 6 | **Nominatim adres teyidi** — `handleSummary` içinde deterministik il/ilçe geocode (4 sn timeout, cache, fail-soft). Eşleşirse özet kartında "Adres teyidi: …" satırı; eşleşmezse model müşteriden yazımı kontrol etmesini ister (siparişi engellemez). | chat EF v18, `ej-chat.js` |
| 7 | **Konuşma puanlama** — kapanışta 1-5 yıldız + opsiyonel yorum (`rate` aksiyonu, `chat_conversations.rating/rating_comment/rated_at`); admin.html listede ★, üst barda ortalama, başlıkta yorum. Hiç mesaj yazılmamışsa sorulmaz. | chat EF v18, `ej-chat.js`, `admin.html` |
| 8 | **Hesabım sipariş görünürlüğü** — durum renkli rozet (`data-st`) + kompakt 4 adımlı timeline + kargo firması/takip no satırı; siparis-takip rozetleri de renklendi. **Header Hesap ikonunda aktif sipariş rozeti** (pending/preparing/shipped sayısı; runtime inject, 5 dk cache). | `hesap.html`, `ej.css` v11, `backend/ej-supabase.js` v16 |
| 9 | **Profil + adres defteri** — hesap.html'de profil (ad/telefon) düzenleme ve adres CRUD (`addresses` tablosu + `is_default`); sepet.html checkout'u profil/varsayılan adresle YALNIZ boş alanları doldurur; chat girişli müşteriye kayıtlı bilgileri teyitle önerir (KAYITLI MÜŞTERİ BİLGİLERİ bloğu). | `hesap.html`, `sepet.html`, chat EF v18 |
| 10 | **Toplu kargo/durum güncelleme** — admin-siparisler "Toplu Güncelle" modalı: (a) Excel/CSV (SheetJS tembel CDN, başlık sezgisel eşleme), (b) ekran görüntüsü OCR (yeni `bulk-order-ocr` EF: verify_jwt+is_admin, Gemini Vision, YALNIZ ayıklar — yazma admin JWT+RLS ile client'ta). Önizleme (eşleşti-diff/aynı/bulunamadı/geçersiz + mükerrer uyarısı) → sıralı update → durum değişenlere ~400 ms arayla durum e-postası (dedupe sunucuda). | `admin-bulk.js`, `admin-siparisler.html`, `backend/edge-functions/bulk-order-ocr/` |

## Şema değişiklikleri (migration uygulandı + schema.sql güncel)

- `chat_conversations`: `pending_order jsonb`, `pending_order_at`, `rating smallint (1-5)`, `rating_comment`, `rated_at`
- `addresses`: `is_default boolean` + kullanıcı başına tek varsayılan (partial unique index)
- `orders`: `orders_status_chk` + `orders_payment_status_chk` CHECK kısıtları (toplu yazıcı emniyeti)

## Deploy durumu

- chat EF **v18** CANLI (`verify_jwt:false`, mevcut ayar)
- `bulk-order-ocr` EF **v1** CANLI (`verify_jwt:true`)
- Statik sürümler: `ej-chat.js?v=19`, `ej.css?v=11`, `ej-supabase.js?v=16` (23 HTML güncellendi)

## Doğrulama

- Birim: `npm test` 102/102 (yeni: `iade-guard.test.mjs`, `bulk.test.mjs`)
- Playwright smoke (yerel, 19/19): widget DOM, yıldız ekranı, hesap yönlendirmesi, sepet, bulk modal + EJBulk, admin.html
- Canlı e2e: "iade edebilir miyim?" → taahhütsüz doğru değişim cevabı; `confirm_order` aksiyonu canlıda (sahte token 403)
- Elle test edilmesi kalanlar (gerçek sipariş gerektirir): chatten COD sipariş onay butonu, kart iframe akışı, chatten değişim talebi, OCR ile gerçek Aras ekran görüntüsü, girişli kullanıcıda header rozeti

## Bilinen sınırlar

- Nominatim yalnız il/ilçe doğrular (TR'de sokak düzeyi OSM güvenilir değil).
- `last_status_emailed` yalnız SON durumu hatırlar; toplu işlemde aynı sipariş iki farklı duruma çekilirse iki mail gider (önizleme mükerrerleri birleştirir).
- Chat kart ödemesi tamamlanınca konuşmaya "ödeme tamamlandı" mesajı düşmez (paytr-callback siparişi güvenle oluşturur; ileride chat-özel success_url).
