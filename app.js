/* FrigoScan — application (PWA) */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------- Catégories ---------- */
const CATS = {
  hache:{label:'Viande hachée',prio:1,est:1}, volaille:{label:'Volaille fraîche',prio:1,est:2},
  viande:{label:'Viande fraîche',prio:1,est:3}, poisson:{label:'Poisson & fruits de mer',prio:1,est:1},
  charcuterie:{label:'Charcuterie tranchée',prio:1,est:5}, plat:{label:'Plats, sandwichs, salades préparés',prio:1,est:2},
  lait:{label:'Lait & crème frais',prio:1,est:7}, yaourt:{label:'Yaourts & desserts frais',prio:1,est:14},
  fromage:{label:'Fromages frais',prio:1,est:7}, pates:{label:'Pâtes fraîches',prio:1,est:10},
  legumes:{label:'Légumes découpés, fruits fragiles',prio:2,est:3}, pain:{label:'Pain & viennoiseries',prio:2,est:3},
  autre:{label:'Autre produit frais',prio:2,est:5}, sec:{label:'Épicerie sèche (pâtes, chips…)',prio:3,est:null}
};
const catOptions = sel => Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(c.label)}</option>`).join('');

/* ---------- Catalogue (démo + produits déjà scannés) ---------- */
const CATALOG = {};
[['540999000101','Filet de poulet','volaille'],['540999000102','Haché porc-bœuf 500 g','hache'],
 ['540999000103','Filet de saumon','poisson'],['540999000104','Jambon cuit tranché','charcuterie'],
 ['540999000105','Lait demi-écrémé frais 1 L','lait'],['540999000106','Yaourt nature 4×125 g','yaourt'],
 ['540999000107','Mozzarella 125 g','fromage'],['540999000108','Lasagne bolognaise traiteur','plat'],
 ['540999000109','Tortellini ricotta-épinards','pates'],['540999000110','Spaghetti 500 g','sec'],
 ['540999000111','Chips paprika','sec']
].forEach(([b, name, cat]) => { const g = GS1.withCheckDigit(b); CATALOG[g.padStart(14,'0')] = {name, cat, ean:g}; });
const byName = n => Object.values(CATALOG).find(p => p.name === n);
// Les produits que l'utilisateur a nommés une fois sont reconnus au scan suivant
const known = store.get('frigoscan.known', {});
const lookupProduct = gtin => gtin ? (known[gtin] || CATALOG[gtin] || null) : null;

/* ---------- Dates ---------- */
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fromIso = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const daysLeft = s => Math.round((fromIso(s) - today()) / 864e5);
const yymmdd = d => iso(d).slice(2).replace(/-/g,'');
const fmt = s => fromIso(s).toLocaleDateString('fr-BE', {weekday:'short', day:'numeric', month:'short'});
const settings = Object.assign({lead:2, hour:17, apiKey:''}, store.get('frigoscan.settings', {}));
const saveSettings = () => store.set('frigoscan.settings', settings);
const reminderOf = s => { const r = addDays(fromIso(s), -settings.lead); return r < today() ? today() : r; };
function status(it) {
  const n = daysLeft(it.date);
  if (n < 0) return {cls:'c-bad', txt: n === -1 ? 'dépassé hier' : `dépassé ${-n} j`};
  if (n === 0) return {cls:'c-bad', txt:"aujourd'hui"};
  if (n === 1) return {cls:'c-bad', txt:'demain'};
  if (n <= 3) return {cls:'c-warn', txt:`dans ${n} j`};
  return {cls:'c-ok', txt:`dans ${n} j`};
}

/* ---------- Frigo ---------- */
const KEY = 'frigoscan.items';
let items = store.get(KEY, null);
if (!items) {
  const t = today();
  items = [
    {name:'Jambon cuit tranché', cat:'charcuterie', date:iso(addDays(t,1)), type:'DLC', source:'exemple', example:true},
    {name:'Lait demi-écrémé frais 1 L', cat:'lait', date:iso(addDays(t,3)), type:'DLC', source:'exemple', example:true}
  ].map(x => ({...x, id: Math.random().toString(36).slice(2)}));
}
const save = () => store.set(KEY, items);
const SRC = {exemple:'exemple', caisse:'QR lu en caisse', 'scan-qr':'scan QR GS1', 'scan-ean':'scan EAN', 'photo-ia':'date lue par IA', manuel:'saisie manuelle'};
const isPicked = it => it.pick ?? (daysLeft(it.date) >= 0 && daysLeft(it.date) <= 3);

function gcalLink(it) {
  const r = reminderOf(it.date), d = x => iso(x).replace(/-/g,'');
  const text = `${it.name} : à consommer avant le ${fmt(it.date)}`;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(text) +
    '&dates=' + d(r) + '/' + d(addDays(r, 1)) + '&details=' + encodeURIComponent('Rappel FrigoScan');
}

let recipeGen = 0;
function render(newIds = []) {
  recipeGen++; $('#recipes').innerHTML = '';
  items.sort((a, b) => a.date.localeCompare(b.date));
  const ul = $('#fridge');
  ul.innerHTML = !items.length
    ? '<li class="empty" style="display:block">Le frigo est vide. Scannez un produit pour commencer.</li>'
    : items.map(it => {
      const st = status(it);
      return `<li class="${newIds.includes(it.id) ? 'new' : ''}">
        <div class="lead"><input type="checkbox" class="pick" data-pick="${it.id}" ${isPicked(it) ? 'checked' : ''} aria-label="Utiliser ${esc(it.name)} pour les recettes"><span class="chip ${st.cls}">${st.txt}</span></div>
        <div style="min-width:0"><div class="item-name">${esc(it.name)}${it.example ? '<span class="tag-ex">exemple</span>' : ''}</div>
          <div class="item-meta"><span>${it.type === 'DDM' ? 'De préférence avant' : it.type === 'estimé' ? 'Estimé au' : 'Jusqu’au'} ${fmt(it.date)}</span>
          <span>Rappel ${fmt(iso(reminderOf(it.date)))}</span><span class="src">${esc(SRC[it.source] || it.source)}${it.lot ? ' · lot ' + esc(it.lot) : ''}</span></div>
          <div class="item-side"><a href="${gcalLink(it)}" target="_blank" rel="noopener">+ Agenda</a>
          <button data-del="${it.id}" aria-label="Retirer ${esc(it.name)}">Retirer</button></div></div></li>`;
    }).join('');
  const c = {bad:0, warn:0, ok:0};
  items.forEach(it => { const n = daysLeft(it.date); if (n <= 1) c.bad++; else if (n <= 3) c.warn++; else c.ok++; });
  $('#tally').innerHTML = `<div class="t-bad"><b>${c.bad}</b><span>aujourd'hui ou demain</span></div>
    <div class="t-warn"><b>${c.warn}</b><span>dans les 3 jours</span></div><div class="t-ok"><b>${c.ok}</b><span>tranquilles</span></div>`;
  const badge = $('#badge'); badge.hidden = !c.bad; badge.textContent = c.bad;
  try { if (navigator.setAppBadge) c.bad ? navigator.setAppBadge(c.bad) : navigator.clearAppBadge(); } catch (e) {}
  updateRecipeBtn();
}
function addItem(it) { const x = {...it, id: Math.random().toString(36).slice(2)}; items.push(x); save(); return x.id; }

$('#fridge').addEventListener('change', e => {
  const id = e.target.dataset?.pick; if (!id) return;
  const it = items.find(i => i.id === id); if (it) { it.pick = e.target.checked; save(); updateRecipeBtn(); }
});
$('#fridge').addEventListener('click', e => {
  const id = e.target.closest('[data-del]')?.dataset.del; if (!id) return;
  items = items.filter(i => i.id !== id); save(); render();
});
let clearArmed = false;
$('#btn-clear').addEventListener('click', e => {
  if (!clearArmed) { clearArmed = true; e.target.textContent = 'Appuyer encore pour confirmer'; setTimeout(() => { clearArmed = false; e.target.textContent = 'Vider le frigo'; }, 3000); return; }
  items = []; save(); render(); clearArmed = false; e.target.textContent = 'Vider le frigo'; toast('Frigo vidé');
});

/* ---------- Rappels : fichier calendrier avec alarmes ---------- */
$('#btn-ics').addEventListener('click', async () => {
  const list = items.filter(it => daysLeft(it.date) >= 0);
  if (!list.length) { toast('Aucun produit à rappeler'); return; }
  const pad = n => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const escI = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ev = list.map(it => {
    const r = reminderOf(it.date); const dt = iso(r).replace(/-/g, '') + 'T' + pad(settings.hour) + '0000';
    return ['BEGIN:VEVENT', `UID:${it.id}@frigoscan`, `DTSTAMP:${stamp}`, `DTSTART:${dt}`, 'DURATION:PT15M',
      `SUMMARY:${escI(it.name + ' : à consommer avant le ' + fmt(it.date))}`,
      `DESCRIPTION:${escI('Rappel FrigoScan. Date ' + (it.type === 'estimé' ? 'estimée' : 'lue sur le produit') + ' : ' + it.date)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${escI(it.name + ' expire bientôt')}`, 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FrigoScan//FR', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
  const file = new File([ics], 'frigoscan-rappels.ics', {type:'text/calendar'});
  try {
    if (navigator.canShare && navigator.canShare({files:[file]}) && /Android/i.test(navigator.userAgent)) { await navigator.share({files:[file], title:'Rappels FrigoScan'}); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = 'frigoscan-rappels.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`${list.length} rappel${list.length > 1 ? 's' : ''} : ouvrez le fichier pour l'ajouter au calendrier`);
});

/* ---------- Navigation ---------- */
const views = {frigo:'#v-frigo', scan:'#v-scan', demo:'#v-demo', set:'#v-set'};
function go(v) {
  Object.entries(views).forEach(([k, sel]) => { $(sel).hidden = k !== v; });
  document.querySelectorAll('nav.tabs button').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (v !== 'scan') stopCam();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));

/* ---------- Caméra : scan en continu ---------- */
let stream = null, scanning = false, lastTry = 0;
const video = $('#video');
const hasDetector = 'BarcodeDetector' in window;
let detector = null;
if (hasDetector) { try { detector = new BarcodeDetector({formats:['qr_code','data_matrix','ean_13','ean_8','upc_a','code_128']}); } catch (e) { detector = null; } }
const zxReader = (() => {
  if (!window.ZXing) return null;
  const F = ZXing.BarcodeFormat, hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.QR_CODE, F.DATA_MATRIX, F.EAN_13, F.EAN_8, F.UPC_A, F.CODE_128]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const r = new ZXing.MultiFormatReader(); r.setHints(hints); return r;
})();
const canvas = document.createElement('canvas');
function zxDecodeCanvas(c) {
  if (!zxReader) return null;
  try { return zxReader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c)))).getText(); }
  catch (e) { return null; } finally { try { zxReader.reset(); } catch (e) {} }
}

async function startCam() {
  $('#out').innerHTML = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false});
  } catch (e) {
    $('#cam-msg').textContent = 'Caméra refusée. Autorisez-la dans les réglages du téléphone, ou choisissez une photo.';
    return;
  }
  video.srcObject = stream; await video.play().catch(() => {});
  $('#cam-start').hidden = true; $('#frame').hidden = false; $('#cam-msg').textContent = 'Visez le code dans le cadre';
  scanning = true; requestAnimationFrame(tick);
}
function stopCam() {
  scanning = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null; $('#cam-start').hidden = false; $('#frame').hidden = true; $('#cam-msg').textContent = '';
}
async function tick(t) {
  if (!scanning) return;
  if (t - lastTry > 280 && video.readyState >= 2) {
    lastTry = t;
    let text = null;
    if (detector) { try { const r = await detector.detect(video); if (r[0]) text = r[0].rawValue; } catch (e) {} }
    else {
      // zone centrale de l'image, réduite pour aller vite
      const vw = video.videoWidth, vh = video.videoHeight;
      const cw = Math.round(vw * 0.8), ch = Math.round(vh * 0.6);
      const s = Math.min(1, 900 / cw);
      canvas.width = Math.round(cw * s); canvas.height = Math.round(ch * s);
      canvas.getContext('2d', {willReadFrequently:true}).drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
      text = zxDecodeCanvas(canvas);
    }
    if (text && scanning) {
      try { navigator.vibrate && navigator.vibrate(60); } catch (e) {}
      const shot = await grabFrame();
      stopCam(); handleCode(text, shot); return;
    }
  }
  requestAnimationFrame(tick);
}
function grabFrame() {
  return new Promise(res => {
    try {
      const c = document.createElement('canvas'); const s = Math.min(1, 1400 / Math.max(video.videoWidth, video.videoHeight));
      c.width = Math.round(video.videoWidth * s); c.height = Math.round(video.videoHeight * s);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); c.toBlob(b => res(b), 'image/jpeg', 0.85);
    } catch (e) { res(null); }
  });
}
$('#btn-cam').addEventListener('click', startCam);

/* Photo depuis la galerie */
$('#btn-photo').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  stopCam();
  $('#out').innerHTML = '<p class="note"><span class="spinner"></span> Lecture du code…</p>';
  let text = null;
  try {
    const bmp = await createImageBitmap(f);
    if (detector) { try { const r = await detector.detect(bmp); if (r[0]) text = r[0].rawValue; } catch (err) {} }
    for (const max of [1400, 900, 2000]) {
      if (text) break;
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); text = zxDecodeCanvas(c);
    }
  } catch (err) {}
  if (text) handleCode(text, f); else showNoCode(f);
});
$('#paste-form').addEventListener('submit', e => { e.preventDefault(); const v = $('#paste').value.trim(); if (v) { stopCam(); handleCode(v.replace(/<GS>|\\x1d|\|/gi, GS1.GS), null); } });
$('#btn-manual').addEventListener('click', () => { stopCam(); showForm({r:{ok:true, fields:[], dates:{}}, prod:null, photo:null, manual:true}); });

/* ---------- Résultat d'un scan ---------- */
function handleCode(text, photo) {
  const r = GS1.parse(text);
  if (!r.ok) {
    $('#out').innerHTML = `<div class="decode"><div class="decode-head"><span class="eyebrow">${esc(r.format)}</span></div><div class="verdict">${esc(r.message || 'Ce code n’identifie pas un produit.')}</div></div>`;
    return;
  }
  showForm({r, prod: lookupProduct(r.gtin), photo});
}
function showForm({r, prod, photo, manual}) {
  const rows = r.fields.map(f => {
    const isDate = ['11','13','15','16','17'].includes(f.ai);
    const v = isDate && r.dates[f.ai] ? `${esc(f.value)} → <b>${fmt(r.dates[f.ai])}</b>` : esc(f.value);
    return `<tr class="${f.ai === '17' || f.ai === '15' ? 'hit' : ''}"><td>(${esc(f.ai)})</td><td>${esc(f.label)} : ${v}</td></tr>`;
  }).join('');
  let verdict = '';
  if (manual) verdict = '';
  else if (r.expiry) verdict = `<div class="verdict"><b>Date trouvée dans le code.</b> ${r.expiryType === 'DLC' ? 'À consommer jusqu’au' : r.expiryType === 'DDM' ? 'De préférence avant le' : 'Vente jusqu’au'} ${fmt(r.expiry)}, rien à saisir.</div>`;
  else if (/magasin/.test(r.format)) verdict = `<div class="verdict">Étiquette magasin à poids variable : article et prix, pas de date. Indiquez la date imprimée.</div>`;
  else verdict = `<div class="verdict">Code-barres classique : il identifie le produit, pas la date. ${settings.apiKey && photo ? 'L’IA peut lire la date sur la photo.' : 'Indiquez la date imprimée sur l’emballage.'}</div>`;
  const cat = prod ? prod.cat : 'autre';
  const low = CATS[cat].prio === 3;
  const date = r.expiry || iso(addDays(today(), CATS[cat].est ?? 30));
  $('#out').innerHTML = `<div class="decode">
    ${manual ? '' : `<div class="decode-head"><span class="eyebrow">${esc(r.format)}</span>${r.gtin ? `<span class="mono">GTIN ${esc(r.gtin)}</span>` : ''}</div><table>${rows}</table>`}${verdict}
    <form class="form" id="confirm">
      ${low ? `<p class="full note">Produit sec : pas de rappel nécessaire, mais vous pouvez l'ajouter.</p>` : ''}
      <label class="full">Produit<input id="f-name" required value="${esc(prod ? prod.name : '')}" placeholder="Nom du produit"></label>
      <label>Catégorie<select id="f-cat">${catOptions(cat)}</select></label>
      <label>Date limite<input type="date" id="f-date" required value="${date}"></label>
      <div class="full row"><button class="primary" type="submit">Ajouter au frigo</button>
        ${!r.expiry && photo && settings.apiKey ? `<button type="button" id="btn-ia">Lire la date (IA)</button>` : ''}</div>
      <p class="full note" id="f-note">${r.expiry ? '' : 'Vérifiez la date imprimée sur l’emballage.'}</p>
    </form></div>`;
  let dateType = r.expiry ? r.expiryType : 'estimé';
  let source = manual ? 'manuel' : r.expiry ? 'scan-qr' : 'scan-ean';
  let touched = false;
  $('#f-cat').addEventListener('change', e => { if (!r.expiry && !touched) { const est = CATS[e.target.value].est; if (est != null) $('#f-date').value = iso(addDays(today(), est)); } });
  $('#f-date').addEventListener('input', () => { touched = true; if (!r.expiry) dateType = 'DLC'; });
  $('#confirm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#f-name').value.trim(), catV = $('#f-cat').value, dateV = $('#f-date').value;
    if (r.gtin && !CATALOG[r.gtin]) { known[r.gtin] = {name, cat:catV}; store.set('frigoscan.known', known); }
    const id = addItem({name, cat:catV, date:dateV, type: touched || r.expiry ? dateType : 'estimé', source, lot:r.lot, gtin:r.gtin});
    $('#out').innerHTML = `<div class="banner"><b>${esc(name)} ajouté.</b><span>Rappel le ${fmt(iso(reminderOf(dateV)))}.</span>
      <div class="row"><button class="primary" id="again">Scanner un autre produit</button><button id="see">Voir le frigo</button></div></div>`;
    $('#again').addEventListener('click', startCam);
    $('#see').addEventListener('click', () => { go('frigo'); render([id]); });
    render([id]);
  });
  const ia = $('#btn-ia');
  if (ia) ia.addEventListener('click', async () => {
    const note = $('#f-note'); ia.disabled = true; note.innerHTML = '<span class="spinner"></span> Lecture de l’emballage…';
    try {
      const d = await askClaude(`Tu lis la photo d'un emballage alimentaire vendu en Belgique. Aujourd'hui : ${iso(today())}.
Trouve la date de péremption imprimée et le nom du produit s'il est visible.
Réponds uniquement en JSON : {"date":"YYYY-MM-DD" ou null,"type":"DLC" (à consommer jusqu'au / te gebruiken tot / use by / EXP) ou "DDM" (de préférence avant / ten minste houdbaar tot / best before) ou null,"produit":"nom" ou null,"texte_lu":"la mention exacte"}`, photo);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) {
        $('#f-date').value = d.date; touched = true; dateType = d.type === 'DDM' ? 'DDM' : 'DLC'; source = 'photo-ia';
        if (d.produit && !$('#f-name').value) $('#f-name').value = d.produit;
        note.textContent = `Lu : « ${d.texte_lu || d.date} ». Vérifiez avant d’ajouter.`;
      } else note.textContent = 'Pas de date lisible. Photographiez la zone de la date (bouton « Choisir une photo »).';
    } catch (e) { note.textContent = e.message; }
    ia.disabled = false;
  });
}
function showNoCode(photo) {
  $('#out').innerHTML = `<div class="decode"><div class="verdict"><b>Aucun code lu sur cette photo.</b> Rapprochez-vous et évitez les reflets.</div></div>`;
  if (settings.apiKey) {
    const d = document.createElement('div'); d.className = 'row'; d.style.marginTop = '10px';
    d.innerHTML = '<button id="nc-ia">Saisir le produit et lire la date (IA)</button>';
    $('#out').appendChild(d);
    $('#nc-ia').addEventListener('click', () => { showForm({r:{ok:true, fields:[], dates:{}}, prod:null, photo, manual:true});
      const b = document.createElement('button'); b.type = 'button'; b.id = 'btn-ia-m'; b.textContent = 'Lire la date (IA)';
      $('#confirm .row').appendChild(b); b.addEventListener('click', () => readDateOnly(photo)); });
  }
}
async function readDateOnly(photo) {
  const note = $('#f-note'); note.innerHTML = '<span class="spinner"></span> Lecture de l’emballage…';
  try {
    const d = await askClaude(`Photo d'un emballage alimentaire en Belgique. Aujourd'hui : ${iso(today())}. Réponds uniquement en JSON : {"date":"YYYY-MM-DD" ou null,"produit":"nom" ou null,"texte_lu":"mention lue"}`, photo);
    if (d?.date) $('#f-date').value = d.date;
    if (d?.produit && !$('#f-name').value) $('#f-name').value = d.produit;
    note.textContent = d?.date ? `Lu : « ${d.texte_lu || d.date} ». Vérifiez.` : 'Pas de date lisible.';
  } catch (e) { note.textContent = e.message; }
}

/* ---------- Claude (clé API sur le téléphone) ---------- */
const MODEL = 'claude-haiku-5-5';
async function blobToJpegB64(blob) {
  const bmp = await createImageBitmap(blob); const s = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}
async function askClaude(prompt, image) {
  if (!settings.apiKey) throw new Error('Ajoutez une clé API Claude dans Réglages.');
  const content = [];
  if (image) content.push({type:'image', source:{type:'base64', media_type:'image/jpeg', data: await blobToJpegB64(image)}});
  content.push({type:'text', text: prompt});
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {method:'POST', headers:{
      'content-type':'application/json', 'x-api-key':settings.apiKey, 'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'}, body: JSON.stringify({model:MODEL, max_tokens:2000, messages:[{role:'user', content}]})});
  } catch (e) { throw new Error('Pas de connexion internet.'); }
  if (res.status === 401) throw new Error('Clé API refusée. Vérifiez-la dans Réglages.');
  if (res.status === 429) throw new Error('Trop de demandes, réessayez dans un instant.');
  if (!res.ok) throw new Error('Claude n’a pas pu répondre (' + res.status + ').');
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); const body = m ? m[1] : text;
  const a = Math.min(...['{','['].map(ch => { const i = body.indexOf(ch); return i < 0 ? Infinity : i; }));
  const b = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  try { return JSON.parse(body.slice(a, b + 1)); } catch (e) { throw new Error('Réponse illisible, réessayez.'); }
}

/* ---------- Recettes ---------- */
function updateRecipeBtn() {
  const n = items.filter(isPicked).length, b = $('#btn-recipes');
  if (!settings.apiKey) { b.disabled = true; b.textContent = 'Recettes'; $('#recipes-hint').textContent = 'Ajoutez une clé API Claude dans Réglages pour obtenir des recettes.'; return; }
  $('#recipes-hint').textContent = 'Cochez les produits à utiliser. Ceux qui expirent dans les 3 jours sont cochés d’office.';
  b.disabled = n === 0; b.textContent = n ? `Avec ${n} produit${n > 1 ? 's' : ''}` : 'Cochez des produits';
}
let lastRecipes = [];
const fullCache = {};
$('#btn-recipes').addEventListener('click', async () => {
  const picked = items.filter(isPicked); if (!picked.length) return;
  const box = $('#recipes'), btn = $('#btn-recipes'); btn.disabled = true; const gen = ++recipeGen;
  box.innerHTML = '<p class="note"><span class="spinner"></span> Recherche d’idées…</p>';
  try {
    const list = picked.map(it => { const n = daysLeft(it.date); return `- ${it.name} (${n < 0 ? 'date dépassée de ' + (-n) + ' j' : 'expire dans ' + n + ' j'})`; }).join('\n');
    const d = await askClaude(`Produits à utiliser :\n${list}\nPropose 3 recettes simples de semaine (famille belge, 30 min max) qui utilisent en priorité ceux qui expirent le plus tôt. Réponds uniquement en JSON : [{"titre":"…","utilise":["…"],"minutes":25,"resume":"une phrase"}]`);
    if (gen !== recipeGen) return;
    lastRecipes = (Array.isArray(d) ? d : []).slice(0, 3);
    box.innerHTML = lastRecipes.map((r, i) => `<div class="recipe" id="rcp${i}"><button class="recipe-btn" data-rcp="${i}" aria-expanded="false">
      <b>${esc(r.titre)}</b><span class="go">Voir la recette</span><span class="muted">${esc(r.minutes)} min · ${esc((r.utilise || []).join(', '))}</span></button>
      <div class="recipe-full" hidden></div></div>`).join('') || '<p class="note">Pas d’idée trouvée.</p>';
  } catch (e) { if (gen === recipeGen) box.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
  finally { updateRecipeBtn(); }
});
$('#recipes').addEventListener('click', async e => {
  const btn = e.target.closest('[data-rcp]'); if (!btn) return;
  const i = +btn.dataset.rcp, card = $('#rcp' + i), full = card.querySelector('.recipe-full'), goEl = btn.querySelector('.go');
  const opening = full.hidden || !!full.dataset.failed; delete full.dataset.failed;
  full.hidden = !opening; card.classList.toggle('open', opening); btn.setAttribute('aria-expanded', opening);
  goEl.textContent = opening ? 'Masquer' : 'Voir la recette';
  if (!opening || full.dataset.loaded) return;
  const r = lastRecipes[i], gen = recipeGen, key = gen + ':' + i;
  full.innerHTML = '<p class="note"><span class="spinner"></span> Rédaction de la recette…</p>';
  try {
    const d = fullCache[key] || await askClaude(`Écris la recette complète de « ${r.titre} » (${r.resume}), pour 4 personnes, prête en ${r.minutes} minutes environ.
Elle utilise ces produits du frigo : ${(r.utilise || []).join(', ')}. Cuisine de tous les jours en Belgique, ingrédients faciles à trouver, quantités en grammes, cl ou unités.
Réponds uniquement en JSON : {"portions":4,"ingredients":[{"q":"400 g","nom":"filet de poulet","du_frigo":true}],"etapes":["…"],"astuce":"une phrase ou null"}`);
    if (gen !== recipeGen) return;
    fullCache[key] = d;
    full.innerHTML = `<h4>Ingrédients · ${esc(d.portions || 4)} personnes</h4><ul>${(d.ingredients || []).map(x => `<li class="${x.du_frigo ? 'fr' : ''}">${esc(x.q)} ${esc(x.nom)}</li>`).join('')}</ul>
      <p class="note" style="margin-top:4px">En gras : produits de votre frigo.</p>
      <h4>Préparation</h4><ol>${(d.etapes || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>${d.astuce ? `<p class="note" style="margin-top:10px">Astuce : ${esc(d.astuce)}</p>` : ''}`;
    full.dataset.loaded = '1';
  } catch (err) { if (gen !== recipeGen) return; full.innerHTML = `<p class="note">${esc(err.message)}</p>`; full.dataset.failed = '1'; goEl.textContent = 'Réessayer'; }
});

/* ---------- Démo : passage en caisse ---------- */
$('#btn-checkout').addEventListener('click', () => {
  const t = today();
  const basket = [['Filet de poulet',2,'L5821'],['Haché porc-bœuf 500 g',1,'B0412'],['Filet de saumon',1,'S7730'],
    ['Mozzarella 125 g',6,'M2210'],['Tortellini ricotta-épinards',11,'P0098'],['Spaghetti 500 g',null],['Chips paprika',null]];
  const lines = basket.map(([name, d, lot]) => { const p = byName(name);
    const raw = d == null ? p.ean : `https://id.gs1.org/01/${p.ean.padStart(14,'0')}/10/${lot}?17=${yymmdd(addDays(t, d))}`;
    return {p, raw, r: GS1.parse(raw)}; });
  const ids = [];
  lines.forEach(l => { if (l.r.expiry && CATS[l.p.cat].prio < 3) ids.push(addItem({name:l.p.name, cat:l.p.cat, date:l.r.expiry, type:l.r.expiryType, source:'caisse', lot:l.r.lot, gtin:l.r.gtin})); });
  $('#receipt').innerHTML = `<div class="receipt"><div class="r-head">SUPERMARCHÉ DÉMO · CAISSE 04<br>${new Date().toLocaleString('fr-BE')}<br>Carte fidélité reconnue</div>
    ${lines.map(l => { const tr = l.r.expiry && CATS[l.p.cat].prio < 3; return `<div class="r-line"><span>${esc(l.p.name)}</span><span>${tr ? '→ frigo, ' + fmt(l.r.expiry) : 'non suivi'}</span><span class="r-raw">${esc(l.raw)}</span></div>`; }).join('')}
    <div class="r-line"><span>Produits frais suivis</span><span>${ids.length} ajoutés</span></div></div>
    <button id="to-fridge" style="margin-top:10px">Voir le frigo</button>`;
  $('#to-fridge').addEventListener('click', () => { go('frigo'); render(ids); });
  render(ids);
});

/* ---------- Démo : étiquettes de test ---------- */
(function labels() {
  const t = today(), P = n => byName(n);
  const defs = [
    {kind:'ean', title:'Mozzarella', sub:'EAN-13 : pas de date', data:P('Mozzarella 125 g').ean},
    {kind:'qr', title:'Filet de poulet', sub:'QR GS1 : DLC J+2', data:`https://id.gs1.org/01/${P('Filet de poulet').ean.padStart(14,'0')}/10/L5821?17=${yymmdd(addDays(t,2))}`},
    {kind:'qr', title:'Lasagne traiteur', sub:'QR GS1 : DLC J+3', data:`https://id.gs1.org/01/${P('Lasagne bolognaise traiteur').ean.padStart(14,'0')}/10/T1102?17=${yymmdd(addDays(t,3))}`},
    {kind:'qr', title:'Yaourt nature', sub:'QR GS1 : DDM J+18', data:`https://id.gs1.org/01/${P('Yaourt nature 4×125 g').ean.padStart(14,'0')}/10/Y33?15=${yymmdd(addDays(t,18))}`}
  ];
  $('#labels').innerHTML = defs.map((d, i) => `<div class="label"><div class="code" id="code${i}"></div><b>${esc(d.title)}</b><span>${esc(d.sub)}</span><button data-use="${i}">Lire ce code</button></div>`).join('');
  defs.forEach((d, i) => {
    const el = $('#code' + i);
    try {
      if (d.kind === 'qr' && window.qrcode) { const q = qrcode(0, 'M'); q.addData(d.data); q.make(); el.innerHTML = q.createSvgTag({cellSize:4, margin:2, scalable:true}); }
      else if (window.JsBarcode) { el.innerHTML = '<svg></svg>'; JsBarcode(el.firstChild, d.data, {format:'EAN13', height:80, width:2, fontSize:14, margin:6, background:'#ffffff', lineColor:'#111111'}); }
    } catch (e) { el.textContent = d.data; }
  });
  $('#labels').addEventListener('click', e => { const i = e.target.closest('[data-use]')?.dataset.use; if (i == null) return; go('scan'); handleCode(defs[i].data, null); });
})();

/* ---------- Réglages ---------- */
$('#lead').value = String(settings.lead); $('#hour').value = String(settings.hour);
$('#lead').addEventListener('change', e => { settings.lead = +e.target.value; saveSettings(); render(); });
$('#hour').addEventListener('change', e => { settings.hour = +e.target.value; saveSettings(); });
function keyState() { $('#key-state').textContent = settings.apiKey ? 'Clé enregistrée sur ce téléphone.' : 'Aucune clé : la lecture de date par IA et les recettes sont désactivées.'; }
$('#btn-key').addEventListener('click', () => { const v = $('#apikey').value.trim(); if (!v) return; settings.apiKey = v; saveSettings(); $('#apikey').value = ''; keyState(); updateRecipeBtn(); toast('Clé enregistrée'); });
$('#btn-key-del').addEventListener('click', () => { settings.apiKey = ''; saveSettings(); keyState(); updateRecipeBtn(); });
keyState();

/* ---------- Installation ---------- */
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const b = $('#install-banner'); b.hidden = false;
  b.innerHTML = ios
    ? '<b>Installer FrigoScan</b><span>Dans Safari : bouton Partager, puis « Sur l’écran d’accueil ».</span>'
    : '<b>Installer FrigoScan</b><span>Menu du navigateur, puis « Installer l’application ».</span><div class="row"><button class="primary" id="btn-install" hidden>Installer</button></div>';
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; const bt = $('#btn-install'); if (bt) bt.hidden = false; });
  document.addEventListener('click', async e => { if (e.target.id === 'btn-install' && deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; b.hidden = true; } });
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
let shownDay = iso(today());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopCam(); return; }
  if (iso(today()) !== shownDay) { shownDay = iso(today()); render(); } // nouveau jour : comptes à rebours à jour
});

render();
})();
