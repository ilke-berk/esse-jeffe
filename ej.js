/* Esse Jeffe — paylaşılan JS */

// ── Hata izleme (EJMonitor) ──────────────────────────────
// Ziyaretçi tarayıcısında patlayan JS hatalarını log-error Edge
// Function'ına raporlar → client_errors tablosunda birikir.
// Sessiz çalışır: raporlama hatası kullanıcıyı asla etkilemez.
// EJ_CONFIG yoksa (Supabase kapalı) hiçbir istek atmaz.
(function () {
  var MAX_PER_PAGE = 8;      // sayfa başına en çok rapor (döngüsel hata seli önlemi)
  var sent = 0;
  var seen = {};             // aynı hatayı bir kez gönder (mesaj+konum anahtarı)

  function post(payload) {
    try {
      var cfg = window.EJ_CONFIG;
      if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) return;
      fetch(cfg.SUPABASE_URL + '/functions/v1/log-error', {
        method: 'POST',
        keepalive: true,     // sayfa kapanırken de gitsin
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.SUPABASE_KEY,
          'apikey': cfg.SUPABASE_KEY
        },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (e) { /* raporlama asla sayfayı bozmaz */ }
  }

  function report(message, source, line, col, stack) {
    message = String(message || '').slice(0, 500);
    if (!message) return;
    // Üçüncü parti/cross-origin script'lerin detaysız "Script error." gürültüsünü atla
    if (message === 'Script error.' && !source) return;
    var key = message + '|' + (source || '') + '|' + (line || 0);
    if (seen[key] || sent >= MAX_PER_PAGE) return;
    seen[key] = true;
    sent++;
    post({
      message: message,
      source: String(source || '').slice(0, 500),
      line: line || null,
      col: col || null,
      stack: String(stack || '').slice(0, 3000),
      url: location.pathname + location.search,
      ua: navigator.userAgent.slice(0, 300)
    });
  }

  window.addEventListener('error', function (e) {
    // yalnız JS hataları; <img>/<script> kaynak yükleme hataları (e.message yok) atlanır
    if (!e || !e.message) return;
    report(e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (r instanceof Error) report(r.message, null, null, null, r.stack);
    else report('unhandledrejection: ' + String(r).slice(0, 300), null, null, null, null);
  });
})();

(function () {
  // ── Name ticker ─────────────────────────────────────────
  const names = ['Pera', 'Asos', 'Efes', 'Karya', 'Likya', 'Side', 'Truva', 'Milet', 'Lidya'];
  const el = document.querySelector('.t-item');
  if (el) {
    let i = 0;
    el.textContent = names[0];
    setInterval(function () {
      i = (i + 1) % names.length;
      el.classList.add('out');
      setTimeout(function () {
        el.textContent = names[i];
        el.classList.remove('out');
        el.classList.add('in');
        setTimeout(function () { el.classList.remove('in'); }, 380);
      }, 320);
    }, 2600);
  }

  // ── Bag panel ───────────────────────────────────────────
  const bagBtn     = document.querySelector('.icon.bag');
  const bagPanel   = document.getElementById('bagPanel');
  const bagOverlay = document.getElementById('bagOverlay');
  const bagClose   = document.getElementById('bagClose');

  function openBag()  {
    if (!bagPanel) return;
    bagPanel.classList.add('open');
    bagOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeBag() {
    if (!bagPanel) return;
    bagPanel.classList.remove('open');
    bagOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (bagBtn)     bagBtn.addEventListener('click', function(e){ e.stopPropagation(); bagPanel && bagPanel.classList.contains('open') ? closeBag() : openBag(); });
  if (bagClose)   bagClose.addEventListener('click', closeBag);
  if (bagOverlay) bagOverlay.addEventListener('click', closeBag);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeBag(); });
  document.addEventListener('click', function(e){
    if (bagPanel && bagPanel.classList.contains('open') && !bagPanel.contains(e.target) && !(bagBtn && bagBtn.contains(e.target))) closeBag();
  });
})();

// ── Paylaşılan katalog + yardımcılar ─────────────────────
// Supabase kapalıyken mega menü ve aramanın tek veri kaynağı.
// Supabase açıkken ej-supabase.js canlı DB verisiyle üzerine yazar.
// (schema.sql tohum verisiyle birebir; slug'lar urun.html?slug= ile eşleşir)
var EJ_CATALOG = [
  { slug: 'pera',  name: 'Pera',  md: 'Uzun Yırtmaçlı Krep Abiye',          price: 1699, old: 2199, tag: 'Çok Satan' },
  { slug: 'asos',  name: 'Asos',  md: 'Fakir Kol V Yaka Davet Elbisesi',    price: 1399, old: 0,    tag: 'Yeni' },
  { slug: 'efes',  name: 'Efes',  md: 'Kruvaze Drapeli Krep Abiye',         price: 1499, old: 0,    tag: '' },
  { slug: 'karya', name: 'Karya', md: 'V Yaka Fırfırlı Kol Krep Abiye',     price: 1299, old: 1599, tag: 'İndirim' },
  { slug: 'likya', name: 'Likya', md: 'Kruvaze Drapeli Askılı Krep Abiye',  price: 1599, old: 0,    tag: '' },
  { slug: 'side',  name: 'Side',  md: 'Diz Üstü Ön Drape Detaylı Abiye',    price: 1399, old: 0,    tag: 'Yeni' },
  { slug: 'truva', name: 'Truva', md: 'Dekolte Detaylı Krep Abiye',         price: 1299, old: 0,    tag: '' },
  { slug: 'milet', name: 'Milet', md: 'Yarasa Kol Kruvaze Drapeli Abiye',   price: 1499, old: 0,    tag: '' },
  { slug: 'lidya', name: 'Lidya', md: 'Ön Fırfır Bodycone Fermuarlı Abiye', price: 1299, old: 0,    tag: '' }
];

var EJ_PH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

function ejFmt(n) { return (n || 0).toLocaleString('tr-TR') + ' TL'; }
function ejEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
// Türkçe + aksan duyarsız normalizasyon (arama eşleşmesi için)
function ejNorm(s) {
  return String(s || '').toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

// ── Koleksiyon mega panel ────────────────────────────────
(function () {
  // Header yüksekliğini --hh CSS değişkenine yaz
  function setHH() {
    var hd = document.querySelector('.header');
    if (hd) document.documentElement.style.setProperty('--hh', hd.offsetHeight + 'px');
  }
  setHH();
  window.addEventListener('resize', setHH);

  var kolLink = document.querySelector('.nav a[href="koleksiyon.html"]');
  if (!kolLink) return;

  // Koleksiyon linkine ok işareti ekle
  kolLink.setAttribute('data-mega', '');

  // Mega panel HTML
  var wrap = document.createElement('div');
  wrap.innerHTML = [
    '<div class="mega-panel" id="megaPanel" role="region" aria-label="Koleksiyon">',
      '<div class="mega-in">',
        '<div class="mega-top">',
          '<span class="mega-top-label">2026 Koleksiyonu</span>',
          '<button class="mega-top-close" id="megaClose" aria-label="Kapat">',
            '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
          '</button>',
        '</div>',
        '<div class="mega-scroll-wrap">',
          '<button class="mega-arr mega-arr-l" id="megaArrL" aria-label="Önceki"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><polyline points="15,18 9,12 15,6"/></svg></button>',
          '<div class="mega-products" id="megaProducts"></div>',
          '<button class="mega-arr mega-arr-r" id="megaArrR" aria-label="Sonraki"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><polyline points="9,18 15,12 9,6"/></svg></button>',
        '</div>',
        '<div class="mega-foot"><a href="koleksiyon.html" class="btn btn-solid">Tümünü Gör</a></div>',
      '</div>',
    '</div>',
    '<div class="mega-overlay" id="megaOverlay"></div>'
  ].join('');
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  // Kartları statik katalogdan üret (Supabase açıksa ej-supabase.js üzerine yazar).
  // Böylece menü katalogla tek kaynaktan senkron ve her kart kendi ürününe gider.
  var megaBox = document.getElementById('megaProducts');
  if (megaBox) {
    megaBox.innerHTML = EJ_CATALOG.map(function (p) {
      var tag = p.tag ? '<span class="mega-tag-sm">' + ejEsc(p.tag) + '</span>' : '';
      var price = (p.old ? '<span class="old">' + ejFmt(p.old) + '</span>' : '') + ejFmt(p.price);
      return '<a class="mega-card" href="urun.html?slug=' + encodeURIComponent(p.slug) + '">' +
        '<div class="mf">' + tag + '<div class="mega-ph">' + EJ_PH_SVG + '</div></div>' +
        '<div class="mt"><div class="mn">' + ejEsc(p.name) + '</div>' +
        '<div class="md">' + ejEsc(p.md) + '</div>' +
        '<div class="mp">' + price + '</div></div></a>';
    }).join('');
  }

  var megaPanel   = document.getElementById('megaPanel');
  var megaOverlay = document.getElementById('megaOverlay');
  var megaClose   = document.getElementById('megaClose');

  function openMega(e) {
    if (e && e.preventDefault) e.preventDefault();
    megaPanel.classList.add('open');
    megaOverlay.classList.add('open');
  }
  function closeMega() {
    megaPanel.classList.remove('open');
    megaOverlay.classList.remove('open');
  }

  // Hover: kolLink veya megaPanel üzerinde iken açık kal
  var hoverTimer = null;
  function cancelClose() { clearTimeout(hoverTimer); hoverTimer = null; }
  function scheduleClose() { hoverTimer = setTimeout(closeMega, 150); }

  kolLink.addEventListener('mouseenter', function () { cancelClose(); openMega(); });
  kolLink.addEventListener('mouseleave', scheduleClose);
  megaPanel.addEventListener('mouseenter', cancelClose);
  megaPanel.addEventListener('mouseleave', scheduleClose);

  // Tıklama ile de aç/kapat
  kolLink.addEventListener('click', function (e) {
    megaPanel.classList.contains('open') ? closeMega() : openMega(e);
  });
  megaClose.addEventListener('click', closeMega);
  megaOverlay.addEventListener('click', closeMega);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMega(); });
  var megaArrL  = document.getElementById('megaArrL');
  var megaArrR  = document.getElementById('megaArrR');
  var megaProds = document.getElementById('megaProducts');
  if(megaArrL && megaProds){ megaArrL.addEventListener('click',function(e){ e.stopPropagation(); megaProds.scrollBy({left:-190*3,behavior:'smooth'}); }); }
  if(megaArrR && megaProds){ megaArrR.addEventListener('click',function(e){ e.stopPropagation(); megaProds.scrollBy({left:190*3,behavior:'smooth'}); }); }
})();

// ── Mobil menü (hamburger) ───────────────────────────────
(function () {
  var headerIn = document.querySelector('.header-in');
  if (!headerIn) return;

  var burger = document.createElement('button');
  burger.className = 'hamburger';
  burger.setAttribute('aria-label', 'Menü');
  burger.innerHTML = '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  headerIn.insertBefore(burger, headerIn.firstChild);

  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="mm-overlay" id="mmOverlay"></div>' +
    '<nav class="mobile-menu" id="mobileMenu" aria-label="Menü">' +
      '<div class="mm-head"><span class="brand-f">ESSE JEFFE</span>' +
        '<button class="mm-close" id="mmClose" aria-label="Kapat"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '</div>' +
      '<a href="index.html">Ana Sayfa</a>' +
      '<a href="koleksiyon.html">Koleksiyon</a>' +
      '<a href="atolye.html">Hakkımızda</a>' +
      '<div class="mm-sub">' +
        '<a href="iletisim.html">İletişim</a>' +
        '<a href="beden-rehberi.html">Beden Rehberi</a>' +
        '<a href="sss.html">SSS</a>' +
      '</div>' +
    '</nav>';
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  var menu = document.getElementById('mobileMenu');
  var overlay = document.getElementById('mmOverlay');
  function openMenu() { menu.classList.add('open'); overlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeMenu() { menu.classList.remove('open'); overlay.classList.remove('open'); document.body.style.overflow = ''; }
  burger.addEventListener('click', openMenu);
  document.getElementById('mmClose').addEventListener('click', closeMenu);
  overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
})();

// ── Arama (search) ───────────────────────────────────────
// Header'daki büyüteç ikonunu çalışır hale getirir. Veri kaynağı:
// Supabase açıksa canlı katalog (EJData.products), yoksa EJ_CATALOG.
(function () {
  var searchBtn = document.querySelector('.tools .icon[aria-label="Ara"]');
  if (!searchBtn) return;

  // Panel + overlay
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="search-overlay" id="ejSearchOverlay"></div>' +
    '<div class="search-panel" id="ejSearchPanel" role="dialog" aria-modal="true" aria-label="Ürün ara">' +
      '<div class="search-in">' +
        '<div class="search-bar">' +
          '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7"></circle><line x1="16.5" y1="16.5" x2="21" y2="21"></line></svg>' +
          '<input type="search" id="ejSearchInput" placeholder="Ürün ara — isim veya model" autocomplete="off" enterkeyhint="search" aria-label="Ürün ara">' +
          '<button class="search-close" id="ejSearchClose" type="button" aria-label="Kapat"><svg viewBox="0 0 24 24" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>' +
        '</div>' +
        '<div class="search-results" id="ejSearchResults" role="listbox"></div>' +
      '</div>' +
    '</div>';
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  var panel   = document.getElementById('ejSearchPanel');
  var overlay = document.getElementById('ejSearchOverlay');
  var input   = document.getElementById('ejSearchInput');
  var results = document.getElementById('ejSearchResults');
  var closeBtn = document.getElementById('ejSearchClose');

  // Katalog: canlı veri gelirse önbelleğe al; gelmezse statik (önbelleksiz → sonra tekrar dener)
  var catalogCache = null;
  function loadCatalog() {
    if (catalogCache) return Promise.resolve(catalogCache);
    if (window.EJData && typeof window.EJData.products === 'function') {
      return window.EJData.products().then(function (list) {
        if (list && list.length) {
          catalogCache = list.map(function (p) {
            return { slug: p.slug, name: p.name, md: p.model_desc || '',
                     price: p.price, old: p.old_price || 0, tag: p.badge || '', img: p.image || '' };
          });
          return catalogCache;
        }
        return EJ_CATALOG;
      }).catch(function () { return EJ_CATALOG; });
    }
    return Promise.resolve(EJ_CATALOG);
  }

  function rowHTML(p) {
    var media = p.img
      ? '<span class="sr-ph"><img src="' + ejEsc(p.img) + '" alt="" loading="lazy" decoding="async"></span>'
      : '<span class="sr-ph">' + EJ_PH_SVG + '</span>';
    var price = (p.old ? '<span class="old">' + ejFmt(p.old) + '</span>' : '') + ejFmt(p.price);
    return '<a class="search-row" role="option" href="urun.html?slug=' + encodeURIComponent(p.slug) + '">' +
      media +
      '<span class="sr-info"><span class="sr-name">' + ejEsc(p.name) + '</span>' +
      '<span class="sr-md">' + ejEsc(p.md) + '</span></span>' +
      '<span class="sr-price">' + price + '</span></a>';
  }

  function renderResults() {
    var q = ejNorm(input.value.trim());
    loadCatalog().then(function (cat) {
      var list = q
        ? cat.filter(function (p) { return ejNorm(p.name + ' ' + p.md).indexOf(q) >= 0; })
        : cat;
      if (!list.length) {
        results.innerHTML = '<p class="search-empty">“' + ejEsc(input.value.trim()) + '” için sonuç bulunamadı.</p>';
        return;
      }
      results.innerHTML = list.map(rowHTML).join('');
    });
  }

  var isOpen = false;
  function openSearch() {
    isOpen = true;
    panel.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderResults();
    setTimeout(function () { input.focus(); }, 60);
  }
  function closeSearch() {
    isOpen = false;
    panel.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  searchBtn.addEventListener('click', function (e) {
    e.preventDefault();
    isOpen ? closeSearch() : openSearch();
  });
  closeBtn.addEventListener('click', closeSearch);
  overlay.addEventListener('click', closeSearch);
  input.addEventListener('input', renderResults);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen) closeSearch(); });
})();

// ── Sepet (cart) ─────────────────────────────────────────
// localStorage tabanlı; backend'e geçince load/save/checkout
// fonksiyonları API çağrılarıyla değiştirilecek. Veri modeli
// sabit kalır: {id,name,desc,price,color,size,qty}
window.EJCart = (function () {
  var KEY = 'ej_cart';
  var WHATSAPP = '%2B908502551237';   // checkout için (mevcut WhatsApp hattı)

  // "2.199 TL" / "1.699 TL" → 1699 (tam sayı, TL)
  function parsePrice(txt) {
    if (txt == null) return 0;
    var digits = String(txt).replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  }
  // 1699 → "1.699 TL"
  function fmt(n) {
    return (n || 0).toLocaleString('tr-TR') + ' TL';
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }
  function save(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    render();
  }

  function lineKey(it) { return [it.id, it.color || '', it.size || ''].join('|'); }

  function add(item) {
    var items = load();
    item.qty = item.qty || 1;
    var found = null;
    for (var i = 0; i < items.length; i++) {
      if (lineKey(items[i]) === lineKey(item)) { found = items[i]; break; }
    }
    if (found) { found.qty += item.qty; }
    else { items.push(item); }
    save(items);
    open();
  }

  function setQty(key, qty) {
    var items = load().filter(function (it) {
      if (lineKey(it) === key) { it.qty = qty; return qty > 0; }
      return true;
    });
    save(items);
  }
  function remove(key) {
    save(load().filter(function (it) { return lineKey(it) !== key; }));
  }
  function clear() { save([]); }

  function count() {
    return load().reduce(function (n, it) { return n + (it.qty || 0); }, 0);
  }
  function subtotal() {
    return load().reduce(function (n, it) { return n + (it.price || 0) * (it.qty || 0); }, 0);
  }

  // ── panel aç/kapat ──
  function panel()   { return document.getElementById('bagPanel'); }
  function overlay() { return document.getElementById('bagOverlay'); }
  function open() {
    var p = panel(), o = overlay();
    if (!p) return;
    p.classList.add('open');
    if (o) o.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    var p = panel(), o = overlay();
    if (!p) return;
    p.classList.remove('open');
    if (o) o.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── render ──
  // Sepet verisi localStorage'dan gelir ama kaynağı DB ürün adı/görseli
  // (ürün sayfası DOM'u) — admin panelinden HTML içeren ürün adı girilirse
  // stored XSS olurdu. Bu yüzden her alan ejEsc'ten geçer; color_hex yalnız
  // #hex biçiminde kabul edilir (style attribute'una serbest metin girmesin).
  function swatch(it) {
    if (it.img) {
      return '<div class="bag-img"><img src="' + ejEsc(it.img) + '" alt="' + ejEsc(it.name || '') + '" loading="lazy" decoding="async"></div>';
    }
    var c = /^#[0-9a-fA-F]{3,8}$/.test(String(it.color_hex || '')) ? it.color_hex : '#e7e1da';
    return '<div class="bag-img"><span style="display:block;width:68px;height:90px;background:' + c + '"></span></div>';
  }

  function itemRow(it) {
    var k = lineKey(it);
    var meta = [];
    if (it.color) meta.push(ejEsc(it.color));
    if (it.size)  meta.push('Beden: ' + ejEsc(it.size));
    return '' +
      '<div class="bag-item" data-key="' + ejEsc(k) + '">' +
        swatch(it) +
        '<div class="bag-info">' +
          '<div class="bag-name">' + ejEsc(it.name || '') + '</div>' +
          (it.desc ? '<div class="bag-meta">' + ejEsc(it.desc) + '</div>' : '') +
          (meta.length ? '<div class="bag-meta">' + meta.join(' · ') + '</div>' : '') +
          '<div class="bag-qty-row">' +
            '<span class="bag-qty">' +
              '<button type="button" class="bag-step" data-step="-1" aria-label="Azalt">−</button>' +
              '<b>' + (parseInt(it.qty, 10) || 0) + '</b>' +
              '<button type="button" class="bag-step" data-step="1" aria-label="Arttır">+</button>' +
              '<button type="button" class="bag-rm" aria-label="Kaldır">Kaldır</button>' +
            '</span>' +
            '<span class="bag-price">' + fmt((it.price || 0) * (it.qty || 0)) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function render() {
    // başlık rozeti (tüm sayfalardaki .bag .count)
    var n = count();
    document.querySelectorAll('.icon.bag .count').forEach(function (b) {
      b.textContent = n;
      b.style.display = n > 0 ? '' : 'none';
    });

    var p = panel();
    if (!p) return;
    var items = load();
    var empty = p.querySelector('.bag-empty-state');
    var oldBody = p.querySelector('.bag-body');
    var oldFoot = p.querySelector('.bag-foot');
    if (oldBody) oldBody.remove();
    if (oldFoot) oldFoot.remove();

    if (!items.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    var head = p.querySelector('.bag-head');
    var sub = subtotal();

    var body = document.createElement('div');
    body.className = 'bag-body';
    body.innerHTML = items.map(itemRow).join('');

    var foot = document.createElement('div');
    foot.className = 'bag-foot';
    foot.innerHTML =
      '<div class="bag-tax-row"><span>Kargo</span><span>Ücretsiz</span></div>' +
      '<div class="bag-total-row"><span>Toplam</span><span>' + fmt(sub) + '</span></div>' +
      '<button type="button" class="btn btn-solid bag-cta" data-checkout>Siparişi Tamamla</button>';

    // head'den hemen sonra body, sonra foot
    if (head && head.nextSibling) {
      p.insertBefore(body, head.nextSibling);
    } else {
      p.insertBefore(body, p.firstChild);
    }
    body.insertAdjacentElement('afterend', foot);
  }

  // backend gelene kadar: WhatsApp üzerinden sipariş özeti
  function checkout() {
    var items = load();
    if (!items.length) return;
    var lines = items.map(function (it) {
      var d = [];
      if (it.color) d.push(it.color);
      if (it.size) d.push(it.size);
      return '• ' + it.name + (d.length ? ' (' + d.join(', ') + ')' : '') +
             ' x' + it.qty + ' — ' + fmt((it.price || 0) * (it.qty || 0));
    });
    var msg = 'Merhaba, sipariş vermek istiyorum:\n' +
      lines.join('\n') + '\n\nToplam: ' + fmt(subtotal());
    window.open('https://api.whatsapp.com/send?phone=' + WHATSAPP +
      '&text=' + encodeURIComponent(msg), '_blank');
  }

  // ── olay delegasyonu ──
  // Not: ürün kartlarının tamamı ürün sayfasına link; karttan sepete
  // ekleme yok (beden/renk ürün sayfasında seçilir).
  function bind() {
    document.addEventListener('click', function (e) {
      // ürün detay sayfasındaki "Sepete Ekle"
      var pdBtn = e.target.closest('.pd-actions .btn-solid');
      if (pdBtn && pdBtn.tagName === 'BUTTON') {
        e.preventDefault(); e.stopPropagation();
        // beden zorunlu: seçilmeden sepete eklenemez → uyarı göster
        var pdSizes = document.querySelector('.pd-sizes');
        if (pdSizes && !pdSizes.querySelector('button.sel')) {
          warnSelectSize(pdSizes);
          return;
        }
        var pdItem = fromProduct();
        flyToCart(pdItem);
        add(pdItem);
        return;
      }
      // sepet panelindeki adım / kaldır
      var step = e.target.closest('.bag-step');
      if (step) {
        var row = step.closest('.bag-item');
        var it = load().filter(function (x) { return lineKey(x) === row.dataset.key; })[0];
        if (it) setQty(row.dataset.key, (it.qty || 0) + parseInt(step.dataset.step, 10));
        return;
      }
      var rm = e.target.closest('.bag-rm');
      if (rm) { remove(rm.closest('.bag-item').dataset.key); return; }
      // checkout → sepet/ödeme sayfası
      if (e.target.closest('[data-checkout]')) { window.location.href = 'sepet.html'; return; }
    });
  }

  // beden seçilmeden "Sepete Ekle"ye basılırsa: ürün sayfasındaki beden seçme
  // popup'ını aç. (Modalın açılışı/bedenleri/chat yönlendirmesi urun.html'de.)
  function warnSelectSize() {
    document.dispatchEvent(new CustomEvent('ej:need-size'));
  }

  // sepete ekleme animasyonu: ürün görselinin bir kopyası, görselin bulunduğu
  // yerden köşedeki sepet ikonuna küçülerek + solarak uçar. Salt görsel efekt.
  function flyToCart(item) {
    var cart = document.querySelector('.icon.bag');
    var srcEl = document.getElementById('pgMain') || document.querySelector('.pd-gallery .pg-item');
    if (!cart || !srcEl) return;
    var s = srcEl.getBoundingClientRect();
    var c = cart.getBoundingClientRect();

    // başlangıç: görselin ekranda GÖRÜNEN kısmının ortası (uzun galeri için güvenli)
    var startX = s.left + s.width / 2;
    var startY = (Math.max(s.top, 70) + Math.min(s.bottom, window.innerHeight)) / 2;
    var w = Math.min(s.width, 130), h = w * 1.25;

    var fly = document.createElement('div');
    fly.className = 'ej-fly';
    if (item && item.img) { fly.style.backgroundImage = 'url("' + item.img + '")'; }
    else { fly.style.background = (item && item.color_hex) || '#6e2c2c'; }
    fly.style.left = (startX - w / 2) + 'px';
    fly.style.top = (startY - h / 2) + 'px';
    fly.style.width = w + 'px';
    fly.style.height = h + 'px';
    document.body.appendChild(fly);

    // hedef: sepet ikonunun merkezi
    var tx = (c.left + c.width / 2) - startX;
    var ty = (c.top + c.height / 2) - startY;
    requestAnimationFrame(function () {
      fly.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(.06)';
      fly.style.opacity = '0.15';
      fly.style.borderRadius = '50%';
    });
    var done = false;
    function finish() {
      if (done) return; done = true;
      if (fly.parentNode) fly.parentNode.removeChild(fly);
      cart.classList.add('ej-cart-bump');
      setTimeout(function () { cart.classList.remove('ej-cart-bump'); }, 340);
    }
    fly.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 900);   // emniyet: transitionend gelmezse temizle
  }

  // ürün detay sayfasından sepet kalemi çıkar
  function fromProduct() {
    var h1 = document.querySelector('.pd-info h1');
    var name = 'Ürün', desc = '';
    if (h1) {
      var em = h1.querySelector('em');
      desc = em ? em.textContent.trim() : '';
      var clone = h1.cloneNode(true);
      if (em) { var ec = clone.querySelector('em'); if (ec) ec.remove(); }
      name = clone.textContent.trim();
    }
    var priceEl = document.querySelector('.pd-price');
    var price = 0;
    if (priceEl) {
      var pc = priceEl.cloneNode(true);
      var old = pc.querySelector('.old'); if (old) old.remove();
      price = parsePrice(pc.textContent);
    }
    var color = (document.getElementById('colorName') || {}).textContent || '';
    var dot = document.getElementById('swDot');
    var hex = dot ? dot.style.background : '';
    var selSize = document.querySelector('.pd-sizes button.sel');
    var size = selSize ? selSize.textContent.trim() : '';
    var img = document.getElementById('pgMainImg');
    var src = (img && img.src && img.style.opacity !== '0') ? img.src : '';
    // DB slug'ı varsa onu kullan (Edge Function fiyatı slug ile DB'den doğrular);
    // yoksa isimden türet (sabit içerik için geriye dönük uyumlu).
    var dbSlug = (window.EJ_PRODUCT && window.EJ_PRODUCT.slug) || slug(name);
    return {
      id: dbSlug, name: name, desc: desc,
      price: price, color: color.trim(), color_hex: hex, size: size,
      img: src, qty: 1
    };
  }

  function slug(s) {
    return String(s).toLowerCase()
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // diğer sekmelerle senkron
  window.addEventListener('storage', function (e) { if (e.key === KEY) render(); });

  function init() {
    bind();
    render();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  return { add: add, remove: remove, setQty: setQty, clear: clear, count: count,
           subtotal: subtotal, open: open, close: close, render: render,
           load: load, _slug: slug, _parsePrice: parsePrice };
})();
