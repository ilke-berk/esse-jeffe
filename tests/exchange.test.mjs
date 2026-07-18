// Esse Jeffe — sohbetten değişim yardımcıları (backend/functions/chat/exchange.ts).
// Saf fonksiyonlar: kalem seçimi, stok kontrolü (rezervasyonsuz), details ekleme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendDetails, pickOrderItem, stockAvailability } from "../backend/functions/chat/exchange.ts";

const ITEM_A = { product_id: "a", product_name: "Zarif Saten Abiye", color: "Siyah", size: "M" };
const ITEM_B = { product_id: "b", product_name: "İnci Detaylı Tül Elbise", color: "Bej", size: "L" };

// ---- pickOrderItem ----
test("tek kalem: ad verilmese de otomatik seçilir", () => {
  const r = pickOrderItem([ITEM_A]);
  assert.equal(r.item, ITEM_A);
});

test("çok kalem + ad yok: ambiguous ve kalem listesi döner", () => {
  const r = pickOrderItem([ITEM_A, ITEM_B]);
  assert.equal(r.error, "ambiguous");
  assert.deepEqual(r.itemNames, ["Zarif Saten Abiye", "İnci Detaylı Tül Elbise"]);
});

test("çok kalem + birebir ad (büyük/küçük harf, TR)", () => {
  const r = pickOrderItem([ITEM_A, ITEM_B], "İNCİ DETAYLI TÜL ELBİSE");
  assert.equal(r.item, ITEM_B);
});

test("çok kalem + kısmi ad eşleşmesi", () => {
  const r = pickOrderItem([ITEM_A, ITEM_B], "saten abiye");
  assert.equal(r.item, ITEM_A);
});

test("çok kalem + eşleşmeyen ad: ambiguous", () => {
  const r = pickOrderItem([ITEM_A, ITEM_B], "kadife elbise");
  assert.equal(r.error, "ambiguous");
});

test("kalem yok: no_items", () => {
  assert.equal(pickOrderItem([]).error, "no_items");
});

// ---- stockAvailability ----
const ROWS = [
  { color: "Siyah", size: "M", stock: 0, track: true },
  { color: "Siyah", size: "L", stock: 3, track: true },
  { color: "Mavi", size: "M", stock: 0, track: false },
];

test("stok satırı yok → takipsiz sayılır, ok", () => {
  assert.equal(stockAvailability(ROWS, "Kırmızı", "S").ok, true);
});

test("track=false → stok 0 olsa da ok", () => {
  assert.equal(stockAvailability(ROWS, "Mavi", "M").ok, true);
});

test("stock>0 → ok (büyük/küçük harf farkı tolere edilir)", () => {
  assert.equal(stockAvailability(ROWS, "siyah", "l").ok, true);
});

test("stock=0 ve track=true → fail + stokta olan alternatifler", () => {
  const r = stockAvailability(ROWS, "Siyah", "M");
  assert.equal(r.ok, false);
  assert.deepEqual(r.alternatives, ["Siyah / L", "Mavi / M"]);
});

// ---- appendDetails ----
test("boş eski değer: sadece güncelleme satırı", () => {
  assert.equal(appendDetails(null, "mavi istiyor", "2026-07-18"), "[Güncelleme 2026-07-18]: mavi istiyor");
});

test("mevcut değere yeni satır olarak eklenir", () => {
  assert.equal(
    appendDetails("Rengini beğenmedim.", "yeni tercih — Renk: Mavi", "2026-07-18"),
    "Rengini beğenmedim.\n[Güncelleme 2026-07-18]: yeni tercih — Renk: Mavi",
  );
});

test("boş not: mevcut değer aynen korunur", () => {
  assert.equal(appendDetails("eski", "  ", "2026-07-18"), "eski");
});

test("2000 karakter sınırına kırpılır", () => {
  const out = appendDetails("x".repeat(1990), "y".repeat(100), "2026-07-18");
  assert.equal(out.length, 2000);
  assert.ok(out.startsWith("x".repeat(1990)));
});
