# Esse Jeffe — Canlı Destek + AI Chat

Sitenin sağ alt köşesindeki sohbet balonu. **Önce AI (Claude)** yanıtlar;
müşteri "Temsilciye Bağlan" derse konuşma canlı desteğe düşer ve operatör
**admin.html** panelinden gerçek zamanlı cevap yazar.

## Parçalar

| Dosya | Görev |
|---|---|
| `chat-schema.sql` (uygulandı) | `chat_conversations` + `chat_messages` tabloları, RLS, `is_admin()`, Realtime |
| `functions/chat/index.ts` (deploy edildi) | Edge Function: AI yanıtı (Claude) + canlı destek köprüsü |
| `../ej-chat.js` | Ziyaretçi widget'ı (tüm sayfalara eklendi) |
| `../admin.html` | Operatör paneli (giriş + Realtime + yanıt) |

## Mimari / Güvenlik

- Ziyaretçiler chat tablolarına **doğrudan erişmez**. Tüm yazma/okuma
  `chat` Edge Function'ı üzerinden, `service_role` ile yapılır.
- Ziyaretçi kimliği tahmin edilemez bir **`visitor_token`** (uuid) ile
  doğrulanır; `localStorage`'ta `ej_chat` anahtarında saklanır.
- AI motoru anahtarı (`ANTHROPIC_API_KEY`) yalnızca Edge Function'da kalır,
  asla tarayıcıya gitmez.
- Operatör paneli gerçek Supabase hesabıyla giriş yapar; yetki `profiles.is_admin`
  + RLS `is_admin()` ile sınırlıdır. Realtime canlı güncelleme sağlar.
- Ziyaretçi tarafı Realtime yerine **4 sn polling** kullanır (anon erişim
  açmamak için bilinçli tercih).

## ⚠️ KALAN TEK ADIM — Anthropic API anahtarı

AI yanıt verebilmesi için anahtarı Supabase secret olarak ekleyin:

1. https://console.anthropic.com → **API Keys** → yeni anahtar oluştur (`sk-ant-...`).
2. Supabase Dashboard → **Project Settings → Edge Functions → Secrets**
   (veya CLI: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`)
   - Ad: `ANTHROPIC_API_KEY`
   - Değer: anahtarınız
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

`functions/chat/index.ts` içinde `CLAUDE_MODEL = "claude-opus-4-8"` (en yetenekli).
Yoğun bir destek hattı için maliyeti ~5x düşürmek isterseniz
`claude-haiku-4-5` yapıp fonksiyonu yeniden deploy edin.

## Test temizliği

Test konuşmaları: `delete from chat_conversations where page = '/test';`
