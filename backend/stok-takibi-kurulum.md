# Stok Takibi — Kurulum & Kullanım

Varyant (ürün × renk × beden) başına stok takibi ve **aşırı satış (overselling) koruması**.
Aşırı satış, sipariş anında atomik stok ayırma ile engellenir; yarış koşulu (race
condition) yoktur.

## Ne değişti?

| Katman | Değişiklik |
|--------|------------|
| `backend/schema.sql` | `product_stock` tablosu, RLS, `reserve_stock_bulk` / `restore_stock_bulk` RPC'leri, tohum satırları |
| `create-order` (COD/havale) | Sipariş açmadan önce stok ayırır; yetmezse `409` |
| `paytr-token` (kart) | Ödeme başlarken (pending) stok ayırır; token/insert hatasında iade eder |
| `paytr-callback` | Ödeme **başarısız/iptal/timeout** → ayrılan stoğu geri verir |

## 1. Şemayı güncelle

Supabase → SQL Editor → `backend/schema.sql` dosyasını yapıştır → **Run**.
Dosya tekrar çalıştırmaya güvenlidir (idempotent). Bu adım:

- `product_stock` tablosunu oluşturur,
- her mevcut varyant için **`track=false` (sınırsız)** bir satır ekler → **hiçbir
  satış engellenmez**, mevcut davranış birebir korunur,
- RPC fonksiyonlarını kurar ve bunları yalnız `service_role`'e açık bırakır
  (`anon`/`authenticated` çağıramaz).

## 2. Edge Function'ları deploy et

```bash
supabase functions deploy create-order
supabase functions deploy paytr-token
supabase functions deploy paytr-callback
```

(Ya da Supabase panelinden ilgili fonksiyonların içeriğini güncelle.)

## 3. Gerçek envanteri gir → korumayı aç

Bir varyant `track=false` olduğu sürece **sınırsız** kabul edilir. Aşırı satış
korumasının o varyantta devreye girmesi için `stock` adedini gir ve `track=true` yap.

**Tek varyant** (ör. Pera / Bordo / M → 5 adet):

```sql
update product_stock set stock = 5, track = true
where product_id = (select id from products where slug = 'pera')
  and color = 'Bordo' and size = 'M';
```

**Bir ürünün tüm varyantları** aynı adede (ör. Pera → hepsi 3 adet):

```sql
update product_stock set stock = 3, track = true
where product_id = (select id from products where slug = 'pera');
```

**Bir varyantı yeniden sınırsız yapmak** (takibi kapat):

```sql
update product_stock set track = false
where product_id = (select id from products where slug = 'pera')
  and color = 'Bordo' and size = 'M';
```

> `color`/`size` değerleri `order_items`'ta saklananla **birebir** eşleşmeli
> (renk adı "Bordo", beden "M" gibi). Sepette renk/beden seçilmiyorsa ilgili
> alan boş string (`''`) olur.

## Nasıl çalışır? (özet)

- **Ayırma:** `reserve_stock_bulk(p_items jsonb)` tüm sepeti tek transaction'da işler.
  Her varyant satırını `FOR UPDATE` ile kilitler; **önce** hepsinin yeterli olduğunu
  doğrular, **sonra** hepsini düşer. Biri bile yetmezse hiçbirini düşmez ve
  `{"ok": false, ...}` döner (fonksiyon `409` + `out_of_stock` ile yanıtlar).
  Kilitler transaction sonuna dek tutulduğundan eşzamanlı iki sipariş serileşir →
  aynı son ürünü iki kişiye satmak imkânsızdır.
- **İade:** `restore_stock_bulk(p_items jsonb)` ayrılan adetleri geri ekler.
  Kart ödemesi başarısız/iptal/timeout olduğunda `paytr-callback` bunu **yalnız ilk
  geçişte** (`pending → failed`) çağırır; PayTR aynı bildirimi tekrarlarsa çift iade olmaz.
- **track=false** olan satır ve **hiç satırı olmayan** varyant sınırsız sayılır,
  hiçbir zaman engellenmez.

## Notlar / kalan opsiyoneller

- `product_stock` herkese **okunur** (RLS `select`), yazma yalnız admin. Böylece ürün
  sayfasında "tükendi" rozeti gösterme veya AI sohbetine stok bilgisi verme altyapısı
  hazırdır — bunlar henüz frontend'e bağlanmadı (opsiyonel iyileştirme).
- Yeni ürün/renk/beden eklediğinde `schema.sql`'in tohum bloğu eksik varyant satırlarını
  `on conflict do nothing` ile tamamlar; sadece dosyayı tekrar Run et.
