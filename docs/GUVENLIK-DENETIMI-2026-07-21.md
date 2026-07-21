# Güvenlik Denetimi — Esse Jeffe (2026-07-21)

Kapsam: statik frontend, 17 Supabase Edge Function, `backend/functions/chat/*`,
Postgres şeması + RLS, canlı veritabanı doğrulaması.
Yöntem: 5 paralel uzman denetimi (erişim kontrolü/IDOR, XSS/istemci, enjeksiyon/sunucu,
Web LLM, kimlik/yapılandırma) + canlı DB üzerinde rol simülasyonu ile ampirik doğrulama.
Referans: PortSwigger Web Security Academy sınıflandırması.

**Genel değerlendirme:** Uygulama, bu ölçekteki bir e-ticaret projesi için
**beklenenin belirgin biçimde üzerinde.** Para akışı, yarış koşulları, RLS ve
XSS yüzeyi doğru kurulmuş. Bulunanların çoğu kenar durumlar. Ancak **1 kritik**
(başkasının kuponunun çalınması) ve doğrulanması gereken **1 yüksek** risk var.

---

## Düzeltme durumu (2026-07-21, Faz 0 + Faz 1)

Doğrulama: 151/151 test yeşil, `node --check` temiz, SRI Playwright ile 7 sayfada
doğrulandı (doğru hash → yükleniyor; bozuk hash → bloklanıyor, yani `integrity`
gerçekten zorlanıyor).

**Deploy durumu (2026-07-21):**
- `chat` **v27 ACTIVE** — boot smoke `start` 200 + `pending:null` ✅
- `create-order` **v16 ACTIVE** — boot smoke `{}` → 400 "Sepet boş" ✅
- `paytr-token` **v15, DEPLOY EDİLMEDİ** ⚠️ — kod hazır, yayınlanmadı
- Statik dosyalar (`_headers`, `netlify.toml`, `admin*.html`, `ej-supabase.js`,
  `ej-chat.js`) **yayınlanmadı** — git push bekliyor

> ⚠️ **K-1 kısmen açık:** `paytr-token` deploy edilmediği için **kart ödeme yolunda**
> kupon kimliği hâlâ `form.email`. COD (chat + `create-order`) yolu kapandı.
> Kalan açığın kapanması `paytr-token` deploy'una bağlı.

| Bulgu | Durum | Nerede |
|---|---|---|
| K-1 kupon çalınması | Kapatıldı — `couponIdentity` artık `{email, verified}` döner; proaktif öneri yalnız `verified`; girişlide `resolveUserEmail` null dönerse forma DÜŞMEZ | `chat/index.ts` |
| K-1 (B birimi) | `create-order` + `paytr-token` kupon kimliğini oturumdan alır (`sessionEmail`); PayTR hash'i form e-postasını korur | `create-order/index.ts`, `paytr-token/index.ts` |
| O-2 COD risk | `cod-risk.ts` chat ağacına kopyalandı, `handleCreateOrder` 4 risk sütununu yazar | `chat/cod-risk.ts`, `chat/index.ts` |
| O-3 CSP/HSTS | HSTS `max-age=86400` (includeSubDomains YOK) + CSP **Report-Only** | `_headers` |
| O-4 SRI | 4 admin sayfası + dinamik enjeksiyon `integrity`+`crossorigin` | `admin*.html`, `ej-supabase.js` |
| O-6 kart dalı | Ayrı `card_checkout` anahtarı; `order_placed` guard'ı artık devrede | `chat/index.ts` |
| O-7 günlük tavan | `send`'e `{max:600, sec:86400}` eklendi | `chat/index.ts` |
| O-8 doküman sızıntısı | `/backend/*.md` + `/backend/*.ps1` → 404 | `netlify.toml` |
| Y-1 XFF | **Kısmen** — `clientIp` artık `XFF_TRUSTED_PROXIES` ile sağdan sayabiliyor; varsayılan 0 = eski davranış. Ölçüm yapılıp N ayarlanana kadar açık **kapanmadı** | `_shared/util.ts` |
| O-1 kimliksiz opt-out | Kapatıldı — `cart-sync`'teki `reminder_optout` silme kaldırıldı; opt-out'lu e-postada misafir yolu 403; geri açma yalnız `cart-reminder?resub=<token>`; `cart-reminder` opt-out okuması fail-closed | `cart-sync/index.ts`, `cart-reminder/index.ts` |
| D sabit zamanlı karşılaştırma | `x-cron-secret` (3 fonksiyon) + PayTR HMAC → `timingSafeEqualStr` | `_shared/util.ts` + 4 fonksiyon |
| D localhost CORS | `EDGE_ALLOW_LOCALHOST` bayrağına alındı (varsayılan KAPALI) | `_shared/cors.ts` |
| D sürüm sabitleme | 13 fonksiyon `supabase-js@2` → `@2.110.7` | `*/index.ts` |

**Kapsam dışı (bilinçli):** Y-2 (onay cümlelerini sunucu üretsin, L boyutunda),
O-5 (prompt injection) ve kalan DÜŞÜK maddeler.
`claimDiscount`'un e-posta bağı kullanıcı kararıyla değiştirilmedi — misafir kuponu
elle yazıp kullanmaya devam eder; kalan risk "e-posta + kod birlikte bilinmeli"ye iner.

---

## Ampirik olarak doğrulanan güçlü yanlar

Bunlar kod okunarak değil, **canlı veritabanında rol simüle edilerek** test edildi.

| Test | Sonuç |
|---|---|
| `anon` ile orders / profiles / addresses / order_items / discount_codes / chat_messages okuma | **0 satır** (yalnız 9 aktif ürün görünür) |
| Normal kullanıcı `set is_admin = true` (kendi satırı) | **Engellendi** — `is_admin` sütununda UPDATE yetkisi yok |
| Normal kullanıcı `is_admin=true` ile yeni profil INSERT | **Engellendi** — RLS politikası |
| Normal kullanıcı ürün fiyatı / sipariş `payment_status` / stok yazma | **Engellendi** (0 satır) |
| Normal kullanıcı kendine %99 kupon INSERT | **Engellendi** — RLS |
| Normal kullanıcı `codrisk_signals()` çağırma (telefon→sipariş geçmişi oracle'ı) | **Engellendi** — permission denied |
| 24 tablonun tamamında RLS | **Açık** |
| Misafir siparişleri (`user_id IS NULL`) anon'a görünüyor mu? | **Hayır** — `NULL = NULL` → NULL, klasik tuzak kapalı |

Ayrıca doğrulandı: SQL injection / SSRF / komut enjeksiyonu / path traversal /
mass assignment **yok**; sipariş toplamları her zaman sunucuda DB fiyatından
hesaplanıyor; PayTR callback HMAC'i **her türlü DB mutasyonundan önce** doğrulanıyor;
stok rezervasyonu iki geçişli `FOR UPDATE` ile deterministik kilit sırasında
(deadlock'a karşı bilinçli tasarım); kupon claim'i atomik (`used_at is null` koşullu
update) — yarış koşuluyla çift harcama mümkün değil; XSS'in hiçbir türü (reflected /
stored / DOM) bulunamadı; `?next=` açık yönlendirmesi zaten doğru şekilde savunulmuş.

`schema.sql:520-521` özellikle iyi yazılmış — tablo seviyesindeki UPDATE yetkisinin
sütun seviyesindeki REVOKE'u geçersiz kıldığı bilinerek ters kurulmuş:

```sql
revoke update on profiles from authenticated, anon;
grant update (full_name, phone) on profiles to authenticated;
```

---

## KRİTİK

### K-1. Chat üzerinden başkasının kişisel kuponu okunup çalınabiliyor

**Dosyalar:** `backend/functions/chat/index.ts:1507-1513, 1537-1548`,
`backend/functions/chat/discount.ts:123-128, 181-199`
**Durum:** Her iki aşama da elle doğrulandı.

Misafir (girişsiz) kullanıcıda kupon kimliği, **kullanıcının chat'e yazdığı
e-posta** oluyor:

```ts
async function couponIdentity(conv, formEmail) {
  if (conv?.user_id) { const e = await resolveUserEmail(conv.user_id); if (e) return e; }
  return formEmail || null;            // misafir: ne yazdıysa o
}
```

Bu değer doğrudan kupon listelemeye gidiyor ve sonuç **tam kod metniyle** modele
veriliyor (`listPersonalCoupons` → `fmtCouponOffer` → `SADAKAT-XK9F2P (%45, en fazla 1500 TL)`).

**Aşama 1 — sızıntı.** Saldırgan chat'e normal bir sipariş açar ve
`E-postam: kurban@gmail.com` yazar. Model, kurbanın aktif kuponlarını
"size tanımlı bir kupon görünüyor" diyerek saldırgana okur.

**Aşama 2 — çalınma.** Saldırgan aynı e-postayla siparişi tamamlar:

```ts
const bound = String(data.email || "").trim().toLowerCase();
if (bound && bound !== given) { ... }   // given == kurban@gmail.com → geçer
```

`bound === given` olduğu için claim **başarılı** olur. Kurbanın sadakat kuponu
(hafızaya göre %50'ye / 1500 TL'ye kadar) saldırganın kapıda ödemeli siparişinde
harcanır ve ürün **saldırganın adresine** gider.

**Kök neden:** e-posta hem *arama anahtarı* hem de *sahiplik kanıtı* olarak
kullanılıyor — döngüsel. "E-postayı bilen sahiptir" demek oluyor.

**Neden mevcut korumalar tutmuyor:** `findFabricatedCoupon`, bir tool cevabında
geçen kodu meşru sayıyor — kod gerçekten tool'dan geldiği için guard onu onaylıyor.
`handleSummary`'nin kendi hız sınırı yok; yalnız `send` (20/dk/IP) geçerli, yani
dakikada ~20 e-posta denenebilir.

**Çözüm:**
1. Proaktif kupon önerisini **yalnız `conv.user_id` varken** çalıştır (sunucu
   doğrulamalı kimlik). Misafire öneri yapma — kuponu olan zaten kodu yazabilir.
2. Savunma derinliği: `claimDiscount`'ta e-postaya bağlı `single` kodlar için
   oturum kimliği veya doğrulanmış e-posta iste; istemcinin beyan ettiği string'i
   sahiplik kanıtı sayma.

> **Not — aynı zayıflığın sistemik hâli:** `create-order/index.ts:172,179` ve
> `paytr-token/index.ts:221` de kupon kimliği için oturumu değil `form.email`'i
> kullanıyor (giriş yapmış kullanıcı `index.ts:90-94`'te zaten çözülmüş olmasına
> rağmen). Sızıntı yalnız chat'te ama **kullanma** zayıflığı normal ödeme akışında
> da var. Doğru desen zaten repoda mevcut: `chat/index.ts:958-968 resolveUserEmail()`.

---

## YÜKSEK

### Y-1. `X-Forwarded-For` sahteciliği — TÜM hız sınırlarını geçersiz kılabilir

**Dosyalar:** `backend/edge-functions/_shared/util.ts:8-11`,
`backend/functions/chat/index.ts:122-125`, `paytr-token/index.ts:288`
**Durum: DOĞRULANMADI — tek komutla teyit edilmeli.** (Denetim ortamında dış ağ
erişimi yok; sahte başlıklı istek gönderilemedi.)

```ts
const xff = req.headers.get("x-forwarded-for") || "";
return xff.split(",")[0].trim() || "unknown";
```

**Soldaki** (ilk) eleman alınıyor. Proxy'ler gerçek IP'yi **sona ekler**; bu
durumda ilk eleman tamamen saldırgan kontrolündedir.

Doğrulanırsa şunların **hepsi** aynı anda düşer: sipariş oluşturma (10/saat),
kupon kontrolü (10/saat), sipariş numarası kaba kuvvet freni (`track-order` 15/10dk),
`verifyGateBlocked` sayaçları (adres değiştirme), chat kotaları ve Gemini fatura
koruması. Ek olarak saldırgan, **kurbanın** sayacını doldurup ona hizmet reddi
uygulayabilir.

**Teyit komutu** (sahte IP'nin tabloya düşüp düşmediğine bakın):

```bash
curl -s -X POST "https://grdinhjtsmoograktgge.supabase.co/functions/v1/track-order" \
  -H "Content-Type: application/json" -H "Origin: https://essejeffe.com" \
  -H "X-Forwarded-For: 203.0.113.77" \
  -d '{"order_no":"EJ00000000000","phone":"5000000000"}'
```

Ardından: `select ip, created_at from order_track_rate_limit order by created_at desc limit 3;`
`203.0.113.77` göründüyse **açık doğrulanmıştır.**

**Çözüm (doğrulanırsa):** ilk değil **son** elemanı al (ya da bilinen proxy hop
sayısına göre sondan N'inci). Üç dosyada aynı desen var — tek bir ortak yardımcıya
taşıyın.

### Y-2. `guards.ts` düzenli ifadeleri sıradan Türkçe yeniden ifadeyle aşılıyor

**Dosya:** `backend/functions/chat/guards.ts:15-49, 76-102, 212-268`
**Durum:** Doğrulandı — guard'lar çalıştırılıp çıktı alındı.

`UNBACKED_GUARDS` tablosunun **tamamı** ilk denemede aşıldı:

```
false  "Ürünü bize gönderin, ücretinizi hesabınıza aktaralım."   (iade)
false  "Size %20 indirim kuponu tanımlıyorum."                   (kupon)
null   "kuponunuz: hosgeldin10 ile %10"                          (küçük harf → uydurma kod görünmez)
yok    "Siparişiniz başarıyla sisteme kaydedildi, numaranız EJ26072012345."
yok    "Ödemenizi aldık, teşekkürler."
yok    "Adres bilgileriniz güncellendi."
```

Yapısal nedenler: `sipariş(?:iniz)?\s+(?:alındı|…)` bitişiklik istiyor — araya
"başarıyla" girince kaçıyor; `kaydedildi` alternasyonda hiç yok; `ödemeniz alındı`
var ama `ödemenizi aldık` yok; `tanımlıyorum` (en doğal biçim) ek listesinde yok;
`CODE_TOKEN_RE` yalnız BÜYÜK harf eşliyor.

**Gerçek risk sınırlı** — DB'de satır oluşmuyor, çünkü asıl kapılar kod tarafında
(K-1 hariç). Etki: müşteri aldatma, destek yükü, chargeback anlaşmazlığında
kullanılabilecek sahte vaat.

**Çözüm:** Türkçe morfolojisini regex'le saymaya çalışmayı bırakın. Doğru desen
zaten repoda: `runOrderConfirm`/`runExchangeConfirm` (`index.ts:2090-2108`)
onay cümlesini **sunucu yazıyor**, model karışmıyor. Bunu genişletin — yan etkili
bir tool başarılı olduğunda müşteriye giden onay cümlesini sunucu üretsin, model
yalnız çevresindeki metni yazsın.

---

## ORTA

| # | Bulgu | Dosya |
|---|---|---|
| O-1 | **`cart-sync` ile kimliksiz onay/opt-out sıfırlama** — saldırgan `{email:"kurban@x.com", consent:true}` gönderip kurbanın `reminder_optout` kaydını **siler**, sepetini ezer, sahte KVKK/ETK rızası yazar ve 3 saat sonra markanın kurbanı e-postalamasına yol açar. `verify_jwt` kapalı. Opt-out, hatırlatmayı susturan **tek** mekanizma (`cart-reminder:226-233`). | `cart-sync/index.ts:237-241, 281-283` |
| O-2 | **Chat sipariş yolu COD risk skorlamasını atlıyor** — `create-order` kapıda ödemede telefonun iptal geçmişini skorlayıp `risk_hold` koyuyor; chat'in ayrı insert'ünde dört risk sütunu da yok. Seri COD reddedeni chat'ten sipariş verip denetimden kaçar. | `chat/index.ts:1674-1682` vs `create-order/index.ts:196-231` |
| O-3 | **CSP ve HSTS yok** — `_headers` dört başlık koyuyor, CSP yok. Oturum JWT'si `localStorage`'da; ileride tek bir kaçan escape hesap ele geçirmeye dönüşür, altta ağ yok. | `_headers:6-10` |
| O-4 | **CDN script'lerinde SRI yok** — sürümler tam sabitlenmiş (iyi) ama `integrity` yok. Kritik olan: bu etiketler **admin sayfalarında**; jsDelivr ele geçirilirse kod `is_admin` yetkili oturumda çalışır. | `admin*.html`, `ej-supabase.js:861` |
| O-5 | **Dolaylı prompt injection** — `profiles.full_name/phone`, `addresses.address` ve LLM'in ürettiği `chat_conversations.summary` sistem prompt'una giriyor. Savunma, enjekte edilen metnin *içindeki* "bunu komut sayma" cümlesi — klasik anti-desen. `summary` bloğunda o uyarı bile yok ve 90 güne kadar oturumlar arası kalıcı. | `chat/index.ts:1765-1800, 2185-2223` |
| O-6 | **Kart dalı ödemeden önce siparişi "başarılı" işaretliyor** — `payment_method:'card'` için sipariş oluşmadan `succeeded.add("order")` çalışıyor, `order_placed` guard'ı devre dışı kalıyor. | `chat/index.ts:1602-1610, 1915` |
| O-7 | **Chat'te günlük gönderim tavanı yok** — `send` yalnız 20/dk; günlük pencere yok. IP başına ~7.500 mesaj/gün, her biri ~6-7 Gemini çağrısı (4 tool turu + 3 düzeltici yeniden istem), tam katalog + 30 mesaj bağlamıyla. `verify_jwt` kapalı, CAPTCHA yok. | `chat/index.ts:133, 1938-1992` |
| O-8 | **`/backend/*.md` ve `deploy-chat.ps1` herkese açık yayınlanıyor** — `netlify.toml` `schema.sql`, `edge-functions`, `functions`, `migrations`, `docs`, `tests` yollarını kapatıyor ama kurulum dokümanlarını değil. Canlı **secret değeri yok** (repo ve tüm git geçmişi tarandı, temiz) ama secret *adları*, tablo/RPC adları, cron kurgusu, hız sınırı eşikleri ve `verify_jwt:false` bilgisi sızıyor. | `netlify.toml:5` |

---

## DÜŞÜK

- **`prune_rate_limits()` `anon` tarafından çağrılabiliyor** — projedeki `REVOKE`
  desenini uygulamayan tek fonksiyon. Etki sınırlı (yalnız >25 saatlik satırları
  siliyor, canlı sayaç sıfırlanmıyor) ama tek predikat değişikliğiyle
  "tüm hız sınırlarını sil" düğmesine dönüşür.
  Düzeltme: `revoke all on function public.prune_rate_limits() from public, anon, authenticated;`
- **Sipariş no entropisi düşük** — `EJ`+YYMMDD+**5 hane** = günde 10⁵, üstelik
  `Math.random()` ile. Bu değer `track-order`, değişim talebi ve **adres değiştirme**
  için iki kimlik faktöründen biri. Telefon bilinen bir hedefte dağıtık saldırı
  ulaşılabilir. Düzeltme: `crypto.getRandomValues()` + 8-10 karakter, ve IP başına
  değil **sipariş no başına** hatalı deneme kilidi.
- **Sızmış parola koruması kapalı** (Supabase advisor) — istemci yalnız 8 karakter
  bakıyor. Tek ayar değişikliği.
- **`products` storage bucket'ı listelenebiliyor** — public bucket'ta geniş SELECT
  politikası; nesne URL'leri için gerekmiyor. Yayınlanmamış ürün görselleri keşfedilebilir.
- **Sabit zamanlı olmayan karşılaştırma** — `x-cron-secret` ve PayTR HMAC'i `!==` ile.
  Ağ jitter'ı altında pratikte sömürülemez; hijyen.
- **Prod'da `localhost` CORS'a açık** — regex iki uçtan çapalı, `evil-essejeffe.com`
  tipi baypaslar **çalışmıyor**; yalnız env bayrağına alınmalı.
- **Gevşek sürüm sabitleme** — 8 fonksiyon `esm.sh/@supabase/supabase-js@2` (yalnız
  major). Service-role kodunda tedarik zinciri riski. Tam sürüm sabitleyin.
- **Doğrulamasız e-posta aboneliği** — `price-alert`, bülten ve chat'teki
  `set_price_alert` rastgele e-posta kabul ediyor. Honeypot + IP limiti var; çift
  onay (double opt-in) gerekli.
- **`style` özniteliğinde CSS injection** — `esc()` HTML için doğru ama tarayıcı
  entity'yi CSS'ten önce çözüyor. `product_colors.hex` admin yazımlı olduğu ve CSS
  script çalıştıramadığı için Düşük. Doğru desen zaten `ej.js:483`'te var.
- **Artık dev fonksiyonları** — `paytr-callback-test` ve `chat-sim` prod'da ACTIVE;
  ikisi de zaten `410` döndürecek şekilde etkisizleştirilmiş. Silinmeli.
  **AÇIK — repoda kod yok, yalnız Supabase'de deploy edilmiş durumdalar.**
  Silme yeri: Supabase Dashboard → Edge Functions → ilgili fonksiyon → Delete.

### Bu turda kapatılanlar (2026-07-21, ikinci tur)

`O-1` + sabit zamanlı karşılaştırma + localhost bayrağı + sürüm sabitleme
yukarıdaki özet tablosunda işaretlendi. `chat` fonksiyonu `jsr:@supabase/supabase-js@2`
ile hâlâ sabitlenmemiş — ayrı deploy zinciri olduğu için bu turda dokunulmadı.

---

## Önerilen sıra

1. **Y-1'i teyit et** (yukarıdaki tek curl) — doğruysa diğer her şeyin şiddetini belirliyor.
2. **K-1** — misafirde proaktif kupon önerisini kapat; `create-order`/`paytr-token`'da
   kupon kimliğini JWT'den al.
3. **O-1** — kimliksiz opt-out silmeyi kaldır.
4. **O-2** — COD risk skorlamasını chat sipariş yoluna taşı.
5. **O-3 / O-4** — CSP + HSTS + SRI (küçük, yüksek getirili).
6. **Y-2** — onay cümlelerini sunucu üretsin.
7. **O-8** ve düşük öncelikliler — çoğu tek satırlık ayar.
