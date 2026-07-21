# Chat AI — "asılsız onay / kaybolan kart" sistematik düzeltmesi (fazlı plan)

**Durum:** Faz 1 CANLI (chat v24) · Faz 2 BACKEND CANLI (chat v25 + migration uygulandı,
DB smoke geçti: poll `pending` taze→kart / bayat→null); kalan yalnız `ej-chat.js` statik
yayını + `/verify` Playwright · **Faz 3 BACKEND CANLI: chat v26 (2026-07-21, HTTP 201/
ACTIVE, boot smoke `start` 200 + `pending:null`)** — kalan yalnız `ej-chat.js` statik yayını ·
**Oluşturma:** 2026-07-21

> Faz 3 değişiklikleri: `guards.ts` (3a: IADE_RE'ye "iade işlemi/sürecini başlat",
> "iadenizi gerçekleştir", "paranızı geri gönder/aktar/öde/yatır" kalıpları; KUPON_RE'ye
> "kod üret", "indirim sağla", "özel fiyat yap" + bare "üret/hazırla" olumlu-eke daraltıldı;
> Türkçe ekler `\S*` ile — `\w` DEĞİL. 3b: `findFabricatedCoupon` — kupon bağlamında tool/
> müşteri kaynağında geçmeyen büyük-harf kod token'ı yakalar), `index.ts` (3b wiring:
> `collectCouponSourceText` + kupon guard sonrası düzeltici tur/safe; `poll` `.gt`→`.gte`
> eşit-ts atlama düzeltmesi), `ej-chat.js` (3c: cancel*'a onFail → buton geri aç + hata
> mesajı; no_pending fallback'te ölü "Onaylandı" sıfırla), yeni test `fabricated-coupon.test.mjs`
> + iade/kupon testleri genişletildi. Tüm suite 151/151 geçti, `node --check` temiz.

> Faz 2 değişiklikleri: migration `backend/migrations/2026-07-21-pending-card.sql`
> (canlı DB'ye apply_migration ile uygulandı) + `schema.sql`; `index.ts`
> (`handleSummary`/`handleExchangeSummary` kartı yeni kolona da yazar; `freshPendingFor`
> yardımcısı; `poll`/`resume`/`start` yanıtına `pending` eklendi; tüm pending-temizleme
> noktalarına `*_card: null`); `ej-chat.js` (`renderPendingCard`/`clearPendingCard`/
> `cardSig`/`derivePending` — poll re-derive, imzayla idempotent; `renderOrderCard`/
> `renderExchangeCard` artık `row` döner). Guard birim testleri 6/6, `node --check` temiz.
> DEPLOY: `backend/deploy-chat.ps1` (sbp token kullanıcıdan) → sonra `ej-chat.js` statik yayın.

> Faz 1 değişiklikleri: `guards.ts` (isApprovalPrompt + UNBACKED_GUARDS tablosu + findUnbackedClaim),
> `index.ts` (runOrderConfirm, kısa-onay çift-pending/son-AI kapısı, askGemini asılsız-başarı backstop,
> runExchangeConfirm yapısal statü), `tests/unbacked-guard.test.mjs`. Birim testleri: 148/148 geçti.
> Kalan doğrulama (deploy sonrası): DB negatif testi + `/verify` Playwright + canlı regresyon.

## Neden

İlke'nin bildirdiği hata (iptal onayında ekranda onay butonunun çıkmaması) izole bir bug değil;
**iki kök nedenden doğan bir hata sınıfının** tek örneği. Üç paralel kod denetimi (backend tool
akışı, guard kapsamı, widget render/race) bunu doğruladı ve canlı DB'de conversation
`8d938ce8-a9fe-43f2-ba04-b96b03b78ee4` / sipariş `EJ26072037837` üzerinde birebir izlendi:

Model `show_exchange_summary` fonksiyonunu hiç çağırmadan "İptal işleminizi başlatmak için onayınızı
almam gerekiyor, aşağıda talebinizin özeti yer alıyor; onaylıyor musunuz?" metnini **düz metin**
olarak yazdı → görsel kart/onay butonu render olmadı, `pending_exchange` set edilmedi, deterministik
kısa-onay kısayolu devreye giremedi. Kullanıcı 1dk40sn butonu bekledikten sonra "onaylıyorum" yazdı;
onay kırılgan Gemini yoluna düştü (kayıt yine de oluştu — ama şans eseri, deterministik güvence yok).

### Kök neden A — backend, model-yazarlığı
`send` → `askGemini` döngüsünde müşteriye giden **tüm** onay/başarı metnini model yazar. Tool sonucu
(`BAŞARILI/HATA/BİLGİ`) modele yalnızca tavsiye niteliğinde string döner. Yani model:
(a) tool'u hiç çağırmadan başarı uydurabilir, veya (b) `HATA:` dönüşünü yok sayıp "oldu" diyebilir.
Deterministik (model-dışı) olan yalnız 3 yol var: `confirm_order` butonu, `confirm_exchange` butonu,
exchange kısa-onay kısayolu. Sistem prompt'undaki ~17 "asla söyleme" kuralından yalnız 2'sinin
(iade, kupon) kod-seviyesi backstop'u var; ödeme onayı, adres değişimi, fiyat alarmı, stok sözü,
sipariş/talep kaydı — hepsi yalnız prompt'a bağlı.

### Kök neden B — frontend, ephemeral kart
Kart payload'ları (`summary`, `card`, `product`, `exchange_summary`) yalnız `send`/`confirm_*` HTTP
yanıt gövdesinde taşınır; `poll` yalnız `chat_messages` döndürür, `resume`/`start` pending taşımaz.
Kart en-fazla-bir-kez oluşan kırılgan bir DOM olayı; oysa "...onaylıyor musunuz?" AI metni kalıcıdır
ve her poll'da geri gelir. Bu asimetri tam da bildirilen semptom: timeout, panel yeniden-açma,
2. sekme, resume, ya da ikinci tool'un `order` payload'unu ezmesi → "metin var, buton yok".

## Amaç

Müşteriye giden hiçbir onay/başarı ve hiçbir aksiyon kontrolü (kart/buton) yalnız tek bir model
turuna veya tek bir ephemeral HTTP yanıtına bırakılmasın; deterministik üretilsin ve kalıcı durumdan
yeniden kurulabilsin. Çözüm **parça parça / 3 faz** halinde; her faz bağımsız deploy edilebilir.

---

## FAZ 1 — Güvenlik çekirdeği (backend-only, migration YOK)
En yüksek değer, en düşük risk. Sahte ödeme/onay/kayıp-talep riskini kapatır.
Dosyalar: `backend/functions/chat/index.ts`, `guards.ts`, `exchange.ts`, `tests/`.

### 1a. Onay yolu asimetrileri
- `confirm_order` gövdesini (`index.ts` ~2257-2288) `runOrderConfirm` yardımcısına çıkar
  (`runExchangeConfirm` aynası: `handleCreateOrder` + sabit aiMsg).
- `send` handler (~2187-2208): **önce** hem `pending_order` hem `pending_exchange` için kısa-onay
  kısayolunu dene, **sonra** yalnız tüketilmeyen pending'i bayatlat. Bugün blanket update ikisini
  birden `null`'lıyor ve yalnız exchange kısayolu araya giriyor → tip edilen "onaylıyorum" siparişi
  deterministik yoldan düşürüyor.
- Çift-pending (ikisi de taze) durumunda bare "evet/onaylıyorum" hiçbirini sessizce seçip diğerini
  silmesin — belirsizse kısayolu atla, modele bırak.
- Kısayol yalnız **kullanıcıdan önceki son AI mesajı onay sorusu ise** commit etsin (TTL içindeki
  alakasız bir "evet" değişimi tetiklemesin). `isShortConfirm` whitelist'i genişletilmez.

### 1b. "Asılsız başarı" deterministik backstop
`askGemini`'de bu turda **başarıyla tamamlanan** side-effect tool'larını bir Set'te izle. iade/kupon
guard'ının genellemesi olan tek post-filter (`guards.ts`'te ortak tablo):

| guard | metin kalıbı (≈) | gereken tool | ihlalde |
|---|---|---|---|
| card_claim | `özet(iniz)? (aşağıda\|var)`, `onaylıyor musunuz`, `aşağıda görebilir` | summary/product | re-prompt→safe |
| payment | `ödeme(niz)? (alındı\|onaylandı\|geçti\|tamamlandı)` | transfer | re-prompt→safe |
| order_placed | `sipariş(iniz)? (alındı\|oluşturuldu\|onaylandı)`, `EJ\d{6,}` | order | re-prompt→safe |
| exchange_recorded | `(değişim\|iptal) talebiniz (alındı\|oluşturuldu\|kaydedildi)` | exchange | re-prompt→safe |
| address_changed | `adresiniz(i)? (güncelle\|değiştir)` | address | re-prompt→safe |
| price_alert | `alarm(ınız)? (kuruldu\|oluşturuldu\|ayarlandı)` | alert | re-prompt→safe |
| stock_promise | `stok.*(gel\|gelince).*(haber\|e-?posta\|bildir)` | — (yetenek YOK) | her zaman blokla |

Kalıba uyup gereken tool bu turda başarılı olmadıysa: 1 kez hedefli düzeltici re-prompt, yine
ihlalse sabit `safeText`. Altyapı `index.ts` ~1886-1912'deki mevcut iade/kupon deseni.

### 1c. `runExchangeConfirm` prose-coupling'ini kır
`handleCreateExchange` yapısal dönsün: `{ status: 'created'|'updated'|'duplicate'|'oos'|'error',
emailed: boolean, message }`. `runExchangeConfirm` (~1959-1989) `startsWith("BAŞARILI")`/`/stok/.test`
yerine `status`'a dallansın; "e-postanıza gönderdik" cümlesi `m.includes("e-posta")` yerine `emailed`
boolean'ına bağlansın.

### Faz 1 doğrulama
- Guard birim testleri: `node --experimental-strip-types tests/*.test.mjs`.
- DB negatif testi: model kart iddia edip fonksiyon atladığında `orders`/`exchange_requests`/
  `price_alerts` satırı OLUŞMAMALI ve müşteriye safe metin gitmeli.
- Regresyon: mevcut `confirm_order`/`confirm_exchange` buton yolları hâlâ deterministik şablon.

---

## FAZ 2 — Kart kalıcılığı (migration + backend + frontend BİRLİKTE)
En büyük parça. Kök neden B; "buton yok" semptom ailesini kökten kapatır.
Dosyalar: migration, `index.ts`, `ej-chat.js`.

1. **Migration** (`backend/migrations/2026-07-2X-pending-card.sql`): `pending_order_card jsonb`,
   `pending_exchange_card jsonb`. Ham input confirm'deki `resolveOrder` fiyat/stok yeniden-doğrulaması
   için KORUNUR; render-hazır kart payload'u ayrı kolona yazılır. Sunucu admin ile eriştiği için RLS yok.
2. **Yazım:** `handleSummary` (~1546) ve `handleExchangeSummary` (~930) kart payload'unu yeni kolona da yaz.
3. **`poll`/`resume`/`start` yanıtına taze pending ekle:** `{ messages, status, pending: {kind, card, at} | null }`.
   Tazelik `PENDING_ORDER_TTL_MS`.
4. **Widget re-derive:** poll/resume işlerken taze `pending` varsa ve o pending için canlı kart yoksa
   kartı kur (idempotent `renderedPendingKey`); pending temizlenince kartı kaldır/geçersiz kıl.
   `handleOrder` hızlı yolu kalır, poll re-derive garanti fallback'tir.

### Faz 2 doğrulama (`/verify` Playwright)
Özet varken paneli kapat/aç + 2. sekme → kart yeniden kuruluyor mu; yapay send-gecikmesinde poll
kartı getiriyor mu; "onaylıyorum" yazınca kart geçersizleşiyor mu.

---

## FAZ 3 — Guard sertleştirme + widget cilası (düşük risk, en son)

- **3a.** `IADE_RE`/`KUPON_RE` kaçışlarını kapat (`guards.ts` ~15-84): "iade işlemi başlat",
  "iadenizi gerçekleştir", "paranızı geri gönder/aktar", "kod üret", "indirim sağla", "özel fiyat yap"
  — regex + `tests/` birim test.
- **3b. (opsiyonel)** Uydurma-tanımlı-kupon: tool dönüşünde geçmeyen spesifik kupon kodu
  (`[A-ZÇĞİÖŞÜ0-9]{4,}`) iddiasını yakala.
- **3c. Widget UX:** poll cursor `.gt(created_at)` → bileşik `(created_at, id)` / id-dedup
  (eşit-timestamp mesaj atlanmasın); `cancel*` boş catch → butonu yeniden aç + hata mesajı;
  `no_pending` fallback'te ölü "Onaylandı" butonunu sıfırla.

---

## Deploy notları
- Faz 1 & 3-guard: yalnız edge function → `backend/deploy-chat.ps1` (sbp token kullanıcıdan).
- Faz 2: önce migration (`mcp supabase apply_migration`), sonra edge function, sonra `ej-chat.js` statik yayın.
- PowerShell UTF-8 dosya yazımında `System.IO.File` API kullan (BOM'suz UTF-8 tuzağı).
