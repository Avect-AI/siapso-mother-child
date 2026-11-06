// SPDX-License-Identifier: MIT
// The fresh held-out set of the prescription reading (SCRUM-57): 12
// synthetic prescriptions made on 2026-11-06, after the review of PR 70,
// with new seeds, new layouts (a regional hospital, a polyclinic letterhead
// with posologies in brackets, a table stamped by a pharmacy) and new
// synthetic names, and frozen before the reading was run on them. The
// reading rules were never set on them: when they are read and a rule is
// changed for what they show, they are no longer held out, and a new set is
// made with new seeds (README). Pure: eval/prescription/fresh/ (truth.json
// and pages.json, the HTML of the sheets) is written by
//   pnpm --filter @siapso/prescription-eval exec tsx freeze-fresh.ts
// and the images for the OCR are rendered from the same sheets by
//   node tools/prescription-eval/generate.mjs <out-dir> 12 <fonts-dir> --fresh
import { IN_BASE, OUT_OF_BASE, pick, rng } from './catalog.mjs';
import { HAND_FONTS } from './synth.mjs';

/** How many prescriptions the fresh set holds: 8 printed, 4 in a handwriting-style font. */
export const FRESH_COUNT = 12;

/** Synthetic names: some common ones, some the reading does not list. No real person. */
const FIRST = [
  'Zeyna',
  'Mbissine',
  'Thiaba',
  'Siga',
  'Ndickou',
  'Kumba',
  'Nianga',
  'Fatou',
  'Aïda',
  'Khady',
  'Mame',
  'Sokhna',
];
const LAST = [
  'Kouyaté',
  'Diakité',
  'Doucouré',
  'Barry',
  'Baldé',
  'Sidibé',
  'Dabo',
  'Cissokho',
  'Senghor',
  'Tamba',
  'Sarr',
  'Ndiaye',
];
const PRESCRIBER = [
  'Dr Mamadou Kouyaté, gynécologue',
  'Dr Aïda Barry',
  'Mme Siga Dabo, sage-femme',
  'Pr Ousmane Senghor',
  'Dr Ndickou Baldé, médecin',
];
/** A city and a district of it. */
const PLACES = [
  ['Dakar', 'Fann'],
  ['Dakar', 'Liberté 6'],
  ['Dakar', 'Hann Maristes'],
  ['Thiès', 'Randoulène'],
  ['Ziguinchor', 'Boucotte'],
  ['Saint-Louis', 'Sor'],
  ['Kaolack', 'Médina Baye'],
  ['Tambacounda', 'Pont'],
];
const CLINICS = ['Polyclinique des Mamelles', 'Polyclinique Bel Air', 'Polyclinique du Fleuve'];
const PHARMACIES = [
  'Pharmacie de la Médina',
  'Pharmacie Khadim Rassoul',
  'Pharmacie du Rond-Point',
  'Pharmacie Alioune',
];
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
];
const PRINT_FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Verdana'];

/**
 * The fresh prescription number `i` (0-based, 12 of them): 2 to 6 products,
 * about one in four outside the pack, never two of the same substances; one
 * in three in a handwriting-style font (a proxy only).
 */
export function makeFreshRx(i, substancesOf) {
  const r = rng(424242 + i * 104729);
  const handwriting = i % 3 === 1;
  const template = ['hospital', 'polyclinic', 'stamped-table'][
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
    const chosen = pick(r, it.pos);
    const [posology, upd] = Array.isArray(chosen) ? chosen : [chosen, undefined];
    // What the prescription says, without the other posologies of the catalog.
    const written = Object.fromEntries(Object.entries(it).filter(([key]) => key !== 'pos'));
    items.push({ ...written, inBase: !out, posology, upd, inline: r() < 0.5 });
  }
  const [city, district] = pick(r, PLACES);
  const day = 1 + Math.floor(r() * 28);
  const month = Math.floor(r() * 10);
  return {
    id: `fx${String(i + 1).padStart(2, '0')}`,
    set: 'fresh',
    template,
    handwriting,
    font: handwriting ? HAND_FONTS[(i + 2) % HAND_FONTS.length] : pick(r, PRINT_FONTS),
    printFont: pick(r, PRINT_FONTS.slice(0, 2)),
    patient: `${pick(r, FIRST)} ${pick(r, LAST)}`,
    age: 17 + Math.floor(r() * 25),
    weeks: 12 + Math.floor(r() * 26),
    date: `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/2026`,
    dateWords: `${String(day)} ${MONTHS[month]} 2026`,
    prescriber: pick(r, PRESCRIBER),
    region: city,
    district,
    cabinet: template === 'stamped-table' ? pick(r, PHARMACIES) : pick(r, CLINICS),
    bp: String(1000 + Math.floor(r() * 9000)),
    items,
  };
}

/** The lines of the header, the items and the signature, in reading order. */
function sheetLines(rx) {
  const it = rx.items;
  if (rx.template === 'hospital') {
    return {
      header: [
        `HÔPITAL RÉGIONAL DE ${rx.region.toUpperCase()}`,
        'Service de gynécologie-obstétrique',
        `${rx.region}, le ${rx.date}`,
        'ORDONNANCE',
        `Patiente : ${rx.patient}, ${String(rx.age)} ans`,
        `Terme : ${String(rx.weeks)} SA`,
      ],
      items: it.map((x) =>
        x.inline ? [`- ${x.written} - ${x.posology}`] : [`- ${x.written}`, x.posology],
      ),
      footer: ['Le médecin', rx.prescriber],
    };
  }
  if (rx.template === 'polyclinic') {
    return {
      header: [
        rx.cabinet.toUpperCase(),
        `BP ${rx.bp} ${rx.region} ${rx.district}`,
        'Tél : 33 000 00 00',
        `Ordonnance du ${rx.dateWords}`,
        `Madame ${rx.patient}`,
      ],
      items: it.map((x, k) =>
        x.inline
          ? [`${String(k + 1)}) ${x.written} (${x.posology})`]
          : [`${String(k + 1)}) ${x.written}`, x.posology],
      ),
      footer: [rx.prescriber, 'Signature'],
    };
  }
  return {
    header: [
      `Clinique ${rx.district}`,
      `${rx.district}, ${rx.region}`,
      'ORDONNANCE',
      `Mlle ${rx.patient}`,
      "Traitement Mode d'emploi",
    ],
    // A table row read as one line: the name, then its posology.
    items: it.map((x) => [`${x.written} ${x.posology}`]),
    footer: [
      rx.prescriber,
      rx.cabinet.toUpperCase(),
      rx.region,
      'Visa du pharmacien',
      `${rx.region}, le ${rx.date}`,
    ],
  };
}

/** The text a perfect reading of the whole sheet would give, header and stamp included. */
export function freshText(rx) {
  const { header, items, footer } = sheetLines(rx);
  return [...header, ...items.flat(), ...footer].join('\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The sheet (1100 px wide, A5 proportions) as a whole HTML page; fonts from `fontBase`. */
export function freshSheetHtml(rx, fontBase = '/fonts') {
  const { header, items, footer } = sheetLines(rx);
  const hand = rx.handwriting
    ? `font-family: '${rx.font}'; color: #1d3486; font-size: 40px;`
    : `font-family: '${rx.font}'; font-size: 30px;`;
  const body =
    rx.template === 'stamped-table'
      ? `<table class="meds"><tr><th>Traitement</th><th>Mode d'emploi</th></tr>${rx.items
          .map((x) => `<tr><td>${esc(x.written)}</td><td>${esc(x.posology)}</td></tr>`)
          .join('')}</table>`
      : `<div class="meds">${items
          .map((lines) =>
            lines
              .map((line, k) => `<div class="${k === 0 ? 'it' : 'pos'}">${esc(line)}</div>`)
              .join(''),
          )
          .join('')}</div>`;
  const head = header
    .slice(0, rx.template === 'stamped-table' ? -1 : undefined)
    .map((line) => `<div>${esc(line)}</div>`)
    .join('');
  const faces = HAND_FONTS.map(
    (f) => `@font-face { font-family: '${f}'; src: url('${fontBase}/${f}.ttf'); }`,
  ).join('\n');
  const stamp =
    rx.template === 'stamped-table'
      ? `<div class="stamp">${esc(rx.cabinet.toUpperCase())}<br>${esc(rx.region)}</div>`
      : '';
  const sign = footer
    .filter((line) => rx.template !== 'stamped-table' || !line.startsWith('PHARMACIE'))
    .filter((line) => rx.template !== 'stamped-table' || line !== rx.region)
    .map((line) => `<div>${esc(line)}</div>`)
    .join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
${faces}
html, body { margin: 0; background: #fff; }
#sheet { width: 1100px; min-height: 1560px; box-sizing: border-box; padding: 60px 70px; background: #fbfaf4; position: relative; font-family: '${rx.printFont}'; font-size: 24px; color: #111; }
header { line-height: 1.4; }
.meds { ${hand} margin: 40px 0 0; line-height: 1.45; }
.meds .it { margin-top: 22px; }
.meds .pos { margin-left: 40px; font-size: 0.9em; }
table.meds { border-collapse: collapse; width: 100%; }
table.meds th, table.meds td { border: 2px solid #333; padding: 10px 14px; text-align: left; vertical-align: top; }
.sign { position: absolute; right: 90px; bottom: 120px; text-align: right; font-size: 24px; }
.stamp { position: absolute; left: 110px; bottom: 150px; width: 250px; height: 140px; border: 5px solid #5a2d82; border-radius: 18px; color: #5a2d82; opacity: .75; transform: rotate(8deg); display: grid; place-items: center; text-align: center; font: bold 22px Arial; padding: 14px; box-sizing: border-box; }
</style></head><body><div id="sheet"><header>${head}</header>${body}
<div class="sign">${sign}</div>${stamp}</div></body></html>`;
}
