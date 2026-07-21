// Esse Jeffe — 3b uydurma-tanımlı-kupon filtresi (backend/functions/chat/guards.ts).
// findFabricatedCoupon: model, kupon BAĞLAMINDA hiçbir meşru kaynakta (tool dönüşü
// ya da müşteri mesajı = knownCodes) geçmeyen SPESİFİK bir kupon kodu andıysa o kodu
// döner; meşru kaynak varsa ya da kupon bağlamı yoksa null döner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findFabricatedCoupon } from "../backend/functions/chat/guards.ts";

// ---- YAKALANMASI gereken (uydurma kod, meşru kaynak yok) ----
const FABRICATED = [
  ["HOSGELDIN10 kuponunuz hazır, kullanabilirsiniz.", []],
  ["Size WELCOME kodunu tanımladım.", []],
  ["INDIRIM25 kuponuyla %25 kazanırsınız.", []],
  ["HOSGELDIN kodunu kullanabilirsiniz.", []],              // saf harf kod
  ["Kuponunuz VIP2026, siparişte geçerli.", []],
  // meşru kaynak var ama BAŞKA bir kod uyduruldu
  ["Kuponunuz BASKA99 ile uygulandı.", ["Tanımlı kupon: SADAKAT-ABC123 (%5)"]],
];

// ---- YAKALANMAması gereken (meşru kaynak var / kupon bağlamı yok / nötr) ----
const CLEAN = [
  // tool dönüşünde geçen tanımlı kupon → meşru
  ["SADAKAT-ABC123 kuponunuz siparişinize uygulandı.", ["Tanımlı kullanılabilir kupon(lar): SADAKAT-ABC123 (%5, en fazla 1.500 TL)."]],
  // müşterinin kendi yazdığı kod → meşru
  ["KAMPANYA50 kodunuzu uyguladım.", ["KAMPANYA50 kodum var, geçerli mi?"]],
  // kupon bağlamı yok → dokunma (sipariş no da EJ ile hariç)
  ["Siparişiniz EJ26072037837 numarasıyla oluşturuldu.", []],
  ["Merhaba! Size nasıl yardımcı olabilirim?", []],
  // stopword (marka/kanal) kupon bağlamında geçse bile kod sayılmaz
  ["WHATSAPP hattımızdan kupon sorabilirsiniz.", []],
  // saf sayı/yıl kod değildir
  ["2026 kampanyası kapsamında kuponunuz olabilir.", []],
  ["", []],
];

test("uydurma kupon kodu (meşru kaynak yok) yakalanır", () => {
  for (const [s, known] of FABRICATED) {
    assert.ok(findFabricatedCoupon(s, known), `yakalanmalıydı: "${s}"`);
  }
});

test("meşru kaynaklı kod / bağlamsız / nötr cümleler yakalanmaz", () => {
  for (const [s, known] of CLEAN) {
    assert.equal(findFabricatedCoupon(s, known), null, `yakalanMAmalıydı: "${s}"`);
  }
});

test("dönen değer uydurulan kodun ta kendisidir", () => {
  assert.equal(findFabricatedCoupon("HOSGELDIN10 kuponunuz hazır.", []), "HOSGELDIN10");
  // meşru koddan sonra gelen uydurma kod da yakalanır
  assert.equal(
    findFabricatedCoupon("SADAKAT-ABC123 ve ayrıca BONUS500 kuponunuz var.", ["SADAKAT-ABC123 (%5)"]),
    "BONUS500",
  );
});
