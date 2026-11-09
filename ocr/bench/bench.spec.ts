// SPDX-License-Identifier: MIT
// Measured evidence, not a CI test: `pnpm ocr:bench` after
// `pnpm ocr:install-local`. A synthetic printed prescription (fake names,
// made here, never saved) is rendered as a clean scan, a phone photo, a text
// PDF and a scanned PDF. The bench checks that nothing is requested before
// the install action, installs the pack, goes offline, reads each document
// in the worker (and a camera frame), then times the same engine on the page
// thread with CPU throttling 1x, 4x and 6x (BENCH_RATES), rough stand-ins
// for a laptop, a mid-range and an entry-level phone. Real phones are
// measured by the team (docs/ocr.md).
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const MANIFEST = fileURLToPath(
  new URL('../../app/public/ocr/ppocrv5-mobile-latin/ocr-pack.json', import.meta.url),
);
const RATES = (process.env['BENCH_RATES'] ?? '1,4,6').split(',').filter(Boolean).map(Number);

interface Reading {
  lines: string[];
  source: string;
  pages: number;
  ms: number;
  wallMs?: number;
}

interface Bench {
  installed(): Promise<boolean>;
  readBeforeInstall(base64: string, type: string): Promise<string>;
  install(): Promise<{ id: string; totalBytes: number; ms: number }>;
  read(base64: string, type: string): Promise<Reading>;
  readFrame(base64: string, type: string): Promise<Reading>;
  release(): void;
  loadPage(): Promise<number>;
  readPage(base64: string, type: string): Promise<Reading>;
  cacheState(): Promise<Record<string, unknown>>;
  environment(): Record<string, unknown>;
}

/** Fake content only: no real prescription, no real person. */
const SHEET = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
body { margin: 0; background: #fff; }
#sheet { width: 1100px; min-height: 1500px; box-sizing: border-box; padding: 60px 70px; background: #fdfcf7; font: 30px Arial, sans-serif; color: #111; }
h1 { text-align: center; font-size: 40px; letter-spacing: 6px; margin: 30px 0; }
li { margin: 0 0 26px; } .pos { margin-left: 34px; font-size: 27px; }
</style></head><body><div id="sheet">
<div style="text-align:center;line-height:1.4"><b>CENTRE DE SANTÉ DE TEST</b><br>Service de maternité</div>
<h1>ORDONNANCE</h1>
<p>Nom et prénom : Awa Diop &nbsp; Âge : 27 ans</p>
<ol>
<li>Doliprane 1000 mg cp<div class="pos">1 cp x 3/j si douleur</div></li>
<li>Amoxicilline 500 mg gél<div class="pos">2 gél x 3/j pendant 7 jours</div></li>
<li>Fer + Acide folique cp : 1 cp/jour pendant 3 mois</li>
<li>Spasfon Lyoc 80 mg<div class="pos">1 lyoc x 3/j si douleur</div></li>
</ol>
<p style="margin-top:120px;text-align:right">Signature et cachet<br>Dr Moussa Test</p>
</div></body></html>`;

const EXPECTED = [
  'doliprane 1000 mg',
  'amoxicilline 500 mg',
  'acide folique',
  'spasfon lyoc 80 mg',
];

const plain = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

function found(lines: readonly string[]): string[] {
  const text = lines.map(plain);
  return EXPECTED.filter((name) => text.some((line) => line.includes(name)));
}

/** The synthetic documents, rendered in a page of their own (not the bench page). */
async function documents(context: BrowserContext) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 1500 });
  await page.setContent(SHEET);
  const scan = await page.locator('#sheet').screenshot({ type: 'png' });
  const textPdf = await page.pdf({ width: '1100px', height: '1500px', printBackground: true });
  // A phone photo: the page on a table, turned and tilted, slightly blurred, as a JPEG.
  await page.setViewportSize({ width: 1200, height: 1600 });
  await page.setContent(
    `<html><body style="margin:0;width:1200px;height:1600px;overflow:hidden;background:#6b4f36">
<div style="position:absolute;inset:0;display:grid;place-items:center;perspective:1400px;filter:blur(0.5px) brightness(0.95) contrast(0.95)">
<img id="im" src="data:image/png;base64,${scan.toString('base64')}" style="width:1080px;transform:rotateX(6deg) rotateY(3deg) rotateZ(3deg)"></div></body></html>`,
  );
  await page.waitForFunction(
    () => (globalThis.document.getElementById('im') as HTMLImageElement | null)?.complete === true,
  );
  const photo = await page.screenshot({ type: 'jpeg', quality: 75 });
  await page.setViewportSize({ width: 1100, height: 1500 });
  await page.setContent(
    `<html><body style="margin:0"><img id="im" src="data:image/jpeg;base64,${photo.toString('base64')}" style="width:1100px"></body></html>`,
  );
  await page.waitForFunction(
    () => (globalThis.document.getElementById('im') as HTMLImageElement | null)?.complete === true,
  );
  const scannedPdf = await page.pdf({ width: '1100px', height: '1467px', printBackground: true });
  await page.close();
  return {
    scan: scan.toString('base64'),
    photo: photo.toString('base64'),
    textPdf: textPdf.toString('base64'),
    scannedPdf: scannedPdf.toString('base64'),
  };
}

const call = <T>(page: Page, method: keyof Bench, ...args: string[]) =>
  page.evaluate(
    ([name, rest]) => {
      const bench = (
        globalThis as unknown as { siapsoBench: Record<string, (...a: string[]) => unknown> }
      ).siapsoBench;
      return bench[name]?.(...rest);
    },
    [method, args] as const,
  ) as Promise<T>;

test('reads a synthetic prescription offline, photo and PDF, with and without CPU throttling', async ({
  page,
  context,
}) => {
  test.skip(
    !existsSync(MANIFEST),
    'No reading pack in app/public/ocr/: run pnpm ocr:install-local first.',
  );
  test.setTimeout(20 * 60_000);
  const docs = await documents(context);

  const requests: string[] = [];
  let offline = false;
  const afterOffline: string[] = [];
  context.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http')) return;
    requests.push(url);
    if (offline) afterOffline.push(url);
  });
  const since = (from: number) => requests.slice(from).map((url) => new URL(url).pathname);
  // Errors of the page and of the worker, said in the bench output.
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.log(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on('worker', (worker) => {
    worker.on('console', (message) => {
      console.log(`worker console ${message.type()}: ${message.text()}`);
    });
  });
  page.on('pageerror', (error) => {
    console.log(`page error: ${error.message}`);
  });

  await page.goto('/');
  const environment = await call<Record<string, unknown>>(page, 'environment');

  // Before the install action: whether the pack is there is read from the cache, with no request.
  let mark = requests.length;
  expect(await call<boolean>(page, 'installed')).toBe(false);
  expect(since(mark)).toEqual([]);

  // The install screen reads the manifest; a reading asked now fails and starts nothing.
  mark = requests.length;
  expect(await call<string>(page, 'readBeforeInstall', docs.scan, 'image/png')).toBe('unavailable');
  expect(since(mark)).toEqual(['/ocr/ppocrv5-mobile-latin/ocr-pack.json']);

  const installed = await call<{ id: string; totalBytes: number; ms: number }>(page, 'install');
  const cacheAfterInstall = await call<Record<string, unknown>>(page, 'cacheState');

  // First reading online: the worker script comes from the network (the app's
  // service worker will keep it); the models come from the cache only.
  mark = requests.length;
  const first = await call<Reading>(page, 'read', docs.scan, 'image/png');
  // The models freed (the page hidden), then loaded again for the next reading:
  // a new worker, whose script this bench page (no service worker) fetches again.
  await call(page, 'release');
  const afterRelease = await call<Reading>(page, 'read', docs.scan, 'image/png');
  const firstRequests = since(mark);
  expect(firstRequests.every((path) => /\/assets\/ocr-worker-[\w-]+\.js$/.test(path))).toBe(true);

  await context.setOffline(true);
  offline = true;
  const scan = await call<Reading>(page, 'read', docs.scan, 'image/png');
  const photo = await call<Reading>(page, 'read', docs.photo, 'image/jpeg');
  const frame = await call<Reading>(page, 'readFrame', docs.photo, 'image/jpeg');
  const textPdf = await call<Reading>(page, 'read', docs.textPdf, 'application/pdf');
  const scannedPdf = await call<Reading>(page, 'read', docs.scannedPdf, 'application/pdf');

  // The same engine on the page thread, where DevTools CPU throttling applies.
  const cdp = await context.newCDPSession(page);
  const pageLoadMs = await call<number>(page, 'loadPage');
  const throttled: Record<string, number> = {};
  for (const rate of RATES) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    throttled[`${String(rate)}x`] = (
      await call<Reading>(page, 'readPage', docs.scan, 'image/png')
    ).ms;
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const readings = { first, scan, photo, frame, textPdf, scannedPdf, afterRelease };
  const report = {
    date: new Date().toISOString(),
    environment,
    pack: installed,
    cacheAfterInstall,
    firstReadingRequests: firstRequests,
    worker: Object.fromEntries(
      Object.entries(readings).map(([name, r]) => [
        name,
        {
          ms: r.ms,
          wallMs: r.wallMs,
          source: r.source,
          pages: r.pages,
          found: found(r.lines),
          lines: r.lines,
        },
      ]),
    ),
    page: { loadMs: pageLoadMs, scanMs: throttled },
    requestsAfterOffline: afterOffline,
    hosts: [...new Set(requests.map((url) => new URL(url).host))],
  };
  console.log(JSON.stringify(report, null, 2));
  const out = process.env['BENCH_OUT'];
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  // Nothing leaves the bench origin, and nothing at all once offline.
  expect(report.hosts).toEqual([new URL(page.url()).host]);
  expect(afterOffline).toEqual([]);
  for (const [name, reading] of Object.entries(readings)) {
    expect(found(reading.lines), name).toEqual(EXPECTED);
  }
  expect(textPdf.source).toBe('pdf-text');
  expect(scannedPdf.source).toBe('pdf-scan');
});
