/* Beden Asistanı — boy/kilo (+ opsiyonel göğüs/bel/basen) → beden önerisi.
   Tamamen frontend; eşikler sitedeki kilo ve ölçü tablolarıyla aynı.
   Kullanım: EJBeden.mount(el, {highlight:'.sg-table', onPick:fn})
   veya <div data-beden-asistani data-highlight=".size-table"></div> (otomatik). */
(function(){
'use strict';

var SIZES = ['S','M','L','XL','2XL','3XL'];
/* üst sınırlar (dahil) — beden-rehberi kilo tablosu (164 cm referans) ve
   urun.html ölçü tablosu (cm) ile birebir aynı */
var KILO  = [55, 61, 66, 72, 80, 90];
var GOGUS = [88, 92, 96, 100, 106, 114];
var BEL   = [70, 74, 78, 82, 88, 96];
var BASEN = [96, 100, 104, 108, 114, 122];
var REF_BOY = 164;          // kilo tablosunun referans boyu
var WHATSAPP = 'https://api.whatsapp.com/send?phone=%2B908502551237';

function idxFor(val, bounds){
  for(var i=0;i<bounds.length;i++) if(val <= bounds[i]) return i;
  return -1;                // tüm bedenlerin üstünde
}

/* {boy,kilo,gogus,bel,basen} → {size, notes:[...]} | {out:true} */
function recommend(m){
  var notes = [], out = false;

  /* kilo → beden; boy referanstan saptıkça kiloyu normalize et
     (aynı kiloda kısa boy daha geniş bedene denk gelir) */
  var boy = m.boy || REF_BOY;
  var adj = m.kilo + (REF_BOY - boy) * 0.25;
  if(adj > KILO[KILO.length-1]) out = true;
  var wIdx = idxFor(adj, KILO);
  if(wIdx === 0 && m.kilo < 50) notes.push('S, en küçük bedenimizdir; kalıbınıza göre bol gelebilir.');

  /* sınıra 1 kg'dan yakınsa üst beden — kalıbımız çok hafif dar kesim.
     Katı eşitsizlik: tablodaki üst sınırın tam 1 kg altı hâlâ kendi bedeninde
     kalır ki öneri, hemen altındaki görünen tabloyla çelişmesin. */
  if(wIdx >= 0 && wIdx < SIZES.length-1 && adj > KILO[wIdx] - 1){
    wIdx++;
    notes.push('İki beden arasındasınız; kalıbımız hafif dar kesim olduğundan üst bedeni önerdik.');
  }
  if(m.boy && Math.abs(m.boy - REF_BOY) >= 6){
    notes.push('Tablomuz ' + REF_BOY + ' cm boy referanslıdır; öneri boyunuza göre ayarlandı.');
  }

  /* ölçü girildiyse her ölçünün sığdığı en küçük bedeni bul, en büyüğünü esas al */
  var best = wIdx, measured = false;
  [[m.gogus, GOGUS], [m.bel, BEL], [m.basen, BASEN]].forEach(function(pair){
    if(!pair[0]) return;
    measured = true;
    var i = idxFor(pair[0], pair[1]);
    if(i === -1) out = true;
    else if(i > best) best = i;
  });
  if(out) return {out:true};
  if(measured && best > wIdx){
    notes.push('Ölçüleriniz kilo tablosundan bir adım büyük bedene işaret ediyor; ölçünüzü esas aldık.');
  }
  return {size: SIZES[best], notes: notes};
}

/* ---- görünüm ---- */
var CSS =
'.ba{border:1px solid var(--line);background:var(--bg-warm);padding:24px 24px 26px;margin-bottom:28px}' +
'.ba-title{font-family:var(--serif);font-weight:400;font-size:19px;letter-spacing:.01em;color:var(--ink);margin:0 0 6px}' +
'.ba-sub{font-size:13px;color:var(--soft);line-height:1.7;margin:0 0 18px}' +
'.ba-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
'.ba-grid.ba-measures{grid-template-columns:1fr 1fr 1fr;margin-top:12px}' +
'.ba-grid.ba-measures[hidden]{display:none}' +
'.ba label{display:flex;flex-direction:column;gap:6px;font-family:var(--sans);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}' +
'.ba input{font-family:var(--sans);font-size:14px;letter-spacing:.03em;color:var(--ink);background:var(--bg);border:1px solid var(--line-strong);padding:11px 12px;width:100%;border-radius:0;-moz-appearance:textfield}' +
'.ba input::-webkit-outer-spin-button,.ba input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}' +
'.ba input:focus{outline:none;border-color:var(--ink)}' +
'.ba-toggle{background:none;border:none;padding:0;margin-top:14px;font-family:var(--sans);font-size:11px;letter-spacing:.1em;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}' +
'.ba-toggle:hover{color:var(--ink)}' +
'.ba-btn{display:block;width:100%;margin-top:18px;padding:14px;background:var(--ink);color:var(--bg);border:1px solid var(--ink);font-family:var(--sans);font-size:11px;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:opacity .2s}' +
'.ba-btn:hover{opacity:.85}' +
'.ba-result{margin-top:18px;border-top:1px solid var(--line);padding-top:18px}' +
'.ba-error{font-size:13px;color:#6e2c2c;margin:0}' +
'.ba-size-row{display:flex;align-items:center;gap:16px}' +
'.ba-size{font-family:var(--serif);font-size:44px;font-weight:500;letter-spacing:.04em;color:var(--ink);line-height:1}' +
'.ba-size-cap{font-family:var(--sans);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}' +
'.ba-note{font-size:12.5px;color:var(--soft);line-height:1.65;margin:10px 0 0}' +
'.ba-pick{display:inline-block;margin-top:14px;padding:11px 22px;background:none;border:1px solid var(--ink);color:var(--ink);font-family:var(--sans);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:background .2s,color .2s}' +
'.ba-pick:hover{background:var(--ink);color:var(--bg)}' +
'.ba-wa{display:inline-block;margin-top:10px;font-family:var(--sans);font-size:12px;letter-spacing:.06em;color:var(--ink);text-decoration:underline;text-underline-offset:3px}' +
'tr.ba-hl td{background:var(--bg-warm)!important;font-weight:500}' +
'@media(max-width:480px){.ba-grid.ba-measures{grid-template-columns:1fr 1fr}}';

function injectCSS(){
  if(document.getElementById('baCss')) return;
  var s = document.createElement('style');
  s.id = 'baCss';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function num(input, min, max){
  var v = parseFloat(String(input.value).replace(',', '.'));
  if(isNaN(v) || v < min || v > max) return null;
  return v;
}

function mount(el, opts){
  opts = opts || {};
  injectCSS();
  el.innerHTML =
    '<div class="ba">' +
      '<p class="ba-title">Beden Asistanı</p>' +
      '<p class="ba-sub">Boy ve kilonuzu girin, size uygun bedeni önerelim. Ölçülerinizi de eklerseniz öneri daha isabetli olur.</p>' +
      '<div class="ba-grid">' +
        '<label>Boy (cm)<input type="number" inputmode="decimal" min="140" max="200" placeholder="örn. 164" data-ba="boy"></label>' +
        '<label>Kilo (kg)<input type="number" inputmode="decimal" min="40" max="130" placeholder="örn. 60" data-ba="kilo"></label>' +
      '</div>' +
      '<button class="ba-toggle" type="button">+ Göğüs / bel / basen ölçümü de gireceğim</button>' +
      '<div class="ba-grid ba-measures" hidden>' +
        '<label>Göğüs (cm)<input type="number" inputmode="decimal" min="70" max="140" data-ba="gogus"></label>' +
        '<label>Bel (cm)<input type="number" inputmode="decimal" min="50" max="120" data-ba="bel"></label>' +
        '<label>Basen (cm)<input type="number" inputmode="decimal" min="80" max="140" data-ba="basen"></label>' +
      '</div>' +
      '<button class="ba-btn" type="button">Bedenimi Bul</button>' +
      '<div class="ba-result" hidden aria-live="polite"></div>' +
    '</div>';

  var q = function(sel){ return el.querySelector(sel); };
  var result = q('.ba-result');
  var measures = q('.ba-measures');

  q('.ba-toggle').addEventListener('click', function(){
    measures.hidden = !measures.hidden;
    this.textContent = measures.hidden ? '+ Göğüs / bel / basen ölçümü de gireceğim'
                                       : '− Ölçüleri gizle';
  });

  function highlight(size){
    if(!opts.highlight) return;
    document.querySelectorAll(opts.highlight + ' tbody tr').forEach(function(tr){
      var cells = tr.querySelectorAll('td');
      var hit = Array.prototype.some.call(cells, function(td){
        return td.textContent.trim() === size;
      });
      tr.classList.toggle('ba-hl', hit);
    });
  }

  function run(){
    var boy   = num(q('[data-ba=boy]'),   140, 200);
    var kilo  = num(q('[data-ba=kilo]'),   40, 130);
    var gogus = measures.hidden ? null : num(q('[data-ba=gogus]'), 70, 140);
    var bel   = measures.hidden ? null : num(q('[data-ba=bel]'),   50, 120);
    var basen = measures.hidden ? null : num(q('[data-ba=basen]'), 80, 140);

    result.hidden = false;
    if(kilo === null){
      result.innerHTML = '<p class="ba-error">Lütfen kilonuzu girin (40–130 kg).</p>';
      highlight('');
      return;
    }
    var r = recommend({boy:boy, kilo:kilo, gogus:gogus, bel:bel, basen:basen});
    if(r.out){
      result.innerHTML =
        '<p class="ba-note" style="margin-top:0">Girdiğiniz değerler standart tablomuzun dışında görünüyor. ' +
        'WhatsApp\'tan yazın, doğru bedeni birlikte bulalım.</p>' +
        '<a class="ba-wa" href="' + WHATSAPP + '">WhatsApp\'tan Sor →</a>';
      highlight('');
      return;
    }
    var html =
      '<div class="ba-size-row"><span class="ba-size">' + r.size + '</span>' +
      '<span class="ba-size-cap">Önerilen<br>Beden</span></div>';
    r.notes.forEach(function(n){ html += '<p class="ba-note">' + n + '</p>'; });
    if(opts.onPick) html += '<button class="ba-pick" type="button">Bu Bedeni Seç</button>';
    result.innerHTML = html;
    highlight(r.size);
    var pick = result.querySelector('.ba-pick');
    if(pick) pick.addEventListener('click', function(){ opts.onPick(r.size); });
  }

  q('.ba-btn').addEventListener('click', run);
  el.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && e.target.matches('.ba input')){ e.preventDefault(); run(); }
  });
}

window.EJBeden = {mount: mount, recommend: recommend};

/* data-beden-asistani olan kapları otomatik kur */
document.querySelectorAll('[data-beden-asistani]').forEach(function(el){
  mount(el, {highlight: el.getAttribute('data-highlight') || null});
});
})();
