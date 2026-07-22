// ============================================================
// Esse Jeffe — Y-2b sunucu yazarlığı (2026-07-22, denetim Y-2).
//
// SORUN AYRIMI: guards.ts "desteksiz başarı"yı (tool çağrılmadı ama model
// "oldu" dedi) yakalar; bu modül "yanlış ifade edilmiş başarı"yı (tool
// BAŞARILI ama model sonucu yanlış özetliyor) kökten çözer: en riskli üç
// side-effect tool'un (create_order, create_exchange_request,
// notify_bank_transfer) onay cümlesini MODEL değil SUNUCU yazar —
// runOrderConfirm/runExchangeConfirm'deki deterministik desenin
// serbest-metin (askGemini) yoluna taşınmış hâli.
//
// AKIŞ: tool başarılı olunca functionResponse'a ONAY_INSTRUCTION eklenir
// ("sonucu SEN bildirme, {{ONAY}} yer tutucusu koy"); askGemini final
// metinde yer tutucuyu outcomeText() şablonuyla değiştirir, yer tutucu
// yoksa şablonu metnin BAŞINA ekler (çelişki varsa müşteri önce doğrusunu
// okur). Model metni komple atılmaz: müşterinin son sorusuna cevap ve
// sonraki adım kaybolmasın.
//
// Saf fonksiyonlar — Deno bağımlılığı yok; tests/outcomes.test.mjs
// Node --experimental-strip-types ile doğrudan import edip test eder.
// ============================================================

export const ONAY_PLACEHOLDER = "{{ONAY}}";

// Riskli tool başarılı olunca functionResponse mesajının sonuna eklenir.
export const ONAY_INSTRUCTION =
  "\n\nSİSTEM KURALI: Bu işlemin sonucunu (sipariş no, tutar, 'alındı/kaydedildi/iletildi' " +
  "bildirimi) müşteriye KENDİN yazma. Yanıtının EN BAŞINA tam olarak {{ONAY}} yaz; sistem bu " +
  "yer tutucuyu doğrulanmış onay metniyle değiştirecek. {{ONAY}} sonrasında istersen müşterinin " +
  "son sorusuna kısa bir ek cevap ya da sonraki adımı yazabilirsin; işlem sonucunu TEKRARLAMA.";

// askGemini'nin tuttuğu tur-içi tool sonucu (OrderResult'ın outcomes.ts'nin
// ihtiyaç duyduğu alt kümesi — index.ts'e ters bağımlılık kurulmaz).
export type ToolOutcome = {
  order?: Record<string, unknown>;   // create_order başarı payload'u (mode/order_no/total)
  status?: string;                   // exchange: created | updated | duplicate | ...
  emailed?: boolean;                 // exchange: süreç e-postası gerçekten gitti mi
  outcome?: Record<string, unknown>; // exchange: yapısal şablon verisi (order_no/type_tr/pref)
};

// Sunucu şablonuna sahip (en riskli) tool anahtarları. card_checkout,
// create_order'ın kart dalı: sipariş OLUŞMAZ ama "kesinleşti" yanılgısı
// aynı risk sınıfında olduğundan onun da onayını sunucu yazar.
export const RISKY_TOOL_KEYS = new Set(["order", "card_checkout", "exchange", "transfer"]);

function tl(n: unknown): string {
  return Number(n).toLocaleString("tr-TR") + " TL";
}

// Tool anahtarına göre sunucu onay cümlesi; şablon kurulamıyorsa null
// (o durumda model metni olduğu gibi kalır, guards.ts son savunmadır).
// Metinler runOrderConfirm/runExchangeConfirm deterministik metinleriyle
// AYNI dilde tutulur — iki onay yolu müşteriye aynı sesle konuşsun.
export function outcomeText(toolKey: string, result: ToolOutcome): string | null {
  if (toolKey === "order") {
    const ord = result.order || {};
    if (ord.mode !== "cod" || !ord.order_no) return null;
    return (
      `Siparişiniz alındı 🎉 Sipariş numaranız: ${ord.order_no}. ` +
      `Toplam ${tl(ord.total)} — kargo ücretsiz, ödemeyi teslimatta yapacaksınız. ` +
      `Siparişiniz hazırlanıp kargoya verildiğinde takip bilgisi iletilecek. Bizi tercih ettiğiniz için teşekkür ederiz!`
    );
  }
  if (toolKey === "card_checkout") {
    return (
      "Güvenli kart ödeme ekranı şimdi açılıyor; kart bilgilerinizi o ekranda girebilirsiniz. " +
      "Ödemeniz onaylanınca siparişiniz kesinleşecek."
    );
  }
  if (toolKey === "exchange") {
    const o = result.outcome || {};
    const typeLo = String(o.type_tr || "değişim").toLocaleLowerCase("tr");
    const emailedTxt = result.emailed
      ? " Talep özetinizi ve süreç adımlarını e-posta adresinize de gönderdik."
      : "";
    if (result.status === "updated") {
      return (
        `Mevcut ${typeLo} talebiniz yeni tercihlerinizle güncellendi ✅ ` +
        `Ekibimiz en kısa sürede (Pazartesi–Cumartesi 08:00–19:00) size dönüş yapacak.` + emailedTxt
      );
    }
    if (result.status === "created") {
      const pref = o.pref ? ` Yeni tercihiniz (${o.pref}) talebinize işlendi.` : "";
      const kargo = o.request_type === "exchange"
        ? " Değişimde gidiş-geliş kargo bedeli size aittir."
        : "";
      return (
        (o.order_no ? `${o.order_no} numaralı siparişiniz için ` : "Siparişiniz için ") +
        `${typeLo} talebiniz alındı ✅${pref} ` +
        `Ekibimiz en kısa sürede (Pazartesi–Cumartesi 08:00–19:00) size dönüş yapacak.` +
        kargo + emailedTxt
      );
    }
    return null; // duplicate/oos/error başarı sayılmaz; buraya normalde düşmez
  }
  if (toolKey === "transfer") {
    return (
      "Havale/EFT bildiriminiz ekibimize iletildi ✅ Ödemeniz, banka hesabımızda görülüp " +
      "ekibimizce kontrol edildikten sonra onaylanacak; onaylandığında sipariş durumunuz güncellenecek."
    );
  }
  return null;
}

// Bu turun outcomes haritasından sunucu onay metnini seç (riskli tool'lardan
// EN SON başarılı olanı — Map ekleme sırasını korur; aynı turda birden fazla
// riskli işlem zaten olağan dışı).
export function pickOutcomeText(outcomes: Map<string, { result: ToolOutcome }>): string | null {
  let conf: string | null = null;
  for (const [key, v] of outcomes) {
    if (!RISKY_TOOL_KEYS.has(key)) continue;
    const t = outcomeText(key, v.result);
    if (t) conf = t;
  }
  return conf;
}

// Final metne sunucu onayını uygula:
//  - {{ONAY}} varsa İLK geçtiği yere şablon konur,
//  - yoksa şablon metnin BAŞINA eklenir (metin boşsa şablonun kendisi),
//  - FAIL-SAFE: kalıntı {{...}} yer tutucuları (model uydursa bile) müşteri
//    metnine/DB'ye SIZMAZ — chat_messages insert'inden önce temizlenir.
export function applyOutcome(text: string, confirmation: string | null): string {
  let t = text || "";
  if (confirmation) {
    t = t.includes(ONAY_PLACEHOLDER)
      ? t.replace(ONAY_PLACEHOLDER, confirmation)
      : (t ? confirmation + "\n\n" + t : confirmation);
  }
  return t
    .replace(/\{\{[^{}\n]{0,40}\}\}/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
