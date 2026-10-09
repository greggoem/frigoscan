/* ---------- Lecture des codes GS1 (EAN, GS1-128, DataMatrix, QR Digital Link) ---------- */
const GS1 = (() => {
  const GS = '\u001d';
  // AI -> [libellé, longueur fixe (null = variable), longueur max]
  const AIS = {
    '00': ['SSCC', 18], '01': ['GTIN', 14], '02': ['GTIN contenu', 14],
    '10': ['Lot', null, 20], '11': ['Date de production', 6], '13': ['Date d’emballage', 6],
    '15': ['À consommer de préférence avant (DDM)', 6], '16': ['Date limite de vente', 6],
    '17': ['À consommer jusqu’au (DLC)', 6], '20': ['Variante', 2],
    '21': ['Numéro de série', null, 20], '30': ['Quantité', null, 8], '37': ['Nombre d’unités', null, 8],
    '240': ['Réf. additionnelle', null, 30], '422': ['Pays d’origine', 3],
    '7003': ['Date/heure d’expiration', 10], '8008': ['Date/heure de production', null, 12]
  };
  const DATE_AIS = ['11', '13', '15', '16', '17'];

  function ai4(code) { // AIs à 4 chiffres : poids (310n…), prix (392n, 393n)
    const p3 = code.slice(0, 3);
    if (/^3[1-6]\d$/.test(p3) && /^\d$/.test(code[3])) return [code.slice(0, 4), ['Mesure ' + p3 + ' (' + code[3] + ' déc.)', 6]];
    if (p3 === '392') return [code.slice(0, 4), ['Prix à payer', null, 15]];
    if (p3 === '393') return [code.slice(0, 4), ['Prix à payer (avec devise)', null, 18]];
    return null;
  }

  function lookup(s) {
    for (const len of [2, 3, 4]) {
      const k = s.slice(0, len);
      if (AIS[k]) return [k, AIS[k]];
    }
    return ai4(s);
  }

  function parseDate(yymmdd) {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    const yy = +yymmdd.slice(0, 2), mm = +yymmdd.slice(2, 4); let dd = +yymmdd.slice(4, 6);
    if (mm < 1 || mm > 12) return null;
    // Règle GS1 : fenêtre glissante simplifiée (2000-2099 suffit pour des produits frais)
    const year = 2000 + yy;
    if (dd === 0) dd = new Date(year, mm, 0).getDate(); // jour 00 = dernier jour du mois
    const d = new Date(year, mm - 1, dd);
    if (d.getMonth() !== mm - 1) return null;
    return year + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  }

  function checkDigitOk(digits) {
    const n = digits.split('').map(Number); const cd = n.pop(); let sum = 0;
    n.reverse().forEach((v, i) => { sum += v * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === cd;
  }
  function withCheckDigit(base) {
    const n = base.split('').map(Number).reverse(); let sum = 0;
    n.forEach((v, i) => { sum += v * (i % 2 === 0 ? 3 : 1); });
    return base + ((10 - (sum % 10)) % 10);
  }

  function elementString(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      const hit = lookup(s.slice(i));
      if (!hit) { out.push({ ai: '?', label: 'Donnée non reconnue', value: s.slice(i) }); break; }
      const [ai, [label, fixed, max]] = hit; i += ai.length;
      let value;
      if (fixed) { value = s.slice(i, i + fixed); i += fixed; }
      else { let j = s.indexOf(GS, i); if (j < 0) j = s.length; value = s.slice(i, Math.min(j, i + max)); i = j; }
      out.push({ ai, label, value });
    }
    return out;
  }

  function digitalLink(url) {
    const out = []; let u;
    try { u = new URL(url); } catch (e) { return null; }
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    let idx = parts.findIndex(p => p === '01' || p === 'gtin');
    if (idx < 0) return null;
    for (let k = idx; k + 1 < parts.length; k += 2) {
      const ai = parts[k] === 'gtin' ? '01' : parts[k] === 'lot' ? '10' : parts[k] === 'ser' ? '21' : parts[k];
      const def = AIS[ai] || (ai4(ai + '000000') || [])[1];
      out.push({ ai, label: def ? def[0] : 'AI ' + ai, value: parts[k + 1] });
    }
    u.searchParams.forEach((v, k) => {
      if (!/^\d{2,4}$/.test(k)) return;
      const def = AIS[k] || (ai4(k + '000000') || [])[1];
      out.push({ ai: k, label: def ? def[0] : 'AI ' + k, value: v });
    });
    return out;
  }

  function parse(raw) {
    let s = String(raw || '').trim();
    let symbology = null;
    const pref = s.match(/^\](Q\d|d\d|C\d|e\d|E\d)/);
    if (pref) { symbology = pref[1]; s = s.slice(3); }
    let format, fields;
    if (/^https?:\/\//i.test(s)) {
      fields = digitalLink(s); format = fields ? 'QR GS1 Digital Link' : 'QR (lien web, pas un code produit)';
      fields = fields || [];
    } else if (/^\(\d{2,4}\)/.test(s)) {
      const flat = s.replace(/\((\d{2,4})\)/g, (m, ai, off) => (off ? GS : '') + ai);
      fields = elementString(flat); format = 'Chaîne GS1 (lisible)';
    } else if (/^\d{8}$|^\d{12,14}$/.test(s)) {
      const g = s.padStart(14, '0');
      fields = [{ ai: '01', label: 'GTIN', value: g }];
      format = s.length === 8 ? 'EAN-8' : s.length === 12 ? 'UPC-A' : 'EAN-13';
      if (s.length === 13 && /^2[0-9]/.test(s)) format = 'EAN-13 magasin (poids/prix variable)';
    } else if (/^\d{2}/.test(s)) {
      fields = elementString(s); format = 'GS1 DataMatrix / GS1-128';
    } else {
      return { ok: false, raw, format: 'Code non GS1', fields: [], message: 'Ce code ne contient pas d’identifiant produit GS1.' };
    }
    const get = ai => (fields.find(f => f.ai === ai) || {}).value;
    const gtin = get('01');
    const res = { ok: !!gtin, raw, symbology, format, fields, gtin: gtin ? gtin.padStart(14, '0') : null,
      lot: get('10') || null, serial: get('21') || null, dates: {} };
    DATE_AIS.forEach(ai => { const v = get(ai); if (v) res.dates[ai] = parseDate(v); });
    if (res.dates['17']) { res.expiry = res.dates['17']; res.expiryType = 'DLC'; }
    else if (res.dates['15']) { res.expiry = res.dates['15']; res.expiryType = 'DDM'; }
    else if (res.dates['16']) { res.expiry = res.dates['16']; res.expiryType = 'Vente'; }
    if (res.gtin) res.gtinValid = checkDigitOk(res.gtin);
    return res;
  }

  return { parse, parseDate, withCheckDigit, checkDigitOk, GS };
})();
if (typeof module !== 'undefined') module.exports = GS1;
