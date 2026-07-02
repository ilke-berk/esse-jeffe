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

### ✅ ÇÖZÜLDÜ — AI asistan kalıcı hafıza + `start`'ta user_id spoof (2026-07-02)
İki sorun birlikte ele alındı: (a) chat `start`, `user_id`'yi client beyanından alıyordu → başkasının hesabına konuşma bağlanabilirdi (hafıza özelliğiyle birlikte başkasının sohbet özetini sızdırabilir hâle gelecekti); (b) AI, geçmiş sohbeti yalnız aynı tarayıcının localStorage'ı üzerinden hatırlıyordu; ayrıca geçmiş sorgusu `order(created_at).limit(30)` ile **ilk** 30 mesajı aldığından uzun sohbette AI en YENİ mesajları göremiyordu.

**Yapıldı (2026-07-02):**
- **Son-30 bug'ı:** geçmiş artık `desc + limit(30) + reverse` ile çekiliyor (en son 30 mesaj).
- **`start`'ta JWT doğrulama:** `user_id` client'tan alınmıyor; widget girişli kullanıcının `access_token`'ını gönderir, fonksiyon `admin.auth.getUser` ile doğrular.
- **`resume` action'ı:** localStorage boşsa (farklı cihaz/tarayıcı) widget, JWT ile kullanıcının son konuşmasını devralır; `visitor_token` yalnız konuşma sahibine döner. 30 günden eski / `closed` konuşma devralınmaz. IP hız sınırı: 10/dk.
- **`end` action'ı:** widget'taki "görüşmeyi sonlandır" artık sunucuda `status=closed` yapar → resume ile geri gelmez.
- **Özet hafıza:** girişli kullanıcı yeni konuşma başlatınca önceki konuşması Gemini ile 3-4 cümleye özetlenir, `chat_conversations.summary`'ye yazılır ve system prompt'a "ÖNCEKİ GÖRÜŞME NOTU" olarak eklenir (90 gün geriye bakar; `EdgeRuntime.waitUntil` ile arka planda). `schema.sql` → `summary` kolonu + `user_id` partial index.
- **`conv_limit` (50 mesaj) kilidi çözüldü:** sınıra ulaşan konuşma widget'ta kapatılıp sıfırlanır; kullanıcının sonraki mesajı (özet hafızayla) yeni konuşmada devam eder.
- **Retention (KVKK):** `start` sırasında 12 aydan eski konuşmalar silinir (mesajlar cascade); `gizlilik.html`'e sohbet kayıtları/12 ay saklama paragrafı eklendi.
- `ej-chat.js` sürümü tüm sayfalarda `?v=13`'e yükseltildi.
- **Aktivasyon:** `schema.sql`'i çalıştır (summary kolonu + index) ve `chat` fonksiyonunu yeniden deploy et.

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

- **✅ ÇÖZÜLDÜ — Admin sipariş yönetimi (2026-07-02):** `admin-siparisler.html` eklendi — sipariş listeleme, durum filtreleri (beklemede/hazırlanıyor/kargoda/teslim/iptal), sipariş no/ad/telefon araması, durum + ödeme durumu + kargo firması/takip no güncelleme ("ödendi" işaretlenince `paid_at` otomatik). Güvenlik: `signInWithPassword` + `profiles.is_admin` kontrolü; asıl kapı RLS (`orders_admin_read`/`orders_admin_update`, yalnız `is_admin()`). Kalan (küçük): sayfalama yok — sipariş sayısı 1000'i aşınca `range()` eklenmeli.
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
- ✅ **ÇÖZÜLDÜ (2026-07-02) — 🔴 Anasayfada ~2 MB geliştirici JS:** `index.html` her ziyaretçiye `react.development.js` + `react-dom.development.js` + `@babel/standalone` (~1.5 MB) yüklüyordu; tek amaçları sağdaki "Tweaks" tasarım paneli (`tweaks-panel.jsx`, hero düzeni/font/başlık/overlay seçici, `EDITMODE` işaretli) idi — yani ziyaretçiye giden bir tasarım editörü. **Yapıldı:** React/Babel/tweaks blok `index.html`'den tamamen kaldırıldı; seçili tasarım statik gömüldü (`<body data-hero="full" style="--ov:.9">`, font zaten Spectral = ej.css varsayılanı). Editör kaybolmadı: `demo.html` artık editörlü anasayfa kopyası (tweaks paneli çalışır, `noindex,nofollow` ile arama motoruna kapalı). Eski `demo.html` (sayfa dizini/site haritası) git geçmişinde. **Net kazanç: anasayfa ~2 MB daha hafif.**
- ✅ **ÇÖZÜLDÜ (2026-07-02) — Görsel lazy-load:** ürün kartı görsellerine `loading="lazy" decoding="async" width/height` eklendi (`ej-supabase.js` `cardHTML`; zaten `aspect-ratio:3/4` vardı → CLS iyileşir). Ayrıca arama sonucu küçük resmi + sepet paneli görselleri (`ej.js`) lazy yapıldı.
- ✅ **ÇÖZÜLDÜ (2026-07-02) — "Font çift yükleme" (aslında ölü yük):** Yerel `_ds/.../fonts.css` **Playfair + Jost** yüklüyordu; oysa site fontu **Spectral** (`--serif`, Google Fonts) — Playfair/Jost'u yalnızca kaldırılan Tweaks paneli kullanıyordu (o da Google Fonts'tan dinamik çekiyor). Yani yerel `fonts.css` **tüm sayfalarda ölü yüktü** (7 woff2 boşa). `fonts.css` `<link>`'i **21 HTML'nin hepsinden** kaldırıldı. Google Fonts Spectral zaten `preconnect` + `display=swap` ile geliyor.
- ✅ **ÇÖZÜLDÜ (2026-07-02) — supabase-js pin + preconnect:** CDN sürümü `@2` (kayan) → `@2.110.0` sabitlendi (`ej-supabase.js` dinamik yükleyici + 3 admin sayfası). `cdn.jsdelivr.net`'e preconnect eklendi: içerik sayfalarında `ej-supabase.js` parse edilir edilmez link enjekte ediliyor (tek nokta, tüm sayfalar); admin sayfalarına statik `<link rel="preconnect">`.
- ⏳ **Kalan — minify/gzip:** `ej.css` (33KB), `ej.js` (20KB), `ej-chat.js` (35KB) hâlâ minify değil. Statik site + build yok; sunucu tarafı gzip/brotli veya ileride bir build adımı önerilir.

**Sağlamlık**
- ✅ **ÇÖZÜLDÜ (2026-07-02) — Yapılandırılmış loglama + rate limit:** ham `console.error` yerine istek başına tek-satır-JSON logger (`_shared/log.ts`, `request_id`+`elapsed_ms`, PII yazmaz). Tüm Edge Function'lar bağlı (`create-order`, `paytr-token`, `paytr-callback`, `submit-form`, `track-order`, `order-email`; `chat` farklı ağaçta olduğundan aynı biçimli yerleşik `chatLog` kullanır). IP rate-limit ortak modüle (`_shared/rate-limit.ts`) toplandı; sipariş için `fn_rate_limit` (create-order+paytr-token ORTAK, 10/60dk — yalnız başarıyla açılan sipariş sayılır), form (3–5/60dk), takip (15/10dk).
- ✅ **ÇÖZÜLDÜ (2026-07-02) — Hata izleme (iki katman):** **(a) Sunucu/Sentry:** logger `error` seviyesinde `SENTRY_DSN` tanımlıysa olayı Sentry'ye iletir (`_shared/sentry.ts`); `EdgeRuntime.waitUntil` ile arka planda, fail-soft (gönderim akışı bozmaz), PII göndermez; DSN yoksa atlanır. **(b) İstemci (tarayıcı):** `ej.js` başındaki EJMonitor `window.onerror`+`unhandledrejection`'ı yakalar → YENİ `log-error` Edge Function (20/saat/IP + sayfa başına 8) → `client_errors` tablosu (yazma yalnız service_role, okuma yalnız admin). Aktivasyon: `backend/saglamlik-kurulum.md`.
- ✅ **ÇÖZÜLDÜ (2026-07-02) — Otomatik test (iki takım):** **(a) Node** (`tests/*.test.mjs`, `npm test`, bağımlılıksız; `--experimental-strip-types` ile `.ts` modüllerini import eder) — **41 test yerelde koşuldu, geçiyor:** util (sipariş no sözleşmesi, telefon normalize, origin allowlist), rate-limit (pencere/karar, sahte DB, fail-closed), log+sentry (JSON biçimi, yalnız `error` Sentry'ye), order-email (fail-soft, XSS escape) + frontend tutarlılığı (JS söz dizimi, `EJ_CATALOG`↔`schema.sql` tohum eşitliği, EJMonitor kurulu mu, `ej.js?v=` sürüm tutarlılığı). **(b) Deno** (`_shared/*_test.ts`, `deno task test`) — Edge çalışma zamanına en yakın doğrulama; bu makinede Deno yok, CI için hazır.
- ✅ **BONUS — Sipariş no tutarsızlığı (testler yazılırken bulundu):** `paytr-token` 12 haneli sipariş no üretiyordu, `track-order` yalnız 11 haneliyi kabul ediyordu → **kart ile ödeyen misafir siparişini takip edemiyordu**. Üretim `_shared/util.ts` → `makeOrderNo`'da tekilleştirildi (11 hane, create-order/schema ile aynı); `track-order` eski 12 haneli kart siparişlerini de kabul eder (`isValidOrderNo`).

---

## Geliştirilmesi Gerekenler (öncelik sırasıyla)

1. ~~COD/havale fiyat doğrulamasını sunucuya taşı (🔴).~~ ✅ Yapıldı — `create-order` Edge Function + RLS kilidi.
2. ~~Admin sipariş yönetimi ekranı~~ ✅ (`admin-siparisler.html`) + ~~sipariş e-posta bildirimi~~ ✅ (Resend, `create-order` + `paytr-callback`, `_shared/order-email.ts`).
3. ~~Spam koruması (Captcha/rate limit)~~ ✅ — ~~bülten, iletişim~~ (honeypot + IP hız sınırı, `submit-form`); ~~chat~~ (origin kilidi + IP hız sınırı, `chat_rate_limit`); ~~sipariş~~ (`fn_rate_limit`, create-order+paytr-token 10/60dk).
4. Eksik SQL'i repoya ekle, admin RLS'i doğrula.
5. SEO paketi (meta/OG/favicon/JSON-LD/sitemap) + Analytics.
6. ~~Misafir sipariş takibi~~ ✅ (`track-order` + `siparis-takip.html`) + site içi arama (kalan).
7. (Sonraki faz) stok takibi, kupon, favoriler, ürün yorumları.
