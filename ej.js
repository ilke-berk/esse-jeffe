/* Esse Jeffe — paylaşılan JS */
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
    if (bagPanel && bagPanel.classList.contains('open') && !bagPanel.contains(e.target) && !bagBtn.contains(e.target)) closeBag();
  });
})();

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
          '<div class="mega-products" id="megaProducts">',
            '<a class="mega-card" href="urun.html"><div class="mf"><span class="mega-tag-sm">Çok Satan</span><div class="mega-ph"></div></div><div class="mt"><div class="mn">Pera</div><div class="md">Uzun Yırtmaçlı Krep Abiye</div><div class="mp"><span class="old">2.199 TL</span>1.699 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><span class="mega-tag-sm">Yeni</span><div class="mega-ph"></div></div><div class="mt"><div class="mn">Asos</div><div class="md">Fakir Kol V Yaka Davet</div><div class="mp">1.399 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><span class="mega-tag-sm">İndirim</span><div class="mega-ph"></div></div><div class="mt"><div class="mn">Karya</div><div class="md">V Yaka Fırfırlı Kol Abiye</div><div class="mp"><span class="old">1.599 TL</span>1.299 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><div class="mega-ph"></div></div><div class="mt"><div class="mn">Efes</div><div class="md">Kruvaze Drapeli Krep Abiye</div><div class="mp">1.499 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><div class="mega-ph"></div></div><div class="mt"><div class="mn">Likya</div><div class="md">Kruvaze Drapeli Askılı</div><div class="mp">1.599 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><span class="mega-tag-sm">Yeni</span><div class="mega-ph"></div></div><div class="mt"><div class="mn">Side</div><div class="md">Diz Üstü Ön Drape Detaylı</div><div class="mp">1.399 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><div class="mega-ph"></div></div><div class="mt"><div class="mn">Truva</div><div class="md">Dekolte Detaylı Krep Abiye</div><div class="mp">1.299 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><div class="mega-ph"></div></div><div class="mt"><div class="mn">Milet</div><div class="md">Yarasa Kol Kruvaze Abiye</div><div class="mp">1.499 TL</div></div></a>',
            '<a class="mega-card" href="koleksiyon.html"><div class="mf"><div class="mega-ph"></div></div><div class="mt"><div class="mn">Lidya</div><div class="md">Ön Fırfır Bodycone Abiye</div><div class="mp">1.299 TL</div></div></a>',
          '</div>',
          '<button class="mega-arr mega-arr-r" id="megaArrR" aria-label="Sonraki"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><polyline points="9,18 15,12 9,6"/></svg></button>',
        '</div>',
        '<div class="mega-foot"><a href="koleksiyon.html" class="btn btn-solid">Tümünü Gör</a></div>',
      '</div>',
    '</div>',
    '<div class="mega-overlay" id="megaOverlay"></div>'
  ].join('');
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

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
  function swatch(it) {
    if (it.img) {
      return '<div class="bag-img"><img src="' + it.img + '" alt="' + (it.name || '') + '"></div>';
    }
    var c = it.color_hex || '#e7e1da';
    return '<div class="bag-img"><span style="display:block;width:68px;height:90px;background:' + c + '"></span></div>';
  }

  function itemRow(it) {
    var k = lineKey(it);
    var meta = [];
    if (it.color) meta.push(it.color);
    if (it.size)  meta.push('Beden: ' + it.size);
    return '' +
      '<div class="bag-item" data-key="' + k + '">' +
        swatch(it) +
        '<div class="bag-info">' +
          '<div class="bag-name">' + (it.name || '') + '</div>' +
          (it.desc ? '<div class="bag-meta">' + it.desc + '</div>' : '') +
          (meta.length ? '<div class="bag-meta">' + meta.join(' · ') + '</div>' : '') +
          '<div class="bag-qty-row">' +
            '<span class="bag-qty">' +
              '<button type="button" class="bag-step" data-step="-1" aria-label="Azalt">−</button>' +
              '<b>' + it.qty + '</b>' +
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
        add(fromProduct());
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
