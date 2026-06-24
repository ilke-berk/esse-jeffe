# Esse Jeffe — Backend (Supabase)

Bu klasör sitenin backend kurulumunu içerir. Mimari:

- **Supabase** — veritabanı (PostgreSQL), üyelik/giriş (Auth), görsel depolama (Storage), otomatik API
- **Ödeme** — kapıda ödeme + havale (Supabase'de kayıt) **ve** online kart (Edge Function ile sağlayıcıya bağlanır)
- **Frontend** — mevcut statik site; `ej.js` içindeki `EJCart` ve ürün/sipariş çağrıları Supabase'e bağlanacak

---

## 1. Supabase projesi oluştur (senin yapacağın)

1. https://supabase.com → ücretsiz hesap aç → **New project**
2. Proje adı: `esse-jeffe`, güçlü bir veritabanı şifresi belirle (bir yere kaydet), bölge: **Frankfurt (eu-central)** (Türkiye'ye en yakın)
3. Proje açılınca **SQL Editor** → **New query** → `schema.sql` dosyasının tamamını yapıştır → **Run**
   - Tablolar + güvenlik kuralları + mevcut ürünler tohum veri olarak oluşur.
4. **Storage** → **New bucket** → adı `products`, **Public** işaretle (ürün görselleri için)

## 2. Bana getireceğin bilgiler

Proje ayarlarından (**Settings → API**):

| Bilgi | Nerede | Güvenli mi? |
|---|---|---|
| **Project URL** | Settings → API → Project URL | ✅ Frontend'de kullanılır |
| **anon public key** | Settings → API → Project API keys → `anon` `public` | ✅ Frontend'de kullanılır |
| **service_role key** | Aynı yer → `service_role` | 🔴 GİZLİ — kimseyle paylaşma, sadece sen sakla |

> `anon` anahtarı frontend'e gömülür ve güvenlidir; veriyi RLS kuralları korur.
> `service_role` anahtarını **bana verme**, sadece kendi admin işlerinde kullan.

## 3. Online ödeme sağlayıcısı — **PayTR** (seçildi)

1. https://www.paytr.com → başvuru/üyelik (şirket bilgilerinle: BEBEGEL TEKSTİL Ltd., MERSİS/VKN)
2. Onay sonrası **Mağaza Paneli → Ayarlar → Mağaza Bilgileri**'nden şu 3 değeri al:
   - `merchant_id`
   - `merchant_key`
   - `merchant_salt`
3. Bu 3 değer **GİZLİDİR** — frontend'e konmaz. Supabase **Edge Function** içinde
   (ortam değişkeni olarak) saklanır; ödeme isteği sunucu tarafından imzalanır.

> Onay birkaç gün sürebilir. Bu sürede backend'in kart dışındaki kısımları
> (katalog, üyelik, sepet, kapıda ödeme/havale ile sipariş) çalışır halde olur;
> PayTR onayı gelince online kartı aktif ederiz.

## 4. Sıradaki adımlar (bende)

- [ ] `backend/schema.sql` — veritabanı şeması ✅ hazır
- [ ] Frontend'e Supabase client + ürünleri veritabanından çekme
- [ ] Üyelik: giriş / kayıt sayfaları + oturum yönetimi
- [ ] Sepet → checkout: teslimat formu + sipariş oluşturma
- [ ] Ödeme Edge Function (PayTR / iyzico) + kapıda ödeme/havale akışı
- [ ] İletişim & bülten formlarını Supabase'e bağlama
- [ ] Sipariş onay e-postası
