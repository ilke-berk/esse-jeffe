# Esse Jeffe — Denetim Durumu ve Kalan İşler

**Tarih:** 2026-07-15
**Kapsam:** 2026-07-09 tarihli iki denetim raporunun (güvenlik + UI/UX) güncel durumu, canlı deploy durumu ve bekleyen işlerin ayrıntılı dökümü.

---

## GÜNCELLEME — 2026-07-15 (aynı gün): kalan işlerin TAMAMI kapatıldı ✅

`feat/denetim-kalan-isler` dalında 4 fazda uygulandı, Playwright ile 29/29 test doğrulandı:

| Madde | Commit | Not |
|-------|--------|-----|
| #16 skip-link | `f80a0a1` | 22 müşteri sayfası + favoriler.html; `.skip-link` ej.css'te |
| #14 Spectral 400 preload | `f80a0a1` | latin + latin-ext woff2; gstatic hash değişirse preload boşa gider, zararsız |
| #12-kalan hero kontrast | `f80a0a1` | .92 alfa + text-shadow; etiketler hâlâ `display:none` — açılırsa hazır |
| #11 footer tekleştirme | `9bc5dfd` | Kanonik: Yardım 6 link (Değişim & İptal + Beden Rehberi birlikte), Kurumsal 5 link, `&amp;` normalize |
| #10a beden-stok göstergesi | `322de9a` | `EJData.stock()` + `ejUpdateSizeStock()`; seçili renk+beden bazında tükendi/disabled + "son X" rozeti (`data-stock-note`); kayıt yok/track=false → sınırsız |
| #10b wishlist | `43a0636` | `EJWish` (localStorage `ej_wishlist`), kart/ürün kalpleri, header sayaç, yeni **favoriler.html** |
| CART_CRON_SECRET | — | **Eklenmiş ve çalışıyor**: cart-reminder cron'u 15 dk'da bir 200 dönüyor (401'ler yalnız ilk kurulum sürümünde) |
| E-posta secrets | — | Son 24 saat loglarında hata yok |

Sürümler: `ej.css?v=10`, `ej.js?v=12`, `ej-chat.js?v=18`, `backend/ej-supabase.js?v=15` (tüm sayfalarda tutarlı; eski v12/v13 tutarsızlığı giderildi).

---

## 1. Güvenlik Denetimi — TAMAMLANDI ✅

`DENETIM-2026-07-09-guvenlik.md` raporundaki **7 maddenin tamamı** düzeltildi, `fix/sifre-sifirlama-akisi` dalına commit'lendi ve canlıya deploy edildi. Kalan güvenlik maddesi **yok**.

| # | Önem | Bulgu | Çözüm |
|---|------|-------|-------|
| 1 | 🔴 Kritik | Herhangi bir üye kendini admin yapabiliyordu (`profiles` UPDATE politikasında `WITH CHECK` yok, `is_admin` kolonu yazılabilir) | Tablo seviyesindeki UPDATE grant kaldırıldı; yalnız `full_name`/`phone` kolonlarına grant verildi + politikaya `with check (auth.uid() = id)` eklendi. Canlı DB'ye migration olarak uygulandı, `schema.sql`'e işlendi |
| 2 | 🟠 Yüksek | Girişte `next` parametresiyle açık yönlendirme + `javascript:` XSS | `ej-supabase.js` `handleLogin`: yalnız yerel `*.html` yollarına izin veren regex doğrulaması |
| 3 | 🟡 Orta | Beden zorunluluğu backend'de doğrulanmıyordu → beden bazlı stok limitini atlayıp aşırı satış (oversell) mümkündü | create-order, paytr-token ve chat'te: ürünün `sizes` listesi doluysa boş beden reddediliyor |
| 4 | 🔵 Düşük | Chat dışı 5 edge fonksiyonunda `Access-Control-Allow-Origin: *` | Paylaşılan `backend/edge-functions/_shared/cors.ts` eklendi (chat'teki origin-kilidi modeli: `EDGE_ALLOWED_ORIGINS` → `CHAT_ALLOWED_ORIGINS` → prod alan adları; localhost otomatik izinli). create-order, submit-form, track-order, log-error, paytr-token bunu kullanıyor |
| 5 | 🔵 Düşük | admin-siparisler.html tüm siparişleri tek seferde çekiyordu (bellek + gereksiz PII transferi) | 50'lik sayfalama: `range()` + `{ count: 'exact' }`, "Daha fazla yükle" düğmesi, toplam sayaç. Arama/filtre yüklü kayıtlarda çalışır (düğme yanında not gösterilir) |
| 6 | 🔵 Düşük | Sohbetten verilen kapıda ödeme siparişinde onay e-postası gitmiyordu | `_shared/order-email.ts`'in birebir kopyası `backend/functions/chat/order-email.ts` olarak eklendi (chat ayrı deploy ağacında olduğundan `_shared` import edilemiyor; başlıkta senkron notu var). Müşteri + işletme e-postası gönderiliyor; hata sipariş akışını bozmaz |
| 7 | 🔵 Düşük | `esc()` tek tırnağı (`'`) kaçırmıyordu (tek tırnaklı `url('...')` bağlamında teorik CSS çıkışı) | Repodaki **tüm** `esc()`/`ejEsc` tanımlarına `'` → `&#39;` eklendi: `ej.js`, `ej-chat.js`, `backend/ej-supabase.js`, admin.html, admin-urunler.html, admin-siparisler.html, hesap.html, sepet.html, siparis-takip.html, urun.html, order-email.ts (×2 kopya) |

**İlgili commit'ler:** `8c58c03` (güvenlik #4–#7 + raporlar), öncesinde #1–#3 aynı dalda. JS cache-bust sürümleri yükseltildi (ej.js v10, ej-supabase.js v11, ej-chat.js v15).

**Canlı deploy durumu (2026-07-15 itibarıyla doğrulandı):** create-order, paytr-token, submit-form, track-order, log-error ve chat fonksiyonlarının tamamı güvenlik düzeltmelerini içeren sürümlerde ve ACTIVE. (Fonksiyonlar 09'undan sonraki çalışmalarla — sepet hatırlatma, kupon sistemi — birkaç sürüm daha ilerledi; ör. chat v16, create-order v13, paytr-token v14. Ayrıca yeni `cart-sync` ve `cart-reminder` fonksiyonları eklendi.)

---

## 2. UI/UX Raporu — Büyük kısmı tamamlandı, 4,5 madde kaldı

`DENETIM-2026-07-09-ui-ux.md` raporundaki 16 maddeden **11,5'i uygulandı** (commit `1d26098`): 44px dokunma hedefleri, ürün kartı slug linkleri, checkout zorunlu Mesafeli Satış/Ön Bilgilendirme onayı, alan-bazlı form doğrulama (`aria-invalid`, inline hata, ilk hataya focus), `aria-live`/`role=status` duyuruları, koleksiyon filtrelerinin gerçek süzmesi, şifre göster/gizle, sepet paneli auth linkleri, hero alt metinleri, lazy loading + `fetchpriority`, PayTR·SSL·3D Secure güven şeridi, global `:focus-visible`.

### Kalan maddeler (ayrıntılı)

#### #10 — Favori (wishlist) + beden bazlı stok göstergesi — EN KAPSAMLI
- **Sorun:** Site genelinde istek listesi yok; ürün sayfasında bedenler stok durumundan bağımsız hep seçilebilir; "tükendi / son X adet" bilgisi yok. Aciliyet ve geri dönüş motivasyonu kayboluyor.
- **Öneri:**
  - Ürün kartlarına ve ürün sayfasına kalp ikonu; seçimler `localStorage`'da (üyelik gerektirmez), header'da sayaç.
  - `urun.html` beden butonları: `product_stock` verisine göre stokta olmayan bedene `disabled` + "tükendi" stili; eşik altına "son X adet" rozeti.
- **Dokunulacak dosyalar:** `urun.html`, `koleksiyon.html`, `index.html`, `ej.js`, `ej.css`; stok için `backend/ej-supabase.js` (okuma RLS'i zaten açık olmalı — kontrol edilmeli).
- **Tahmini efor:** Orta-büyük (birkaç saatlik iş); wishlist ve stok göstergesi bağımsız iki parça olarak ayrı ayrı da yapılabilir.

#### #11 — Footer'ın tekleştirilmesi
- **Sorun:** Aynı footer'ın 3–4 farklı sürümü sayfalar arasında dolaşıyor (Beden Rehberi/Çerez/Ön Bilgilendirme linkleri ve Kurumsal listesi sayfadan sayfaya değişiyor: `index.html`, `odeme.html`, `urun.html`, `sepet.html`, `giris.html` vb.).
- **Öneri:** Statik sitede iki seçenek: (a) tek "kanonik" footer bloğu belirleyip ~22 HTML dosyasına elle/script'le kopyalamak, (b) `ej.js` içinde footer'ı JS ile basmak (JS kapalıysa boş kalır — önerilmez). Pratik yol (a); tek seferlik mekanik iş.
- **Tahmini efor:** Küçük ama geniş (çok dosyaya dokunur, riski düşük).

#### #14 — Spectral fontu için `preload`
- **Sorun:** `display=swap` + `preconnect` var (iyi) ama kritik ağırlık için `<link rel="preload" as="font">` yok; ilk boyamada kısa FOUT görülebilir.
- **Öneri:** Google Fonts CSS'i ağırlık başına ayrı dosya döndürdüğünden en sık kullanılan ağırlığın (400) woff2 URL'si preload edilir. İsteğe bağlı, görsel cila.
- **Tahmini efor:** Çok küçük.

#### #16 — "İçeriğe atla" (skip-to-content) linki
- **Sorun:** Hiçbir sayfada içeriğe atlama linki yok; klavye kullanıcısı her sayfada nav'ı geçmek zorunda.
- **Öneri:** `<body>` başına görünmez (focus'ta görünür) `<a href="#main" class="skip-link">İçeriğe atla</a>`; ana içerik sarmalayıcısına `id="main"`. `ej.css`'e ~5 satır stil.
- **Tahmini efor:** Küçük (tüm HTML sayfalarına 1 satır + CSS).

#### #12 (kalan yarısı) — Hero etiket overlay kontrastı
- **Sorun:** `index.html` hero etiketi `rgba(255,255,255,.78)` küçük punto, değişken görsel üstünde; alt kenarda kontrast düşebilir. (Alt metinler kısmı yapıldı.)
- **Öneri:** Overlay'i hafif koyulaştır veya etikete `text-shadow` ekle.
- **Tahmini efor:** Çok küçük.

**Önerilen sıra:** #16 + #14 + #12-kalan (hızlı kazanımlar, tek oturum) → #11 (mekanik) → #10 (ayrı planlanacak özellik işi).

---

## 3. Denetim dışı bekleyen işler

| İş | Durum | Not |
|----|-------|-----|
| `CART_CRON_SECRET` secret'ının eklenmesi | ⚠️ **Bekliyor — tek manuel adım** | Sepet hatırlatma sistemi kuruldu ve deploy edildi; cron'un `cart-reminder` fonksiyonunu tetikleyebilmesi için Supabase Dashboard → Edge Functions → Secrets'a eklenmeli |
| Kupon "kargo bedava" türü | Bilinçli no-op | Kargo zaten site genelinde ücretsiz; ücretli kargoya geçilirse etkinleştirilecek |
| E-posta secrets kontrolü | Muhtemelen hazır | Chat COD e-postasının gitmesi `RESEND_API_KEY` + `ORDER_FROM_EMAIL` (+ `ORDER_NOTIFY_EMAIL`) secret'larına bağlı; create-order aynı modülü kullandığından büyük ihtimalle tanımlı. Yoksa gönderim sessizce atlanır, sipariş bozulmaz |
| `_shared/order-email.ts` ↔ `chat/order-email.ts` senkronu | Sürekli dikkat | Chat kopyası birebir; kaynak modül değişirse kopya da güncellenmeli (her iki dosyanın başlığında not var) |

---

## 4. İlgili dosyalar

- Güvenlik raporu: `DENETIM-2026-07-09-guvenlik.md` (tüm maddeler ✅ işaretli, uygulanan çözümler not düşülü)
- UI/UX raporu: `DENETIM-2026-07-09-ui-ux.md` (başındaki DURUM bloğunda yapılan/kalan ayrımı)
- Önceki denetim: `RAPOR-2026-07-02-denetim-ve-gelecek-plani.md`
- Çalışma dalı: `fix/sifre-sifirlama-akisi` (commit'ler: `8c58c03` güvenlik, `1d26098` UI/UX, `8e5fe5c` rapor notu)
