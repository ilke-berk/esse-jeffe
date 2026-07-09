// Esse Jeffe — frontend tutarlılık ve söz dizimi testleri
// Statik sitede en sık kırılan şey: bir JS dosyasında yazım hatası (tüm
// sayfalar aynı dosyayı yükler) ve katalog kaynaklarının birbirinden kayması.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(path.join(root, p), "utf8");

const JS_FILES = ["ej.js", "ej-chat.js", "image-slot.js", "backend/ej-supabase.js", "backend/supabase-config.js"];

for (const f of JS_FILES) {
  test(`söz dizimi geçerli: ${f}`, async () => {
    const src = await read(f);
    // new Function derlemesi tam bir söz dizimi denetimidir (çalıştırmaz)
    assert.doesNotThrow(() => new Function(src), `${f} parse edilemedi`);
  });
}

test("EJ_CATALOG (ej.js) ile schema.sql tohum ürünleri aynı slug kümesine sahip", async () => {
  const ejs = await read("ej.js");
  const sql = await read("backend/schema.sql");

  // ej.js: { slug: 'pera', ... } satırları (EJ_CATALOG bloğu)
  const catBlock = ejs.match(/EJ_CATALOG\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(catBlock, "ej.js içinde EJ_CATALOG bulunamadı");
  const jsSlugs = [...catBlock[1].matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]).sort();

  // schema.sql: insert into products ... values ('pera', ...)
  const seedBlock = sql.match(/insert into products \(slug[\s\S]*?on conflict/);
  assert.ok(seedBlock, "schema.sql içinde products tohum verisi bulunamadı");
  const sqlSlugs = [...seedBlock[0].matchAll(/\(\s*'([a-z-]+)'\s*,/g)].map((m) => m[1]).sort();

  assert.ok(jsSlugs.length > 0 && sqlSlugs.length > 0);
  assert.deepEqual(jsSlugs, sqlSlugs, "EJ_CATALOG ve schema.sql tohumları birbirinden kaymış");
});

test("EJMonitor ej.js'de kurulu (error + unhandledrejection dinleyicileri)", async () => {
  const ejs = await read("ej.js");
  assert.match(ejs, /addEventListener\('error'/);
  assert.match(ejs, /addEventListener\('unhandledrejection'/);
  assert.match(ejs, /functions\/v1\/log-error/);
});

test("tüm HTML sayfaları ej.js'i aynı ?v= sürümüyle yükler (yarım cache-bust olmasın)", async () => {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(root)).filter((f) => f.endsWith(".html"));
  const versions = new Map();
  for (const f of files) {
    const html = await read(f);
    const m = html.match(/src="ej\.js\?v=(\d+)"/);
    if (m) versions.set(f, m[1]);
  }
  assert.ok(versions.size > 0, "hiçbir sayfada ej.js bulunamadı");
  const uniq = [...new Set(versions.values())];
  assert.equal(uniq.length, 1, `ej.js sürümleri tutarsız: ${JSON.stringify([...versions])}`);
});
