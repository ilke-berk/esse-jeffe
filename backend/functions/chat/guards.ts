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
