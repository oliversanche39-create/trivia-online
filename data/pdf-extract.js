// Extrae el texto del PDF (ReportLab, streams FlateDecode + ASCII85Decode)
// y lo convierte en data/themes.json con los 7 temas.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const pdfPath = process.argv[2] || 'C:/Users/SUPER/Downloads/preguntas_unicas_actuales.pdf';
const raw = fs.readFileSync(pdfPath).toString('latin1');

// decodificar ASCII85
function a85decode(s) {
  const decoded = [];
  let group = [];
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 'z' && count === 0) { decoded.push(0, 0, 0, 0); continue; }
    if (c < '!' || c > 'u') continue;
    group.push(s.charCodeAt(i) - 33);
    count++;
    if (count === 5) { decodeGroup(group); group = []; count = 0; }
  }
  if (count > 0) {
    const real = group.length;
    for (let k = 0; k < 5 - real; k++) group.push(84);
    decodeGroup(group);
  }
  function decodeGroup(g) {
    let val = 0;
    for (const d of g) val = val * 85 + d;
    decoded.push((val >>> 24) & 255, (val >>> 16) & 255, (val >>> 8) & 255, val & 255);
  }
  return Buffer.from(decoded.slice(0, decoded.length - (count === 0 ? 0 : 4 - (count - 1))));
}

function decodePdfString(t) {
  // reemplaza escapes \ddd (octal), \n, \' y \ + símbolo
  return t.replace(/\\(\d{1,3})|[\\]([()\\'n])/g, (_, oct, chr) => {
    if (oct !== undefined) return String.fromCharCode(parseInt(oct, 8));
    if (chr === 'n') return ' ';
    return chr;
  });
}

const re = /<<([\s\S]{0,600}?)>>\s*stream\r?\n([\s\S]*?)endstream/g;
let m;
const pages = [];
while ((m = re.exec(raw)) !== null) {
  const dict = m[1];
  if (!/FlateDecode/.test(dict)) continue;
  let data = m[2].replace(/[\r\n]+/g, '');
  if (data.endsWith('~>')) data = data.slice(0, -2);
  const bin = /ASCII85Decode/.test(dict) ? a85decode(data) : Buffer.from(data, 'latin1');
  try {
    pages.push(zlib.inflateSync(bin).toString('latin1'));
  } catch (e) {
    console.error('stream falló:', e.message, 'len', bin.length);
  }
}
console.log('páginas:', pages.length);

const lines = [];
for (const chunk of pages) {
  const btRe = /BT([\s\S]*?)ET/g;
  let bt;
  while ((bt = btRe.exec(chunk)) !== null) {
    const seg = bt[1];
    let line = '';
    const strRe = /\((?:[^()\\]|\\.)*\)/g;
    let s;
    while ((s = strRe.exec(seg)) !== null) {
      line += decodePdfString(s[0].slice(1, -1));
    }
    if (line.trim()) lines.push(line.trim());
  }
  lines.push('');
}

fs.writeFileSync(path.join(__dirname, 'pdf_text.txt'), lines.join('\r\n'));
console.log('líneas de texto:', lines.filter(Boolean).length);

// ── Parsear a temas ──
// encabezados tipo: "1. PREGUNTAS CALIENTES (151)" (los índices 1-7 del índice)
// clasificar por palabra clave: el orden importa ("RARAS" antes que "CALIENTES", "GUARRAS" antes que "CALIENTES")
const THEME_RULES = [
  ['RARAS', 'raras'],
  ['INCÓMODAS', 'raras'],
  ['INCOMODAS', 'raras'],
  ['GUARRAS', 'muy_calientes'],
  ['SÍ O NO', 'siono'],
  ['SI O NO', 'siono'],
  ['CONTESTAR NORMAL', 'normal'],
  ['CALENTITAS', 'calentitas'],
  ['VIDA COTIDIANA', 'vida'],
  ['CALIENTES', 'calientes'],
];
function classifyTitle(t) {
  const up = t.toUpperCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  for (const [word, key] of THEME_RULES) {
    if (up.includes(word)) return key;
  }
  return null;
}

const themes = {}; // clave -> [preguntas]
let current = null;
for (const line of lines) {
  if (!line) continue;
  // encabezado de sección real: "2. PREGUNTAS CALIENTES RARAS E INCÓMODAS (101)"
  const h = line.match(/^\d+\.\s*(.+?)\s*\((\d+)\)\s*$/);
  if (h) {
    const key = classifyTitle(h[1]);
    if (key) {
      if (!themes[key]) themes[key] = [];
      current = key;
      continue;
    }
  }
  if (!current) continue;
  // pregunta: "12. ¿texto?" u otra cosa; solo líneas numeradas
  const q = line.match(/^\d+\.\s*(.+)$/);
  if (q) {
    const text = q[1].replace(/\s+/g, ' ').trim();
    if (text.length > 3) themes[current].push(text);
  }
}

const norm = s => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
for (const [k, arr] of Object.entries(themes)) {
  const seen = new Set();
  themes[k] = arr.filter(q => {
    const key = norm(q);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // corregir "¿¿" duplicados si los hubiese, y espacios
  themes[k] = themes[k].map(q => q.replace(/\s+/g, ' ').trim());
}

const total = Object.values(themes).reduce((s, a) => s + a.length, 0);
console.log(Object.entries(themes).map(([k, v]) => `${k}: ${v.length}`).join(' | '));
console.log('TOTAL:', total);

fs.writeFileSync(path.join(__dirname, 'themes.json'), JSON.stringify(themes, null, 2));
console.log('✅ data/themes.json escrito');
