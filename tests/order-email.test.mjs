// Esse Jeffe — _shared/order-email.ts testleri
// Modül Deno.env kullanır; testte minimal bir Deno.env stub'ı kurulur.
import { test } from "node:test";
import assert from "node:assert/strict";

// import'tan ÖNCE kur: modül fonksiyonları çağrı anında Deno.env.get okur.
const ENV = {};
globalThis.Deno = { env: { get: (k) => ENV[k] } };

const { sendOrderEmails } = await import("../backend/edge-functions/_shared/order-email.ts");

const ORDER = {
  order_no: "EJ26070212345",
  payment_method: "transfer",
  full_name: "Ayşe Yılmaz",
  phone: "0532 123 45 67",
  email: "ayse@example.com",
  city: "İstanbul",
  district: "Kadıköy",
  address: "Deneme Sok. No:1",
  subtotal: 1699,
  shipping_fee: 0,
  total: 1699,
  items: [{ product_name: "Pera", model_desc: "Krep Abiye", color: "Bordo", size: "M", unit_price: 1699, qty: 1 }],
};

function stubLogger() {
  const events = [];
  return { events, warn: (e, f) => events.push(["warn", e, f]), error: (e, f) => events.push(["error", e, f]) };
}

test("secret yoksa gönderim atlanır, hata fırlatılmaz (fail-soft sözleşmesi)", async () => {
  delete ENV.RESEND_API_KEY;
  delete ENV.ORDER_FROM_EMAIL;
  const log = stubLogger();
  const r = await sendOrderEmails(ORDER, log);
  assert.deepEqual(r, { customer: false, business: false, skipped: "no-config" });
});

test("Resend hatasında sipariş akışı bozulmaz: fırlatmaz, false döner", async () => {
  ENV.RESEND_API_KEY = "re_test";
  ENV.ORDER_FROM_EMAIL = "Esse Jeffe <siparis@essejeffe.com>";
  ENV.ORDER_NOTIFY_EMAIL = "isletme@essejeffe.com";
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
  try {
    const r = await sendOrderEmails(ORDER, stubLogger()); // fırlatırsa test düşer
    assert.equal(r.customer, false);
    assert.equal(r.business, false);
  } finally {
    globalThis.fetch = origFetch;
    delete ENV.RESEND_API_KEY;
    delete ENV.ORDER_FROM_EMAIL;
    delete ENV.ORDER_NOTIFY_EMAIL;
  }
});

test("başarılı gönderim: müşteri + işletme mail'i, HTML'de sipariş no ve escape'li içerik", async () => {
  ENV.RESEND_API_KEY = "re_test";
  ENV.ORDER_FROM_EMAIL = "Esse Jeffe <siparis@essejeffe.com>";
  ENV.ORDER_NOTIFY_EMAIL = "isletme@essejeffe.com";
  const bodies = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    // XSS denemesi içeren not — HTML'e ham geçmemeli
    const r = await sendOrderEmails({ ...ORDER, note: '<script>alert(1)</script>' }, stubLogger());
    assert.deepEqual(r, { customer: true, business: true });
    assert.equal(bodies.length, 2);
    const [customer, business] = bodies;
    assert.deepEqual(customer.to, ["ayse@example.com"]);
    assert.deepEqual(business.to, ["isletme@essejeffe.com"]);
    assert.equal(business.reply_to, "ayse@example.com"); // yanıtla → müşteri
    for (const b of bodies) {
      assert.match(b.html, /EJ26070212345/);
      assert.ok(!b.html.includes("<script>alert(1)</script>"), "not alanı escape edilmeli");
      assert.match(b.html, /&lt;script&gt;/);
    }
  } finally {
    globalThis.fetch = origFetch;
    delete ENV.RESEND_API_KEY;
    delete ENV.ORDER_FROM_EMAIL;
    delete ENV.ORDER_NOTIFY_EMAIL;
  }
});
