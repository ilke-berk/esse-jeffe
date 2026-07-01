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
  // Uyarlanabilir yoklama (poll): sabit setInterval yerine duruma göre aralık.
  // - Canlı destek/bekleme (operatör her an yazabilir): kısa aralık.
  // - AI modu boşta (senkron yanıt zaten 'send' cevabında gelir; burada yalnız
  //   operatörün sohbeti devralmasını yakalarız): geniş aralık + backoff.
  // - Sekme arka planda ya da panel kapalı: hiç yoklama yok.
  // Böylece çok kullanıcıda gereksiz istek yükü ciddi düşer; backend değişmez.
  var POLL_LIVE_MS = 3500;    // waiting/live: operatör mesajını çabuk al
  var POLL_IDLE_MS = 8000;    // ai modu boşta: yavaş başla
  var POLL_IDLE_MAX = 20000;  // boşta arttıkça bu tavana kadar yavaşla (backoff)
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
  var pollingOn = false;      // uyarlanabilir yoklama döngüsü açık mı
  var pollMisses = 0;         // ard arda yeni mesaj getirmeyen poll (idle backoff)
  var starting = false, sending = false;
  var startErr = null;        // konuşma başlatılamazsa (ör. kota) gösterilecek mesaj
  var sendQueue = [];         // canlı destekte yazılan mesajlar düşmesin diye sıra
  var userMsgCount = 0;       // temsilci bağlantısını ne zaman göstereceğimiz için

  // insan gibi gönderim (AI modu): kullanıcı ard arda yazarsa mesajları HEMEN
  // API'ye göndermeyip birleştir → tek Gemini çağrısı. Daha az maliyet (bot spam'i
  // bile tek konuşmada tek çağrıya iner) + daha doğal akış. Bu pencere içinde yeni
  // mesaj gelirse bekleme sıfırlanır. NOT: gerçek güvenlik sınırı sunucuda olmalı
  // (edge function'da origin kilidi + IP/oturum hız sınırı + günlük konuşma kotası);
  // buradaki birleştirme yalnızca dürüst kullanıcı için maliyet/UX iyileştirmesidir.
  var COALESCE_MS = 1200;
  var burst = [];             // henüz gönderilmemiş kullanıcı satırları
  var burstRow = null;        // bu satırları biriktiren tek 'pending' balon
  var coalesceTimer = null;

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
  '.ej-foot{width:100%;box-sizing:border-box}' +
  '.ej-input{display:flex;align-items:flex-end;gap:10px;padding:12px 14px;width:100%;box-sizing:border-box}' +
  '.ej-input textarea{flex:1 1 auto;width:100%;min-width:0;box-sizing:border-box;min-height:44px;height:44px;border:1px solid var(--line-strong,#d4d4d4);border-radius:22px;padding:11px 16px;font:inherit;font-size:13.5px;line-height:20px;resize:none;max-height:100px;outline:none;background:var(--bg,#fff);color:var(--ink,#1b1a17)}' +
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

  /* kart ödeme katmanı (PayTR güvenli iframe paneli) */
  '.ej-pay{position:absolute;inset:0;background:var(--bg,#fff);z-index:6;display:none;flex-direction:column}' +
  '.ej-pay.on{display:flex;animation:ejFade .2s ease}' +
  '.ej-pay .ej-payhead{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#e8e8e8);flex:0 0 auto}' +
  '.ej-pay .ej-payhead b{font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--ink,#1b1a17)}' +
  '.ej-pay .ej-payback{margin-left:auto;background:none;border:none;color:var(--soft,#56534c);cursor:pointer;padding:6px;line-height:0;border-radius:3px;transition:background .2s,color .2s}' +
  '.ej-pay .ej-payback:hover{color:var(--ink,#1b1a17);background:rgba(0,0,0,.05)}' +
  '.ej-pay .ej-payback svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7}' +
  '.ej-pay .ej-paybody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
  '.ej-pay .ej-payload{padding:26px 20px;text-align:center;color:var(--soft,#56534c);font-size:13px;line-height:1.7}' +
  '.ej-pay iframe{width:100%;border:0;display:block;min-height:560px;background:var(--bg,#fff)}' +

  /* sohbet içi sipariş özet kartı */
  '.ej-row.ej-ordrow{max-width:92%}' +
  '.ej-order{width:100%;background:var(--bg,#fff);border:1px solid var(--line,#e8e8e8);border-radius:14px;border-bottom-left-radius:5px;overflow:hidden}' +
  '.ej-ord-items{display:flex;flex-direction:column}' +
  '.ej-ord-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line,#eee)}' +
  '.ej-ord-thumb{width:46px;height:60px;flex:0 0 auto;border-radius:6px;overflow:hidden;background:var(--bg-warm,#f5f5f5)}' +
  '.ej-ord-thumb img{width:100%;height:100%;object-fit:cover;display:block}' +
  '.ej-ord-meta{flex:1;min-width:0}' +
  '.ej-ord-pname{font-size:13px;font-weight:600;color:var(--ink,#1b1a17);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.ej-ord-pvar{font-size:11px;color:var(--muted,#8c887f);margin-top:3px;letter-spacing:.02em}' +
  '.ej-ord-price{font-size:12.5px;color:var(--ink,#1b1a17);white-space:nowrap;align-self:flex-start;padding-top:1px}' +
  '.ej-ord-ship{padding:12px 14px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--line,#eee)}' +
  '.ej-ord-line{display:flex;gap:9px;align-items:flex-start;font-size:12px;color:var(--soft,#56534c);line-height:1.45}' +
  '.ej-ord-line svg{width:14px;height:14px;flex:0 0 auto;margin-top:1px;fill:none;stroke:var(--muted,#8c887f);stroke-width:1.6}' +
  '.ej-ord-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px}' +
  '.ej-ord-pay{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--soft,#56534c);background:var(--bg-warm,#f5f5f5);padding:5px 11px;border-radius:999px;white-space:nowrap}' +
  '.ej-ord-total{font-size:12px;color:var(--muted,#8c887f)}' +
  '.ej-ord-total b{font-size:14px;color:var(--ink,#1b1a17);font-weight:600;margin-left:5px}' +
  '.ej-ord-confirm{display:block;width:100%;border:none;border-top:1px solid var(--line,#e8e8e8);background:' + INK + ';color:#fff;' +
    'font:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;padding:14px;cursor:pointer;transition:opacity .2s}' +
  '.ej-ord-confirm:hover{opacity:.88}' +
  '.ej-ord-confirm:disabled{opacity:.5;cursor:default}' +

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
    '</div>' +
    '<div class="ej-foot">' +
      '<div class="ej-input">' +
        '<textarea id="ejChatText" rows="1" placeholder="Mesajınızı yazın…"></textarea>' +
        '<button id="ejChatSend" aria-label="Gönder"><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
      '</div>' +
    '</div>' +
    // onay & ödeme katmanları: panelin doğrudan çocuğu (kayan body değil) → her zaman tüm paneli kaplar
    '<div class="ej-confirm" id="ejChatConfirm">' +
      '<p>Görüşmeyi sonlandırmak istediğinize emin misiniz?</p>' +
      '<div class="ej-cbtns">' +
        '<button class="ej-yes" id="ejChatEndYes">Evet</button>' +
        '<button class="ej-no" id="ejChatEndNo">Hayır</button>' +
      '</div>' +
    '</div>' +
    '<div class="ej-pay" id="ejChatPay">' +
      '<div class="ej-payhead">' +
        '<b>Güvenli Kart Ödemesi</b>' +
        '<button class="ej-payback" id="ejChatPayBack" aria-label="Kapat" title="Kapat"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '</div>' +
      '<div class="ej-paybody" id="ejChatPayBody"><div class="ej-payload" id="ejChatPayLoad">Güvenli ödeme ekranı hazırlanıyor…</div></div>' +
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
  var payEl = document.getElementById('ejChatPay');
  var payBodyEl = document.getElementById('ejChatPayBody');

  // ---------- olaylar ----------
  btn.addEventListener('click', openPanel);
  document.getElementById('ejChatMin').addEventListener('click', closePanel);     // küçült: konuşmayı saklar
  document.getElementById('ejChatX').addEventListener('click', askEnd);           // kapat: sonlandırma onayı
  document.getElementById('ejChatEndYes').addEventListener('click', endChat);
  document.getElementById('ejChatEndNo').addEventListener('click', function () { confirmEl.classList.remove('on'); });
  document.getElementById('ejChatPayBack').addEventListener('click', closeCardPayment);
  sendBtn.addEventListener('click', doSend);
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
  // sekme arka plana geçince yoklamayı duraklat; geri gelince hemen bir kez yokla + sürdür
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    } else if (pollingOn) {
      poll().then(function () { if (pollingOn) scheduleNextPoll(); });
    }
  });

  // ---------- akış ----------
  function openPanel() {
    panel.classList.add('open');
    btn.style.display = 'none';           // ikon gizlenir; panel köşeye oturur
    dotEl.style.display = 'none';
    // Konuşma YOKSA otomatik başlatma: karşılama/seçim ekranı görünür kalsın.
    // Konuşma ancak kullanıcı bir çipe tıklayınca ya da mesaj yazınca başlar.
    if (conv && conv.id) { poll(); startPolling(); }
    setTimeout(function () { textEl.focus(); }, 80);
  }
  // uyarlanabilir yoklama: duruma göre bir sonraki aralığı seç (bkz. POLL_* sabitleri)
  function nextPollDelay() {
    if (status === 'waiting' || status === 'live') return POLL_LIVE_MS;
    // AI modu boşta: yeni mesaj geldikçe hızlan, boş döndükçe tavana kadar yavaşla
    return Math.min(POLL_IDLE_MS + pollMisses * 4000, POLL_IDLE_MAX);
  }
  function startPolling() {
    if (pollingOn) return;                // zaten çalışıyor
    pollingOn = true;
    scheduleNextPoll();
  }
  function stopPolling() {
    pollingOn = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }
  function scheduleNextPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    // panel kapalı / sekme arka planda / konuşma yoksa: yoklama yok (istek yükünü kes)
    if (!pollingOn || document.hidden || !conv || !conv.id || !panel.classList.contains('open')) return;
    pollTimer = setTimeout(function () {
      pollTimer = null;
      poll().then(function () { if (pollingOn) scheduleNextPoll(); });
    }, nextPollDelay());
  }
  function closePanel() {
    panel.classList.remove('open');
    confirmEl.classList.remove('on');
    btn.style.display = '';               // ikon geri gelir
    stopPolling();
  }
  function askEnd() { confirmEl.classList.add('on'); }
  function endChat() {
    // konuşmayı yerelde sıfırla: bir sonraki açılış temiz başlar
    closeCardPayment();
    conv = null; save(null);
    seen = {}; lastTs = '1970-01-01'; status = 'ai'; userMsgCount = 0; pollMisses = 0;
    burst = []; burstRow = null; sendQueue = [];
    if (coalesceTimer) { clearTimeout(coalesceTimer); coalesceTimer = null; }
    var rows = bodyEl.querySelectorAll('.ej-row');
    for (var i = 0; i < rows.length; i++) rows[i].parentNode.removeChild(rows[i]);
    welcomeEl.classList.remove('hide');
    applyStatus('ai');
    closePanel();
  }

  function api(action, payload, timeoutMs) {
    // zaman aşımı: istek ağda takılırsa sonsuza dek beklemesin (yoksa sending kilitlenir)
    var ctrl, timer;
    try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
    if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeoutMs || 60000);
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_KEY,
        'Authorization': 'Bearer ' + cfg.SUPABASE_KEY
      },
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function ensureConv() {
    if (conv && conv.id) return Promise.resolve();
    if (starting) return Promise.resolve();
    starting = true;
    startErr = null;
    return prefill().then(function (info) {
      return api('start', { name: info.name, email: info.email, user_id: info.user_id, page: location.pathname });
    }).then(function (res) {
      if (res && res.conversation_id) { conv = { id: res.conversation_id, token: res.visitor_token }; save(conv); }
      else if (res && res.error) { startErr = res.message || 'Sohbet şu an başlatılamadı, lütfen biraz sonra tekrar deneyin.'; }
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
    if (!text) return;
    text = String(text).trim();
    if (!text) return;
    if (!conv) {
      ensureConv().then(function () {
        if (conv) sendText(text);
        else if (startErr) { addMsg('sys', startErr, null, null); scrollDown(); }
      });
      return;
    }
    userMsgCount++;
    maybeShowAgent();

    // Canlı destekte (operatör) AI maliyeti yok → mesajı anında ilet.
    if (status !== 'ai') {
      addMsg('user', text, null, null);   // pending balon; gerçek mesaj poll'da gelince değişir
      scrollDown();
      sendQueue.push(text);
      flushQueue();
      return;
    }

    // AI modu: mesajı HEMEN göster ama API'ye hemen gitme. Kullanıcı kısa arayla
    // yazmaya devam ederse satırlar birleşir ve tek çağrıda gönderilir.
    burst.push(text);
    renderBurst();
    scrollDown();
    scheduleFlush();
  }

  // birikmiş kullanıcı satırlarını tek 'pending' balonda göster (accumulate)
  function renderBurst() {
    welcomeEl.classList.add('hide');
    if (!burstRow) {
      burstRow = document.createElement('div');
      burstRow.className = 'ej-row user';
      burstRow.dataset.pending = '1';
      var bub = document.createElement('div');
      bub.className = 'ej-bub';
      burstRow.appendChild(bub);
      var time = document.createElement('span');
      time.className = 'ej-time';
      time.textContent = fmtTime(null);
      burstRow.appendChild(time);
      bodyEl.insertBefore(burstRow, typingEl);
    }
    burstRow.querySelector('.ej-bub').textContent = burst.join('\n');
  }

  function scheduleFlush() {
    if (coalesceTimer) clearTimeout(coalesceTimer);
    coalesceTimer = setTimeout(flushBurst, COALESCE_MS);
  }

  // biriken mesajları TEK bir 'send' çağrısında gönder (tek Gemini yanıtı)
  function flushBurst() {
    coalesceTimer = null;
    if (!burst.length || !conv) return;
    if (sending) { scheduleFlush(); return; }   // önceki gönderim sürüyorsa biraz daha bekle
    // sunucu ile aynı biçim: trim + 2000 kırpma → pending balon poll'daki gerçekle eşleşsin
    var text = burst.join('\n').trim().slice(0, 2000);
    burst = [];
    var row = burstRow; burstRow = null;        // bu balon commit edildi
    if (row) row.querySelector('.ej-bub').textContent = text;

    sending = true;
    sendBtn.disabled = true;
    showTyping(true);                           // artık gerçekten yanıt bekleniyor
    startPolling();                             // ilk mesajla birlikte polling'i başlat
    api('send', { conversation_id: conv.id, visitor_token: conv.token, text: text })
      .then(function (res) {
        sending = false; sendBtn.disabled = false;
        // sunucu sınırı/hatası (ör. 429 hız sınırı) → yazıyor'u kapat, kısa uyarı göster
        if (res && res.error) {
          showTyping(false);
          addMsg('sys', res.message || 'Şu an yanıt veremiyorum, lütfen biraz sonra tekrar deneyin.', null, null);
          scrollDown();
          return;
        }
        // AI yanıtını göster, ardından sipariş çıktısını işle (kartta PayTR ekranı açılır)
        return poll().then(function () { handleOrder(res && res.order); });
      })
      .then(function () { if (burst.length) scheduleFlush(); })   // bu sırada yeni yazıldıysa
      .catch(function () {
        sending = false; sendBtn.disabled = false; showTyping(false);
        addMsg('sys', 'Mesaj gönderilemedi, lütfen tekrar deneyin.', null, null);
        if (burst.length) scheduleFlush();
      });
  }

  // canlı destek: sıradaki mesajı tek tek operatöre iletir (AI çağrısı yok)
  function flushQueue() {
    if (sending || !conv || !sendQueue.length) return;
    startPolling();                       // ilk mesajla birlikte polling'i başlat
    sending = true;
    sendBtn.disabled = true;
    var text = sendQueue.shift();
    api('send', { conversation_id: conv.id, visitor_token: conv.token, text: text })
      .then(function (res) {
        sending = false; sendBtn.disabled = false;
        // AI yanıtını göster, ardından sipariş çıktısını işle (kartta PayTR ekranı açılır)
        return poll().then(function () { handleOrder(res && res.order); });
      })
      .then(function () { flushQueue(); })  // sırada bekleyen varsa devam et
      .catch(function () {
        sending = false; sendBtn.disabled = false; showTyping(false);
        addMsg('sys', 'Mesaj gönderilemedi, lütfen tekrar deneyin.', null, null);
        flushQueue();                       // kalan mesajlar kilitlenmesin
      });
  }

  // temsilci bağlantısı kaldırıldı (alt çubuk sadeleştirildi); güvenli no-op
  function maybeShowAgent() {
    if (!agentRow) return;
    var show = userMsgCount >= AGENT_AFTER && (status === 'ai' || status === 'closed');
    agentRow.classList.toggle('on', show);
  }

  function requestAgent() {
    if (!conv) { ensureConv().then(function () { if (conv) requestAgent(); }); return; }
    agentRow.classList.remove('on');
    api('request_agent', { conversation_id: conv.id, visitor_token: conv.token }).then(function () { poll(); });
  }

  // ---------- sohbette sipariş ----------
  // send yanıtındaki order: kapıda ödemede {mode:'cod',...} (zaten oluşturuldu),
  // kartta {mode:'card',items,form,total} → PayTR güvenli ödeme ekranını aç.
  function handleOrder(order) {
    if (!order) return;
    if (order.mode === 'summary') renderOrderCard(order);   // onay öncesi görsel özet kartı
    else if (order.mode === 'card') openCardPayment(order);
    // cod: AI yanıtı sipariş numarasını ve özeti zaten içeriyor
  }

  // para biçimi: 2400 → "2.400 TL"
  function money(n) { return (Number(n) || 0).toLocaleString('tr-TR') + ' TL'; }

  var ICON_USER = '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  var ICON_PHONE = '<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var ICON_PIN = '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  // sohbet içinde minimal sipariş özet kartı (ürün görseli + teslimat + toplam + onay)
  function renderOrderCard(order) {
    welcomeEl.classList.add('hide');
    showTyping(false);
    var f = order.form || {};
    var items = order.items || [];

    var itemsHTML = items.map(function (it) {
      var v = [];
      if (it.color) v.push(esc(it.color));
      if (it.size) v.push(esc(it.size));
      v.push((it.qty || 1) + ' adet');
      var line = (it.line_total != null) ? it.line_total : (it.unit_price || 0) * (it.qty || 1);
      var thumb = it.image
        ? '<img src="' + esc(it.image) + '" alt="' + esc(it.name) + '" loading="lazy">'
        : '';
      return '<div class="ej-ord-item">' +
        '<div class="ej-ord-thumb">' + thumb + '</div>' +
        '<div class="ej-ord-meta"><div class="ej-ord-pname">' + esc(it.name) + '</div>' +
          '<div class="ej-ord-pvar">' + v.join(' · ') + '</div></div>' +
        '<div class="ej-ord-price">' + money(line) + '</div>' +
      '</div>';
    }).join('');

    var addr = [];
    if (f.address) addr.push(esc(f.address));
    var dc = [f.district, f.city].filter(Boolean).map(esc).join(' / ');
    if (dc) addr.push(dc);
    var addrTxt = addr.join(', ');
    var payTxt = order.payment_method === 'card' ? 'Kredi / Banka Kartı' : 'Kapıda Ödeme';

    var row = document.createElement('div');
    row.className = 'ej-row bot ej-ordrow';
    row.innerHTML =
      '<span class="ej-name">' + esc(senderName()) + '</span>' +
      '<div class="ej-order">' +
        '<div class="ej-ord-items">' + itemsHTML + '</div>' +
        '<div class="ej-ord-ship">' +
          (f.full_name ? '<div class="ej-ord-line">' + ICON_USER + '<span>' + esc(f.full_name) + '</span></div>' : '') +
          (f.phone ? '<div class="ej-ord-line">' + ICON_PHONE + '<span>' + esc(f.phone) + '</span></div>' : '') +
          (addrTxt ? '<div class="ej-ord-line">' + ICON_PIN + '<span>' + addrTxt + '</span></div>' : '') +
        '</div>' +
        '<div class="ej-ord-foot">' +
          '<span class="ej-ord-pay">' + payTxt + '</span>' +
          '<span class="ej-ord-total">Toplam<b>' + money(order.total) + '</b></span>' +
        '</div>' +
        '<button type="button" class="ej-ord-confirm">Siparişi Onayla</button>' +
      '</div>';

    bodyEl.insertBefore(row, typingEl);
    var cbtn = row.querySelector('.ej-ord-confirm');
    cbtn.addEventListener('click', function () {
      if (cbtn.disabled) return;
      cbtn.disabled = true;
      cbtn.textContent = 'Onaylandı';
      sendText('Siparişi onaylıyorum.');
    });
    scrollDown();
  }

  // girişliyse kullanıcı JWT'si (sipariş hesaba bağlansın), değilse anon key
  function getAuthToken() {
    try {
      if (window.EJData && EJData.auth && EJData.auth.session) {
        return EJData.auth.session().then(function (s) {
          return (s && s.access_token) ? s.access_token : cfg.SUPABASE_KEY;
        }).catch(function () { return cfg.SUPABASE_KEY; });
      }
    } catch (e) {}
    return Promise.resolve(cfg.SUPABASE_KEY);
  }

  // kart ödemesi: mevcut paytr-token fonksiyonu siparişi (pending) oluşturur + token döner
  function openCardPayment(order) {
    payEl.classList.add('on');
    payBodyEl.innerHTML = '<div class="ej-payload">Güvenli ödeme ekranı hazırlanıyor…</div>';
    var TOKEN_URL = cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/paytr-token';
    getAuthToken().then(function (bearer) {
      return fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.SUPABASE_KEY,
          'Authorization': 'Bearer ' + bearer
        },
        body: JSON.stringify({ form: order.form, items: order.items, origin: location.origin })
      });
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d && d.token) { showPaytrIframe(d.token); }
        else {
          closeCardPayment();
          addMsg('sys', (d && d.error) ? d.error : 'Kart ödeme ekranı şu an açılamadı. Kapıda ödeme ile devam edebilir ya da temsilciye bağlanabilirsiniz.', null, null);
        }
      })
      .catch(function () {
        closeCardPayment();
        addMsg('sys', 'Ödeme ekranına ulaşılamadı, lütfen tekrar deneyin.', null, null);
      });
  }

  function showPaytrIframe(token) {
    payBodyEl.innerHTML = '';
    var ifr = document.createElement('iframe');
    ifr.id = 'ejPaytrIframe';
    ifr.setAttribute('frameborder', '0');
    ifr.setAttribute('scrolling', 'no');
    ifr.src = 'https://www.paytr.com/odeme/guvenli/' + token;   // ödeme bitince sepet.html?paytr=ok'a döner (üst pencere taşınır)
    payBodyEl.appendChild(ifr);
    function size() { try { window.iFrameResize({}, '#ejPaytrIframe'); } catch (e) {} }
    if (window.iFrameResize) { size(); }
    else {
      var s = document.createElement('script');
      s.src = 'https://www.paytr.com/js/iframeResizer.min.js';
      s.onload = size;
      document.body.appendChild(s);
    }
  }

  function closeCardPayment() {
    if (!payEl) return;
    payEl.classList.remove('on');
    payBodyEl.innerHTML = '<div class="ej-payload">Güvenli ödeme ekranı hazırlanıyor…</div>';
  }

  function poll() {
    if (!conv) return Promise.resolve();
    return api('poll', { conversation_id: conv.id, visitor_token: conv.token, after: lastTs })
      .then(function (res) {
        if (!res) return;
        if (res.status) applyStatus(res.status);
        var stick = nearBottom();   // kullanıcı zaten en alttaysa takip et; yukarı kaydırdıysa rahat bırak
        var added = false;
        (res.messages || []).forEach(function (m) {
          if (seen[m.id]) return;
          seen[m.id] = true;
          added = true;
          if (m.created_at > lastTs) lastTs = m.created_at;
          if (m.role !== 'user') showTyping(false);
          removePendingUser(m);
          addMsg(roleClass(m.role), m.content, m.id, m.created_at);
        });
        if (added && stick) scrollDown();   // yalnız yeni mesaj VARSA ve alttaydıysa kaydır
        pollMisses = added ? 0 : pollMisses + 1;   // idle backoff sayacı (yeni mesajda sıfırla)
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
    // not: otomatik kaydırmayı çağıran karar verir (poll: yalnız alttaysa; gönderim: her zaman)
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
  // kullanıcı en altta mı (≈)? yukarı kaydırıp geçmişi okurken otomatik kaydırmayı engellemek için
  function nearBottom() { return (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight) < 90; }

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
