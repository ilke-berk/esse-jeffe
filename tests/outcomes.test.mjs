// Esse Jeffe — Y-2b sunucu yazarlığı testleri (backend/functions/chat/outcomes.ts).
// outcomeText: riskli tool sonucundan sunucu onay şablonu; applyOutcome:
// {{ONAY}} yer tutucu değiştirme + kalıntı temizleme (fail-safe);
// guard uyumu: şablonlar kendi backstop guard'larına takılmamalı.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ONAY_PLACEHOLDER, ONAY_INSTRUCTION, RISKY_TOOL_KEYS,
  outcomeText, pickOutcomeText, applyOutcome,
} from "../backend/functions/chat/outcomes.ts";
import { findUnbackedClaim, hasIadeCommitment, hasKuponPromise } from "../backend/functions/chat/guards.ts";

const COD = { order: { mode: "cod", order_no: "EJ26072212345", total: 4750 } };
const CARD = { order: { mode: "card", total: 4750 } };
const EXCH_CREATED = {
  status: "created", emailed: true,
  outcome: { order_no: "EJ26072212345", request_type: "exchange", type_tr: "Değişim", pref: "Renk: Kırmızı, Beden: M" },
};
const CANCEL_CREATED = {
  status: "created", emailed: false,
  outcome: { order_no: "EJ26072212345", request_type: "cancel", type_tr: "İptal", pref: null },
};
const EXCH_UPDATED = {
  status: "updated", emailed: false,
  outcome: { order_no: "EJ26072212345", request_type: "exchange", type_tr: "Değişim", pref: "Beden: L" },
};

test("outcomeText — kapıda ödeme siparişi: no + tutar sunucu şablonunda", () => {
  const t = outcomeText("order", COD);
  assert.ok(t.includes("EJ26072212345"), t);
  assert.ok(t.includes("4.750 TL"), t);
  assert.ok(/alındı/i.test(t), t);
});

test("outcomeText — 'order' anahtarı yalnız COD içindir (kart payload'unda null)", () => {
  assert.equal(outcomeText("order", CARD), null);
  assert.equal(outcomeText("order", {}), null);
});

test("outcomeText — kart: ödeme ekranı metni, sipariş kesinleşti DEMEZ", () => {
  const t = outcomeText("card_checkout", CARD);
  assert.ok(/ödeme ekranı/i.test(t), t);
  assert.ok(!/sipariş(iniz)?\s+(alındı|oluşturuldu|onaylandı)/i.test(t), t);
});

test("outcomeText — değişim created: sipariş no + tercih + e-posta notu", () => {
  const t = outcomeText("exchange", EXCH_CREATED);
  assert.ok(t.includes("EJ26072212345"), t);
  assert.ok(t.includes("değişim talebiniz alındı"), t);
  assert.ok(t.includes("Renk: Kırmızı, Beden: M"), t);
  assert.ok(t.includes("kargo bedeli"), t);       // yalnız exchange'de
  assert.ok(t.includes("e-posta"), t);            // emailed: true
});

test("outcomeText — iptal created: kargo/e-posta notu yok", () => {
  const t = outcomeText("exchange", CANCEL_CREATED);
  assert.ok(t.includes("iptal talebiniz alındı"), t);
  assert.ok(!t.includes("kargo bedeli"), t);
  assert.ok(!t.includes("e-posta"), t);
});

test("outcomeText — değişim updated: güncelleme metni", () => {
  const t = outcomeText("exchange", EXCH_UPDATED);
  assert.ok(/güncellendi/.test(t), t);
});

test("outcomeText — başarı olmayan exchange durumları ve bilinmeyen anahtar null", () => {
  assert.equal(outcomeText("exchange", { status: "duplicate" }), null);
  assert.equal(outcomeText("exchange", { status: "oos" }), null);
  assert.equal(outcomeText("summary", {}), null);
  assert.equal(outcomeText("alert", {}), null);
});

test("outcomeText — havale bildirimi: iletildi der, onaylandı DEMEZ", () => {
  const t = outcomeText("transfer", {});
  assert.ok(/iletildi/.test(t), t);
  assert.ok(!/ödemeniz\s+(alındı|onaylandı)/i.test(t), t);
});

test("pickOutcomeText — yalnız riskli anahtarlar; son başarılı kazanır", () => {
  assert.equal(pickOutcomeText(new Map()), null);
  assert.equal(pickOutcomeText(new Map([["summary", { result: {} }]])), null);
  const m = new Map([
    ["summary", { result: {} }],
    ["transfer", { result: {} }],
    ["order", { result: COD }],
  ]);
  const t = pickOutcomeText(m);
  assert.ok(t.includes("EJ26072212345"), t); // en son riskli = order
});

test("applyOutcome — {{ONAY}} yerine şablon konur", () => {
  const conf = outcomeText("order", COD);
  const out = applyOutcome("{{ONAY}}\n\nBaşka bir sorunuz var mı?", conf);
  assert.ok(out.startsWith("Siparişiniz alındı"), out);
  assert.ok(out.includes("Başka bir sorunuz var mı?"), out);
  assert.ok(!out.includes("{{"), out);
});

test("applyOutcome — yer tutucu yoksa şablon BAŞA eklenir", () => {
  const out = applyOutcome("Teşekkürler, iyi günler!", "ONAY METNİ.");
  assert.ok(out.startsWith("ONAY METNİ."), out);
  assert.ok(out.endsWith("Teşekkürler, iyi günler!"), out);
});

test("applyOutcome — metin boşsa şablonun kendisi döner", () => {
  assert.equal(applyOutcome("", "ONAY METNİ."), "ONAY METNİ.");
});

test("applyOutcome — fail-safe: kalıntı {{...}} müşteri metnine sızmaz", () => {
  // şablon yokken model yer tutucu uydurdu
  assert.equal(applyOutcome("{{ONAY}} Merhaba!", null), "Merhaba!");
  // çoklu yer tutucu: ilki değiştirilir, kalanlar temizlenir
  const out = applyOutcome("{{ONAY}} ve {{ONAY}} ve {{BASKA}}", "X.");
  assert.ok(out.includes("X."), out);
  assert.ok(!out.includes("{{"), out);
});

test("ONAY_INSTRUCTION yer tutucuyu içerir; riskli anahtar kümesi doğru", () => {
  assert.ok(ONAY_INSTRUCTION.includes(ONAY_PLACEHOLDER));
  for (const k of ["order", "card_checkout", "exchange", "transfer"]) {
    assert.ok(RISKY_TOOL_KEYS.has(k), k);
  }
  assert.ok(!RISKY_TOOL_KEYS.has("summary"));
});

test("guard uyumu — şablonlar backing anahtarıyla findUnbackedClaim'e takılmaz", () => {
  const cases = [
    ["order", COD],
    ["card_checkout", CARD],
    ["exchange", EXCH_CREATED],
    ["exchange", CANCEL_CREATED],
    ["exchange", EXCH_UPDATED],
    ["transfer", {}],
  ];
  for (const [key, result] of cases) {
    const t = outcomeText(key, result);
    assert.ok(t, `şablon boş: ${key}`);
    const g = findUnbackedClaim(t, new Map([[key, { tool: "x", result }]]));
    assert.equal(g, null, `şablon kendi guard'ına takıldı: ${key} → ${g && g.name}\n"${t}"`);
    assert.equal(hasIadeCommitment(t), false, `iade filtresi: "${t}"`);
    assert.equal(hasKuponPromise(t), false, `kupon filtresi: "${t}"`);
  }
});

test("guard uyumu — transfer/kart şablonu ödeme-onayı guard'ına (tools:[]) takılmaz", () => {
  // payment guard'ı hiçbir tool'la meşrulaşmaz; şablon yine de temiz olmalı
  assert.equal(findUnbackedClaim(outcomeText("transfer", {}), []), null);
  assert.equal(findUnbackedClaim(outcomeText("card_checkout", CARD), []), null);
});

test("findUnbackedClaim — Map ve Iterable aynı davranır (Y-2a imza uyumu)", () => {
  const claim = "Siparişiniz alındı 🎉";
  assert.ok(findUnbackedClaim(claim, []));
  assert.ok(findUnbackedClaim(claim, new Map()));
  assert.equal(findUnbackedClaim(claim, ["order"]), null);
  assert.equal(findUnbackedClaim(claim, new Map([["order", { tool: "create_order" }]])), null);
});
