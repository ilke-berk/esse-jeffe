// ============================================================
// Esse Jeffe — Chat: değişim talebinin saf yardımcıları
// handleCreateExchange'in (index.ts) test edilebilir parçaları;
// DB/ağ erişimi YOK. Testler: tests/exchange.test.mjs
// ============================================================

export type ExchOrderItem = {
  product_id: string | null;
  product_name: string;
  color: string | null;
  size: string | null;
};

export type StockRow = {
  color: string;
  size: string;
  stock: number;
  track: boolean;
};

function fold(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
}

// Siparişin kalemlerinden değişecek ürünü seç: tek kalemse otomatik; birden
// çok kalemde ad eşleşmesi (birebir → içerir, matchProduct deseni). Eşleşme
// yoksa kalem adları döner ki model müşteriye listeyi sorabilsin.
export function pickOrderItem(
  items: ExchOrderItem[],
  productNameArg?: string | null,
): { item?: ExchOrderItem; error?: string; itemNames?: string[] } {
  if (!items.length) return { error: "no_items" };
  if (items.length === 1) return { item: items[0] };
  const names = items.map((it) => it.product_name);
  const want = fold(productNameArg);
  if (want) {
    let hit = items.find((it) => fold(it.product_name) === want);
    if (!hit) hit = items.find((it) => fold(it.product_name).includes(want) || want.includes(fold(it.product_name)));
    if (hit) return { item: hit };
  }
  return { error: "ambiguous", itemNames: names };
}

// İstenen yeni varyantın stok durumu (SADECE kontrol; rezervasyon yok).
// reserve_stock_bulk semantiğiyle tutarlı: satır yok VEYA track=false →
// takipsiz sayılır (stokta var). Varyant zaten canonChatVariant ile katalog
// listesine sabitlendiğinden "uydurma varyant → takipsiz" boşluğu oluşmaz.
export function stockAvailability(
  stockRows: StockRow[],
  color: string,
  size: string,
): { ok: boolean; alternatives: string[] } {
  const row = stockRows.find((r) => fold(r.color) === fold(color) && fold(r.size) === fold(size));
  if (!row || row.track === false || (row.stock ?? 0) > 0) return { ok: true, alternatives: [] };
  const alternatives = stockRows
    .filter((r) => r.track === false || (r.stock ?? 0) > 0)
    .map((r) => [r.color, r.size].filter(Boolean).join(" / "))
    .slice(0, 12);
  return { ok: false, alternatives };
}

// Açık talebe not ekleme: mevcut details korunur, güncelleme tarihli satır
// olarak eklenir; toplam uzunluk şema sınırına (2000) kırpılır.
export function appendDetails(
  oldDetails: string | null | undefined,
  note: string,
  dateStr: string,
  max = 2000,
): string {
  const clean = String(note || "").trim();
  const prev = String(oldDetails || "").trim();
  if (!clean) return prev.slice(0, max);
  const entry = `[Güncelleme ${dateStr}]: ${clean}`;
  return (prev ? prev + "\n" + entry : entry).slice(0, max);
}
