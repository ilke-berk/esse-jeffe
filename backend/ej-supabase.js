/* ============================================================
   Esse Jeffe — Supabase veri katmanı
   supabase-config.js'den SONRA yüklenmeli.
   - Supabase client'ı kurar
   - window.EJData ile ürün verisi sunar
   - [data-ej-grid] taşıyan kapsayıcıları ürün kartlarıyla doldurur
   ============================================================ */

// cdn.jsdelivr.net'e erken bağlan (supabase-js buradan yüklenir) — bağlantı ısıtma
(function () {
  try {
    var pc = document.createElement('link');
    pc.rel = 'preconnect'; pc.href = 'https://cdn.jsdelivr.net';
    document.head.appendChild(pc);
  } catch (e) {}
})();

(function () {
  var cfg = window.EJ_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) {
    console.warn('[EJ] Supabase yapılandırması eksik — sabit içerik kullanılacak.');
    return;
  }

  var client = null;

  // ---- yardımcılar ----
  function fmt(n) { return (n || 0).toLocaleString('tr-TR') + ' TL'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function bySort(a, b) { return (a.sort || 0) - (b.sort || 0); }

  var PH_SVG = '<div class="img-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>';

  // satırı (DB) sade ürün nesnesine çevir
  function normalize(row) {
    var colors = (row.product_colors || []).slice().sort(bySort);
    var images = (row.product_images || []).slice().sort(bySort);
    var primary = (images[0] && images[0].url) || null;
    if (!primary) {
      for (var i = 0; i < colors.length; i++) { if (colors[i].image_url) { primary = colors[i].image_url; break; } }
    }
    return {
      slug: row.slug, name: row.name, model_desc: row.model_desc,
      description: row.description, price: row.price, old_price: row.old_price,
      badge: row.badge, category: row.category,
      sizes: row.sizes || ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
      image: primary, colors: colors, images: images
    };
  }

  // ürün kartı (mevcut .card markup'ıyla birebir — sepet & CSS uyumlu)
  function cardHTML(p) {
    var tag = p.badge ? '<span class="tag">' + esc(p.badge) + '</span>' : '';
    var media = p.image
      ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async" width="900" height="1200" style="width:100%;aspect-ratio:3/4;object-fit:cover;display:block">'
      : PH_SVG;
    var dots = p.colors.map(function (c) {
      return '<span style="background:' + esc(c.hex) + '" title="' + esc(c.name) + '"></span>';
    }).join('');
    var price = (p.old_price ? '<span class="old">' + fmt(p.old_price) + '</span>' : '') + fmt(p.price);
    return '<a class="card" href="urun.html?slug=' + encodeURIComponent(p.slug) + '">' +
      '<div class="frame">' + tag + media + '</div>' +
      '<div class="meta"><h3>' + esc(p.name) + '</h3>' +
        '<p class="model-desc">' + esc(p.model_desc || '') + '</p>' +
        '<div class="dots">' + dots + '</div>' +
        '<div class="price">' + price + '</div></div></a>';
  }

  var SELECT = '*, product_colors(name,hex,sort,image_url), product_images(url,sort)';

  // ---- public API ----
  var EJData = {
    fmt: fmt,
    cardHTML: cardHTML,
    // ürün listesi — opts: {featured, category, limit}
    products: function (opts) {
      opts = opts || {};
      var q = client.from('products').select(SELECT).eq('active', true).order('sort');
      if (opts.featured) q = q.eq('featured', true);
      if (opts.category) q = q.eq('category', opts.category);
      return q.then(function (res) {
        if (res.error) throw res.error;
        var list = (res.data || []).map(normalize);
        if (opts.limit) list = list.slice(0, opts.limit);
        return list;
      });
    },
    // tek ürün
    product: function (slug) {
      return client.from('products').select(SELECT).eq('slug', slug).eq('active', true)
        .limit(1).maybeSingle().then(function (res) {
          if (res.error) throw res.error;
          return res.data ? normalize(res.data) : null;
        });
    },
    // sipariş oluştur (kapıda ödeme / havale) — form: teslimat+ödeme, items: sepet kalemleri
    // GÜVENLİK: fiyat client'tan gelmez. Sipariş, tutarı slug'lara göre DB'den
    // yeniden hesaplayan create-order Edge Function'ı üzerinden oluşturulur
    // (aynen kart akışındaki paytr-token gibi). RLS artık doğrudan client
    // insert'ine izin vermez; yazma yalnızca service_role ile bu fonksiyonda olur.
    createOrder: function (form, items) {
      if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
      if (!client.functions) return Promise.reject(new Error('Sipariş servisi hazır değil'));
      if (!items || !items.length) return Promise.reject(new Error('Sepet boş'));
      return client.functions.invoke('create-order', {
        body: { form: form, items: items }
      }).then(function (r) {
        // non-2xx → gerçek hata mesajı yanıt gövdesinde (context.json)
        if (r.error) return invokeErr(r.error).then(function (m) { throw new Error(m); });
        var d = r.data || {};
        if (d.error) throw new Error(d.error);
        if (!d.order_no) throw new Error('Sipariş oluşturulamadı.');
        return { order_no: d.order_no, total: d.total };
      });
    },
    // misafir sipariş takibi — track-order Edge Function üzerinden.
    // order_no + telefon İKİSİ de eşleşirse sipariş özetini döner. RLS,
    // misafirin siparişini doğrudan okumasına izin vermez; bu yüzden
    // service_role ile bu fonksiyonda okunur (bkz. track-order/index.ts).
    trackOrder: function (orderNo, phone) {
      if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
      if (!client.functions) return Promise.reject(new Error('Takip servisi hazır değil'));
      return client.functions.invoke('track-order', {
        body: { order_no: orderNo, phone: phone }
      }).then(function (r) {
        if (r.error) return invokeErr(r.error).then(function (m) { throw new Error(m); });
        var d = r.data || {};
        if (d.error) throw new Error(d.error);
        if (!d.order) throw new Error('Sipariş bulunamadı.');
        return d.order;
      });
    },
    // bülten aboneliği — submit-form Edge Function üzerinden (honeypot + IP hız sınırı).
    // RLS artık doğrudan client insert'ine izin vermez; yazma yalnız service_role ile.
    subscribe: function (email, hp) {
      if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
      if (!client.functions) return Promise.reject(new Error('Servis hazır değil'));
      return client.functions.invoke('submit-form', {
        body: { kind: 'newsletter', email: email, hp: hp || '' }
      }).then(function (r) {
        if (r.error) return invokeErr(r.error).then(function (m) { throw new Error(m); });
        var d = r.data || {};
        if (d.error) throw new Error(d.error);
        return { ok: true, already: !!d.already };
      });
    },
    // iletişim mesajı — submit-form Edge Function üzerinden (honeypot + IP hız sınırı).
    sendMessage: function (d) {
      if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
      if (!client.functions) return Promise.reject(new Error('Servis hazır değil'));
      return client.functions.invoke('submit-form', {
        body: {
          kind: 'contact', hp: d.hp || '',
          name: d.name, email: d.email, phone: d.phone || null,
          subject: d.subject || null, order_no: d.order_no || null, message: d.message
        }
      }).then(function (r) {
        if (r.error) return invokeErr(r.error).then(function (m) { throw new Error(m); });
        var res = r.data || {};
        if (res.error) throw new Error(res.error);
        return { ok: true };
      });
    },
    // ---- üyelik / oturum ----
    auth: {
      signUp: function (name, email, password, phone) {
        if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
        return client.auth.signUp({
          email: email, password: password,
          options: { data: { full_name: name, phone: phone || null } }
        }).then(function (res) { if (res.error) throw res.error; return res.data; });
      },
      signIn: function (email, password) {
        if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
        return client.auth.signInWithPassword({ email: email, password: password })
          .then(function (res) { if (res.error) throw res.error; return res.data; });
      },
      signOut: function () {
        if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
        return client.auth.signOut();
      },
      resetPassword: function (email) {
        if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
        // maildeki link kullanıcıyı yeni şifre formuna götürür (giris.html değil —
        // aksi hâlde recovery oturumu açılır ama şifre belirlenemezdi).
        // NOT: bu adres Supabase panelinde Auth → URL Configuration → Redirect URLs'e ekli olmalı.
        return client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + '/sifre-yenile.html'
        }).then(function (res) { if (res.error) throw res.error; return res.data; });
      },
      updatePassword: function (password) {
        if (!client) return Promise.reject(new Error('Supabase bağlı değil'));
        return client.auth.updateUser({ password: password })
          .then(function (res) { if (res.error) throw res.error; return res.data; });
      },
      session: function () {
        if (!client) return Promise.resolve(null);
        return client.auth.getSession().then(function (r) { return r.data.session; });
      },
      onChange: function (cb) {
        if (!client) return;
        return client.auth.onAuthStateChange(cb);
      }
    },
    client: function () { return client; }
  };
  window.EJData = EJData;

  // Edge Function hata mesajını (non-2xx) yanıt gövdesinden çöz
  function invokeErr(error) {
    if (error && error.context && typeof error.context.json === 'function') {
      return error.context.json()
        .then(function (b) { return (b && b.error) || error.message || 'İşlem başarısız'; })
        .catch(function () { return (error && error.message) || 'İşlem başarısız'; });
    }
    return Promise.resolve((error && error.message) || 'İşlem başarısız');
  }

  // ---- mega menü kartı (ej.js'in .mega-card markup'ıyla birebir) ----
  function megaCardHTML(p) {
    var tag = p.badge ? '<span class="mega-tag-sm">' + esc(p.badge) + '</span>' : '';
    var media = p.image
      ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '">'
      : '<div class="mega-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>';
    var price = (p.old_price ? '<span class="old">' + fmt(p.old_price) + '</span>' : '') + fmt(p.price);
    return '<a class="mega-card" href="urun.html?slug=' + encodeURIComponent(p.slug) + '">' +
      '<div class="mf">' + tag + media + '</div>' +
      '<div class="mt"><div class="mn">' + esc(p.name) + '</div>' +
        '<div class="md">' + esc(p.model_desc || '') + '</div>' +
        '<div class="mp">' + price + '</div></div></a>';
  }

  // Header mega menüsünü canlı katalogla doldur (ej.js statik kartları üzerine yazılır).
  // Kutu ej.js tarafından body'ye eklenir; bu yüzden var olup olmadığını kontrol et.
  function renderMega() {
    var box = document.getElementById('megaProducts');
    if (!box) return;
    EJData.products().then(function (list) {
      if (!list.length) return;                        // veri yoksa statik kartlar kalsın
      box.innerHTML = list.map(megaCardHTML).join('');
    }).catch(function (e) { console.error('[EJ] Mega menü yüklenemedi:', e.message || e); });
  }

  // [data-ej-grid] kapsayıcılarını doldur
  function renderGrids() {
    document.querySelectorAll('[data-ej-grid]').forEach(function (el) {
      var kind = el.getAttribute('data-ej-grid');     // "all" | "featured" | kategori
      var limit = parseInt(el.getAttribute('data-limit') || '0', 10) || 0;
      var opts = { limit: limit };
      if (kind === 'featured') opts.featured = true;
      else if (kind && kind !== 'all') opts.category = kind;
      EJData.products(opts).then(function (list) {
        if (!list.length) return;                      // veri yoksa sabit HTML kalsın
        el.innerHTML = list.map(cardHTML).join('');
        el.dispatchEvent(new CustomEvent('ej:grid-rendered', { bubbles: true }));
      }).catch(function (e) { console.error('[EJ] Ürünler yüklenemedi:', e.message || e); });
    });
  }

  // ---- ürün detay sayfasını DB'den doldur ----
  function applyProduct(p) {
    document.title = p.name + ' — Esse Jeffe';
    window.EJ_PRODUCT = p;

    var crumb = document.querySelector('.pd-info .crumb');
    if (crumb) crumb.innerHTML =
      '<a href="index.html">Ana Sayfa</a> · <a href="koleksiyon.html">Koleksiyon</a> · ' + esc(p.name);

    var label = document.querySelector('.pd-info .label');
    if (label) {
      if (p.badge) { label.textContent = p.badge; label.style.display = ''; }
      else { label.style.display = 'none'; }
    }
    var modelTag = document.querySelector('.model-tag');
    if (modelTag) {
      if (p.badge) { modelTag.textContent = p.badge; modelTag.style.display = ''; }
      else { modelTag.style.display = 'none'; }
    }

    var h1 = document.querySelector('.pd-info h1');
    if (h1) h1.innerHTML = esc(p.name) +
      ' <em style="font-style:normal;display:block;font-family:var(--sans);font-size:clamp(13px,1.2vw,16px);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:400;margin-top:8px">' +
      esc(p.model_desc || '') + '</em>';

    var price = document.querySelector('.pd-price');
    if (price) price.innerHTML =
      (p.old_price ? '<span class="old">' + fmt(p.old_price) + '</span>' : '') + fmt(p.price);

    var desc = document.querySelector('.pd-desc');
    if (desc && p.description) desc.textContent = p.description;

    // bedenler
    var sizesWrap = document.querySelector('.pd-sizes');
    if (sizesWrap && p.sizes && p.sizes.length) {
      var defIdx = p.sizes.indexOf('M'); if (defIdx < 0) defIdx = 0;
      sizesWrap.innerHTML = p.sizes.map(function (s, i) {
        return '<button type="button"' + (i === defIdx ? ' class="sel"' : '') + '>' + esc(s) + '</button>';
      }).join('');
    }

    // renk karuseli kartları
    var stage = document.getElementById('cstage');
    if (stage && p.colors && p.colors.length) {
      stage.innerHTML = p.colors.map(function (c) {
        return '<button class="ccard" data-name="' + esc(c.name) + '" data-img="' + esc(c.image_url || '') + '" style="--c:' + esc(c.hex) + '">' +
          '<span class="face"><span class="nm">' + esc(c.name) + '</span></span>' +
          '<span class="ring"></span>' +
          '<span class="chk"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span></button>';
      }).join('');
    }
  }

  function renderProduct() {
    if (!document.querySelector('.pd')) return;     // ürün sayfası değil
    var slug = (new URLSearchParams(location.search)).get('slug');
    var done = function () {
      window.dispatchEvent(new CustomEvent('ej:product-loaded', { detail: window.EJ_PRODUCT || null }));
    };
    if (!slug) { done(); return; }                  // slug yoksa sabit içerik + init
    EJData.product(slug).then(function (p) {
      if (p) applyProduct(p);
      done();
    }).catch(function (e) { console.error('[EJ] Ürün yüklenemedi:', e.message || e); done(); });
  }

  // ---- form bağlama (bülten + iletişim) ----
  function wireForms() {
    // bülten — .news içindeki form
    var news = document.querySelector('.news form');
    if (news && !news.dataset.ejWired) {
      news.dataset.ejWired = '1';
      news.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = news.querySelector('input[type="email"]') || news.querySelector('input');
        var btn = news.querySelector('button');
        var email = ((input && input.value) || '').trim();
        var hpEl = news.querySelector('input[name="website"]');
        var hp = hpEl ? hpEl.value : '';
        if (!email || email.indexOf('@') < 0) { newsMsg(news, 'Geçerli bir e-posta girin.'); return; }
        if (btn) btn.disabled = true;
        EJData.subscribe(email, hp).then(function (r) {
          if (input) input.value = '';
          newsMsg(news, r.already ? 'Zaten abonesiniz — teşekkürler.' : 'Abone olundu, teşekkürler!');
        }).catch(function (err) {
          newsMsg(news, 'Bir hata oluştu, tekrar deneyin.');
          console.error('[EJ] bülten hatası', err);
        }).then(function () { if (btn) btn.disabled = false; });
      });
    }

    // iletişim — #contactForm
    var cf = document.getElementById('contactForm');
    if (cf && !cf.dataset.ejWired) {
      cf.dataset.ejWired = '1';
      cf.addEventListener('submit', function (e) {
        e.preventDefault();
        var sent = document.getElementById('sent');
        var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
        var hpEl = cf.querySelector('input[name="website"]');
        var data = {
          name: get('ad'), phone: get('tel'), email: get('mail'),
          subject: get('konu'), order_no: get('siparis'), message: get('mesaj'),
          hp: hpEl ? hpEl.value : ''
        };
        if (!data.name || !data.email) { contactErr(cf, 'Lütfen ad ve e-posta alanlarını doldurun.'); return; }
        if (!data.message) { contactErr(cf, 'Lütfen mesajınızı yazın.'); return; }
        var btn = cf.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Gönderiliyor...'; }
        EJData.sendMessage(data).then(function () {
          cf.reset();
          if (sent) { sent.textContent = 'Teşekkürler — talebiniz alındı, kısa sürede dönüş yapacağız.'; sent.style.display = 'block'; sent.style.color = 'var(--zeytin)'; }
        }).catch(function (err) {
          if (sent) { sent.textContent = 'Gönderilemedi, lütfen tekrar deneyin.'; sent.style.display = 'block'; sent.style.color = '#b03030'; }
          console.error('[EJ] iletişim hatası', err);
        }).then(function () {
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.t || 'Talebi Gönder'; }
        });
      });
    }
  }
  function newsMsg(form, msg) {
    var p = form.parentElement.querySelector('.news-msg');
    if (!p) {
      p = document.createElement('p'); p.className = 'news-msg';
      p.style.cssText = 'margin-top:16px;font-size:13px;letter-spacing:.06em;color:var(--ink)';
      form.parentElement.appendChild(p);
    }
    p.textContent = msg;
  }
  function contactErr(form, msg) {
    var sent = document.getElementById('sent');
    if (sent) { sent.textContent = msg; sent.style.display = 'block'; sent.style.color = '#b03030'; }
  }

  // ---- oturum durumu + auth formları ----
  var _session = null;

  // admin ise header (.nav) ve mobil menüye "Admin" linki ekle
  function syncAdminLink(session) {
    if (!session) { removeAdminLinks(); return; }
    client.from('profiles').select('is_admin').eq('id', session.user.id).single()
      .then(function (r) { if (r.data && r.data.is_admin) addAdminLinks(); else removeAdminLinks(); })
      .catch(function () { removeAdminLinks(); });
  }
  function mkAdminLink(text, cls) {
    var a = document.createElement('a');
    a.href = 'admin-urunler.html'; a.textContent = text; a.className = 'ej-admin-link ' + cls;
    return a;
  }
  function addAdminLinks() {
    // masaüstü: logo ile sağ araç çubuğunun ortasına (header-in'de mutlak konum)
    var hin = document.querySelector('.header .header-in');
    if (hin && !hin.querySelector('.ej-admin-top')) hin.appendChild(mkAdminLink('Admin', 'ej-admin-top'));
    // mobil menü
    var mm = document.getElementById('mobileMenu');
    if (mm && !mm.querySelector('.ej-admin-mm')) mm.appendChild(mkAdminLink('Admin Paneli', 'ej-admin-mm'));
  }
  function removeAdminLinks() {
    Array.prototype.forEach.call(document.querySelectorAll('.ej-admin-link'), function (el) { el.remove(); });
  }

  function applyAuthState(session) {
    _session = session;
    var inAuth = !!session;
    document.body.classList.toggle('is-auth', inAuth);
    document.body.classList.toggle('is-guest', !inAuth);
    syncAdminLink(session);

    var bagAuth = document.querySelector('.bag-auth');
    if (bagAuth) {
      var as = bagAuth.querySelectorAll('a');
      if (as.length >= 2) {
        if (inAuth) {
          as[0].textContent = 'Hesabım'; as[0].href = 'hesap.html'; as[0].onclick = null;
          as[1].textContent = 'Çıkış Yap'; as[1].href = '#';
          as[1].onclick = function (e) { e.preventDefault(); EJData.auth.signOut().then(function () { location.href = 'index.html'; }); };
        } else {
          as[0].textContent = 'Giriş Yap'; as[0].href = 'giris.html'; as[0].onclick = null;
          as[1].textContent = 'Üye Ol'; as[1].href = 'kayit.html'; as[1].onclick = null;
        }
      }
    }
  }

  function aVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function authMsg(msg, isErr) {
    var el = document.getElementById('authMsg');
    if (el) { el.textContent = msg; el.style.display = 'block'; el.style.color = isErr ? '#b03030' : 'var(--zeytin)'; }
  }
  function setBtn(btn, busy, txt) {
    if (!btn) return;
    if (busy) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = txt; }
    else { btn.disabled = false; btn.textContent = btn.dataset.t || btn.textContent; }
  }
  function authErr(err) {
    var m = (err && err.message) || '';
    if (/already registered|already exists|User already/i.test(m)) return 'Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.';
    if (/Invalid login credentials/i.test(m)) return 'E-posta veya şifre hatalı.';
    if (/Email not confirmed/i.test(m)) return 'E-postanızı doğrulamanız gerekiyor. Gelen kutunuzu kontrol edin.';
    if (/Password should be at least|at least 6/i.test(m)) return 'Şifre çok kısa.';
    if (/different from the old password/i.test(m)) return 'Yeni şifre eski şifrenizle aynı olamaz.';
    if (/Auth session missing/i.test(m)) return 'Sıfırlama bağlantısı geçersiz veya süresi dolmuş. Giriş sayfasından yeni bir link isteyin.';
    return m || 'Bir hata oluştu, tekrar deneyin.';
  }

  function handleRegister(e) {
    e.preventDefault();
    var name = aVal('regName'), email = aVal('regEmail'), pass = aVal('regPass');
    var phone = aVal('regPhone');
    var kvkk = document.getElementById('regKvkk');
    if (!name || !email || !pass) return authMsg('Lütfen tüm zorunlu alanları doldurun.', true);
    if (pass.length < 8) return authMsg('Şifre en az 8 karakter olmalı.', true);
    if (kvkk && !kvkk.checked) return authMsg('Devam etmek için Gizlilik Politikası onayı gerekli.', true);
    var btn = e.target.querySelector('button[type="submit"]'); setBtn(btn, true, 'Kaydediliyor...');
    EJData.auth.signUp(name, email, pass, phone).then(function (data) {
      if (data.session) { location.href = 'hesap.html'; }     // e-posta onayı kapalıysa otomatik giriş
      else {
        authMsg('Hesabınız oluşturuldu! E-postanıza gönderdiğimiz doğrulama linkine tıklayın, sonra giriş yapın.', false);
        setBtn(btn, false);
      }
    }).catch(function (err) { authMsg(authErr(err), true); setBtn(btn, false); });
  }

  function handleLogin(e) {
    e.preventDefault();
    var email = aVal('logEmail'), pass = aVal('logPass');
    if (!email || !pass) return authMsg('E-posta ve şifre gerekli.', true);
    var btn = e.target.querySelector('button[type="submit"]'); setBtn(btn, true, 'Giriş yapılıyor...');
    EJData.auth.signIn(email, pass).then(function () {
      var to = new URLSearchParams(location.search).get('next') || 'hesap.html';
      location.href = to;
    }).catch(function (err) { authMsg(authErr(err), true); setBtn(btn, false); });
  }

  function handleForgot(e) {
    e.preventDefault();
    var email = aVal('logEmail');
    if (!email) return authMsg('Önce e-posta adresinizi yazın, sonra "Şifremi unuttum"a basın.', true);
    EJData.auth.resetPassword(email).then(function () {
      authMsg('Şifre sıfırlama linki e-postanıza gönderildi.', false);
    }).catch(function (err) { authMsg(authErr(err), true); });
  }

  // sifre-yenile.html — recovery linkiyle gelen kullanıcı yeni şifresini belirler.
  // Supabase, linkteki token'ı doğrulayıp oturumu otomatik açar (detectSessionInUrl);
  // şifre bu oturum üzerinden auth.updateUser ile yazılır.
  function handleReset(e) {
    e.preventDefault();
    var pass = aVal('newPass'), pass2 = aVal('newPass2');
    if (!pass || !pass2) return authMsg('Lütfen her iki şifre alanını da doldurun.', true);
    if (pass.length < 8) return authMsg('Şifre en az 8 karakter olmalı.', true);
    if (pass !== pass2) return authMsg('Şifreler birbiriyle uyuşmuyor.', true);
    var btn = e.target.querySelector('button[type="submit"]'); setBtn(btn, true, 'Kaydediliyor...');
    EJData.auth.session().then(function (s) {
      if (!s) { var err = new Error('Auth session missing'); throw err; }
      return EJData.auth.updatePassword(pass);
    }).then(function () {
      authMsg('Şifreniz güncellendi. Hesabınıza yönlendiriliyorsunuz...', false);
      setTimeout(function () { location.href = 'hesap.html'; }, 1500);
    }).catch(function (err) { authMsg(authErr(err), true); setBtn(btn, false); });
  }

  // linkin kendisi hatalıysa (süresi dolmuş / kullanılmış) Supabase hash'te error döner
  function initResetPage(form) {
    var h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    if (!h.get('error')) return;
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    authMsg(h.get('error_code') === 'otp_expired'
      ? 'Bu sıfırlama linkinin süresi dolmuş. Lütfen giriş sayfasından yeni bir link isteyin.'
      : 'Sıfırlama linki geçersiz. Lütfen giriş sayfasından yeni bir link isteyin.', true);
  }

  function wireAuthUI() {
    var acc = document.querySelector('.tools .icon[aria-label="Hesap"]');
    if (acc && !acc.dataset.ejWired) {
      acc.dataset.ejWired = '1';
      acc.addEventListener('click', function () { location.href = _session ? 'hesap.html' : 'giris.html'; });
    }
    var rf = document.getElementById('registerForm');
    if (rf && !rf.dataset.ejWired) { rf.dataset.ejWired = '1'; rf.addEventListener('submit', handleRegister); }
    var lf = document.getElementById('loginForm');
    if (lf && !lf.dataset.ejWired) { lf.dataset.ejWired = '1'; lf.addEventListener('submit', handleLogin); }
    var fp = document.getElementById('forgotLink');
    if (fp && !fp.dataset.ejWired) { fp.dataset.ejWired = '1'; fp.addEventListener('click', handleForgot); }
    var pf = document.getElementById('resetForm');
    if (pf && !pf.dataset.ejWired) { pf.dataset.ejWired = '1'; pf.addEventListener('submit', handleReset); initResetPage(pf); }
  }

  function renderAll() {
    renderGrids(); renderMega(); renderProduct(); wireForms(); wireAuthUI();
    EJData.auth.session().then(applyAuthState);
  }

  function init() {
    if (!window.supabase || !window.supabase.createClient) {
      console.error('[EJ] Supabase SDK bulunamadı.');
      return;
    }
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
    window.ejSupabase = client;
    // oturum değişiminde (giriş/çıkış) arayüzü güncelle
    EJData.auth.onChange(function (event, session) { applyAuthState(session); });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderAll);
    } else { renderAll(); }
  }

  // supabase-js (UMD) CDN'den yükle, sonra başlat
  if (window.supabase && window.supabase.createClient) { init(); }
  else {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0';
    s.onload = init;
    s.onerror = function () { console.error('[EJ] Supabase SDK yüklenemedi (internet?).'); };
    document.head.appendChild(s);
  }
})();
