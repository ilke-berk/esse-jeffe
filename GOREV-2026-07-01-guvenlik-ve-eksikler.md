# Görev — 2026-07-01 · Güvenlik Zafiyetleri & Eksikler

> Esse Jeffe site denetimi sonucu çıkan yapılacaklar listesi. Öncelik sırası en altta.

---

## 3. Güvenlik Zafiyetleri

### ✅ ÇÖZÜLDÜ — Kapıda ödeme/havalede fiyat client'tan geliyordu
`backend/ej-supabase.js:93-128` — `createOrder`, sepet kalemlerinin fiyatını localStorage'dan alıp `orders.total` ve `order_items.unit_price` olarak yazıyordu. RLS ise `orders`/`order_items` için `insert with check (true)` idi.

**Sonuç:** Kötü niyetli biri konsoldan sepet fiyatını `1 TL` yapıp kapıda ödeme/havale siparişi geçebiliyordu. Kart akışı güvenliydi (`paytr-token` fiyatı DB'den yeniden hesaplıyor), ama COD/havale bu korumadan yoksundu.

**Yapıldı (2026-07-01):** COD/havale siparişi de artık `create-order` Edge Function'ı üzerinden geçiyor; fiyat kart akışındaki gibi DB'den yeniden hesaplanıyor.
- Yeni: `backend/edge-functions/create-order/index.ts` (service_role ile yazar).
- `ej-supabase.js` → `createOrder` artık doğrudan insert yapmıyor, fonksiyonu çağırıyor.
- `schema.sql` → `orders`/`order_items` için client insert politikaları **kaldırıldı**; yazma yalnızca Edge Function service_role ile.
- Deploy/aktivasyon adımları: `backend/create-order-kurulum.md`.

### ✅ ÇÖZÜLDÜ — Açık insert politikaları + rate limit yok (spam/abuse)
`newsletter_subscribers`, `contact_messages` `with check (true)` idi → herhangi bir anon istemci (bot) bu tablolara sınırsız satır yazabiliyordu (bülten/iletişim spam'i, DB şişmesi).

**Yapıldı (2026-07-01):** Yazma `create-order` deseniyle aynı şekilde Edge Function'a taşındı; açık insert politikaları kaldırıldı.
- Yeni: `backend/edge-functions/submit-form/index.ts` — honeypot + IP başına hız sınırı (bülten 3/saat, iletişim 5/saat) + service_role insert.
- `schema.sql` → `form_rate_limit` sayaç tablosu eklendi; `newsletter_subscribers`/`contact_messages` açık insert politikaları **kaldırıldı** (yeni insert politikası eklenmedi → client yazamaz).
- `ej-supabase.js` → `subscribe`/`sendMessage` artık doğrudan insert yapmıyor, `submit-form`'u çağırıyor ve honeypot iletiyor.
- `index.html` (bülten) + `iletisim.html` (iletişim) → gizli `website` honeypot alanı eklendi.
- Deploy/aktivasyon adımları: `backend/submit-form-kurulum.md`.

### ✅ ÇÖZÜLDÜ — Chat fonksiyonu maliyet istismarına açıktı
`backend/functions/chat/index.ts` CORS `*` idi ve `start`/`send` aksiyonlarında hız sınırı yoktu. Her `send` bir Gemini çağrısı → herhangi bir origin'den bot ile spam yapılırsa Gemini + Supabase faturası şişebiliyordu (bill amplification). `visitor_token` yalnızca tek konuşmayı koruyordu; yeni konuşma başlatmak serbestti.

**Yapıldı (2026-07-01):**
- **CORS origin kilidi:** `Access-Control-Allow-Origin: *` kaldırıldı; `CHAT_ALLOWED_ORIGINS` secret'ındaki izinli origin'ler yansıtılır (localhost/127.0.0.1 yerelde otomatik kabul). Origin'i olan izinsiz istekler 403.
- **Hız sınırı (paylaşımlı IP / mobil CGNAT'ı mağdur etmeyecek şekilde):** Oturum başına `send` **50 mesaj/konuşma** (`visitor_token`'a bağlı, IP'den bağımsız — asıl oturum sınırı; aşılınca WhatsApp/temsilci yönlendirmesi). IP başına burst (`chat_rate_limit` tablosu): `send` **20/dk**, `start` **5/10dk + 40/gün**. Aşımda 429.
- **İstemci birleştirme (UX + maliyet):** `ej-chat.js` AI modunda mesajları ~1.2s birleştirip TEK `send` çağrısı yapar (dürüst kullanıcı için daha az Gemini çağrısı, daha doğal akış). 429/kota yanıtı kullanıcıya sistem mesajıyla gösterilir.
- `schema.sql` → `chat_rate_limit` tablosu + RLS (client politikası yok) eklendi.
- **Aktivasyon:** `chat` fonksiyonunu yeniden deploy et; `CHAT_ALLOWED_ORIGINS` secret'ını prod alan adınla gir; `schema.sql`'i çalıştır (bkz. `backend/chat-README.md`).

> NOT: CORS yalnız tarayıcı kaynaklı çağrıları durdurur; asıl bot koruması IP hız sınırıdır. İstemci birleştirme güvenlik değil, dürüst kullanıcı için maliyet/UX iyileştirmesidir.

### ✅ ÇÖZÜLDÜ — 🟠 Orta — Şema drift'i / repoda eksik SQL (2026-07-01)
`schema.sql` şunları içermiyordu: `profiles.is_admin`, `orders.paid_at`, `orders.payment_ref`, `chat_conversations`/`chat_messages` tabloları, admin/ürün-yazma RLS politikaları, `is_admin()`. `chat-README.md`, olmayan bir `chat-schema.sql`'e atıf yapıyordu.

**Canlı DB (Supabase MCP ile) doğrulandı:**
- **Güvenlik SORUNSUZ.** Ürün yazma politikaları (`products_admin_write`, `product_colors_admin_write`, `product_images_admin_write`) canlıda **`is_admin()` ile kilitli** — hem `using` hem `with_check`. Yani "herkes ürün düzenleyebilir" açığı **yok**; anon key ile yalnız `is_admin=true` authenticated kullanıcı yazabiliyor. Okuma herkese açık, `products` select yalnız `active=true`.
- Eksik sanılan her şey (chat tabloları, `is_admin()`, `profiles.is_admin`, `orders.paid_at`/`payment_ref`) canlıda **mevcut**. Sorun yalnızca repo drift'iydi.

**Yapıldı:** Canlıdaki gerçek tanımlar birebir çekilip `backend/schema.sql`'e eklendi (idempotent): `profiles.is_admin` + geriye dönük `alter add column`, `orders.paid_at`/`payment_ref` + `alter add column`, `chat_conversations`/`chat_messages` tabloları+indeksler+FK+check, `is_admin()` (SECURITY DEFINER, boş search_path), ürün ve chat admin RLS politikaları, RLS enable. `chat-README.md`'deki `chat-schema.sql` atfı `schema.sql` sohbet bölümüne güncellendi. Artık tek dosyadan sıfırdan kurulabilir.

### ✅ ÇÖZÜLDÜ — 🟡 Düşük öncelikli üç madde (2026-07-01)
- **✅ `paytr-token` `origin` client'tan geliyordu** (`paytr-token/index.ts`) → artık ok/fail yönlendirme origin'i bir **allowlist'e** bağlı. Client'ın gönderdiği `origin` yalnızca `PAYTR_ALLOWED_ORIGINS` (yoksa `SITE_URL`, yoksa prod alan adı) içindeyse kullanılır; değilse ilk izinli origin'e sabitlenir + yerel geliştirmede `localhost/127.0.0.1` kabul edilir. Böylece kötü niyetli client kullanıcıyı başka siteye yönlendiremez. **Aktivasyon:** prod'da `PAYTR_ALLOWED_ORIGINS` secret'ını (ya da `SITE_URL`) gerçek alan adınla gir.
- **✅ `?paytr=ok` ile sahte başarı / sepet kaybı** (`sepet.html`) → `openPaytr` çağrısında sipariş no'su `sessionStorage`'a yazılıyor; `?paytr=ok` dönüşünde yalnızca **bu oturumda başlatılan ve `no` ile eşleşen** ödemede "başarılı" ekranı gösterilip sepet temizleniyor. URL'i elle `?paytr=ok` yazan biri artık sahte başarı görmez ve **sepetini kaybetmez** (checkout'a döner). Gerçek ödeme onayı zaten server-side `paytr-callback`'ten gelir; bu ekran sadece UX.
- **✅ Şifre kuralı tutarsızlığı** → frontend zaten min 8 dayatıyor (`ej-supabase.js` → `handleRegister`) ve hata mesajı eşlemesi Supabase'in "Password should be at least…" metnini yakalıyor. Panel ayarının da 8 olması için **somut adımlar** `backend/uyelik-guvenlik-raporu.md`'ye eklendi (Authentication → Email → Minimum password length = 8). NOT: Bu son adım panelden yapılman gereken bir ayar; kod tarafı hazır.

---

## 4. Kullanıcıya Açılınca Çıkabilecek Sorunlar (Fonksiyonel/UX)

- **Admin'de sipariş yönetimi yok:** `admin.html` (destek) ve `admin-urunler.html` (ürün) var, ama sipariş listeleme/durum güncelleme ekranı yok. Siparişler yalnızca Supabase dashboard'undan görülüyor → operasyonel büyük boşluk. Kargoya verildi/teslim edildi gibi durum güncellemesi arayüzü yok.
- **✅ ÇÖZÜLDÜ — Misafir sipariş takibi (2026-07-01):** "Sipariş no + telefon ile sorgula" akışı eklendi. RLS geri okumayı engellediği için takip, service_role ile okuyan `track-order` Edge Function üzerinden yapılır; `order_no` **ve** telefon (rakam normalize, son 10 hane) **ikisi de** eşleşirse yalnız güvenli alanlar döner (adres/e-posta dönmez). IP başına hız sınırı (`order_track_rate_limit`, 15/10 dk) enumeration/kaba kuvveti yavaşlatır; eşleşmezse belirsiz `404` (bilgi sızdırmaz). Yeni sayfa `siparis-takip.html` (footer "Yardım" + sepet onay ekranından linkli, no otomatik dolu); kargo firması/takip no da gösterilir. Deploy: `backend/track-order-kurulum.md`.
- **✅ ÇÖZÜLDÜ — Arama (2026-07-01):** Header'daki büyüteç ikonu artık tam ekran bir arama paneli açıyor (`ej.js` yeni `Arama` IIFE'si + `ej.css` `.search-*` stilleri). İsim/model üzerinde Türkçe + aksan duyarsız (`ejNorm`) anlık filtreleme; sonuçlar `urun.html?slug=…`'e link. Veri kaynağı: Supabase açıksa canlı `EJData.products()` (başarılıysa önbelleğe alınır, değilse statik'e düşer ve sonra tekrar dener), kapalıysa yeni paylaşılan `EJ_CATALOG`. 19 sayfanın hepsi `ej.js`+`ej.css` yüklediği için tek noktadan çözüldü; HTML'lere dokunulmadı (yalnız `?v=` cache sürümleri artırıldı).
- **✅ ÇÖZÜLDÜ — Mega menü senkronu (2026-07-01):** Elle hardcode 9 kart kaldırıldı; kartlar artık tek kaynak `EJ_CATALOG`'dan üretiliyor ve **hepsi** `urun.html?slug=…`'e gidiyor (eskiden çoğu `koleksiyon.html`'e gidiyordu). Supabase açıkken `ej-supabase.js` → `renderMega()` aynı `#megaProducts` kutusunu koleksiyon grid'iyle **aynı** canlı DB verisiyle üzerine yazıyor → menü katalogla asla eskimiyor. Veri yoksa statik kartlar fallback kalır.
- **✅ ÇÖZÜLDÜ — Sipariş onay e-postası (2026-07-01):** artık müşteriye onay + işletmeye "yeni sipariş" bildirimi gidiyor (Resend). COD/havale `create-order`'da sipariş yazılınca; kart ise `paytr-callback`'te ödeme `success` olunca (oluşturma anında değil, ödeme doğrulanınca). Paylaşılan modül: `backend/edge-functions/_shared/order-email.ts`. **Fail-soft:** mail hatası siparişi bozmaz; secret (`RESEND_API_KEY`/`ORDER_FROM_EMAIL`) yoksa gönderim sessizce atlanır. Havalede `ORDER_BANK_INFO` girilirse IBAN bloğu eklenir; işletme maili `reply_to`=müşteri. İdempotent (`payment_status=paid` ise callback erken döner → çift mail yok). Aktivasyon: `backend/siparis-eposta-kurulum.md` (Resend domain doğrulama + secret'lar).
- **✅ ÇÖZÜLDÜ — Stok takibi (2026-07-01):** Varyant (ürün × renk × beden) başına `product_stock` tablosu eklendi. Aşırı satış, **atomik** `reserve_stock_bulk` RPC'si ile önlenir: her varyant satırı `FOR UPDATE` ile kilitlenir, "önce hepsini doğrula → sonra hepsini düş" iki-geçişli mantık tek transaction'da çalışır, eşzamanlı siparişler serileşir (race yok). Sipariş yolları güncellendi: `create-order` (COD/havale) ile `paytr-token` (kart) sipariş açmadan önce stok ayırır; yetmezse `409` + `out_of_stock` döner. Kart ödemesi başarısız/iptal/timeout olursa `paytr-callback` ayrılan stoğu `restore_stock_bulk` ile geri verir (yalnız `pending→failed` ilk geçişte → çift iade yok); token/insert hataları da iade eder. **Güvenli geçiş:** mevcut varyantlar `track=false` (sınırsız) tohumlanır — hiçbir satış engellenmez; admin gerçek adedi girip `track=true` yapınca koruma o varyantta devreye girer. RPC'ler yalnız `service_role`'e açık (anon/authenticated `revoke`). Kurulum & envanter girişi: `backend/stok-takibi-kurulum.md`. **Kalan (opsiyonel):** ürün sayfasında "tükendi" rozeti + AI'a stok bilgisi (`product_stock` herkese okunur, altyapı hazır).
- **✅ ÇÖZÜLDÜ — Chat polling yükü (2026-07-01):** ziyaretçi tarafı sabit `setInterval` (4s) yerine **uyarlanabilir yoklamaya** geçti (`ej-chat.js`). AI modu boşta 8s→20s backoff (senkron AI yanıtı zaten `send` cevabında geliyor; yoklama yalnız operatör devralmasını yakalar), canlı destek/beklemede 3.5s, **sekme arka planda veya panel kapalıyken hiç istek yok** (`visibilitychange` + panel/konuşma guard'ı). Backend değişmedi; visitor_token/doğrudan-DB-yok güvenlik modeli korundu (Supabase Realtime anon'a tablo select/subscribe açacağı için tercih edilmedi). İstek yükü boşta ~5×, arka plan sekmede %100 azalır.

---

## 5. SEO / Erişilebilirlik Eksikleri

- **Meta/paylaşım eksik:** `index.html` ve diğer sayfalarda `meta description`, Open Graph, Twitter Card, `canonical`, favicon yok. Sosyal paylaşımda çirkin önizleme, zayıf SEO.
- **`robots.txt` / `sitemap.xml` yok.**
- **Ürün sayfaları client-render:** `urun.html` başlığı/içeriği JS ile `?slug`'dan dolduruluyor. Googlebot JS render etse de e-ticaret için riskli; JSON-LD Product schema (fiyat, stok, rating) ve sunucu tarafı meta yok → zengin sonuç/indekslenme kaybı.
- **Analytics/Pixel yok:** GA4 / Meta Pixel / dönüşüm takibi yok — reklam ve dönüşüm ölçümü yapılamaz.
- **CLS riski:** ürün kartı görsellerinde `width/height` ve grid'de `loading="lazy"` yok (`ej-supabase.js:49`).

---

## 6. Optimizasyon Önerileri

**Performans**
- `ej.css` (33KB), `ej.js` (20KB), `ej-chat.js` (35KB) minify edilmemiş — prod için minify/gzip.
- Ürün grid görsellerine `loading="lazy"` + boyut ekle (LCP/CLS iyileşir).
- **Font çift yükleme:** hem Google Fonts (Spectral) hem yerel `_ds/.../fonts.css` yükleniyor — birini seç, `font-display: swap` ve preload uygula.
- supabase-js her sayfada CDN'den dinamik `<script>` ile geliyor; `<link rel="preconnect">`/preload ile hızlandır, sürüm sabitle (`@2` yerine `@2.x.y`).

**Sağlamlık**
- Hata izleme (Sentry vb.) yok — şu an sadece `console.error`.
- Edge Function'lara yapılandırılmış loglama + rate limit.
- Otomatik test yok.

---

## Geliştirilmesi Gerekenler (öncelik sırasıyla)

1. ~~COD/havale fiyat doğrulamasını sunucuya taşı (🔴).~~ ✅ Yapıldı — `create-order` Edge Function + RLS kilidi.
2. Admin sipariş yönetimi ekranı (kalan) + ~~sipariş e-posta bildirimi~~ ✅ (Resend, `create-order` + `paytr-callback`, `_shared/order-email.ts`).
3. Spam koruması (Captcha/rate limit) — ~~bülten, iletişim~~ ✅ (honeypot + IP hız sınırı, `submit-form`); ~~chat~~ ✅ (origin kilidi + IP hız sınırı, `chat_rate_limit`); **kalan: sipariş rate-limit**.
4. Eksik SQL'i repoya ekle, admin RLS'i doğrula.
5. SEO paketi (meta/OG/favicon/JSON-LD/sitemap) + Analytics.
6. ~~Misafir sipariş takibi~~ ✅ (`track-order` + `siparis-takip.html`) + site içi arama (kalan).
7. (Sonraki faz) stok takibi, kupon, favoriler, ürün yorumları.
