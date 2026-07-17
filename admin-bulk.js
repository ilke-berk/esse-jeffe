// ============================================================
// Esse Jeffe — Toplu kargo/durum güncellemesi: SAF yardımcılar.
// admin-siparisler.html <script type="module"> ile yükler (window.EJBulk'a
// bağlanır); tests/bulk.test.mjs doğrudan import eder.
// Burada DOM/supabase BAĞIMLILIĞI YOKTUR — eşleştirme/yazma admin sayfasında
// (admin JWT + RLS) yapılır; bu modül yalnız ayrıştırır ve sınıflandırır.
// ============================================================

// TR durum ifadeleri → orders.status değerleri.
// bulk-order-ocr EF'teki normStatus ile AYNI eşleme — biri değişirse diğeri de.
const STATUS_MAP = {
  'pending': 'pending', 'bekliyor': 'pending', 'alindi': 'pending', 'alındı': 'pending',
  'preparing': 'preparing', 'hazirlaniyor': 'preparing', 'hazırlanıyor': 'preparing',
  'shipped': 'shipped', 'kargoda': 'shipped', 'kargoya verildi': 'shipped',
  'kargoya-verildi': 'shipped', 'yolda': 'shipped', 'cikis yapildi': 'shipped', 'çıkış yapıldı': 'shipped',
  'delivered': 'delivered', 'teslim': 'delivered', 'teslim edildi': 'delivered',
  'teslimat tamamlandi': 'delivered', 'teslimat tamamlandı': 'delivered',
  'cancelled': 'cancelled', 'iptal': 'cancelled', 'iptal edildi': 'cancelled', 'iade': 'cancelled',
};

export const ALLOWED_STATUSES = ['pending', 'preparing', 'shipped', 'delivered', 'cancelled'];

/** Serbest durum metnini 5 izinli değere çevirir; tanınmazsa null. */
export function normalizeStatus(v) {
  const s = String(v ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (STATUS_MAP[s]) return STATUS_MAP[s];
  for (const k of Object.keys(STATUS_MAP)) {
    if (s.includes(k)) return STATUS_MAP[k];
  }
  return null;
}

/** Sipariş no biçimi: EJ + 11 (standart) veya 12 (eski kart) rakam. */
export function isValidOrderNo(v) {
  return /^EJ\d{11,12}$/.test(String(v ?? ''));
}

/**
 * Başlık hücresi → alan adı (sezgisel; TR/EN yaygın adlar). Sıra önemli:
 * "kargo takip no" → tracking (kargo'dan önce), "sipariş durumu" → status
 * (sipariş'ten önce).
 */
export function headerField(h) {
  const s = String(h ?? '').toLocaleLowerCase('tr').trim();
  if (!s) return null;
  if (/(takip|tracking|gönderi|gonderi|barkod)/.test(s)) return 'tracking_no';
  if (/(durum|status)/.test(s)) return 'status';
  if (/(sipariş|siparis|order)/.test(s)) return 'order_no';
  if (/(firma|carrier|taşıyıcı|tasiyici|kargo)/.test(s)) return 'carrier';
  return null;
}

/** Ham satır → temiz kayıt. Tanınmayan durum status_raw olarak işaretlenir. */
export function cleanRow(r) {
  const out = {};
  const on = String(r?.order_no ?? '').toUpperCase().replace(/\s+/g, '');
  if (on) out.order_no = on;
  const tn = String(r?.tracking_no ?? '').replace(/\s+/g, '');
  if (tn) out.tracking_no = tn.slice(0, 60);
  const ca = String(r?.carrier ?? '').trim();
  if (ca) out.carrier = ca.slice(0, 80);
  const rawSt = String(r?.status ?? '').trim();
  const st = normalizeStatus(rawSt);
  if (st) out.status = st;
  else if (rawSt) out.status_raw = rawSt;   // önizlemede "geçersiz durum" olarak görünür
  return out;
}

/**
 * SheetJS `sheet_to_json(ws, {header:1})` çıktısı gibi bir 2B diziyi kayda
 * çevirir. İlk satırda tanınan başlık varsa kolonlar ona göre, yoksa hücre
 * İÇERİĞİNDEN sezgisel çıkarım yapılır (EJ… → sipariş no, uzun sayı → takip,
 * bilinen durum sözcüğü → durum, kalan kısa metin → firma).
 */
export function parseMatrix(matrix) {
  const rows = (matrix || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (!rows.length) return [];
  const header = rows[0].map(headerField);
  // ilk satırda gerçek bir sipariş no görünüyorsa bu bir VERİ satırıdır
  // ("Kargoya verildi" hücresi başlık sezgisine takılmasın)
  const looksLikeData = rows[0].some((c) => /^EJ\d{11,12}$/i.test(String(c ?? '').replace(/\s+/g, '')));
  const hasHeader = !looksLikeData && header.some(Boolean);
  const body = hasHeader ? rows.slice(1) : rows;
  const out = [];
  for (const r of body) {
    const rec = {};
    if (hasHeader) {
      header.forEach(function (f, i) {
        if (!f || rec[f] != null) return;
        const v = String(r[i] ?? '').trim();
        if (v) rec[f] = v;
      });
    } else {
      for (const cRaw of r) {
        const c = String(cRaw ?? '').trim();
        if (!c) continue;
        if (/^EJ\d{11,12}$/i.test(c.replace(/\s+/g, ''))) { if (!rec.order_no) rec.order_no = c; continue; }
        if (!rec.status && normalizeStatus(c)) { rec.status = c; continue; }
        if (!rec.tracking_no && /\d{6,}/.test(c.replace(/\s+/g, '')) && c.replace(/\s+/g, '').length >= 8) { rec.tracking_no = c; continue; }
        if (!rec.carrier && /[a-zçğıöşü]/i.test(c) && c.length <= 40) rec.carrier = c;
      }
    }
    const clean = cleanRow(rec);
    if (clean.order_no || clean.tracking_no) out.push(clean);
  }
  return out;
}

/**
 * Aynı siparişin mükerrer satırlarını tekilleştirir (sonraki satır öncekinin
 * üstüne yazar). Dönen dupCount önizlemede uyarı olarak gösterilir.
 */
export function dedupeRows(rows) {
  const seen = new Map();
  const dups = new Set();
  let anon = 0;
  for (const r of rows || []) {
    const key = r.order_no ? 'o:' + r.order_no : (r.tracking_no ? 't:' + r.tracking_no : 'x:' + (anon++));
    if (seen.has(key)) { dups.add(key); Object.assign(seen.get(key), r); }
    else seen.set(key, Object.assign({}, r));
  }
  return { rows: Array.from(seen.values()), dupCount: dups.size };
}

/**
 * Satır + eşleşen sipariş → önizleme kararı.
 *  - notfound : sipariş bulunamadı
 *  - invalid  : durum metni tanınamadı (status_raw) → uygulanmaz
 *  - same     : değişecek alan yok
 *  - update   : {patch} uygulanacak alanlar (yalnız farklı olanlar)
 */
export function classifyRow(row, order) {
  if (!order) return { kind: 'notfound' };
  if (row.status_raw) return { kind: 'invalid' };
  if (row.status && ALLOWED_STATUSES.indexOf(row.status) === -1) return { kind: 'invalid' };
  const patch = {};
  if (row.status && row.status !== order.status) patch.status = row.status;
  if (row.carrier && row.carrier !== (order.carrier || '')) patch.carrier = row.carrier;
  if (row.tracking_no && row.tracking_no !== (order.tracking_no || '')) patch.tracking_no = row.tracking_no;
  if (!Object.keys(patch).length) return { kind: 'same' };
  return { kind: 'update', patch };
}

const EJBulk = {
  ALLOWED_STATUSES, normalizeStatus, isValidOrderNo, headerField,
  cleanRow, parseMatrix, dedupeRows, classifyRow,
};
if (typeof window !== 'undefined') window.EJBulk = EJBulk;
export default EJBulk;
