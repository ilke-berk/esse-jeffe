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
    "indirim\\s+kodu\\w*\\s+(?:oluştur(?:dum|uyorum|acağım|abilir|ayım|urum)|üret|hazırla)",
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
