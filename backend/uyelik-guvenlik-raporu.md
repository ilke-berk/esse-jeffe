# Üyelik & Güvenlik Raporu — Esse Jeffe

> Amaç: Üyelik (giriş/kayıt) sistemini kurmadan önce **şifrelerin ve hassas
> verilerin nasıl korunduğunu** net bir şekilde anlamak. Kısa cevap:
> **şifreyi biz saklamıyoruz, görmüyoruz; Supabase güvenli şekilde yönetiyor.**

---

## 1. Şifre nasıl saklanır? (En önemli kısım)

### Yanlış yöntem (ASLA yapmayacağımız)
Şifreyi olduğu gibi ("123456" → veritabanına "123456") yazmak. Buna **plaintext**
denir. Veritabanı çalınırsa herkesin şifresi açığa çıkar. **Kesinlikle yapılmaz.**

### Doğru yöntem: Hashing (bizim kullandığımız)
Şifre, **tek yönlü** bir matematiksel fonksiyondan geçirilir ("hash"). Sonuç
geri çözülemez:

```
"MüşteriŞifresi123"  →  bcrypt  →  $2a$10$N9qo8uLOickgx2ZMRZoMy...
```

- Bu hash veritabanına kaydedilir, **şifrenin kendisi değil.**
- Hash'ten şifreye geri dönmek **matematiksel olarak mümkün değil.**
- Kullanıcı giriş yaparken: girdiği şifre tekrar hash'lenir, kayıttaki hash ile
  karşılaştırılır. Aynıysa giriş başarılı. Yani sistem bile gerçek şifreyi bilmez.
- **bcrypt** ayrıca her şifreye rastgele "salt" ekler → aynı şifreyi kullanan iki
  kişinin hash'i bile farklı olur (toplu kırma saldırılarına karşı koruma).

### Bunu kim yapıyor? → **Supabase Auth**
- `supabase.auth.signUp({ email, password })` çağırdığımızda, şifre **HTTPS ile
  şifrelenmiş** olarak Supabase'in kimlik sunucusuna gider.
- Supabase şifreyi **bcrypt ile hash'leyip** `auth.users` tablosunda saklar
  (`encrypted_password` alanı). Bu tabloya bizim frontend kodumuz **erişemez.**
- **Biz (uygulama), sen (işletme sahibi), hatta Supabase çalışanları bile**
  kullanıcının gerçek şifresini göremez.
- Yani: şifre güvenliğini sıfırdan yazmıyoruz — sektör standardı, denetlenmiş bir
  sistemi kullanıyoruz. Bu, kendin yazmaktan **çok daha güvenli.**

---

## 2. Giriş nasıl "hatırlanır"? (Oturum / Session)

Şifre her sayfada tekrar sorulmaz. Giriş başarılı olunca Supabase iki **jeton (token)** verir:

- **Access token (JWT):** kısa ömürlü (~1 saat), her istekte "ben buyum" der.
- **Refresh token:** access token bitince yenisini otomatik alır.

Bu jetonlar tarayıcıda (`localStorage`) tutulur ve `supabase-js` kütüphanesi
otomatik yönetir. Şifre tarayıcıda **saklanmaz** — sadece bu geçici jetonlar.

---

## 3. Hassas kişisel veriler (ad, adres, telefon, e-posta)

Üyelik + sipariş ile bu bilgiler de saklanacak. Korumalar:

| Koruma | Nasıl |
|---|---|
| **İletimde şifreleme** | Tüm trafik **HTTPS** (Supabase zorunlu kılar) — ağda dinlenemez |
| **Diskte şifreleme** | Supabase veritabanı **encryption at rest** ile şifreli diskte tutulur |
| **Erişim kontrolü (RLS)** | Row Level Security: her kullanıcı **yalnızca kendi** verisini görebilir; başkasının siparişini/adresini göremez (şemamızda kurulu) |
| **Gizli anahtar** | `service_role` anahtarı asla frontend'e/kullanıcıya verilmez; sadece sende |
| **Frontend anahtarı** | `publishable` anahtar herkese açık olabilir — RLS veriyi koruduğu için güvenli |

---

## 4. KVKK / yasal taraf

- KVKK (ve GDPR) **plaintext şifre yasaklar** — bizim yöntemimiz (hash) uyumlu.
- Topladığımız veriler (ad, adres, e-posta) için **açık rıza + aydınlatma metni**
  gerekir. Sitede `gizlilik.html` ve `kvkk.html` mevcut; kayıt formuna
  "Gizlilik Politikası'nı okudum/kabul ediyorum" onayı ekleyeceğiz.
- Kullanıcı isterse **hesabını/verisini sildirme** hakkına sahip (ileride hesap
  sayfasına "hesabı sil" eklenebilir).

---

## 5. Ek güvenlik önlemleri (önereceğimiz)

- ✅ **E-posta doğrulama:** kayıt sonrası Supabase doğrulama maili gönderir;
  doğrulanmadan giriş engellenebilir (sahte hesapları azaltır).
- ✅ **Güçlü şifre kuralı:** en az 8 karakter. Frontend bunu zaten dayatır
  (`ej-supabase.js` → `handleRegister`, `pass.length < 8`). **ÖNEMLİ —** frontend
  doğrulaması yalnızca tarayıcıyı korur; Supabase Auth API'sine doğrudan istek atan
  biri panel ayarı 6 ise 6 karakterle kayıt olabilir. Bu yüzden panelden de 8 yap:
  **Supabase → Authentication → Sign In / Providers → Email → "Minimum password
  length" = 8** (bazı panellerde: Authentication → Policies / Password) → Save.
  (İstenirse aynı ekranda "Password Requirements" ile harf+rakam zorunluluğu da açılabilir.)
- ✅ **Şifremi unuttum:** `resetPasswordForEmail` ile güvenli sıfırlama maili.
- ✅ **Brute-force koruması:** Supabase Auth'ta hız sınırlama (rate limit) yerleşik.
- ⚠️ **2FA (iki adımlı doğrulama):** ileride eklenebilir (şart değil).

---

## 6. Üyelik planı (rapor onaylanınca yapılacaklar)

Seçimin: **üye + misafir ikisi de.** Yapılacaklar:

1. **Kayıt sayfası** (`kayit.html`) — ad, e-posta, şifre + KVKK onayı → `signUp`
   (profil satırı `handle_new_user` trigger'ı ile otomatik oluşur).
2. **Giriş sayfası** (`giris.html`) — e-posta + şifre → `signInWithPassword` +
   "Şifremi unuttum" linki.
3. **Oturum yönetimi** — Hesap ikonu: girişliyse hesap menüsü (Hesabım / Çıkış),
   değilse giriş sayfasına yönlendirir. Sepet panelindeki "Giriş Yap / Üye Ol"
   bağlanır.
4. **Hesabım sayfası** (`hesap.html`) — sipariş geçmişi (RLS ile sadece kendi
   siparişleri), kayıtlı adresler.
5. **Checkout entegrasyonu** — girişliyse sipariş `user_id` ile kaydedilir
   (geçmişte görünür); misafir akışı aynen kalır.
6. **Supabase ayarı** — panelde e-posta doğrulama + şifre kuralı (senin yapacağın
   küçük ayar; adımları vereceğim).

---

## Özet (tek cümle)

Şifreyi hiç saklamıyoruz; Supabase onu **geri döndürülemez biçimde hash'leyip**
güvenli tutuyor, biz sadece "doğru mu?" sorusunu soruyoruz. Hassas veriler HTTPS +
disk şifreleme + RLS ile korunuyor. Bu, e-ticaret için sektör standardı ve
KVKK-uyumlu bir yaklaşım.
