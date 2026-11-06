// SPDX-License-Identifier: MIT
// Writes the fresh held-out set (fresh.mjs) to eval/prescription/fresh/:
// truth.json (what each prescription says) and pages.json (the HTML of each
// sheet by its id, to render and read with an OCR engine; eval/ holds no
// HTML file), with the substances of the pack built from the repository.
// Run once to freeze the set; a test checks that the generator still gives
// these files.
//   pnpm --filter @siapso/prescription-eval exec tsx freeze-fresh.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPack, loadContent } from '@siapso/pack-tools';
import { FRESH_COUNT, freshSheetHtml, makeFreshRx } from './fresh.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const folder = path.join(root, 'eval', 'prescription', 'fresh');
const pack = buildPack(await loadContent(root));
const substancesOf = (id: string) =>
  (pack.products.find((p) => p.id === id)?.components ?? [])
    .map((c) => c.substance)
    .sort()
    .join('+');

await mkdir(folder, { recursive: true });
const truth = Array.from({ length: FRESH_COUNT }, (_, i) => makeFreshRx(i, substancesOf));
const pages = Object.fromEntries(truth.map((rx) => [rx.id, freshSheetHtml(rx)]));
await writeFile(path.join(folder, 'pages.json'), `${JSON.stringify(pages, null, 2)}\n`);
await writeFile(path.join(folder, 'truth.json'), `${JSON.stringify(truth, null, 2)}\n`);
console.log(`${String(truth.length)} fresh prescriptions in ${folder}`);
