/* ============================================================
   Esse Jeffe — Chat widget (canlı destek + AI)
   - Sağ altta yüzen marka monogram balonu + minimal sohbet paneli.
   - Editöryel marka dili: klasik beyaz zemin, ink/zeytin palet,
     Spectral serif, yumuşak köşeli balonlar. Maison Margiela tarzı
     sade düzen; Esse Jeffe kimliğiyle harmanlanmış.
   - AI (Claude) önce yanıtlar; kullanıcı birkaç mesaj yazınca alta
     ince "Temsilciye bağlan" bağlantısı belirir (direkt gelmez).
   - Panel açılınca yüzen ikon gizlenir; panel köşeye oturur.
   - Tabloya doğrudan erişmez; kimlik tahmin edilemez visitor_token.
   supabase-config.js'den SONRA yüklenir (EJ_CONFIG gerekir).
   ============================================================ */
(function () {
  var cfg = window.EJ_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) return;            // backend yoksa widget yok
  if (document.getElementById('ejChatBtn')) return;             // çift enjeksiyon koruması
  if (/\/admin/i.test(location.pathname)) return;               // admin sayfalarında gösterme

  var ENDPOINT = cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/chat';
  var LSKEY = 'ej_chat';
  var POLL_MS = 4000;
  var BRAND = 'ESSE JEFFE';
  var AGENT_AFTER = 2;        // bu kadar kullanıcı mesajından sonra temsilci bağlantısı belirir

  // hızlı konu çipleri (karşılama ekranında; tıklayınca otomatik soru gönderir)
  var CHIPS = [
    { t: 'Beden', q: 'Hangi bedeni seçmeliyim?' },
    { t: 'Kargo', q: 'Kargo ne kadar sürede gelir?' },
    { t: 'Değişim', q: 'Değişim ve iade nasıl yapılıyor?' },
    { t: 'Kapıda Ödeme', q: 'Kapıda ödeme var mı?' }
  ];

  var conv = load();          // {id, token} | null
  var lastTs = '1970-01-01';  // görülen son mesaj zamanı
  var seen = {};              // id -> true
  var status = 'ai';
  var pollTimer = null;
  var starting = false, sending = false;
  var userMsgCount = 0;       // temsilci bağlantısını ne zaman göstereceğimiz için

  // ---------- stil ----------
  var INK = 'var(--ink,#1b1a17)';
  var css =
  /* yüzen ikon */
  '#ejChatBtn{position:fixed;right:24px;bottom:24px;width:58px;height:58px;border:none;border-radius:50%;' +
    'background:' + INK + ';color:#fff;cursor:pointer;z-index:9998;box-shadow:0 10px 30px rgba(0,0,0,.26);' +
    'display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s}' +
  '#ejChatBtn:hover{transform:translateY(-3px);box-shadow:0 16px 38px rgba(0,0,0,.32)}' +
  '#ejChatBtn svg{width:25px;height:25px;fill:none;stroke:#fff;stroke-width:1.6}' +
  '#ejChatBtn .ej-dot{position:absolute;top:4px;right:6px;width:11px;height:11px;border-radius:50%;background:#6e2c2c;display:none;border:2px solid #fff}' +

  /* panel — köşeye oturan klasik beyaz pano */
  '#ejChatPanel{position:fixed;right:24px;bottom:24px;width:384px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 48px);' +
    'background:var(--bg,#fff);border:1px solid var(--line,#e8e8e8);border-radius:6px;z-index:9999;display:none;flex-direction:column;overflow:hidden;' +
    'box-shadow:0 26px 80px rgba(0,0,0,.2);font-family:var(--sans,"Helvetica Neue",Helvetica,Arial,sans-serif)}' +
  '#ejChatPanel.open{display:flex;animation:ejUp .26s cubic-bezier(.22,.61,.36,1)}' +
  '@keyframes ejUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}' +

  /* başlık — minimal: marka + durum, sağda küçült & kapat */
  '.ej-head{display:flex;align-items:center;gap:12px;padding:16px 16px 15px;border-bottom:1px solid var(--line,#e8e8e8);background:var(--bg,#fff)}' +
  '.ej-head .ej-htxt{display:flex;flex-direction:column;gap:5px;min-width:0}' +
  '.ej-head .ej-brand{font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:var(--ink,#1b1a17);line-height:1}' +
  '.ej-head .ej-sub{font-size:11px;color:var(--muted,#8c887f);display:flex;align-items:center;gap:6px;letter-spacing:.02em;line-height:1}' +
  '.ej-head .ej-live{width:6px;height:6px;border-radius:50%;background:#5b8f5e;display:inline-block;flex:0 0 auto}' +
  '.ej-head .ej-acts{margin-left:auto;display:flex;align-items:center;gap:2px}' +
  '.ej-head .ej-act{background:none;border:none;color:var(--soft,#56534c);cursor:pointer;padding:6px;line-height:0;border-radius:3px;transition:background .2s,color .2s}' +
  '.ej-head .ej-act:hover{color:var(--ink,#1b1a17);background:rgba(0,0,0,.05)}' +
  '.ej-head .ej-act svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7}' +

  /* mesaj alanı */
  '.ej-body{flex:1;overflow-y:auto;padding:20px 18px;display:flex;flex-direction:column;gap:14px;position:relative}' +
  '.ej-body::-webkit-scrollbar{width:7px}.ej-body::-webkit-scrollbar-thumb{background:#e0ddd6;border-radius:99px}' +

  /* karşılama (boş ekran) */
  '.ej-welcome{margin:auto;text-align:center;max-width:300px;padding:18px 6px;display:flex;flex-direction:column;align-items:center;gap:16px}' +
  '.ej-welcome .ej-mono{width:48px;height:48px;border-radius:50%;background:' + INK + ';color:#fff;display:flex;align-items:center;justify-content:center;' +
    'font-family:var(--serif,"Spectral",Georgia,serif);font-size:18px;letter-spacing:.06em}' +
  '.ej-welcome h4{margin:0;font-family:var(--serif,"Spectral",Georgia,serif);font-weight:400;font-size:22px;letter-spacing:.02em;color:var(--ink,#1b1a17);line-height:1.2}' +
  '.ej-welcome p{margin:0;font-size:13px;line-height:1.7;color:var(--soft,#56534c)}' +
  '.ej-welcome.hide{display:none}' +
  '.ej-wchips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:2px}' +
  '.ej-wchips button{background:none;border:1px solid var(--line-strong,#d4d4d4);color:var(--soft,#56534c);' +
    'font:inherit;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;padding:8px 14px;border-radius:999px;cursor:pointer;white-space:nowrap;transition:all .2s}' +
  '.ej-wchips button:hover{background:' + INK + ';color:#fff;border-color:' + INK + '}' +

  /* mesajlar */
  '.ej-row{display:flex;flex-direction:column;gap:5px;max-width:84%}' +
  '.ej-row.user{align-self:flex-end;align-items:flex-end}' +
  '.ej-row.bot{align-self:flex-start;align-items:flex-start}' +
  '.ej-row.sys{align-self:center;align-items:center;max-width:94%}' +
  '.ej-name{font-size:9.5px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--muted,#8c887f);padding:0 3px}' +
  '.ej-bub{padding:11px 15px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;border-radius:14px}' +
  '.ej-row.user .ej-bub{background:' + INK + ';color:#fff;border-bottom-right-radius:5px}' +
  '.ej-row.bot .ej-bub{background:var(--bg-warm,#f5f5f5);color:var(--ink,#1b1a17);border:1px solid var(--line,#e8e8e8);border-bottom-left-radius:5px}' +
  '.ej-row.sys .ej-bub{background:transparent;color:var(--muted,#8c887f);font-size:11.5px;text-align:center;letter-spacing:.02em;padding:2px 8px}' +
  '.ej-time{font-size:9.5px;color:var(--muted,#a7a298);padding:0 3px;letter-spacing:.04em}' +

  /* yazıyor */
  '.ej-typing{align-self:flex-start;background:var(--bg-warm,#f5f5f5);border:1px solid var(--line,#e8e8e8);border-radius:14px;border-bottom-left-radius:5px;padding:13px 16px;display:none}' +
  '.ej-typing.on{display:flex;gap:5px}' +
  '.ej-typing span{width:6px;height:6px;border-radius:50%;background:var(--muted,#b9b6aa);animation:ejBlink 1.2s infinite both}' +
  '.ej-typing span:nth-child(2){animation-delay:.2s}.ej-typing span:nth-child(3){animation-delay:.4s}' +
  '@keyframes ejBlink{0%,80%,100%{opacity:.25}40%{opacity:1}}' +

  /* alt: ince temsilci bağlantısı (sonradan belirir) + giriş */
  '.ej-foot{background:var(--bg,#fff);border-top:1px solid var(--line,#e8e8e8)}' +
  '.ej-agent{display:none;text-align:center;padding:10px 16px 0}' +
  '.ej-agent.on{display:block}' +
  '.ej-agent button{background:none;border:none;color:var(--zeytin,#3c4a3a);font:inherit;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;border-bottom:1px solid transparent;padding-bottom:2px}' +
  '.ej-agent button:hover{color:var(--ink,#1b1a17);border-bottom-color:var(--ink,#1b1a17)}' +
  '.ej-input{display:flex;align-items:center;gap:9px;padding:14px 16px 16px}' +
  '.ej-input textarea{flex:1;min-width:0;box-sizing:border-box;min-height:44px;height:44px;border:1px solid var(--line-strong,#d4d4d4);border-radius:22px;padding:11px 16px;font:inherit;font-size:13.5px;line-height:20px;resize:none;max-height:100px;outline:none;background:var(--bg,#fff);color:var(--ink,#1b1a17)}' +
  '.ej-input textarea:focus{border-color:' + INK + '}' +
  '.ej-input textarea::placeholder{color:var(--muted,#8c887f);letter-spacing:.02em}' +
  '.ej-input button{flex:0 0 auto;width:44px;height:44px;box-sizing:border-box;border:none;border-radius:50%;background:' + INK + ';color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .18s,opacity .18s}' +
  '.ej-input button:hover{transform:scale(1.06)}' +
  '.ej-input button:active{transform:scale(.96)}' +
  '.ej-input button:disabled{opacity:.4;cursor:default;transform:none}' +
  '.ej-input button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;margin-left:-1px}' +

  /* sonlandırma onayı */
  '.ej-confirm{position:absolute;inset:0;background:rgba(255,255,255,.96);z-index:5;display:none;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:28px;text-align:center}' +
  '.ej-confirm.on{display:flex;animation:ejFade .2s ease}' +
  '@keyframes ejFade{from{opacity:0}to{opacity:1}}' +
  '.ej-confirm p{margin:0;font-family:var(--serif,"Spectral",Georgia,serif);font-size:18px;color:var(--ink,#1b1a17);line-height:1.4;max-width:260px}' +
  '.ej-confirm .ej-cbtns{display:flex;gap:12px}' +
  '.ej-confirm button{font:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;padding:13px 30px;border-radius:6px;border:1px solid ' + INK + ';transition:all .2s}' +
  '.ej-confirm .ej-yes{background:' + INK + ';color:#fff}.ej-confirm .ej-yes:hover{opacity:.85}' +
  '.ej-confirm .ej-no{background:transparent;color:var(--ink,#1b1a17)}.ej-confirm .ej-no:hover{background:rgba(0,0,0,.05)}' +

  '@media (max-width:480px){#ejChatPanel{right:8px;left:8px;bottom:8px;width:auto;height:calc(100vh - 16px);max-height:none}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- DOM ----------
  var chatIcon = '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-5.4A8.4 8.4 0 0 1 4 11.6 8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>';

  var btn = document.createElement('button');
  btn.id = 'ejChatBtn';
  btn.setAttribute('aria-label', 'Yardım & Destek');
  btn.innerHTML = '<span class="ej-dot" id="ejChatDot"></span>' + chatIcon;

  var chipsHTML = CHIPS.map(function (c) {
    return '<button type="button" data-q="' + esc(c.q) + '">' + esc(c.t) + '</button>';
  }).join('');

  var panel = document.createElement('div');
  panel.id = 'ejChatPanel';
  panel.innerHTML =
    '<div class="ej-head">' +
      '<div class="ej-htxt">' +
        '<span class="ej-brand">' + BRAND + '</span>' +
        '<div class="ej-sub" id="ejChatSub"><span class="ej-live"></span>Çevrimiçi · anında yanıt</div>' +
      '</div>' +
      '<div class="ej-acts">' +
        '<button class="ej-act" id="ejChatMin" aria-label="Küçült" title="Küçült"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>' +
        '<button class="ej-act" id="ejChatX" aria-label="Görüşmeyi sonlandır" title="Görüşmeyi sonlandır"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '</div>' +
    '</div>' +
    '<div class="ej-body" id="ejChatBody">' +
      '<div class="ej-welcome" id="ejChatWelcome">' +
        '<span class="ej-mono">EJ</span>' +
        '<h4>Esse Jeffe\'ye hoş geldiniz</h4>' +
        '<p>Abiye seçimi, beden, renk ya da kargo — her konuda yardımcı olalım. Size nasıl yardımcı olabiliriz?</p>' +
        '<div class="ej-wchips" id="ejChatChips">' + chipsHTML + '</div>' +
      '</div>' +
      '<div class="ej-typing" id="ejChatTyping"><span></span><span></span><span></span></div>' +
      '<div class="ej-confirm" id="ejChatConfirm">' +
        '<p>Görüşmeyi sonlandırmak istediğinize emin misiniz?</p>' +
        '<div class="ej-cbtns">' +
          '<button class="ej-yes" id="ejChatEndYes">Evet</button>' +
          '<button class="ej-no" id="ejChatEndNo">Hayır</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ej-foot">' +
      '<div class="ej-agent" id="ejChatAgentRow"><button id="ejChatAgent">Müşteri temsilcisine bağlan</button></div>' +
      '<div class="ej-input">' +
        '<textarea id="ejChatText" rows="1" placeholder="Mesajınızı yazın…"></textarea>' +
        '<button id="ejChatSend" aria-label="Gönder"><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var bodyEl = document.getElementById('ejChatBody');
  var typingEl = document.getElementById('ejChatTyping');
  var welcomeEl = document.getElementById('ejChatWelcome');
  var confirmEl = document.getElementById('ejChatConfirm');
  var subEl = document.getElementById('ejChatSub');
  var chipsEl = document.getElementById('ejChatChips');
  var agentRow = document.getElementById('ejChatAgentRow');
  var textEl = document.getElementById('ejChatText');
  var sendBtn = document.getElementById('ejChatSend');
  var dotEl = document.getElementById('ejChatDot');

  // ---------- olaylar ----------
  btn.addEventListener('click', openPanel);
  document.getElementById('ejChatMin').addEventListener('click', closePanel);     // küçült: konuşmayı saklar
  document.getElementById('ejChatX').addEventListener('click', askEnd);           // kapat: sonlandırma onayı
  document.getElementById('ejChatEndYes').addEventListener('click', endChat);
  document.getElementById('ejChatEndNo').addEventListener('click', function () { confirmEl.classList.remove('on'); });
  sendBtn.addEventListener('click', doSend);
  document.getElementById('ejChatAgent').addEventListener('click', requestAgent);
  chipsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b && b.dataset.q) sendText(b.dataset.q);
  });
  textEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  textEl.addEventListener('input', function () {
    textEl.style.height = 'auto';
    textEl.style.height = Math.min(textEl.scrollHeight, 100) + 'px';
  });

  // ---------- akış ----------
  function openPanel() {
    panel.classList.add('open');
    btn.style.display = 'none';           // ikon gizlenir; panel köşeye oturur
    dotEl.style.display = 'none';
    ensureConv().then(function () {
      poll();
      if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
      setTimeout(function () { textEl.focus(); }, 80);
    });
  }
  function closePanel() {
    panel.classList.remove('open');
    confirmEl.classList.remove('on');
    btn.style.display = '';               // ikon geri gelir
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function askEnd() { confirmEl.classList.add('on'); }
  function endChat() {
    // konuşmayı yerelde sıfırla: bir sonraki açılış temiz başlar
    conv = null; save(null);
    seen = {}; lastTs = '1970-01-01'; status = 'ai'; userMsgCount = 0;
    var rows = bodyEl.querySelectorAll('.ej-row');
    for (var i = 0; i < rows.length; i++) rows[i].parentNode.removeChild(rows[i]);
    welcomeEl.classList.remove('hide');
    applyStatus('ai');
    closePanel();
  }

  function api(action, payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_KEY,
        'Authorization': 'Bearer ' + cfg.SUPABASE_KEY
      },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function (r) { return r.json(); });
  }

  function ensureConv() {
    if (conv && conv.id) return Promise.resolve();
    if (starting) return Promise.resolve();
    starting = true;
    return prefill().then(function (info) {
      return api('start', { name: info.name, email: info.email, user_id: info.user_id, page: location.pathname });
    }).then(function (res) {
      if (res && res.conversation_id) { conv = { id: res.conversation_id, token: res.visitor_token }; save(conv); }
      starting = false;
    }).catch(function () { starting = false; });
  }

  // girişliyse ad/e-posta'yı önceden doldur (operatöre kim olduğunu gösterir)
  function prefill() {
    try {
      if (window.EJData && EJData.auth && EJData.auth.session) {
        return EJData.auth.session().then(function (s) {
          if (s && s.user) {
            var md = s.user.user_metadata || {};
            return { name: md.full_name || null, email: s.user.email || null, user_id: s.user.id };
          }
          return {};
        }).catch(function () { return {}; });
      }
    } catch (e) {}
    return Promise.resolve({});
  }

  function doSend() {
    var text = (textEl.value || '').trim();
    if (!text) return;
    textEl.value = ''; textEl.style.height = 'auto';
    sendText(text);
  }

  function sendText(text) {
    if (!text || sending) return;
    if (!conv) { ensureConv().then(function () { if (conv) sendText(text); }); return; }
    sending = true;
    sendBtn.disabled = true;
    userMsgCount++;
    maybeShowAgent();
    addMsg('user', text, null, null);
    if (status === 'ai') showTyping(true);
    scrollDown();
    api('send', { conversation_id: conv.id, visitor_token: conv.token, text: text })
      .then(function () { sending = false; sendBtn.disabled = false; poll(); })
      .catch(function () {
        sending = false; sendBtn.disabled = false; showTyping(false);
        addMsg('sys', 'Mesaj gönderilemedi, lütfen tekrar deneyin.', null, null);
      });
  }

  // temsilci bağlantısı: birkaç mesajdan sonra ve sadece AI modundayken görünür
  function maybeShowAgent() {
    var show = userMsgCount >= AGENT_AFTER && (status === 'ai' || status === 'closed');
    agentRow.classList.toggle('on', show);
  }

  function requestAgent() {
    if (!conv) { ensureConv().then(function () { if (conv) requestAgent(); }); return; }
    agentRow.classList.remove('on');
    api('request_agent', { conversation_id: conv.id, visitor_token: conv.token }).then(function () { poll(); });
  }

  function poll() {
    if (!conv) return;
    api('poll', { conversation_id: conv.id, visitor_token: conv.token, after: lastTs })
      .then(function (res) {
        if (!res) return;
        if (res.status) applyStatus(res.status);
        (res.messages || []).forEach(function (m) {
          if (seen[m.id]) return;
          seen[m.id] = true;
          if (m.created_at > lastTs) lastTs = m.created_at;
          if (m.role !== 'user') showTyping(false);
          removePendingUser(m);
          addMsg(roleClass(m.role), m.content, m.id, m.created_at);
        });
        scrollDown();
      }).catch(function () {});
  }

  function applyStatus(s) {
    status = s;
    if (s === 'ai') subEl.innerHTML = '<span class="ej-live"></span>Çevrimiçi · anında yanıt';
    else if (s === 'waiting') subEl.innerHTML = 'Temsilciye bağlanılıyor…';
    else if (s === 'live') subEl.innerHTML = '<span class="ej-live"></span>Müşteri temsilcisi · çevrimiçi';
    else if (s === 'closed') subEl.innerHTML = 'Görüşme kapandı';
    maybeShowAgent();
  }

  function roleClass(role) {
    if (role === 'user') return 'user';
    if (role === 'system') return 'sys';
    return 'bot';                      // ai + agent
  }

  // bot mesajının gönderen etiketi (ai/agent ayrı isim)
  function senderName() {
    return status === 'live' ? 'Müşteri Temsilcisi' : BRAND;
  }

  // ---------- render yardımcıları ----------
  function addMsg(cls, text, id, ts) {
    welcomeEl.classList.add('hide');

    var row = document.createElement('div');
    row.className = 'ej-row ' + cls;
    if (cls === 'user' && !id) row.dataset.pending = '1';

    if (cls === 'bot') {
      var name = document.createElement('span');
      name.className = 'ej-name';
      name.textContent = senderName();
      row.appendChild(name);
    }

    var bub = document.createElement('div');
    bub.className = 'ej-bub';
    bub.textContent = text;
    row.appendChild(bub);

    if (cls !== 'sys') {
      var time = document.createElement('span');
      time.className = 'ej-time';
      time.textContent = fmtTime(ts);
      row.appendChild(time);
    }

    bodyEl.insertBefore(row, typingEl);
    scrollDown();
  }
  function removePendingUser(m) {
    if (m.role !== 'user') return;
    var p = bodyEl.querySelector('.ej-row.user[data-pending]');
    if (p && p.querySelector('.ej-bub') && p.querySelector('.ej-bub').textContent === m.content) {
      p.parentNode.removeChild(p);
    }
  }
  function showTyping(on) { typingEl.classList.toggle('on', !!on); if (on) scrollDown(); }
  function scrollDown() { bodyEl.scrollTop = bodyEl.scrollHeight; }

  // ISO/now → "az önce" veya "HH:MM"
  function fmtTime(ts) {
    var d = ts ? new Date(ts) : new Date();
    if (isNaN(d.getTime())) return 'az önce';
    if (Date.now() - d.getTime() < 60000) return 'az önce';
    var h = d.getHours(), mi = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }

  // ---------- localStorage ----------
  function load() { try { return JSON.parse(localStorage.getItem(LSKEY) || 'null'); } catch (e) { return null; } }
  function save(c) {
    try { c ? localStorage.setItem(LSKEY, JSON.stringify(c)) : localStorage.removeItem(LSKEY); } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
})();
