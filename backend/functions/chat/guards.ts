// ============================================================
// Esse Jeffe — chat yanıtı deterministik korumaları.
//
// İADE FİLTRESİ: Sistem prompt'u "iade taahhüdü" vermeyi açıkça yasaklar,
// ama LLM zaman zaman genel e-ticaret kalıbına kayıp "14 gün içinde iade
// edebilirsiniz" diyebiliyor (canlıda görüldü, 2026-07-17). Bu modül yalnız
// TAAHHÜT kalıplarını yakalar; politikayı DOĞRU anlatan cümleler
// ("iade yerine değişim yapıyoruz", "iade hakkı bulunmuyor",
//  "para iadesi yapılamamaktadır") yakalanmaz.
//
// Saf fonksiyonlar — Deno bağımlılığı yok; tests/iade-guard.test.mjs
// Node --experimental-strip-types ile doğrudan import edip test eder.
// ============================================================

export const IADE_RE = new RegExp(
  [
    // "iade edebilirsiniz / iade edilir / iade edilebilir / iade alabilirsiniz"
    // (olumsuzları eşleşmez: "iade edilemez", "iade edilmemektedir")
    "iade\\s+ed(?:ebilir|ilir|ilebilir|iyoruz|eriz|elim)",
    "iade\\s+al(?:abilir|ıyoruz|ırız)",
    // "ürünü/ürünlerinizi iade edin/ediniz/et..."
    "iade\\s+ed(?:in\\b|iniz)",
    // "iade hakkınız var(dır) / bulunmakta / mevcut" ("bulunmuyor" eşleşmez)
    "iade\\s+hakkınız\\s+(?:var|bulunmakta|mevcut)",
    // "cayma hakkınız var(dır)" ("istisnası kapsamında" anlatımı eşleşmez)
    "cayma\\s+hakkınız\\s+(?:var|bulunmakta|mevcut)",
    // "iade talebinizi oluşturabilir/başlatabilir/alabiliriz"
    "iade\\s+taleb\\w*\\s+(?:oluştur|başlat|al(?:abilir|alım|ıyoruz))",
    // "iadeleri kabul ediyoruz/edilir" ("kabul edilmemektedir" eşleşmez)
    "iade\\w*\\s+kabul\\s+(?:ediyoruz|ederiz|edilir|edilecek|edilmektedir)",
    // "para/ücret/bedel/tutar iadesi yapılır/sağlanır/mümkün" (olumsuz eşleşmez)
    "(?:para|ücret\\w*|bedel|tutar\\w*)\\s+iadesi\\s+(?:yapıl(?:ır|acak|abilir|maktadır)|sağlan|mümkün|alabilir)",
    // "geri ödeme yapılır/alırsınız" ("geri ödeme yapılmaz" eşleşmez)
    "geri\\s+ödeme(?:nizi|si)?\\s+(?:yapıl(?:ır|acak|abilir|maktadır)|al(?:abilir|ırsınız)|sağlan)",
    // "ücretiniz/paranız/bedeli iade edilir" (olumsuz "edilmez" eşleşmez)
    "(?:ücret\\w*|para\\w*|bedel\\w*|tutar\\w*)\\s+iade\\s+edil(?:ir|ecek|ebilir|mektedir)",
    // ---- 3a kaçış kapatma (2026-07-21): dolaylı iade AKSİYONU taahhütleri.
    // Türkçe ekler için \S* (\w Türkçe 'ı/ş/ğ/ç/ö/ü' harflerini eşlemez — Faz 1 tuzağı).
    // "iade (işlemini/sürecini/talebini) başlat(ıyorum/acağım/…)" — arada 0-1 sözcük.
    // (olumsuz "başlatamam/başlatamıyorum" ek listesinde yok → eşleşmez)
    "iade\\S*\\s+(?:\\S+\\s+)?başlat(?:ıyor|acağ|alım|ayım|abilir|tım|ırım|abiliriz)",
    // "iadenizi / iade işleminizi gerçekleştir(iyorum/eceğim/…)"
    "iade\\S*\\s+(?:\\S+\\s+)?gerçekleştir(?:iyor|eceğ|elim|eyim|ebilir|dim|iriz|irim)",
    // "paranızı/ücretinizi/bedelinizi geri gönder/aktar/öde/yatır/ver (taahhüt)".
    // Olumsuzlar (…-me-/-ma-/-eme-/-ama-) fiil kökünden sonraki lookahead'lerle elenir.
    "(?:para\\S*|ücret\\S*|bedel\\S*|tutar\\S*|ödeme\\S*)\\s+geri\\s+(?:gönder|aktar|öde|yatır|ver)(?!m)(?!eme)(?!emi)(?!ama)(?!amı)\\S*",
  ].join("|"),
  "i",
);

export function hasIadeCommitment(text: string): boolean {
  if (!text) return false;
  // JS regex /i, Türkçe 'İ' (U+0130) harfini 'i' ile eşlemez ("İade" kaçardı).
  // Metin iki ayrı küçük-harf haritasıyla normalize edilip öyle test edilir
  // (tr: İ→i ve I→ı; düz: I→i) — iki olasılık da kapsanır.
  return IADE_RE.test(text.toLocaleLowerCase("tr")) || IADE_RE.test(text.toLowerCase());
}

// Düzeltici tur talimatı: modelin taslağı yasak kalıp içerdiğinde geçmişe
// eklenip aynı soru değişim politikasıyla yeniden yanıtlatılır.
export const IADE_FIX_INSTRUCTION =
  "SİSTEM DÜZELTMESİ (müşteriye gösterilmez, buna yanıt olarak yalnız müşteri mesajını yanıtla): " +
  "Bir önceki taslak yanıtında yasak olan iade/bedel iadesi taahhüdü var. Aynı soruya, iade sözü VERMEDEN " +
  "yeniden yanıt ver: ürünler sipariş üzerine müşterinin tercihine göre hazırlandığından iade yerine " +
  "14 gün içinde beden/renk/model DEĞİŞİMİ yapıldığını nazikçe ve resmî bir dille açıkla. " +
  "Yanıtında iade, bedel/ücret ya da ödeme geri verme TAAHHÜDÜ bildiren hiçbir ifade bulunmasın.";

// ============================================================
// KUPON VAADİ FİLTRESİ (2026-07-18): Bot YENİ kupon oluşturamaz/tanımlayamaz;
// prompt bunu yasaklar ama iade filtresindeki ders geçerli — LLM ısrarcı
// müşteride "size özel kupon tanımlayayım" kalıbına kayabilir. Bu filtre
// yalnız ÜRETME/VAAT kalıplarını yakalar; sistemdeki TANIMLI kuponu söylemek
// ("size tanımlı bir kupon var", "kuponunuz uygulandı") YAKALANMAZ.
// ============================================================

export const KUPON_RE = new RegExp(
  [
    // "kupon/kod oluşturdum|oluşturuyorum|oluşturacağım|oluşturabilirim|oluşturayım"
    // (olumsuz "oluşturamıyorum/oluşturamam" eşleşmez — ekler listede yok)
    "(?:kupon|kod)u?\\w*\\s+oluştur(?:dum|uyorum|acağım|abilir|ayım|alım|urum)",
    // üret/hazırla artık olumlu eklerle sınırlı (olumsuz "üretemem/hazırlayamam" hariç)
    "indirim\\s+kodu\\w*\\s+(?:oluştur(?:dum|uyorum|acağım|abilir|ayım|urum)|üret(?:iyor|eceğ|eyim|ebilir|tim|elim|iriz|irim)|hazırla(?:rım|yayım|yacağ|yabilir|dım|yalım))",
    // "kupon tanımladım|tanımlarım|tanımlayacağım|tanımlayabilirim|tanımlayayım"
    // ("tanımlı" SIFATI eşleşmez: tanımla + kişi eki zorunlu)
    "kupon\\w*\\s+tanımla(?:dım|rım|yacağım|yabilir|yayım|yalım)",
    "(?:hesabınıza|adınıza|sizin\\s+için)\\s+(?:bir\\s+)?(?:kupon|kod|indirim)\\w*\\s+tanımla(?:dım|rım|yacağım|yabilir|nacak|yayım)",
    // "size özel kupon/kod/indirim ..." (üretme vaadi kalıbı)
    "size\\s+özel\\s+(?:bir\\s+)?(?:kupon|kod|indirim)",
    // "kupon vereyim|verebilirim|veriyorum|göndereyim|gönderebilirim"
    "kupon\\w*\\s+(?:ver(?:eyim|ebilir|iyorum|irim)|gönder(?:eyim|ebilir|iyorum|irim))",
    // bot pazarlığı: "indirim yapabilirim|yapayım|yaparım|uygulayabilirim|uygulayayım"
    "indirim\\s+(?:yap(?:abilirim|ayım|arım)|uygula(?:yabilirim|yayım|rım))",
    // ---- 3a kaçış kapatma (2026-07-21). Türkçe ekler için \S*.
    // "(kupon/indirim) kod(u) üret(iyorum/eceğim/…)" (olumsuz "üretemem" hariç)
    "(?:kupon|indirim)?\\s*kod\\S*\\s+üret(?:iyor|eceğ|eyim|ebilir|tim|elim|iriz|irim)",
    // "indirim sağla(rım/yacağım/yabilirim/…)" (olumsuz "sağlayamam/sağlayamıyorum" hariç)
    "indirim\\s+sağla(?:rım|yacağ|yabilir|yayım|yalım|dım|yabiliriz)",
    // "(size) özel fiyat yap/ver/sun (taahhüt)" — olumsuzlar lookahead'le elenir
    "özel\\s+fiyat\\s+(?:yap|ver|sun)(?!m)(?!eme)(?!emi)(?!ama)(?!amı)\\S*",
  ].join("|"),
  "i",
);

export function hasKuponPromise(text: string): boolean {
  if (!text) return false;
  // iade filtresiyle aynı Türkçe İ/I normalizasyonu (iki harita da denenir)
  return KUPON_RE.test(text.toLocaleLowerCase("tr")) || KUPON_RE.test(text.toLowerCase());
}

export const KUPON_FIX_INSTRUCTION =
  "SİSTEM DÜZELTMESİ (müşteriye gösterilmez, buna yanıt olarak yalnız müşteri mesajını yanıtla): " +
  "Bir önceki taslak yanıtında kupon oluşturma/tanımlama/indirim yapma VAADİ var; böyle bir yetkin YOK. " +
  "Aynı soruya yeniden yanıt ver: yeni kupon oluşturamayacağını/tanımlayamayacağını nazikçe söyle; " +
  "yalnız sistemde müşteriye TANIMLI kuponlar varsa onlar kullanılabilir (get_customer_benefits sonucu " +
  "ya da sipariş özetindeki BİLGİ satırı dışında kupon adı ANMA). İndirim pazarlığı yapma.";

// İkinci deneme de kupon vaadi içerirse kullanılacak sabit güvenli yanıt.
export function kuponSafeText(): string {
  return (
    "Kupon tanımlama ya da özel indirim yapma yetkim bulunmuyor. Hesabınıza tanımlı bir kupon varsa " +
    "sipariş oluştururken size otomatik olarak öneririm; dilerseniz siteye giriş yapıp benden " +
    "kupon ve sadakat bakiyenizi sorgulamamı isteyebilirsiniz."
  );
}

// ============================================================
// 3b — UYDURMA TANIMLI KUPON KODU (2026-07-21, opsiyonel): hasKuponPromise
// ÜRETME/VAAT fiillerini ("kupon tanımladım") yakalar; bu filtre FİİLSİZ ama
// spesifik-kod iddiasını kapatır — model, hiçbir tool dönüşünde (ya da müşterinin
// kendi mesajında) GEÇMEYEN spesifik bir kupon kodunu ("HOSGELDIN10 kuponunuz
// hazır") söyleyemesin. Yalnız kupon BAĞLAMINDAKİ (yakınında kupon/kod/indirim
// geçen) büyük-harf kod token'ları denetlenir; sipariş no (EJ + rakam), saf sayı
// ve marka/kanal gibi kod-olmayan büyük sözcükler hariç.
// ============================================================

// Kupon-kodu benzeri büyük-harf token'ları (≥4, en az bir harf). Türkçe büyük
// harfler dâhil; ORİJİNAL metinde (küçültme YOK — kod büyük-harf olmalı) taranır.
const CODE_TOKEN_RE = /[A-ZÇĞİÖŞÜ0-9]{4,}/g;
// Kod OLMAYAN, kupon bağlamında geçebilen büyük-harf sözcükler (marka/kanal/boyut).
const CODE_STOPWORDS = new Set([
  "WHATSAPP", "PAYTR", "ESSE", "JEFFE", "ESIN", "KARGO", "TESLIMAT",
  "SIPARIŞ", "SİPARİŞ", "KUPON", "İNDİRİM", "INDIRIM", "KAMPANYA",
  "PTT", "MNG", "ARAS", "YURTİÇİ", "YURTICI", "XXL", "XXXL",
]);
function codeTokens(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const tok of text.match(CODE_TOKEN_RE) || []) {
    if (!/[A-ZÇĞİÖŞÜ]/.test(tok)) continue; // en az bir harf (saf sayı/yıl/fiyat değil)
    if (/^EJ\d/.test(tok)) continue;        // sipariş numarası (EJ26072037837)
    out.add(tok);
  }
  return out;
}
// Kupon bağlamı: metin bunlardan birini içermeli (kod token'ı zaten büyük-harf
// zorunlu, o yüzden bağlamı geniş tutmak yanlış-pozitif getirmez).
const COUPON_CONTEXT_RE = /kupon|kod|indirim|promosyon|kampanya/;

// Kupon bağlamında geçen ama knownCodes'ta OLMAYAN ilk spesifik kodu döner (yoksa null).
// knownCodes: bu turda tool dönüşlerinde + müşteri mesajlarında görülen metinler.
export function findFabricatedCoupon(text: string, knownCodes: Iterable<string>): string | null {
  if (!text) return null;
  const lo = text.toLocaleLowerCase("tr");
  if (!COUPON_CONTEXT_RE.test(lo) && !COUPON_CONTEXT_RE.test(text.toLowerCase())) return null;
  const known = new Set<string>();
  for (const k of knownCodes) for (const t of codeTokens(k)) known.add(t);
  for (const tok of codeTokens(text)) {
    if (CODE_STOPWORDS.has(tok)) continue;
    if (known.has(tok)) continue;
    return tok; // kupon bağlamında, hiçbir meşru kaynakta geçmeyen spesifik kod
  }
  return null;
}

// ============================================================
// ONAY SORUSU TESPİTİ (2026-07-21): Kısa-onay kısayolu (send içindeki
// "onaylıyorum" → deterministik commit) YALNIZ kullanıcıdan önceki son AI
// mesajı bir onay sorusuysa devreye girsin. Aksi halde TTL içindeki alakasız
// bir "evet" bekleyen bir siparişi/değişimi sessizce onaylayabilir.
// ============================================================
export function isApprovalPrompt(text: string): boolean {
  if (!text) return false;
  // "onaylıyor musunuz", "onaylar mısınız", "onayınızı", "özetiniz aşağıda/var"
  const re = /onaylıyor\s*mu|onaylar\s*mısınız|onayınız|özet(?:i|iniz)?\s*(?:aşağıda|var|hazır)/;
  return re.test(text.toLocaleLowerCase("tr")) || re.test(text.toLowerCase());
}

// ============================================================
// ASILSIZ BAŞARI BACKSTOP (2026-07-21): send→askGemini döngüsünde müşteriye
// giden onay/başarı metnini MODEL yazar; tool sonucu modele yalnız tavsiyedir.
// Model bir side-effect'i (sipariş/değişim/ödeme bildirimi/adres/fiyat alarmı)
// YAPILMIŞ gibi anlatıp ilgili tool'u hiç çağırmamış ya da HATA almış olabilir;
// ya da hiç kart/özet fonksiyonu çağırmadan "özetiniz aşağıda" diyebilir (canlı
// vaka 2026-07-20, iptal onayı). Bu tablo modelin final metnini tarar:
// "başarı/kart iddiası var AMA bu turda gereken tool BAŞARILI olmadı" ise
// iade/kupon deseniyle aynı düzeltici tur + sabit güvenli metin uygulanır.
//
// tools: iddianın meşru sayılması için bu turda BAŞARILI olması gereken tool
//   anahtar(lar)ı (askGemini doldurur). BOŞ liste → o yetenek HİÇ yok / iddia
//   her koşulda yasak (ödeme onayı, stok bildirimi): her zaman blokla.
// ============================================================
export type UnbackedGuard = {
  name: string;
  re: RegExp;
  tools: string[];
  fix: string;
  safe: (whatsapp: string) => string;
};

const UB_FIX = "SİSTEM DÜZELTMESİ (müşteriye gösterilmez, buna yanıt olarak yalnız müşterinin son mesajını yanıtla): ";

export const UNBACKED_GUARDS: UnbackedGuard[] = [
  {
    name: "payment",
    // "ödemeniz/havaleniz alındı|onaylandı|geçti|tamamlandı" (bitişik) — "havale
    // bildiriminiz alındı" gibi araya kelime giren meşru ifadeler eşleşmez.
    re: /(?:ödeme|havale|eft)(?:niz)?\s+(?:alındı|onaylandı|onaylanmıştır|geçti|tamamlandı|başarıyla\s+alındı)/,
    tools: [],
    fix: UB_FIX + "Bir önceki taslağında ödemenin alındığını/onaylandığını söyledin; böyle bir onayı SEN veremezsin — ödeme yalnız ekip banka hesabını kontrol edince onaylanır. Aynı soruya, ödeme onayı İMA ETMEDEN yeniden yanıt ver; havale/EFT ise yalnız 'bildiriminizi ilettim, ekibimiz kontrol edip onaylayacak' de.",
    safe: () => "Ödemenizle ilgili onayı ben veremiyorum; havale/EFT bildiriminizi ekibimize iletebilirim. Ödemeniz, banka hesabımızda görülüp ekibimizce kontrol edildikten sonra onaylanır.",
  },
  {
    name: "order_placed",
    re: /sipariş(?:iniz)?\s+(?:alındı|oluşturuldu|oluşturdum|onaylandı|verildi|tamamlandı)/,
    tools: ["order"],
    fix: UB_FIX + "Bir önceki taslağında siparişin oluşturulduğunu/alındığını söyledin ama sipariş oluşturma fonksiyonunu bu turda BAŞARIYLA çağırmadın. Siparişin oluştuğunu İMA ETMEDEN yeniden yanıt ver; gerekiyorsa önce eksik bilgileri iste, sonra özet+onay akışını izle.",
    safe: () => "Siparişinizi henüz sisteme kaydetmedim. Dilerseniz özet kartını hazırlayıp onayınızı alarak siparişinizi oluşturayım.",
  },
  {
    name: "exchange_recorded",
    re: /(?:değişim|iptal)\s+taleb\S*\s+(?:alındı|aldım|oluşturuldu|oluşturdum|kaydedildi|kaydettim|başlatıldı|başlattım|işleme\s+alındı)/,
    tools: ["exchange"],
    fix: UB_FIX + "Bir önceki taslağında değişim/iptal talebinin alındığını/kaydedildiğini söyledin ama talep fonksiyonunu bu turda BAŞARIYLA çağırmadın. Talebin kaydedildiğini İMA ETMEDEN yeniden yanıt ver; eksikse sipariş numarası (EJ ile başlar) ve siparişteki telefonu iste.",
    safe: () => "Talebinizi henüz sisteme kaydetmedim. Sipariş numaranız (EJ ile başlar) ve siparişte kullandığınız telefon numarasıyla talebinizi birlikte oluşturalım.",
  },
  {
    name: "address_changed",
    re: /adresiniz\S*\s+(?:güncelledim|güncellendi|değiştirdim|değiştirildi|yeniledim|kaydettim)/,
    tools: ["address"],
    fix: UB_FIX + "Bir önceki taslağında teslimat adresini güncellediğini söyledin ama adres güncelleme fonksiyonu bu turda BAŞARILI dönmedi. Adresin değiştiğini İMA ETMEDEN yeniden yanıt ver; ürün kargoya verildiyse adresin buradan değiştirilemeyeceğini söyle.",
    safe: () => "Adres değişikliğini henüz uygulayamadım. Sipariş numaranız ve telefonunuzla kontrol edip güncelleyeyim; ürün kargoya verildiyse adres buradan değiştirilemez.",
  },
  {
    name: "price_alert",
    re: /(?:fiyat\s+)?alarm\S*\s+(?:kuruldu|kurdum|oluşturuldu|oluşturdum|ayarlandı|ayarladım|tanımlandı|tanımladım|aktif\s+edildi)/,
    tools: ["alert"],
    fix: UB_FIX + "Bir önceki taslağında fiyat alarmının kurulduğunu söyledin ama alarm fonksiyonu bu turda BAŞARILI dönmedi. Alarmın kurulduğunu İMA ETMEDEN yeniden yanıt ver.",
    safe: () => "Fiyat alarmını henüz kuramadım. Hangi ürün için alarm istediğinizi belirtirseniz kurmayı tekrar deneyeyim.",
  },
  {
    name: "stock_promise",
    // "stok gelince/geldiğinde ... haber/e-posta/bildir/haberdar" — bot'un böyle
    // bir yeteneği YOK; her koşulda yasak.
    re: /sto[kğ]\S*.{0,30}(?:gelince|geldiğinde|gelirse|geldiği\s+an|tekrar\s+sto[kğ])\S*.{0,30}(?:haber|bilgi|bildir|e-?posta|haberdar|mail)/,
    tools: [],
    fix: UB_FIX + "Bir önceki taslağında stok gelince haber vereceğini söyledin; böyle bir yeteneğin YOK, stok bildirimi gönderemezsin. Stok bildirimi SÖZÜ vermeden yeniden yanıt ver; istersen WhatsApp hattını öner.",
    safe: (wa) => `Ne yazık ki ürün için otomatik stok bildirimi gönderme özelliğim yok. Dilerseniz WhatsApp ${wa} hattımızdan yazarsanız ekibimiz ürünle ilgili size yardımcı olabilir.`,
  },
  {
    name: "card_claim",
    // "özetiniz aşağıda/var", "onaylıyor musunuz", "kartı aşağıda", "aşağıda
    // görebilirsiniz" — model bir kart/özet gösterdiğini iddia ediyor.
    re: /özet(?:iniz)?\s+(?:aşağıda|var|hazır)|onaylıyor\s*mu|kart(?:ı|ınız)?\s+aşağıda|aşağıda\s+göre?bilir/,
    tools: ["summary", "product"],
    fix: UB_FIX + "Bir önceki taslağında bir özet/kart gösterdiğini ya da 'aşağıda' olduğunu söyledin ama ilgili özet/kart fonksiyonunu (show_order_summary / show_exchange_summary / show_product_card) bu turda çağırmadın; müşteri hiçbir kart görmeyecek. Kart/özet gösterdiğini İMA ETMEDEN yeniden yanıt ver — eksik bilgi varsa iste.",
    safe: () => "Özeti hazırlıyorum. Devam etmeden önce eksik bir bilgi varsa birlikte tamamlayalım; hazır olduğunda onayınızı isteyeceğim.",
  },
];

// Metinde, bu turda gereken tool BAŞARILI olmadan yapılmış bir başarı/kart
// iddiası varsa ilgili guard'ı döner (iade/kupon deseninin genellemesi).
export function findUnbackedClaim(text: string, succeeded: Iterable<string>): UnbackedGuard | null {
  if (!text) return null;
  const have = new Set(succeeded);
  const lo = text.toLocaleLowerCase("tr");
  const lo2 = text.toLowerCase();
  for (const g of UNBACKED_GUARDS) {
    if (!(g.re.test(lo) || g.re.test(lo2))) continue;
    if (g.tools.length && g.tools.some((t) => have.has(t))) continue; // iddia meşru
    return g;
  }
  return null;
}

// İkinci deneme de yasak kalıp içerirse kullanılacak sabit güvenli yanıt.
export function iadeSafeText(whatsapp: string): string {
  return (
    "Ürünlerimiz siparişiniz üzerine, tercihlerinize göre hazırlandığı için iade yerine " +
    "teslimden itibaren 14 gün içinde beden, renk ya da model değişimi sunuyoruz. " +
    "Ürünün etiketi çıkarılmamış ve kullanılmamış olması yeterli; değişimde gidiş-geliş kargo bedeli müşterimize aittir. " +
    "Ayıplı/kusurlu bir ürün söz konusuysa yasal haklarınız saklıdır — bu durumda WhatsApp " +
    whatsapp + " hattımızdan (Pazartesi–Cumartesi 08:00–19:00) size hemen yardımcı olalım."
  );
}
