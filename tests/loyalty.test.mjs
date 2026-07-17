// Esse Jeffe — _shared/loyalty.ts testleri (sahte admin + sahte Resend ile)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accrueLoyalty,
  loyaltyConfig,
  loyaltyHtml,
} from "../backend/edge-functions/_shared/loyalty.ts";

// Sessiz logger — çağrıları kaydeder.
function fakeLog() {
  const entries = [];
  const push = (level) => (event, data) => entries.push({ level, event, data });
  return { entries, info: push("info"), warn: push("warn"), error: push("error") };
}

// loyalty.ts yalnız rpc() kullanır; from() güvenlik ağı olarak sayaçlanır
// (accrueLoyalty hiçbir tabloya doğrudan dokunmamalı, özellikle DELETE yok).
function fakeAdmin(rpcResult) {
  const calls = { rpcs: [], froms: [] };
  return {
    calls,
    from(table) {
      calls.froms.push(table);
      throw new Error("accrueLoyalty from() kullanmamalı");
    },
    rpc(fn, args) {
      calls.rpcs.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  };
}

const ENV = {
  RESEND_API_KEY: "re_test",
  ORDER_FROM_EMAIL: "Esse Jeffe <info@essejeffe.com>",
  SITE_URL: "https://essejeffe.com/",
};
const envOf = (map) => (k) => map[k];

const OK_ROW = {
  ok: true,
  code: "SADAKAT-ABC234",
  percent: 15,
  orders_count: 3,
  email: "musteri@x.com",
  expires_at: "2027-01-13T10:00:00.000Z",
  max_discount: 1500,
};

// ---------- loyaltyConfig ----------

test("loyaltyConfig: env yoksa varsayılanlar (5/50/1000/1500/180)", () => {
  const c = loyaltyConfig(() => undefined);
  assert.deepEqual(c, { step: 5, maxPercent: 50, minSubtotal: 1000, maxDiscount: 1500, validDays: 180 });
});

test("loyaltyConfig: env değerleri okunur ve clamp'lenir", () => {
  const c = loyaltyConfig(envOf({
    LOYALTY_STEP_PERCENT: "10",
    LOYALTY_MAX_PERCENT: "200", // → 90
    LOYALTY_MIN_SUBTOTAL: "-5", // → 0
    LOYALTY_MAX_DISCOUNT: "2000",
    LOYALTY_VALID_DAYS: "0", // → 1
  }));
  assert.deepEqual(c, { step: 10, maxPercent: 90, minSubtotal: 0, maxDiscount: 2000, validDays: 1 });
});

test("loyaltyConfig: bozuk değer → varsayılan", () => {
  const c = loyaltyConfig(envOf({ LOYALTY_STEP_PERCENT: "abc" }));
  assert.equal(c.step, 5);
});

// ---------- accrueLoyalty ----------

test("accrueLoyalty: RPC'ye config parametreleri gider, başarıda mail çıkar", async () => {
  const admin = fakeAdmin({ data: OK_ROW, error: null });
  const sent = [];
  const log = fakeLog();
  const r = await accrueLoyalty(admin, "o1", log, {
    env: envOf({ ...ENV, LOYALTY_MIN_SUBTOTAL: "750" }),
    send: async (...args) => sent.push(args),
  });
  assert.equal(r.accrued, true);
  assert.equal(r.percent, 15);
  assert.equal(r.code, "SADAKAT-ABC234");
  assert.deepEqual(admin.calls.rpcs[0], {
    fn: "loyalty_accrue",
    args: {
      p_order_id: "o1",
      p_step: 5,
      p_max_percent: 50,
      p_min_subtotal: 750,
      p_max_discount: 1500,
      p_valid_days: 180,
    },
  });
  assert.equal(sent.length, 1);
  const [, , to, subject, html] = sent[0];
  assert.equal(to, "musteri@x.com");
  assert.match(subject, /%15/);
  assert.match(html, /SADAKAT-ABC234/);
});

test("accrueLoyalty: RPC ok:false (below-min vb.) → mail yok, accrued:false + reason", async () => {
  const admin = fakeAdmin({ data: { ok: false, reason: "below-min" }, error: null });
  const sent = [];
  const log = fakeLog();
  const r = await accrueLoyalty(admin, "o1", log, {
    env: envOf(ENV),
    send: async (...args) => sent.push(args),
  });
  assert.deepEqual(r, { accrued: false, reason: "below-min" });
  assert.equal(sent.length, 0);
  assert.ok(log.entries.some((e) => e.event === "loyalty_skip"));
});

test("accrueLoyalty: RPC hatası → fail-soft, accrued:false, fırlatmaz", async () => {
  const admin = fakeAdmin({ data: null, error: { message: "boom" } });
  const log = fakeLog();
  const r = await accrueLoyalty(admin, "o1", log, { env: envOf(ENV), send: async () => {} });
  assert.deepEqual(r, { accrued: false, reason: "rpc-error" });
  assert.ok(log.entries.some((e) => e.level === "error"));
});

test("accrueLoyalty: mail hatası → accrued:true kalır, kod SİLİNMEZ (from() hiç çağrılmaz)", async () => {
  const admin = fakeAdmin({ data: OK_ROW, error: null });
  const log = fakeLog();
  const r = await accrueLoyalty(admin, "o1", log, {
    env: envOf(ENV),
    send: async () => {
      throw new Error("resend down");
    },
  });
  assert.equal(r.accrued, true); // birikim işlendi, mail sonra iletilebilir
  assert.equal(admin.calls.froms.length, 0); // delete/update YOK
  assert.ok(log.entries.some((e) => e.event === "loyalty_email_failed"));
});

test("accrueLoyalty: Resend config eksik → mail atlanır ama birikim işlenir", async () => {
  const admin = fakeAdmin({ data: OK_ROW, error: null });
  const log = fakeLog();
  const r = await accrueLoyalty(admin, "o1", log, { env: envOf({}), send: async () => {} });
  assert.equal(r.accrued, true);
  assert.ok(log.entries.some((e) => e.event === "loyalty_email_skipped"));
});

// ---------- loyaltyHtml ----------

test("loyaltyHtml: kod, yüzde, tavan, tarih ve tek-e-posta uyarısı içerir", () => {
  const html = loyaltyHtml(
    {
      code: "SADAKAT-XY23ZW",
      percent: 25,
      ordersCount: 5,
      email: "a@b.com",
      expiresAt: "2027-01-13T10:00:00.000Z",
      maxDiscount: 1500,
    },
    "https://essejeffe.com",
  );
  assert.match(html, /SADAKAT-XY23ZW/);
  assert.match(html, /%25/);
  assert.match(html, /5\. siparişinizle/);
  assert.match(html, /1\.500 ₺/); // tl() biçimi
  assert.match(html, /2027/); // son kullanma yılı
  assert.match(html, /yalnız bu e-posta/);
  assert.match(html, /https:\/\/essejeffe\.com\/koleksiyon\.html/);
});

test("loyaltyHtml: ilk birikimde 'kazandınız' dili, tavansızsa TL notu yok", () => {
  const html = loyaltyHtml(
    {
      code: "SADAKAT-AAAAAA",
      percent: 5,
      ordersCount: 1,
      email: "a@b.com",
      expiresAt: "2027-01-13T10:00:00.000Z",
      maxDiscount: null,
    },
    "https://essejeffe.com",
  );
  assert.match(html, /kazandınız/);
  assert.doesNotMatch(html, /en fazla/);
});
