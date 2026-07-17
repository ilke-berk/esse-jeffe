// Esse Jeffe — toplu kargo/durum güncelleme yardımcıları (admin-bulk.js) testleri.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRow,
  cleanRow,
  dedupeRows,
  headerField,
  isValidOrderNo,
  normalizeStatus,
  parseMatrix,
} from "../admin-bulk.js";

test("normalizeStatus: TR/EN durum ifadeleri 5 izinli değere çevrilir", () => {
  assert.equal(normalizeStatus("Kargoya verildi"), "shipped");
  assert.equal(normalizeStatus("KARGODA"), "shipped");
  assert.equal(normalizeStatus("Teslim Edildi"), "delivered");
  assert.equal(normalizeStatus("teslimat tamamlandı"), "delivered");
  assert.equal(normalizeStatus("Hazırlanıyor"), "preparing");
  assert.equal(normalizeStatus("İptal edildi"), "cancelled");
  assert.equal(normalizeStatus("shipped"), "shipped");
  assert.equal(normalizeStatus("Bekliyor"), "pending");
  assert.equal(normalizeStatus("bilinmeyen bir şey"), null);
  assert.equal(normalizeStatus(""), null);
});

test("headerField: başlık sezgisi — takip kargo'dan, durum sipariş'ten önce", () => {
  assert.equal(headerField("Kargo Takip No"), "tracking_no");
  assert.equal(headerField("Sipariş Durumu"), "status");
  assert.equal(headerField("Sipariş No"), "order_no");
  assert.equal(headerField("Kargo Firması"), "carrier");
  assert.equal(headerField("Kargo"), "carrier");
  assert.equal(headerField("Tracking Number"), "tracking_no");
  assert.equal(headerField("Order"), "order_no");
  assert.equal(headerField("Tutar"), null);
});

test("isValidOrderNo: EJ + 11/12 rakam", () => {
  assert.equal(isValidOrderNo("EJ26071712345"), true);
  assert.equal(isValidOrderNo("EJ260717123456"), true);   // eski kart siparişi (12 hane)
  assert.equal(isValidOrderNo("EJ123"), false);
  assert.equal(isValidOrderNo("XX26071712345"), false);
});

test("cleanRow: normalize + tanınmayan durum status_raw olur", () => {
  const r = cleanRow({ order_no: " ej2607 1712345 ", tracking_no: "12 34 56 789", carrier: "  Aras Kargo ", status: "Kargoya verildi" });
  assert.deepEqual(r, { order_no: "EJ26071712345", tracking_no: "123456789", carrier: "Aras Kargo", status: "shipped" });
  const bad = cleanRow({ order_no: "EJ26071712345", status: "acayip durum" });
  assert.equal(bad.status, undefined);
  assert.equal(bad.status_raw, "acayip durum");
});

test("parseMatrix: başlıklı tablo kolonlara göre ayrışır", () => {
  const rows = parseMatrix([
    ["Sipariş No", "Kargo Firması", "Kargo Takip No", "Durum"],
    ["EJ26071712345", "Aras Kargo", "1234567890", "Kargoya verildi"],
    ["", "", "", ""],
    ["EJ26071754321", "Aras Kargo", "987654321", "Teslim edildi"],
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { order_no: "EJ26071712345", carrier: "Aras Kargo", tracking_no: "1234567890", status: "shipped" });
  assert.equal(rows[1].status, "delivered");
});

test("parseMatrix: başlıksız veride hücre içeriğinden çıkarım", () => {
  const rows = parseMatrix([
    ["EJ26071712345", "Kargoya verildi", "1234567890", "Aras Kargo"],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order_no, "EJ26071712345");
  assert.equal(rows[0].status, "shipped");
  assert.equal(rows[0].tracking_no, "1234567890");
  assert.equal(rows[0].carrier, "Aras Kargo");
});

test("parseMatrix: sipariş no ve takip no'suz satırlar elenir", () => {
  const rows = parseMatrix([
    ["Sipariş No", "Durum"],
    ["", "Kargoya verildi"],
    ["EJ26071712345", "Kargoya verildi"],
  ]);
  assert.equal(rows.length, 1);
});

test("dedupeRows: aynı sipariş no'lu satırlar birleşir, dupCount artar", () => {
  const { rows, dupCount } = dedupeRows([
    { order_no: "EJ26071712345", carrier: "Aras" },
    { order_no: "EJ26071712345", tracking_no: "111" },
    { order_no: "EJ26071754321" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(dupCount, 1);
  const merged = rows.find((r) => r.order_no === "EJ26071712345");
  assert.equal(merged.carrier, "Aras");
  assert.equal(merged.tracking_no, "111");
});

test("classifyRow: bulunamadı / geçersiz / aynı / güncelle", () => {
  assert.deepEqual(classifyRow({ order_no: "EJ1" }, null), { kind: "notfound" });
  assert.deepEqual(classifyRow({ status_raw: "x" }, { status: "pending" }), { kind: "invalid" });
  assert.deepEqual(
    classifyRow({ status: "shipped", carrier: "Aras", tracking_no: "1" },
      { status: "shipped", carrier: "Aras", tracking_no: "1" }),
    { kind: "same" },
  );
  const r = classifyRow(
    { status: "shipped", carrier: "Aras", tracking_no: "999" },
    { status: "preparing", carrier: "Aras", tracking_no: null },
  );
  assert.equal(r.kind, "update");
  assert.deepEqual(r.patch, { status: "shipped", tracking_no: "999" });
});
