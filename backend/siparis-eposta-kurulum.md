# Sipariş Onay E-postası (Resend) — Kurulum

Sipariş oluşunca müşteriye onay, işletmeye "yeni sipariş" bildirimi gönderilir.
Gönderim **Resend** REST API'si üzerinden, Edge Function'lardan yapılır.

## Mimarî (özet)

```
COD / Havale:  sepet.html → create-order → orders yazılır → sendOrderEmails()
Kart:          sepet.html → paytr-token (pending order)
               PayTR → paytr-callback (status=success) → sendOrderEmails()
```

Kart siparişinde e-posta **ödeme onaylanınca** (callback `success`) gider, sipariş
oluşturulduğu an değil — çünkü ödeme henüz doğrulanmamıştır.

Paylaşılan mail modülü: `backend/edge-functions/_shared/order-email.ts`
(hem `create-order` hem `paytr-callback` bunu import eder).

**Fail-soft:** E-posta gönderimi siparişi ASLA bozmaz. Secret yoksa, Resend
çökerse veya adres geçersizse hata loglanır, sipariş yine de kaydedilir/onaylanır.

## 1. Resend hesabı + domain doğrulama

1. https://resend.com → hesap aç, **API Keys** → yeni anahtar (`re_...`).
2. **Domains** → `essejeffe.com` ekle → gösterilen **SPF + DKIM** DNS kayıtlarını
   alan adının DNS'ine gir. Doğrulanana kadar (birkaç dk–saat) mailler gitmez.
3. Gönderen adresi doğrulanan domainde olmalı, ör. `siparis@essejeffe.com`.
   (Domain doğrulanmadan yalnız Resend'in test adresine gönderebilirsin.)

## 2. Secret'ları gir

Supabase → **Edge Functions → Secrets** (veya CLI `supabase secrets set`):

| Secret | Zorunlu | Örnek / Açıklama |
|---|---|---|
| `RESEND_API_KEY` | ✅ | `re_xxx` — Resend API anahtarı |
| `ORDER_FROM_EMAIL` | ✅ | `Esse Jeffe <siparis@essejeffe.com>` (domain doğrulanmış) |
| `ORDER_NOTIFY_EMAIL` | ✅ | İşletme bildirim adresi, ör. `siparis@essejeffe.com` |
| `ORDER_BANK_INFO` | ⬜ | Havale siparişlerinde e-postaya eklenir. IBAN/banka. Satır sonu `\n`. |
| `SITE_URL` | ⬜ | E-postadaki "hesabım" linki için taban, ör. `https://essejeffe.com` |

`ORDER_BANK_INFO` örneği:
```
Alıcı: Esse Jeffe
Banka: XBank
IBAN: TR00 0000 0000 0000 0000 0000 00
```

`RESEND_API_KEY` veya `ORDER_FROM_EMAIL` yoksa gönderim **sessizce atlanır**
(sipariş normal çalışır). Böylece secret'ları girmeden de canlıya çıkabilir,
sonra e-postayı aktive edebilirsin.

## 3. Deploy

Mail modülü `_shared/` altında olduğu için **CLI ile deploy** önerilir (import'lar
otomatik bundle'lanır):

```
supabase functions deploy create-order
supabase functions deploy paytr-callback
```

> Paneli kullanıyorsan: her iki fonksiyon için `_shared/order-email.ts` dosyasını
> da fonksiyonun dosyalarına ekle (import yolu `../_shared/order-email.ts`).

## 4. Test

1. **COD:** Sepete ürün ekle → Kapıda Ödeme → Siparişi Ver.
   - Müşteri e-postasına onay, `ORDER_NOTIFY_EMAIL`'e "yeni sipariş" düşmeli.
2. **Havale:** Aynı akış → e-postada IBAN bloğu (`ORDER_BANK_INFO` girildiyse) çıkmalı.
3. **Kart:** PayTR test kartıyla öde → `paytr-callback` `success` alınca mail gitmeli.
   - Ödeme başarısız/iptal → **mail gitmez** (yalnız `success` durumunda gider).
4. **İdempotenlik:** PayTR aynı bildirimi tekrar gönderirse (`payment_status=paid`)
   fonksiyon erken döner → **mail tekrar gitmez**.
5. Log kontrolü: `supabase functions logs create-order` / `... paytr-callback` →
   `[order-email]` satırlarında hata var mı bak.

## Notlar

- **Deliverability:** SPF+DKIM doğrulanmadan mailler spam'e düşer veya reddedilir.
- Müşteri maili yoksa (COD'da e-posta opsiyonel) müşteriye gönderim atlanır;
  işletme bildirimi yine gider.
- İşletme maili `reply_to` olarak müşteri adresini taşır → "Yanıtla" müşteriye gider.
