// ============================================================
//  Esse Jeffe — Chat: sipariş durumu sorgulamanın saf yardımcıları
//  Deno/DB bağımlılığı YOK; tests/order-info.test.mjs test eder.
//  Türkçe karşılıklar siparis-takip.html / admin-siparisler.html
//  map'lerinin kopyasıdır (müşteri diliyle).
// ============================================================

export const ORDER_STATUS_TR: Record<string, string> = {
  pending: "Alındı — hazırlanıyor",
  preparing: "Hazırlanıyor",
  shipped: "Kargoya verildi",
  delivered: "Teslim edildi",
  cancelled: "İptal edildi",
};

export const PAYMENT_STATUS_TR: Record<string, string> = {
  pending: "Ödeme bekleniyor",
  paid: "Ödendi",
  failed: "Ödeme başarısız",
  cod: "Kapıda ödenecek",
};

export const PAYMENT_METHOD_TR: Record<string, string> = {
  cod: "Kapıda ödeme",
  card: "Kredi/banka kartı",
  transfer: "Havale/EFT",
};

export const EXCH_STATUS_TR: Record<string, string> = {
  new: "Alındı — inceleme bekliyor",
  in_progress: "İşlemde",
  closed: "Sonuçlandı",
};

export type OrderInfoRow = {
  order_no: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total: number;
  carrier: string | null;
  tracking_no: string | null;
  created_at: string;
};

export type OrderInfoItem = {
  product_name: string;
  color: string | null;
  size: string | null;
  qty: number;
};

export type OpenExchangeInfo = {
  request_type: string; // exchange | cancel
  status: string;       // new | in_progress
  new_color: string | null;
  new_size: string | null;
} | null;

const tl = (n: number) => `${Number(n || 0).toLocaleString("tr-TR")} TL`;
const day = (iso: string) => String(iso || "").slice(0, 10);

function itemLine(it: OrderInfoItem): string {
  const v = [it.color, it.size].filter(Boolean).join("/");
  return `${it.qty} x ${it.product_name}${v ? ` (${v})` : ""}`;
}

/**
 * get_order_status yanıtının AI'a (functionResponse) dönecek metni.
 * Model bu metnin DIŞINA çıkmamalı (takip kodu/durum uydurma yasağı prompt'ta).
 */
export function formatOrderStatus(
  order: OrderInfoRow,
  items: OrderInfoItem[],
  openExchange: OpenExchangeInfo,
): string {
  const lines: string[] = [];
  lines.push(`Sipariş ${order.order_no} (${day(order.created_at)}): durum = ${ORDER_STATUS_TR[order.status] || order.status}.`);
  if (items.length) lines.push(`Ürünler: ${items.map(itemLine).join(", ")}.`);
  lines.push(`Toplam ${tl(order.total)} — ${PAYMENT_METHOD_TR[order.payment_method] || order.payment_method} (${PAYMENT_STATUS_TR[order.payment_status] || order.payment_status}).`);
  if (order.tracking_no) {
    lines.push(`Kargo: ${order.carrier || "kargo firması"} — takip no ${order.tracking_no}.`);
  } else if (order.status === "shipped") {
    lines.push(`Kargoya verildi; takip numarası henüz sisteme girilmemiş.`);
  } else {
    lines.push(`Henüz kargoya verilmedi; takip numarası oluşunca SMS/e-posta ile iletilir.`);
  }
  if (openExchange) {
    const t = openExchange.request_type === "cancel" ? "İptal" : "Değişim";
    const pref = [openExchange.new_color ? `renk: ${openExchange.new_color}` : "", openExchange.new_size ? `beden: ${openExchange.new_size}` : ""].filter(Boolean).join(", ");
    lines.push(`Açık ${t} talebi var — durumu: ${EXCH_STATUS_TR[openExchange.status] || openExchange.status}${pref ? ` (yeni tercih: ${pref})` : ""}.`);
  }
  return `BAŞARILI: ${lines.join(" ")} Müşteriye bu bilgileri sıcak bir dille aktar; bu metinde OLMAYAN durum/takip bilgisi SÖYLEME.`;
}

/**
 * Değişim sürecinde müşterinin izleyeceği adımlar (kaynak: hizmetler.html
 * "Değişim Şartları" + degisim-iptal.html koşulları — site metniyle tutarlı).
 * returnAddr: EXCHANGE_RETURN_ADDRESS secret'ı (yoksa "ekip iletecek" satırı).
 */
export function exchangeInstructions(returnAddr: string | null): string[] {
  return [
    "Ürünün etiketi çıkarılmamış, kullanılmamış/yıkanmamış ve leke, parfüm ya da makyaj izi bulaşmamış olmalı.",
    "Ürünü orijinal ambalajı ve varsa aksesuarlarıyla eksiksiz paketleyin; kargo poşeti içinde gönderin, ürün kutusunun üzerine ek bant yapıştırmayın.",
    "Fatura veya sipariş bilginizi (sipariş numaranız yeterli) paketin içine ekleyin.",
    returnAddr
      ? `Paketi şu adrese gönderin: ${returnAddr}.`
      : "Gönderim adresi ve anlaşmalı kargo bilgisi ekibimiz tarafından size iletilecek (Pazartesi–Cumartesi 08:00–19:00).",
    "Gidiş-geliş kargo bedeli müşterimize aittir; kargo ücretini gönderirken kargo firmasına ödersiniz.",
    "Ürün bize ulaşıp incelendikten sonra yeni ürününüz aynı gün kargoya verilir.",
  ];
}

/** Girişli kullanıcının sipariş listesi metni. */
export function formatOrderList(rows: OrderInfoRow[]): string {
  if (!rows.length) {
    return "BİLGİ: Bu hesaba kayıtlı sipariş bulunamadı. Müşteri siparişini üye olmadan verdiyse sipariş no + telefonla sorgulayabilirsin; iste.";
  }
  const lines = rows.map((o) =>
    `${o.order_no} — ${day(o.created_at)}, ${ORDER_STATUS_TR[o.status] || o.status}, ${tl(o.total)}${o.tracking_no ? `, takip ${o.tracking_no}` : ""}`,
  );
  return `BAŞARILI: Müşterinin son siparişleri: ${lines.join(" | ")}. Detayını istediği siparişi sipariş numarasıyla tekrar sorgulayabilirsin.`;
}
