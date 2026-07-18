// Esse Jeffe — ölçüm yükleyicisi (GA4 + Meta Pixel)
// KVKK: scriptler yalnız çerez onayı ('ej_cookie_consent' === 'accepted')
// verildiyse yüklenir. Onay yoksa hiçbir üçüncü taraf isteği atılmaz.
// ID'ler boşken onay olsa bile hiçbir şey yüklenmez — hesaplar açılınca
// aşağıdaki iki satıra ID yazmak yeterli.
(function () {
  'use strict';

  var CONFIG = {
    ga4: '',        // ör: 'G-XXXXXXXXXX'  (GA4 Measurement ID)
    metaPixel: ''   // ör: '1234567890'    (Meta Pixel ID)
  };

  var CONSENT_KEY = 'ej_cookie_consent';
  var loaded = false;
  var queue = [];

  function consent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }

  // ---- yükleyiciler ----
  function loadGA4(id) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
  }

  function loadPixel(id) {
    if (window.fbq) return;
    var n = window.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
    window.fbq('init', id);
    window.fbq('track', 'PageView');
  }

  function activate() {
    if (loaded) return;
    if (consent() !== 'accepted') return;
    if (CONFIG.ga4) loadGA4(CONFIG.ga4);
    if (CONFIG.metaPixel) loadPixel(CONFIG.metaPixel);
    loaded = true;
    var q = queue.splice(0);
    q.forEach(function (a) { send(a.name, a.params); });
  }

  // ---- olay API'si: ejTrack('purchase', {...}) ----
  // GA4 adları kullanılır; Pixel standart olaylarına burada çevrilir.
  var PIXEL_MAP = {
    view_item: 'ViewContent',
    add_to_cart: 'AddToCart',
    begin_checkout: 'InitiateCheckout',
    purchase: 'Purchase'
  };

  function send(name, params) {
    params = params || {};
    if (window.gtag && CONFIG.ga4) window.gtag('event', name, params);
    if (window.fbq && CONFIG.metaPixel) {
      var px = PIXEL_MAP[name];
      var pd = { currency: params.currency || 'TRY', value: params.value };
      if (px) window.fbq('track', px, pd);
      else window.fbq('trackCustom', name, params);
    }
  }

  window.ejTrack = function (name, params) {
    if (consent() === 'rejected') return;
    if (!loaded) { queue.push({ name: name, params: params }); activate(); return; }
    send(name, params);
  };

  // ---- çerez onay bandı (tüm sayfalarda) ----
  // index.html'deki statik bant dahil tüm bağlama burada; sayfada bant yoksa
  // enjekte edilir (stiller ej.css'te).
  function bindBar(bar) {
    function set(v) {
      try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {}
      bar.classList.remove('show');
      if (v === 'accepted') activate();
    }
    var acc = bar.querySelector('#cbAccept'), rej = bar.querySelector('#cbReject');
    if (acc) acc.addEventListener('click', function () { set('accepted'); });
    if (rej) rej.addEventListener('click', function () { set('rejected'); });
    if (!consent()) setTimeout(function () { bar.classList.add('show'); }, 1200);
  }

  function ensureBar() {
    if (consent()) return;                       // karar verilmiş, bant gerekmez
    var bar = document.getElementById('cookiebar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'cookiebar';
      bar.id = 'cookiebar';
      bar.setAttribute('role', 'dialog');
      bar.setAttribute('aria-label', 'Çerez bildirimi');
      bar.innerHTML =
        '<div class="cookiebar-in">' +
        '<p>Size daha iyi bir alışveriş deneyimi sunmak için çerezler kullanıyoruz. ' +
        'Detaylar için <a href="cerez-politikasi.html">Çerez Politikası</a> ve ' +
        '<a href="gizlilik.html">Gizlilik Politikası</a> sayfalarına bakabilirsiniz.</p>' +
        '<div class="cb-actions">' +
        '<button type="button" class="cb-reject" id="cbReject">Reddet</button>' +
        '<button type="button" class="cb-accept" id="cbAccept">Kabul Et</button>' +
        '</div></div>';
      document.body.appendChild(bar);
    }
    bindBar(bar);
  }

  // ---- otomatik olaylar ----
  window.addEventListener('ej:product-loaded', function (e) {
    var p = e.detail || window.EJ_PRODUCT;
    if (!p || !p.slug) return;
    window.ejTrack('view_item', {
      currency: 'TRY', value: p.price,
      items: [{ item_id: p.slug, item_name: p.name, price: p.price }]
    });
  });

  function init() { ensureBar(); activate(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
