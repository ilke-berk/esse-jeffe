# Rapor — 2026-07-02 · Görev Doğrulaması, Kod Değerlendirmesi & Gelecek Planı

> `GOREV-2026-07-01-guvenlik-ve-eksikler.md`'deki tüm "✅ ÇÖZÜLDÜ" iddiaları kodda tek tek doğrulandı; canlı Supabase projesi (advisors) tarandı; kod düzeni/performans incelendi. Üç paralel denetimin birleşik sonucu.

---

## ⟳ YENİDEN İNCELEME — 2026-07-03

Rapordan sonra yapılan değişiklikler kontrol edildi.

### Yeni yapılan ve DOĞRULANAN işler
- **Chat: `start`'ta user_id spoof kapatıldı + kalıcı hafıza** (GOREV md'ye yeni eklenen bölüm) — tüm alt iddialar kodda doğrulandı: JWT doğrulama (`chat/index.ts:622-634`), `resume` action (closed-guard + 10/dk limit, `:657-679`), `end` → `status=closed` (`:680-684`), son-30 mesaj `desc+reverse` düzeltmesi (`:723-724`), özet hafıza `attachMemory` + `waitUntil` + 90 gün (`:532,574,643-645`), 12 ay KVKK retention (`:618`) + `gizlilik.html` paragrafı, `?v=13` 21 sayfada, `schema.sql` `summary` kolonu.
- **GOREV md güncellendi:** loglama/rate-limit, Sentry (iki katman), otomatik test ve sipariş rate-limiti ✅ işaretlendi; sipariş-no tutarsızlığı bonus'u eklendi. (Raporun "md kodun gerisinde" tespiti büyük ölçüde giderildi.)
- **Testler:** `npm test` bu incelemede koşuldu — **41/41 geçiyor**.
- **ej-chat.js:** `api()` çağrılarına AbortController timeout'u (60sn) ve canlı destek için `sendQueue` eklendi (rapordaki "istek takılırsa sending kilitlenir" riskini azaltır).
- **Kısmi:** `ej.js` `bagBtn` null-guard listener satırına eklendi; ancak belge tıklama handler'ındaki `!bagBtn.contains(e.target)` hâlâ korumasız.

### ✅ 2026-07-03'te DÜZELTİLDİ (bu oturum)
1. **XSS — sepet paneli:** `ej.js` `swatch()`/`itemRow()` artık tüm alanları `ejEsc()`'ten geçiriyor; `color_hex` yalnız `#hex` biçiminde kabul, `qty` sayıya zorlanıyor. `bagBtn` null-guard'ı belge tıklama handler'ına da eklendi.
2. **XSS — son gezilenler:** `urun.html` `ejRecent()` yerel `esc()` ile `name/desc/price` escape ediyor; `href` yalnız `urun.html?slug=`'a izinli (localStorage'a yazılmış `javascript:` çalışmaz).
3. **Stok varyant bypass'ı:** `_shared/util.ts`'e `normVariant`/`canonVariant` eklendi; `create-order` ve `paytr-token` renk/bedeni ürünün gerçek listesine (`products.sizes` + `product_colors.name`, TR/case/boşluk duyarsız) sabitliyor, listede yoksa 400. Chat de aynı mantıkla (`canonChatVariant`, `resolveOrder` içinde) doğruluyor — AI'a mevcut seçenekler bildirilir.
4. **Chat COD korumaya alındı:** sipariş öncesi `fn_rate_limit` 'order' sayacı (create-order/paytr-token ile ORTAK, 10/60dk) + `reserve_stock_bulk` stok ayırma; sipariş/kalem hatasında sipariş silinir + stok iade edilir; başarıda sayaç kaydedilir. (E-posta hâlâ yalnız create-order/callback'ten — chat ayrı deploy ağacında, bilinen eksik.)
5. **paytr-token kalem insert'i:** insert artık `.select("id").single()` ile tek istekte; kalem hatasında sipariş silinir + stok iade edilir, jenerik 500 döner.
6. **Hata sızıntısı (sipariş yolları):** create-order/paytr-token'daki tüm `err.message`/PayTR `reason` içeren yanıtlar jenerikleştirildi (detay yalnız log'a).
7. **Testler:** `canonVariant`/`normVariant` için Node (4 yeni test → 45/45 geçiyor) + Deno (`util_test.ts`) testleri eklendi; düzenlenen 4 TS dosyası syntax-check'ten geçti.
8. **GOREV md:** admin sipariş yönetimi maddesi ✅'ye çevrildi (`admin-siparisler.html`; kalan: sayfalama).
> Deploy notu: `create-order`, `paytr-token` ve `chat` fonksiyonları yeniden deploy edilmeli.

### Hâlâ AÇIK olanlar
1. 🔴 **Commit hâlâ yok:** tüm değişiklik dalgası (artık daha da büyüdü) working tree'de, OneDrive altında.
2. 🟠 CORS `*` (chat dışındaki fonksiyonlar), sipariş rate-limitinin yalnız başarıyı sayması, katalog sorgusu tekrarı, `_ds_bundle` 15 sayfada, `uploads/` 20MB, hero 390KB JPG, chat COD e-postası, admin-siparisler sayfalaması, SEO paketi (Faz 2-3 planındaki haliyle duruyor).

---

## 1. Doğrulama Sonucu: Söylenenler gerçekten yapılmış mı? → **EVET, hepsi.**

Görev dosyasındaki **tüm** "ÇÖZÜLDÜ" iddiaları kodda kanıtıyla doğrulandı:

| İddia | Durum | Kanıt |
|---|---|---|
| COD/havale fiyatı sunucuda (`create-order`) | ✅ VERIFIED | fiyat DB'den: `create-order/index.ts:92-121`; client insert politikaları kaldırılmış: `schema.sql:477,481` |
| submit-form honeypot + IP limit (3/sa, 5/sa) | ✅ VERIFIED | `submit-form/index.ts:34-37,56-59,96-106` |
| Chat CORS allowlist + hız sınırları (50/konuşma, 20/dk, 5/10dk+40/gün) | ✅ VERIFIED | `chat/index.ts:48-56,93-99,577-581` |
| paytr-token origin allowlist | ✅ VERIFIED | `paytr-token/index.ts:27-31,96` |
| track-order (no+telefon, 15/10dk, belirsiz 404) | ✅ VERIFIED | `track-order/index.ts:41,63,100-123` |
| Sipariş e-postası (fail-soft, idempotent) | ✅ VERIFIED | `_shared/order-email.ts`; `paytr-callback/index.ts:89` |
| Stok (atomik RPC, iade, çift iade koruması) | ✅ VERIFIED | `schema.sql:339-436`; `paytr-callback/index.ts:134-151` |
| Şema drift giderildi | ✅ VERIFIED | `schema.sql:57,114-115,259-280,303-313,444-458` |
| index.html React/Babel kaldırıldı (~2MB) | ✅ VERIFIED | index.html temiz; editör `demo.html`'de + `noindex` |
| Lazy-load, fonts.css temizliği, supabase-js pin | ✅ VERIFIED | `ej-supabase.js:59,535`; fonts.css hiçbir HTML'de yok |
| Arama + mega menü (EJ_CATALOG) | ✅ VERIFIED | `ej.js:53-63,123-131,214-309`; `ej-supabase.js:231-238` |
| `?paytr=ok` sahte başarı koruması | ✅ VERIFIED | `sepet.html:239,272-292` |

### Sürpriz: Görev dosyası kodun GERİSİNDE kalmış
md'de "kalan/yapılmadı" görünen şu işler working tree'de **fiilen yapılmış** (henüz commitlenmemiş):

- **Admin sipariş yönetimi** → `admin-siparisler.html` var: listeleme, durum filtreleri, kargo/takip no, `paid_at` damgası; RLS (`orders_admin_read/update`) ile kilitli. md satır 60 güncel değil.
- **Sipariş rate-limit** → `create-order/index.ts:35` + `paytr-token/index.ts:34` (`fn_rate_limit`, 10/saat ortak sayaç). md satır 100 güncel değil.
- **Yapılandırılmış loglama + rate limit modülü** → `_shared/log.ts`, `_shared/rate-limit.ts`, `_shared/util.ts` yazılmış ve 6 fonksiyonda import ediliyor. md satır 91 güncel değil.
- **Hata izleme** → `_shared/sentry.ts` + `log-error/index.ts` + `client_errors` tablosu (md'de hiç yok). md satır 90 kısmen güncel değil.
- **Testler** → `tests/*.test.mjs` (_shared modülleri) başlamış. md satır 92 kısmen güncel değil.

**Yapılacak:** GOREV md'sini bu beş maddeyle güncelle + 35 dosyalık değişikliği commit'le.

---

## 2. Düzeltilmesi Gereken YENİ Bulgular

### 🔴 Kritik (canlıya çıkmadan önce şart)

1. **Stok koruması varyant adıyla atlatılabilir.** `reserve_stock_bulk` satır bulamazsa "takip edilmiyor → sınırsız" sayıyor (`schema.sql:371-372`); `color/size` client'tan geliyor, normalize/doğrulama yok (`create-order/index.ts:114-131`). `"M "` veya `"m"` gönderen tükenmiş üründen sipariş geçebilir. → Varyantı `products.sizes`/`product_colors` ile doğrula + trim/normalize.
2. **Chat COD siparişi tüm korumaların dışında.** `chat/index.ts:409-425` doğrudan insert: stok ayırmıyor, sipariş rate-limitine tabi değil, onay maili yok, kalem hatasında rollback yok. → Chat'i `create-order` fonksiyonunu çağıracak şekilde değiştir (tek sipariş kapısı).
3. **XSS — sepet paneli** (`ej.js:453-471`): `it.name/desc/color/size/img` escape'siz `innerHTML`'e giriyor (DB→localStorage→DOM zinciri, stored XSS). `ejEsc()` dosyada var ama kullanılmamış. → Tüm alanları `ejEsc()`'ten geçir.
4. **XSS — "son gezilenler"** (`urun.html:556`): aynı desen, `p.name/p.desc` escape'siz. → Aynı düzeltme.
5. **Kart siparişinde kalem insert hatası yutuluyor** (`paytr-token/index.ts:230-234`): select/insert başarısız olursa müşteri **kalemsiz sipariş için ödeme yapar**; başarısız ödemede iade edilecek kalem bulunamayıp ayrılan stok kalıcı kaybolur. `create-order:184-192`'deki doğru desene (rollback + stok iadesi) eşitle.
6. **Commitlenmemiş 35+ dosya, OneDrive altında.** İnceleme sırasında `ej.js`'in diskte anlık değiştiği bizzat gözlendi (senkron çakışması riski). → Hemen commit; projeyi OneDrive dışına taşımayı ciddi düşün.

### 🟠 Orta

7. **Sipariş rate-limit yalnız başarıyı sayıyor** (`create-order/index.ts:194-195`): sürekli hata alan bot hiç sayılmıyor → sınırsız RPC yükü. Denemeleri de say (track-order'daki gibi).
8. **İç hata mesajları client'a sızıyor** (`create-order/index.ts:99,138,181,191`; `paytr-token:143,191,227,285`). Logla, jenerik mesaj dön.
9. **`create-order` ↔ `paytr-token` ~120 satır kopya** (validasyon→fiyat→stok→insert). Bulgu #5 tam da bu kopyanın çürümesi. → `_shared/order.ts`'e çıkar.
10. **CORS tutarsız:** chat allowlist'li, diğer 5 fonksiyon `*`. → `_shared/cors.ts` + tüm fonksiyonlarda allowlist.
11. **Sayfa başına aynı katalog sorgusu 2–3 kez** (`ej-supabase.js` renderGrids/renderMega + `ej.js` loadCatalog; `EJData.products()` önbelleksiz). → tek promise-cache.
12. **Her sayfada `profiles` sorgusu** (`ej-supabase.js:395-399` syncAdminLink, auth değişiminde tekrar). → sessionStorage'a al.
13. **Chat başlatma yarışı mesaj yutabiliyor** (`ej-chat.js:374-386`), **Gemini'de timeout yok** (`chat/index.ts:464-474`), chat rate limiti fail-open (`chat/index.ts:104-109`).
14. **Ölü ağırlık:** `_ds_bundle.js` (32KB) 12 gereksiz sayfada; `uploads/` ~14.5MB kullanılmayan PNG; `image-slot.js` tek placeholder için; React dev build'li `demo.html` prod repoda.
15. **İki edge-function klasörü** (`backend/edge-functions/*` vs `backend/functions/chat`) — chat `_shared`'ı kullanamıyor. → chat'i taşı.
16. **Rate-limit her istekte DELETE + TOCTOU** (`_shared/rate-limit.ts:60`). → olasılıklı purge / RPC.

### 🟡 Düşük

17. Girdi uzunluk/telefon format doğrulaması yok (create-order/paytr-token); `makeOrderNo` çakışmasında retry yok; fail→success PayTR sırasında stok yeniden ayrılmıyor (nadir aşırı satış penceresi).
18. `ej.js:106` `bagBtn` null guard; `sepet.html:213` `color_hex` escape; arama yanıt yarışı; `EJ_CATALOG` ↔ schema.sql el senkronu; PayTR iframe kodu 2 yerde kopya.
19. `index.html:116` LCP görseli 390KB JPG (`hero.webp` 82KB varken); preload/srcset yok.
20. admin-siparisler: `esc()`'e `'` ekle (ucuz sigorta), sayfalama yok (1000 satır limitinde sessiz kesilme), header/footer 21 sayfada kopya.

### Canlı Supabase (advisors) bulguları

- **WARN — `is_admin()`** authenticated tarafından `/rest/v1/rpc/is_admin` ile çağrılabilir (SECURITY DEFINER). Bilgi sızıntısı düşük ama `revoke execute ... from anon, authenticated` yapılabilir — *dikkat: RLS politikaları çağırabilsin diye policy'lerde kullanılan role'ün erişimi korunmalı; Supabase önerisindeki remediation'ı izle.*
- **WARN — `products` bucket'ı listelemeye açık** (`products_obj_public_read` geniş SELECT). Public bucket için listeleme politikası gereksiz → politikayı kaldır, URL erişimi yeterli.
- **WARN — Sızdırılmış şifre koruması (HaveIBeenPwned) kapalı.** Panelden aç (Auth → Passwords).
- **WARN (perf) — RLS'te `auth.uid()` satır başına yeniden değerlendiriliyor** (profiles/addresses/orders/order_items politikaları) → `(select auth.uid())` ile sar.
- **WARN (perf) — çakışan çift permissive SELECT politikaları** (products/orders/order_items/product_colors/product_images: public read + admin_write aynı action'da) → admin politikalarını `for update/insert/delete`'e daraltıp SELECT çakışmasını kaldır.
- INFO — rate-limit tabloları "RLS var, policy yok" (bilinçli tasarım, sorun değil); birkaç kullanılmayan/indekssiz FK indeksi.

---

## 3. Kod Düzeni & Performans Değerlendirmesi

**Düzen: 6/10** — Artılar: yorumlar "neden"i anlatıyor; `_shared/` modülleri ve `tests/` doğru yön; sipariş çekirdeği (fiyat asla client'tan gelmez, atomik stok, hata yollarında iade) ciddi tasarlanmış. Eksiler: iki edge-function evi, `create-order`/`paytr-token` kopyası, 21 sayfada kopya header/footer, 7+ yerde kopya `esc()/fmt()`, repoda ölü dev araçları, commitlenmemiş yığın.

**Performans: 6/10** — Artılar: sayfalar küçük (5–37KB), lazy-load, chat'te uyarlanabilir polling + mesaj birleştirme (gerçek maliyet mühendisliği). Eksiler: sayfa başına 2–3 tekrar katalog sorgusu, 12 sayfada gereksiz 32KB bundle, 390KB LCP hero JPG, ~15MB kullanılmayan upload, minify/build yok, rate-limit'te istek başına DELETE.

---

## 4. Gelecek Planı

### Faz 0 — Bugün (küçük, acil yamalar)
1. ✅'ları commit'le (35 dosya) — tercihen önce bu rapordaki Faz 0 yamalarıyla birlikte.
2. XSS düzeltmeleri: `ej.js` sepet paneli + `urun.html` son gezilenler → `ejEsc()`.
3. `paytr-token` kalem insert kontrolü + rollback (create-order deseni).
4. GOREV md'sini güncelle (admin-siparisler, sipariş rate-limit, loglama, Sentry, testler → ✅).

### Faz 1 — Bu hafta (canlıya çıkış öncesi güvenlik)
5. Varyant doğrulama/normalize (stok bypass'ını kapat) — `create-order` + `paytr-token` + RPC.
6. Chat COD'unu `create-order`'a yönlendir (tek sipariş kapısı: stok + rate limit + e-posta bedavaya gelir).
7. Rate-limit'i denemeleri de sayacak hale getir; iç hata mesajlarını jenerikleştir.
8. Supabase panel işleri: HaveIBeenPwned aç, min şifre 8 doğrula, `products` bucket listelemesini kapat, `is_admin()` execute'unu daralt.
9. `CHAT_ALLOWED_ORIGINS`/`PAYTR_ALLOWED_ORIGINS`/`SITE_URL`/Resend secret'larının prod'da girildiğini doğrula (kod hazır, aktivasyon adımları md'lerde).

### Faz 2 — Önümüzdeki 2 hafta (canlıya çıkış paketi)
10. **SEO paketi (hâlâ tamamen boş):** her sayfaya `meta description` + `canonical` + favicon; index/koleksiyon/urun'a OG/Twitter kartları; `robots.txt` + `sitemap.xml`; `urun.html`'e JSON-LD Product.
11. **Analytics:** GA4 (+ istenirse Meta Pixel) + çerez onayıyla uyum.
12. Performans hızlı kazanımlar: hero'yu `hero.webp`+preload yap; `_ds_bundle.js`'i 3 sayfaya indir; `uploads/` temizliği (~15MB); `EJData.products()` promise-cache; `syncAdminLink` cache.
13. RLS perf düzeltmeleri: `(select auth.uid())` + çift permissive SELECT'leri ayrıştır.

### Faz 3 — Ay içinde (sağlamlaştırma)
14. `_shared/order.ts` refaktörü (create-order/paytr-token ortak çekirdek) + `_shared/cors.ts` (tüm fonksiyonlar allowlist).
15. Chat'i `edge-functions/` altına taşı, `_shared`'a bağla; Gemini'ye timeout; start-yarışı düzeltmesi.
16. Test genişletme: fiyat hesabı/stok akışına birim test; minify/gzip için basit build (esbuild) veya sunucu brotli.
17. Header/footer tekilleştirme (basit include/enjeksiyon) — 21 sayfa kopyasını bitir.
18. Projeyi OneDrive dışına taşı (senkron çakışması riski gözlendi).

### Faz 4 — Sonraki faz (ürün geliştirme, md ile uyumlu)
19. Ürün sayfasında "tükendi" rozeti + chat AI'ya stok bilgisi (altyapı hazır).
20. Kupon, favoriler, ürün yorumları; admin-siparisler'e sayfalama + e-posta ile durum bildirimi (kargoya verildi maili).
