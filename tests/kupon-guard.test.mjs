// Esse Jeffe — chat kupon-vaadi filtresi (backend/functions/chat/guards.ts).
// Filtre yalnız kupon ÜRETME/VAAT kalıplarını yakalamalı; sistemdeki tanımlı
// kuponu söyleyen ya da yetkisizliği açıklayan cümleleri YAKALAMAMALI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasKuponPromise, KUPON_FIX_INSTRUCTION, kuponSafeText } from "../backend/functions/chat/guards.ts";

// ---- yakalanması GEREKEN (vaat/üretme) örnekler ----
const VIOLATIONS = [
  "Size özel bir kupon oluşturuyorum.",
  "Hesabınıza %10 indirimlik bir kupon tanımladım.",
  "İsterseniz size kupon verebilirim.",
  "Size özel indirim kodu göndereyim.",
  "Bu sipariş için indirim yapabilirim.",
  "Kupon tanımlarım, sorun değil.",
  "Sizin için bir indirim kodu oluşturacağım.",
  "Hemen bir kupon oluşturayım.",
  "Adınıza kupon tanımlayacağım.",
  "İndirim uygulayabilirim tabii ki.",
  "SİZE ÖZEL KUPON OLUŞTURDUM.",            // tamamı büyük harf (İ/I normalizasyonu)
  "İndirim kodu hazırlayayım mı?",
];

// ---- yakalanmaMASI gereken (meşru) örnekler ----
const SAFE = [
  "Size tanımlı bir kupon görünüyor, kullanmak ister misiniz?",
  "Hesabınıza tanımlı SADAKAT-ABC123 kuponunuz var.",
  "Kupon oluşturamıyorum, böyle bir yetkim yok.",
  "Yeni kupon tanımlayamıyorum; ancak tanımlı kuponunuz varsa önerebilirim.",
  "Kupon tanımlama yetkim bulunmuyor.",
  "SEPET-ABC123 kuponunuz siparişinize uygulandı.",
  "Kuponunuz %10 indirim uygular.",
  "Kampanya kuponu kullanabilirsiniz.",
  "Kuponlar sipariş sırasında otomatik önerilir.",
  "Sadakat programında her sipariş %5 kazandırır.",
  "Merhaba! Size nasıl yardımcı olabilirim?",
  "",
];

test("kupon vaadi kalıpları yakalanır", () => {
  for (const t of VIOLATIONS) {
    assert.equal(hasKuponPromise(t), true, `yakalanmalıydı: "${t}"`);
  }
});

test("tanımlı kupon anlatımı ve yetkisizlik cümleleri yakalanmaz", () => {
  for (const t of SAFE) {
    assert.equal(hasKuponPromise(t), false, `yakalanMAmalıydı: "${t}"`);
  }
});

test("güvenli metin ve düzeltme talimatı kendi filtresini tetiklemez", () => {
  assert.equal(hasKuponPromise(kuponSafeText()), false);
  assert.equal(hasKuponPromise(KUPON_FIX_INSTRUCTION), false);
});
