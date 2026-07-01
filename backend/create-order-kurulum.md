# Kapıda Ödeme / Havale — Güvenli Sipariş (create-order) Kurulumu

COD/havale siparişlerinde fiyat manipülasyonu açığı kapatıldı. Artık tutar
client'tan **alınmaz**; kart akışındaki `paytr-token` gibi, sipariş sunucuda
fiyatı DB'den yeniden hesaplayan `create-order` Edge Function'ı üzerinden oluşur.

## Mimarî (özet)

```
sepet.html (Kapıda Ödeme / Havale seç)
   │  EJData.createOrder(form, items)
   │  → client.functions.invoke('create-order', {form, items})
   ▼
Edge Function: create-order
   - Ödeme yöntemini doğrular (yalnız cod | transfer)
   - Fiyatı sepet slug'larından DB'den hesaplar (client'a GÜVENMEZ)
   - orders + order_items yazar (service_role → RLS baypas)
   ▼
sepet.html sipariş onayı (order_no gösterilir)
```

Kart ödemesi eskisi gibi `paytr-token` üzerinden gider — değişmedi.

## Deploy adımları

### 1. Edge Function'ı deploy et
- Kaynak: `backend/edge-functions/create-order/index.ts`
- Supabase CLI: `supabase functions deploy create-order`
  (veya panelden yeni fonksiyon oluşturup içeriği yapıştır).
- Ekstra secret **gerekmez**: `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY`
  otomatik gelir.

### 2. RLS'i güncelle (ÖNEMLİ — açığı asıl kapatan adım)
`backend/schema.sql` güncellendi: `orders` / `order_items` için **client insert
politikaları kaldırıldı**. Supabase → SQL Editor'de şunu çalıştır:

```sql
drop policy if exists "sipariş oluştur"     on orders;
drop policy if exists "sipariş kalemi ekle" on order_items;
```

Bundan sonra anon/authenticated rol doğrudan sipariş **ekleyemez**; yazma yalnızca
Edge Function'ların service_role'ü ile mümkündür. `select` politikaları (üye
kendi siparişini görür) aynen kalır.

### 3. Test et
- Sepete ürün ekle → **Kapıda Ödeme** → Siparişi Ver → onay ekranı + `orders`'ta
  doğru `total` (DB fiyatı) olduğunu doğrula.
- **Manipülasyon testi:** DevTools konsolunda sepet `localStorage`'ındaki fiyatı
  `1` yap, siparişi geç. `orders.total` yine **gerçek DB fiyatını** göstermeli.
- Doğrudan insert denemesi: anon anahtarla `orders`'a insert → RLS reddetmeli.
