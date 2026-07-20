// Esse Jeffe — chat sipariş durumu yardımcıları (backend/functions/chat/order-info.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCH_STATUS_TR,
  exchangeInstructions,
  formatOrderList,
  formatOrderStatus,
  ORDER_STATUS_TR,
  PAYMENT_METHOD_TR,
  PAYMENT_STATUS_TR,
} from "../backend/functions/chat/order-info.ts";

// ---- exchangeInstructions (değişim süreç talimatları) ----
test("exchangeInstructions: adres verilirse adres satırı, verilmezse 'ekip iletecek'", () => {
  const withAddr = exchangeInstructions("Örnek Mah. No:1 Esenler/İstanbul");
  assert.ok(withAddr.some((s) => s.includes("Örnek Mah. No:1")));
  assert.ok(!withAddr.some((s) => s.includes("ekibimiz tarafından size iletilecek")));
  const noAddr = exchangeInstructions(null);
  assert.ok(noAddr.some((s) => s.includes("ekibimiz tarafından size iletilecek")));
});

test("exchangeInstructions: zorunlu koşullar her iki modda da var", () => {
  for (const steps of [exchangeInstructions(null), exchangeInstructions("adres")]) {
    assert.equal(steps.length, 6);
    assert.ok(steps.some((s) => s.includes("etiketi çıkarılmamış")));
    assert.ok(steps.some((s) => s.includes("orijinal ambalajı")));
    assert.ok(steps.some((s) => s.includes("sipariş numaranız")));
    assert.ok(steps.some((s) => s.includes("kargo bedeli müşterimize aittir")));
  }
});

// ---- map'ler schema.sql CHECK listeleriyle birebir ----
test("ORDER_STATUS_TR: orders.status CHECK değerlerinin tamamı var", () => {
  for (const s of ["pending", "preparing", "shipped", "delivered", "cancelled"]) {
    assert.ok(ORDER_STATUS_TR[s], `eksik: ${s}`);
  }
});

test("PAYMENT_STATUS_TR / PAYMENT_METHOD_TR / EXCH_STATUS_TR eksiksiz", () => {
  for (const s of ["pending", "paid", "failed", "cod"]) assert.ok(PAYMENT_STATUS_TR[s], `eksik ödeme durumu: ${s}`);
  for (const s of ["cod", "card", "transfer"]) assert.ok(PAYMENT_METHOD_TR[s], `eksik yöntem: ${s}`);
  for (const s of ["new", "in_progress", "closed"]) assert.ok(EXCH_STATUS_TR[s], `eksik talep durumu: ${s}`);
});

// ---- formatOrderStatus ----
const ORDER = {
  order_no: "EJ26071812345",
  status: "shipped",
  payment_method: "cod",
  payment_status: "cod",
  total: 1699,
  carrier: "Aras Kargo",
  tracking_no: "TR123456",
  created_at: "2026-07-18T10:00:00Z",
};
const ITEMS = [{ product_name: "Pera", color: "Siyah", size: "M", qty: 1 }];

test("kargolu sipariş: durum + takip no + ürünler + toplam metinde", () => {
  const m = formatOrderStatus(ORDER, ITEMS, null);
  assert.ok(m.startsWith("BAŞARILI:"));
  assert.ok(m.includes("EJ26071812345"));
  assert.ok(m.includes("Kargoya verildi"));
  assert.ok(m.includes("TR123456"));
  assert.ok(m.includes("Aras Kargo"));
  assert.ok(m.includes("1 x Pera (Siyah/M)"));
  assert.ok(m.includes("1.699 TL"));
  assert.ok(m.includes("UYDURMA") || m.includes("SÖYLEME")); // uydurma yasağı talimatı
});

test("kargosuz sipariş: 'henüz kargoya verilmedi' der, takip no geçmez", () => {
  const m = formatOrderStatus({ ...ORDER, status: "preparing", tracking_no: null, carrier: null }, ITEMS, null);
  assert.ok(m.includes("Hazırlanıyor"));
  assert.ok(m.includes("Henüz kargoya verilmedi"));
  assert.ok(!m.includes("TR123456"));
});

test("shipped ama takip no girilmemiş: özel açıklama", () => {
  const m = formatOrderStatus({ ...ORDER, tracking_no: null }, ITEMS, null);
  assert.ok(m.includes("takip numarası henüz sisteme girilmemiş"));
});

test("açık değişim talebi yanıtta görünür (yeni tercihle)", () => {
  const m = formatOrderStatus(ORDER, ITEMS, {
    request_type: "exchange", status: "in_progress", new_color: "Mavi", new_size: null,
  });
  assert.ok(m.includes("Açık Değişim talebi"));
  assert.ok(m.includes("İşlemde"));
  assert.ok(m.includes("renk: Mavi"));
});

test("açık iptal talebi 'İptal' etiketiyle görünür", () => {
  const m = formatOrderStatus(ORDER, ITEMS, {
    request_type: "cancel", status: "new", new_color: null, new_size: null,
  });
  assert.ok(m.includes("Açık İptal talebi"));
});

// ---- formatOrderList ----
test("boş liste: bilgilendirme + no+telefon yönlendirmesi", () => {
  const m = formatOrderList([]);
  assert.ok(m.startsWith("BİLGİ:"));
  assert.ok(m.includes("sipariş no + telefon"));
});

test("dolu liste: her sipariş no + durum + tutar", () => {
  const m = formatOrderList([ORDER, { ...ORDER, order_no: "EJ26071899999", status: "delivered", tracking_no: null }]);
  assert.ok(m.startsWith("BAŞARILI:"));
  assert.ok(m.includes("EJ26071812345"));
  assert.ok(m.includes("EJ26071899999"));
  assert.ok(m.includes("Teslim edildi"));
  assert.ok(m.includes("takip TR123456"));
});
