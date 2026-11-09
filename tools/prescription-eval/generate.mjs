// SPDX-License-Identifier: MIT
// Renders the synthetic prescriptions to images (SCRUM-57 spike):
//   node tools/prescription-eval/generate.mjs <out-dir> [count=24] [fonts-dir]
// For each prescription: <id>-scan.png (the clean sheet), then three phone
// photos, <id>-photo.jpg, <id>-hard.jpg and <id>-dim.jpg, and truth.json
// (what each one says). Needs the built pack (pnpm knowledge:build) and the
// Playwright Chromium of the app. The fonts directory holds the TTF files of
// HAND_FONTS (Google Fonts, OFL or Apache-2.0; not committed): without them
// the handwriting proxies fall back to a print font. Never commit the images.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRx, sceneHtml, sheetHtml, VARIANTS } from './synth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(path.join(root, 'app/package.json'));
const { chromium } = require('@playwright/test');

const [outArg, countArg = '24', fontsArg] = process.argv.slice(2);
if (outArg === undefined) {
  console.error('usage: node tools/prescription-eval/generate.mjs <out-dir> [count] [fonts-dir]');
  process.exit(2);
}
const out = path.resolve(outArg);
const fonts = fontsArg === undefined ? undefined : path.resolve(fontsArg);
const pack = JSON.parse(await readFile(path.join(root, 'app/public/pack/pack.json'), 'utf8'));
const substancesOf = (id) => {
  const product = pack.products.find((p) => p.id === id);
  if (product === undefined) throw new Error(`no product ${id} in the pack`);
  return product.components
    .map((c) => c.substance)
    .sort()
    .join('+');
};

// Serves the output folder and the fonts to the browser, on this machine only.
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const name = path.basename(decodeURIComponent(url.pathname));
  const file =
    url.pathname.startsWith('/fonts/') && fonts ? path.join(fonts, name) : path.join(out, name);
  readFile(file)
    .then((body) => {
      res.writeHead(200);
      res.end(body);
    })
    .catch(() => {
      res.writeHead(404);
      res.end();
    });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const address = server.address();
const origin = `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`;

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1560 } });
const truth = [];
for (let i = 0; i < Number(countArg); i++) {
  const rx = makeRx(i, substancesOf);
  await writeFile(path.join(out, `${rx.id}.html`), sheetHtml(rx));
  await page.goto(`${origin}/${rx.id}.html`);
  // These callbacks run in the browser page, not in Node.
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.locator('#sheet').screenshot({ path: path.join(out, `${rx.id}-scan.png`) });
  for (const [name, v] of Object.entries(VARIANTS)) {
    await page.setViewportSize({ width: v.w, height: v.h });
    await page.setContent(
      sceneHtml(`${origin}/${rx.id}-scan.png`, v, i % 2 === 0 ? 1 : -1, 77 + i),
    );
    await page.waitForFunction(() => globalThis.document.getElementById('im')?.complete === true);
    await page.screenshot({
      path: path.join(out, `${rx.id}-${name}.jpg`),
      type: 'jpeg',
      quality: v.q,
    });
  }
  await page.setViewportSize({ width: 1100, height: 1560 });
  // The truth keeps what the prescription says, not the layout's random draws.
  const kept = { ...rx };
  delete kept.jitter;
  truth.push(kept);
}
await writeFile(path.join(out, 'truth.json'), JSON.stringify(truth, null, 1));
await browser.close();
server.close();
console.log(`${String(truth.length)} prescriptions in ${out}`);
