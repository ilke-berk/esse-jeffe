// Esse Jeffe — "asılsız başarı" backstop + onay-sorusu tespiti testleri
// (backend/functions/chat/guards.ts). findUnbackedClaim: metinde bir başarı/
// kart iddiası varsa VE gereken tool bu turda başarılı olmadıysa guard döner;
// gereken tool başarılıysa iddia meşrudur (null döner). isApprovalPrompt: kısa-
// onay kısayolunun kapısı.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findUnbackedClaim, isApprovalPrompt, UNBACKED_GUARDS,
} from "../backend/functions/chat/guards.ts";

// Hiçbir tool başarılı değilken YAKALANMASI gereken (asılsız) iddialar.
const UNBACKED = [
  ["payment", "Ödemeniz onaylandı, siparişiniz hazırlanıyor."],
  ["payment", "Havaleniz alındı, teşekkürler."],
  ["payment", "Ödemeniz başarıyla alındı."],
  ["order_placed", "Siparişiniz alındı 🎉 numaranız EJ26072037837."],
  ["order_placed", "Siparişiniz oluşturuldu, teşekkürler."],
  ["exchange_recorded", "İptal talebiniz alındı, ekibimiz dönüş yapacak."],
  ["exchange_recorded", "Değişim talebinizi oluşturdum."],
  ["exchange_recorded", "İptal talebiniz işleme alındı."],
  ["address_changed", "Teslimat adresinizi güncelledim."],
  ["address_changed", "Adresiniz değiştirildi."],
  ["price_alert", "Fiyat alarmınız kuruldu, düşünce haber vereceğiz."],
  ["price_alert", "Alarmı oluşturdum."],
  ["stock_promise", "Ürün stoğa gelince size haber veririm."],
  ["stock_promise", "Stok geldiğinde e-posta göndereceğim."],
  ["card_claim", "Talebinizin özeti aşağıda, onaylıyor musunuz?"],
  ["card_claim", "Aşağıda siparişinizin özeti var, onaylıyor musunuz?"],
  ["card_claim", "İşte ürün, aşağıda görebilirsiniz."],
];

// Gereken tool BAŞARILI olduğunda aynı iddia MEŞRUDUR (null dönmeli).
const BACKED = [
  ["Talebinizin özeti aşağıda, onaylıyor musunuz?", ["summary"]],
  ["İşte ürün, aşağıda görebilirsiniz.", ["product"]],
  ["Siparişiniz alındı 🎉", ["order"]],
  ["İptal talebiniz alındı.", ["exchange"]],
  ["Teslimat adresinizi güncelledim.", ["address"]],
  ["Fiyat alarmınız kuruldu.", ["alert"]],
];

// HİÇBİR guard'a takılmaması gereken meşru/nötr cümleler (tool yokken bile).
const CLEAN = [
  "Merhaba! Size nasıl yardımcı olabilirim?",
  "Pera modelimiz mavi renkte XL bedende mevcut.",
  "Havale bildiriminiz alındı; ekibimiz banka hesabını kontrol edip onaylayacak.", // ödeme onayı DEĞİL
  "İptal işleminizi başlatmak için onayınızı almam gerekiyor.",                    // henüz alınmadı
  "Adresinizi güncelleyebilirim, sipariş numaranızı paylaşır mısınız?",            // teklif, geçmiş değil
  "Ödemeniz onaylanınca siparişiniz kesinleşecek.",                                // gelecek zaman
  "",
];

test("asılsız başarı iddiaları (tool yokken) doğru guard'a takılır", () => {
  for (const [name, s] of UNBACKED) {
    const g = findUnbackedClaim(s, []);
    assert.ok(g, `yakalanmalıydı: "${s}"`);
    assert.equal(g.name, name, `"${s}" → beklenen guard ${name}, gelen ${g && g.name}`);
  }
});

test("gereken tool başarılıysa iddia meşrudur (null)", () => {
  for (const [s, tools] of BACKED) {
    assert.equal(findUnbackedClaim(s, tools), null, `meşru olmalıydı: "${s}" (tools: ${tools})`);
  }
});

test("meşru/nötr cümleler hiçbir guard'a takılmaz", () => {
  for (const s of CLEAN) {
    const g = findUnbackedClaim(s, []);
    assert.equal(g, null, `yakalanMAmalıydı: "${s}" (${g && g.name})`);
  }
});

test("payment ve stock_promise tool'dan bağımsız her zaman yasaktır", () => {
  // tools:[] olan guard'lar herhangi bir succeeded set'iyle bile bloklamalı
  assert.ok(findUnbackedClaim("Ödemeniz onaylandı.", ["order", "transfer", "summary"]));
  assert.ok(findUnbackedClaim("Stok gelince haber veririm.", ["order", "summary"]));
});

test("her guard'ın safe metni kendi kalıbına yeniden takılmaz", () => {
  for (const g of UNBACKED_GUARDS) {
    const safe = g.safe("0850 255 12 37");
    assert.equal(findUnbackedClaim(safe, []), null, `safe metni kendini yakalıyor: ${g.name} → "${safe}"`);
  }
});

test("isApprovalPrompt onay sorularını tanır, alakasız cümleleri tanımaz", () => {
  const YES = [
    "Talebinizin özeti aşağıda, onaylıyor musunuz?",
    "Aşağıda siparişinizin özeti var, onaylıyor musunuz?",
    "Özetiniz hazır, onaylıyor musunuz?",
    "Onaylar mısınız?",
  ];
  const NO = [
    "Size nasıl yardımcı olabilirim?",
    "Hangi bedeni istersiniz?",
    "Teşekkürler, iyi günler!",
    "",
  ];
  for (const s of YES) assert.equal(isApprovalPrompt(s), true, `onay sorusu: "${s}"`);
  for (const s of NO) assert.equal(isApprovalPrompt(s), false, `onay sorusu DEĞİL: "${s}"`);
});
