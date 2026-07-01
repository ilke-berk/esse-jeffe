# Esse Jeffe — Canlı Destek + AI Chat + Sohbetle Sipariş

Sitenin sağ alt köşesindeki sohbet balonu. **Önce AI (Claude)** yanıtlar;
müşteri "Temsilciye Bağlan" derse konuşma canlı desteğe düşer ve operatör
**admin.html** panelinden gerçek zamanlı cevap yazar.

Ayrıca müşteri **sohbetin içinde sipariş oluşturabilir** ("sipariş vermek
istiyorum" gibi). AI gerekli bilgileri (ürün+beden+adet, ad soyad, telefon,
il/ilçe, açık adres, ödeme yöntemi) doğal konuşmayla toplar, özetler, onay
alır ve `create_order` aracını çağırır.

## Sohbetle sipariş akışı

- **Kapıda ödeme (cod):** Sipariş doğrudan Edge Function içinde (`service_role`)
  `orders` + `order_items` tablolarına yazılır; AI sipariş numarasını söyler.
- **Kart (card):** Sipariş Edge Function'da oluşturulmaz. Araç doğrulanmış
  sepeti + teslimat bilgisini widget'a döner; widget mevcut **`paytr-token`**
  fonksiyonunu çağırır (pending sipariş + token oluşturur) ve **PayTR güvenli
  ödeme iframe'ini sohbet panelinde açar**. Ödeme bitince PayTR iframe'i
  `sepet.html?paytr=ok`'a döner, üst pencere oraya taşınır (başarı ekranı).
  > Kart ödemesi PayTR merchant secret'ları tanımlı olana dek çalışmaz;
  > o zamana kadar widget "kart ekranı açılamadı" uyarısı gösterir
  > (bkz. `paytr-kurulum.md`). Kapıda ödeme her durumda çalışır.
- **Fiyat güvenliği:** Tutar asla AI'dan/clienttan alınmaz; ürün adı katalogla
  eşleştirilip fiyat her zaman DB'den (`service_role`) okunur.

## Parçalar

| Dosya | Görev |
|---|---|
| `schema.sql` (sohbet bölümü) | `chat_conversations` + `chat_messages` tabloları, RLS, `is_admin()`; sohbet şeması ana `schema.sql`'e taşındı (ayrı `chat-schema.sql` yoktur) |
| `functions/chat/index.ts` | Edge Function: AI yanıtı (Claude tool-use) + canlı destek köprüsü + sohbetle sipariş (`create_order`) |
| `../ej-chat.js` | Ziyaretçi widget'ı (tüm sayfalara eklendi); kart siparişinde PayTR iframe'ini açar |
| `../admin.html` | Operatör paneli (giriş + Realtime + yanıt) |

## ⚠️ Deploy (sohbetle sipariş eklendiğinde)

`functions/chat/index.ts` değişti — Supabase'e yeniden deploy edin.

Bu makinede `npx supabase` npm TLS hatası verdi (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`)
ve `curl` schannel CRL kontrolünde takıldı; ikisi de aşağıdaki yöntemle çözüldü.
**Çalışan yöntem — Management API (curl, CLI gerekmez):**

```bash
# <TOKEN> = https://supabase.com/dashboard/account/tokens (sbp_...)
curl --ssl-no-revoke -X POST \
  "https://api.supabase.com/v1/projects/grdinhjtsmoograktgge/functions/deploy?slug=chat" \
  -H "Authorization: Bearer <TOKEN>" \
  -F 'metadata={"entrypoint_path":"index.ts","name":"chat","verify_jwt":false};type=application/json' \
  -F 'file=@backend/functions/chat/index.ts;type=application/typescript'
```

`--ssl-no-revoke` = yalnız sertifika iptal (CRL) kontrolünü atlar, zincir doğrulaması sürer.
Başarılı yanıt `version` numarasını arttırır (HTTP 201). Alternatif: Supabase Dashboard
→ Edge Functions → chat → kod editörüne yapıştır → Deploy.

`paytr-token` fonksiyonu değişmedi (kart akışı onu olduğu gibi kullanır).
Widget cache sürümü `ej-chat.js?v=7`'ye yükseltildi (tüm HTML'lerde).

### ⚠️ Güvenlik güncellemesi aktivasyonu (origin kilidi + hız sınırı)

`chat/index.ts` origin kilidi + IP hız sınırı ile güncellendi. Aktive etmek için:

1. **Şema:** `schema.sql`'i çalıştır (tekrar çalıştırmaya güvenli) — `chat_rate_limit`
   tablosunu ekler. (Yalnız chat fonksiyonu `service_role` ile yazar; client erişimi yok.)
2. **Secret:** Supabase → Edge Functions → Secrets → `CHAT_ALLOWED_ORIGINS` =
   prod origin'lerin virgülle listesi, ör. `https://essejeffe.com,https://www.essejeffe.com`
   (girilmezse bu iki değer varsayılan; yerelde `localhost`/`127.0.0.1` otomatik kabul).
3. **Deploy:** `chat` fonksiyonunu yukarıdaki yöntemle yeniden deploy et.
4. **Sınırlar** kodda: konuşma başına `CONV_SEND_MAX` (50), IP burst `RATE_LIMITS`
   (`send` 20/dk; `start` 5/10dk + 40/gün). Paylaşımlı IP'yi zorlamaz. Widget
   birleştirme penceresi `ej-chat.js` → `COALESCE_MS`.
5. Widget değiştiği için `ej-chat.js?v=` cache sürümünü tüm HTML'lerde bir artır.

## Mimari / Güvenlik

- Ziyaretçiler chat tablolarına **doğrudan erişmez**. Tüm yazma/okuma
  `chat` Edge Function'ı üzerinden, `service_role` ile yapılır.
- **Maliyet istismarına karşı (bill amplification):**
  - **CORS origin kilidi:** `Access-Control-Allow-Origin` artık `*` değil;
    `CHAT_ALLOWED_ORIGINS` secret'ındaki izinli origin'ler yansıtılır
    (yerelde `localhost`/`127.0.0.1` otomatik). Origin'i olan izinsiz istekler 403.
    ⚠️ CORS yalnız **tarayıcı** kaynaklı çağrıları durdurur (başka siteye gömme);
    curl/bot Origin göndermez → asıl koruma aşağıdaki IP hız sınırıdır.
  - **Hız sınırı** (paylaşımlı IP / mobil CGNAT mağdur olmayacak şekilde):
    - **Oturum (konuşma) başına:** `send` **50 mesaj/konuşma** — `visitor_token`'a bağlı,
      IP'den bağımsız (asıl "oturum sınırı"). Aşılınca WhatsApp/temsilci yönlendirmesi.
    - **IP başına burst** (`chat_rate_limit` tablosu, `form_rate_limit` deseni):
      `send` **20/dk**; `start` **5/10dk + 40/gün**. Kısa pencere → insanı zorlamaz, botu yavaşlatır.
    - Aşımda 429 + kullanıcıya sistem mesajı. Sınırlar `RATE_LIMITS` + `CONV_SEND_MAX` sabitlerinden ayarlanır.
  - **İstemci birleştirme** (`ej-chat.js`): AI modunda ard arda yazılan mesajlar
    ~1.2 sn birleştirilip **tek `send`** çağrısı olur → dürüst kullanıcı için daha
    az Gemini çağrısı + daha doğal akış. (Güvenlik değil, maliyet/UX iyileştirmesi.)
- Ziyaretçi kimliği tahmin edilemez bir **`visitor_token`** (uuid) ile
  doğrulanır; `localStorage`'ta `ej_chat` anahtarında saklanır.
- AI motoru anahtarı (`GEMINI_API_KEY`) yalnızca Edge Function'da kalır,
  asla tarayıcıya gitmez.
- Operatör paneli gerçek Supabase hesabıyla giriş yapar; yetki `profiles.is_admin`
  + RLS `is_admin()` ile sınırlıdır. Realtime canlı güncelleme sağlar.
- Ziyaretçi tarafı Realtime yerine **4 sn polling** kullanır (anon erişim
  açmamak için bilinçli tercih).

## ⚠️ KALAN TEK ADIM — Gemini (Google AI) API anahtarı

AI motoru **Google Gemini**'dir. Yanıt verebilmesi için anahtarı Supabase secret olarak ekleyin:

1. https://aistudio.google.com/apikey → **Create API key** (ücretsiz katman mevcut).
2. Supabase Dashboard → **Project Settings → Edge Functions → Secrets**
   (veya CLI: `supabase secrets set GEMINI_API_KEY=...`)
   - Ad: `GEMINI_API_KEY`
   - Değer: anahtarınız
   - (Opsiyonel) `GEMINI_MODEL` = `gemini-2.5-flash` (varsayılan) veya `gemini-2.5-pro`
3. Bu kadar — fonksiyon anahtarı otomatik okur.

Anahtar girilmeden de chat çalışır; AI yerine "Temsilciye Bağlan / WhatsApp"
yönlendirmesi döner.

## Operatör paneli

- `siteniz/admin.html` adresinden açın (arama motorlarına kapalı, `noindex`).
- Operatör hesabı: **luciferandlucius@gmail.com** (`is_admin = true` yapıldı).
  Başka operatör eklemek için o kullanıcının `profiles.is_admin` alanını `true` yapın.
- Solda konuşmalar (okunmamışlar kırmızı nokta), tıklayınca sağda mesajlar.
  "Devral (canlı)" ile AI'dan canlı desteğe geçin, yanıt yazın; "AI'ya devret"
  veya "Kapat" ile durumu değiştirin.

## AI modeli / maliyet

AI motoru **Google Gemini**. Model `GEMINI_MODEL` secret'ı ile seçilir
(varsayılan `gemini-2.5-flash` — hızlı + uygun maliyetli, function-calling
destekli). Daha güçlü yanıt isterseniz `gemini-2.5-pro` yapın (secret'ı
değiştirmek yeterli, yeniden deploy gerekmez). Function calling ile sohbette
sipariş oluşturma `create_order` fonksiyonu üzerinden çalışır.

## Test temizliği

Test konuşmaları: `delete from chat_conversations where page = '/test';`
