// Esse Jeffe — chat iade filtresi (backend/functions/chat/guards.ts) testleri.
// Filtre yalnız İADE TAAHHÜDÜ kalıplarını yakalamalı; politikayı doğru anlatan
// ("iade yerine değişim", olumsuz "iade edilemez") cümleleri YAKALAMAMALI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasIadeCommitment, iadeSafeText, IADE_FIX_INSTRUCTION } from "../backend/functions/chat/guards.ts";

// ---- yakalanması GEREKEN (taahhüt) örnekler ----
const VIOLATIONS = [
  // canlıda görülen gerçek ihlal (2026-07-17)
  "Ürün size ulaştıktan sonra 14 gün içinde, etiketi çıkarılmamış ürünlerinizi orijinal ambalajı ve faturasıyla birlikte iade edebilirsiniz.",
  "İade edebilirsiniz.",                          // büyük İ (U+0130) ile başlangıç
  "Dilerseniz ürünü iade edin, biz ilgilenelim.",
  "İade hakkınız var, merak etmeyin.",
  "Cayma hakkınız bulunmakta.",
  "Para iadesi yapılır.",
  "Bedel iadesi mümkün.",
  "Ücretiniz iade edilir.",
  "Geri ödemenizi alabilirsiniz.",
  "Geri ödeme yapılacak.",
  "İadeleri kabul ediyoruz.",
  "İade talebinizi oluşturabilirim.",
  "Tabii, iade alabiliriz.",
  "PARA İADESİ YAPILIR.",                          // tamamı büyük harf
];

// ---- yakalanmaMASI gereken (doğru politika / olumsuz) örnekler ----
const SAFE = [
  "Ürünlerimiz sipariş üzerine hazırlandığı için iade yerine 14 gün içinde beden, renk ya da model değişimi yapıyoruz.",
  "İade hakkı bulunmuyor; size değişim seçeneği sunuyoruz.",
  "İade hakkınız bulunmamaktadır ancak değişim her zaman mümkündür.",
  "Ürünler iade edilemez; değişim yapılabilir.",
  "Para iadesi yapılamamaktadır.",
  "İade kabul edilmemektedir.",
  "Geri ödeme yapılmamaktadır.",
  "Ürünlerimiz cayma hakkının istisnaları kapsamındadır.",
  "Değişim her zaman vardır; 14 gün içinde beden ve renk değişimi yapıyoruz.",
  "Merhaba! Size nasıl yardımcı olabilirim?",
  "Kargo tüm siparişlerde ücretsizdir.",
  "",
];

test("iade taahhüdü kalıpları yakalanır", () => {
  for (const s of VIOLATIONS) {
    assert.equal(hasIadeCommitment(s), true, `yakalanmalıydı: "${s}"`);
  }
});

test("doğru politika anlatımı ve olumsuz cümleler yakalanmaz", () => {
  for (const s of SAFE) {
    assert.equal(hasIadeCommitment(s), false, `yakalanMAmalıydı: "${s}"`);
  }
});

test("güvenli metin taahhüt içermez ve WhatsApp numarasını taşır", () => {
  const txt = iadeSafeText("0850 255 12 37");
  assert.equal(hasIadeCommitment(txt), false);
  assert.ok(txt.includes("0850 255 12 37"));
  assert.ok(/değişim/i.test(txt));
});

test("düzeltme talimatı da filtreyi tetiklemez (kendi kendini yakalamasın)", () => {
  // talimat metni geçmişe user rolüyle eklenir; filtre yalnız model ÇIKTISINA
  // uygulanır ama yine de talimatın kendisi taahhüt kalıbı içermemeli
  assert.equal(hasIadeCommitment(IADE_FIX_INSTRUCTION), false);
});
