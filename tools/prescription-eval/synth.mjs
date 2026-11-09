// SPDX-License-Identifier: MIT
// Synthetic prescriptions (SCRUM-57 spike): what each one says (its truth),
// the HTML of the sheet, and the HTML of a phone-photo scene around it. Pure:
// generate.mjs renders them with Playwright. Handwriting-style fonts are a
// proxy for handwriting only: real handwriting is much harder to read.
import {
  CABINETS,
  FIRST,
  IN_BASE,
  LAST,
  OUT_OF_BASE,
  PLACES,
  PRESCRIBER,
  pick,
  rng,
} from './catalog.mjs';

/** Handwriting-style fonts (SIL OFL 1.1 or Apache-2.0, Google Fonts), loaded from `fonts/`. */
export const HAND_FONTS = ['Caveat', 'ReenieBeanie', 'HomemadeApple', 'NothingYouCouldDo', 'Kalam'];
const PRINT_FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Verdana'];

/** Phone-photo degradations: frame size, rotation and tilt, blur, light, noise, JPEG quality. */
export const VARIANTS = {
  photo: {
    w: 1200,
    h: 1600,
    rz: 3,
    rx: 6,
    ry: 3,
    blur: 0.5,
    bright: 0.97,
    contrast: 0.95,
    sepia: 0,
    shadow: 0.15,
    noise: 0.04,
    q: 75,
    scale: 0.9,
  },
  hard: {
    w: 900,
    h: 1200,
    rz: 8,
    rx: 14,
    ry: 6,
    blur: 1.3,
    bright: 0.85,
    contrast: 0.8,
    sepia: 0.1,
    shadow: 0.45,
    noise: 0.08,
    q: 50,
    scale: 0.85,
  },
  dim: {
    w: 1200,
    h: 1600,
    rz: 2.5,
    rx: 4,
    ry: 2,
    blur: 0.8,
    bright: 0.5,
    contrast: 0.7,
    sepia: 0.35,
    shadow: 0.2,
    noise: 0.12,
    q: 60,
    scale: 0.9,
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * The prescription number `i` (0-based): its layout, fonts, patient, and 2 to
 * 6 products, about one in four outside the pack. `substancesOf(productId)`
 * gives the sorted substances of a pack product: two products with the same
 * substances never appear on one prescription. One in three is written in a
 * handwriting-style font.
 */
export function makeRx(i, substancesOf) {
  const r = rng(1000 + i * 7919);
  const handwriting = i % 3 === 2;
  const template = ['post', 'cabinet', 'table'][
    handwriting ? Math.floor(r() * 2) : Math.floor(i / 3) % 3
  ];
  const n = 2 + Math.floor(r() * 5);
  const items = [];
  const used = new Set();
  while (items.length < n) {
    const out = r() < 0.25;
    const it = pick(r, out ? OUT_OF_BASE : IN_BASE);
    if (used.has(it.written)) continue;
    if (!out && items.some((x) => x.inBase && substancesOf(x.product) === substancesOf(it.product)))
      continue;
    used.add(it.written);
    // A posology of a pack product comes with the units per day it says.
    const chosen = pick(r, it.pos);
    const [posology, upd] = Array.isArray(chosen) ? chosen : [chosen, undefined];
    items.push({ ...it, inBase: !out, posology, upd, inline: r() < 0.45 });
  }
  const [region, district, village] = pick(r, PLACES);
  const day = 1 + Math.floor(r() * 28);
  const month = 1 + Math.floor(r() * 10);
  return {
    id: `rx${String(i + 1).padStart(2, '0')}`,
    template,
    handwriting,
    font: handwriting ? HAND_FONTS[i % HAND_FONTS.length] : pick(r, PRINT_FONTS),
    printFont: pick(r, PRINT_FONTS.slice(0, 2)),
    patient: `${pick(r, FIRST)} ${pick(r, LAST)}`,
    age: 17 + Math.floor(r() * 25),
    weeks: 12 + Math.floor(r() * 26),
    date: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/2026`,
    prescriber: pick(r, PRESCRIBER),
    cabinet: pick(r, CABINETS),
    region,
    district,
    village,
    stampOverlap: r() < 0.3,
    jitter: Array.from({ length: 20 }, () => r()),
    items,
  };
}

/** The text a perfect reading would give (the same lines as the sheet's body). */
export function truthText(rx) {
  const lines = [
    'ORDONNANCE',
    `Nom et prénom : ${rx.patient}`,
    `Âge : ${String(rx.age)} ans Date : ${rx.date}`,
  ];
  rx.items.forEach((it, k) => {
    if (it.inline) lines.push(`${String(k + 1)}. ${it.written} : ${it.posology}`);
    else lines.push(`${String(k + 1)}. ${it.written}`, it.posology);
  });
  lines.push('Signature et cachet', rx.prescriber);
  return lines.join('\n');
}

function itemsHtml(rx) {
  const tilt = (k) =>
    rx.handwriting
      ? ` style="transform: rotate(${((rx.jitter[k % 20] - 0.5) * 3).toFixed(2)}deg) translateX(${String(Math.round((rx.jitter[(k + 7) % 20] - 0.5) * 30))}px)"`
      : '';
  if (rx.template === 'table' && !rx.handwriting) {
    const rows = rx.items
      .map((it) => `<tr><td>${esc(it.written)}</td><td>${esc(it.posology)}</td></tr>`)
      .join('');
    return `<table class="meds"><tr><th>Médicament</th><th>Posologie</th></tr>${rows}</table>`;
  }
  const rows = rx.items
    .map((it, k) =>
      it.inline
        ? `<li${tilt(k)}>${esc(it.written)} : ${esc(it.posology)}</li>`
        : `<li${tilt(k)}>${esc(it.written)}<div class="pos">${esc(it.posology)}</div></li>`,
    )
    .join('');
  return `<ol class="meds">${rows}</ol>`;
}

/** The sheet (1100 px wide, A5 proportions) as a whole HTML page; fonts from `fontBase`. */
export function sheetHtml(rx, fontBase = '/fonts') {
  const body = rx.handwriting
    ? `font-family: '${rx.font}'; color: #1d3486; font-size: 40px;`
    : `font-family: '${rx.font}'; font-size: 30px;`;
  const header =
    rx.template === 'post'
      ? `<header class="center"><b>RÉPUBLIQUE DU SÉNÉGAL</b><br><i>Un Peuple - Un But - Une Foi</i><br><b>MINISTÈRE DE LA SANTÉ ET DE L'ACTION SOCIALE</b><br>Région médicale de ${esc(rx.region)}<br>District sanitaire de ${esc(rx.district)}<br><b>Poste de santé de ${esc(rx.village)}</b></header>`
      : rx.template === 'cabinet'
        ? `<header class="split"><div><b>${esc(rx.prescriber)}</b><br>Médecine générale<br>${esc(rx.cabinet)}<br>Rue 10 x 13, ${esc(rx.district)}<br>Tél : 33 000 00 00</div><div class="right">${esc(rx.district)}, le ${rx.date}</div></header>`
        : `<header class="split"><div class="logo">CS</div><div><b>CENTRE DE SANTÉ DE ${esc(rx.district.toUpperCase())}</b><br>Service de maternité<br>${esc(rx.prescriber)}<br>Tél : 33 000 00 00</div></header>`;
  const patient = rx.handwriting
    ? `<div class="pre">Nom et prénom : <span class="hand">${esc(rx.patient)}</span></div><div class="pre">Âge : <span class="hand">${String(rx.age)} ans</span> &nbsp; Terme : <span class="hand">${String(rx.weeks)} SA</span> &nbsp; Date : <span class="hand">${rx.date}</span></div>`
    : rx.template === 'cabinet'
      ? `<div class="pt">Mme ${esc(rx.patient)}, ${String(rx.age)} ans</div>`
      : `<div class="pt">Nom et prénom : ${esc(rx.patient)} &nbsp;&nbsp; Âge : ${String(rx.age)} ans<br>Terme : ${String(rx.weeks)} SA &nbsp;&nbsp; Date : ${rx.date}</div>`;
  const stamp =
    rx.template === 'cabinet'
      ? rx.cabinet.toUpperCase()
      : `POSTE DE SANTÉ DE ${rx.village.toUpperCase()}`;
  const faces = HAND_FONTS.map(
    (f) => `@font-face { font-family: '${f}'; src: url('${fontBase}/${f}.ttf'); }`,
  ).join('\n');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
${faces}
html, body { margin: 0; background: #fff; }
#sheet { width: 1100px; min-height: 1560px; box-sizing: border-box; padding: 60px 70px; background: #fdfcf7; position: relative; font-family: '${rx.printFont}'; font-size: 24px; color: #111; }
header.center { text-align: center; line-height: 1.35; }
header.split { display: flex; justify-content: space-between; gap: 30px; line-height: 1.35; }
header .right { text-align: right; }
.logo { width: 110px; height: 110px; border: 4px solid #222; display: grid; place-items: center; font-size: 44px; font-weight: 800; }
h1 { text-align: center; font-size: 38px; letter-spacing: 6px; margin: 40px 0 26px; text-decoration: underline; }
.pt, .pre { font-size: 26px; margin: 8px 0; line-height: 1.5; }
.hand { font-family: '${rx.font}'; color: #1d3486; font-size: 36px; }
.meds { ${body} margin: 34px 0 0; padding-left: 50px; line-height: 1.45; }
.meds li { margin: 0 0 26px; }
.meds .pos { margin-left: 34px; font-size: 0.9em; }
table.meds { border-collapse: collapse; width: 100%; padding: 0; }
table.meds th, table.meds td { border: 2px solid #333; padding: 10px 14px; text-align: left; vertical-align: top; }
.sign { position: absolute; right: 90px; bottom: ${rx.stampOverlap ? 420 : 110}px; text-align: center; font-size: 24px; }
.stamp { position: absolute; right: 120px; bottom: ${rx.stampOverlap ? 330 : 170}px; width: 230px; height: 230px; border: 6px double #4a3fa8; border-radius: 50%; color: #4a3fa8; opacity: .72; transform: rotate(-14deg); display: grid; place-items: center; text-align: center; font: bold 20px Arial; padding: 20px; box-sizing: border-box; }
</style></head><body><div id="sheet">${header}<h1>ORDONNANCE</h1>${patient}${itemsHtml(rx)}
<div class="sign">Signature et cachet<br><svg width="260" height="90" viewBox="0 0 260 90"><path d="M10 60 C 40 10, 60 90, 90 40 S 140 20, 160 55 S 210 80, 250 25" stroke="#1d3486" stroke-width="4" fill="none"/></svg><br>${esc(rx.prescriber)}</div>
<div class="stamp">${esc(stamp)}<br>* * *</div></div></body></html>`;
}

/**
 * A phone photo of the sheet image `src`: the page on a table, turned and
 * tilted (`sign` picks the side), blurred, under uneven light, with sensor
 * noise drawn from `seed`; the caller screenshots it as a JPEG of quality `v.q`.
 */
export function sceneHtml(src, v, sign, seed) {
  return `<!doctype html><html><head><style>
html, body { margin: 0; width: ${String(v.w)}px; height: ${String(v.h)}px; overflow: hidden; background: radial-gradient(circle at 30% 20%, #8a6a4a, #4b3624); }
.wrap { position: absolute; inset: 0; display: grid; place-items: center; perspective: 1400px; filter: blur(${String(v.blur)}px) brightness(${String(v.bright)}) contrast(${String(v.contrast)}) sepia(${String(v.sepia)}); }
img { width: ${String(Math.round(v.w * v.scale))}px; transform: rotateX(${String(v.rx)}deg) rotateY(${String(sign * v.ry)}deg) rotateZ(${String(sign * v.rz)}deg); box-shadow: 0 10px 30px rgba(0,0,0,.5); }
.light { position: absolute; inset: 0; background: linear-gradient(${sign > 0 ? 120 : 240}deg, rgba(0,0,0,${String(v.shadow)}) 0%, rgba(0,0,0,0) 45%), radial-gradient(circle at 60% 40%, rgba(255,250,235,.08), rgba(0,0,0,.18)); pointer-events: none; }
canvas { position: absolute; inset: 0; opacity: ${String(v.noise)}; mix-blend-mode: overlay; }
</style></head><body><div class="wrap"><img id="im" src="${src}"></div><div class="light"></div><canvas id="n" width="${String(v.w)}" height="${String(v.h)}"></canvas>
<script>
let a = ${String(seed)} >>> 0; const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const c = document.getElementById('n').getContext('2d'); const d = c.createImageData(${String(v.w)}, ${String(v.h)});
for (let i = 0; i < d.data.length; i += 4) { const g = Math.floor(r() * 255); d.data[i] = d.data[i+1] = d.data[i+2] = g; d.data[i+3] = 255; }
c.putImageData(d, 0, 0);
</script></body></html>`;
}
