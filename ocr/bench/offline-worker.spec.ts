// SPDX-License-Identifier: MIT
// The reading worker starts offline from the app's service worker, with no
// voice installed: the bench page under the app's own service worker
// (app/src/sw.ts, built over the bench by bench/vite.config.ts), the pack
// installed, a reading, the models freed (release, as when the page is
// hidden), the network cut, then a new worker that reads a scanned PDF
// (CCITT Group 4, decoded by the pack's jbig2.wasm). Part of `pnpm ocr:bench`
// (it needs the pack: `pnpm ocr:install-local`); run it alone with
// `pnpm --filter @siapso/ocr exec playwright test --config bench/playwright.config.ts offline-worker`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { ccittScan, makePdf } from '../test/pdf-fixtures.js';

const MANIFEST = fileURLToPath(
  new URL('../../app/public/ocr/ppocrv5-mobile-latin/ocr-pack.json', import.meta.url),
);

interface Reading {
  lines: string[];
  source: string;
  pages: number;
}

const EXPECTED = [
  'doliprane 1000 mg',
  'amoxicilline 500 mg',
  'acide folique',
  'spasfon lyoc 80 mg',
];

const plain = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

const found = (lines: readonly string[]) =>
  EXPECTED.filter((name) => lines.map(plain).some((line) => line.includes(name)));

const call = <T>(page: Page, method: string, ...args: string[]) =>
  page.evaluate(
    ([name, rest]) => {
      const bench = (
        globalThis as unknown as { siapsoBench: Record<string, (...a: string[]) => unknown> }
      ).siapsoBench;
      return bench[name]?.(...rest);
    },
    [method, args] as const,
  ) as Promise<T>;

test('a new reading worker starts offline from the precache, with no voice installed', async ({
  page,
  context,
}) => {
  test.skip(
    !existsSync(MANIFEST),
    'No reading pack in app/public/ocr/: run pnpm ocr:install-local first.',
  );
  test.setTimeout(5 * 60_000);
  const scan = Buffer.from(makePdf([{ image: ccittScan() }])).toString('base64');

  // The reading workers the page starts (those of ONNX Runtime's threads have blob addresses).
  const readingWorkers: string[] = [];
  page.on('worker', (worker) => {
    if (!worker.url().startsWith('blob:')) readingWorkers.push(new URL(worker.url()).pathname);
    worker.on('console', (message) => {
      if (message.type() === 'error') console.log(`worker console: ${message.text()}`);
    });
  });
  let offline = false;
  const failedOffline: string[] = [];
  context.on('requestfailed', (request) => {
    if (offline) failedOffline.push(request.url());
  });

  // The app's first visit: its service worker installs, precaches and takes control.
  await page.goto('/');
  expect(await call<boolean>(page, 'serviceWorker')).toBe(true);
  // Served by the service worker from now on, with the isolation headers.
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);

  // No voice: the speech worker's cache and the voice pack cache are absent.
  const before = await call<string[]>(page, 'cacheNames');
  expect(before).not.toContain('siapso-voice-worker');
  expect(before).not.toContain('transformers-cache');

  await call(page, 'install');
  const online = await call<Reading>(page, 'read', scan, 'application/pdf');
  expect(online.source).toBe('pdf-scan');
  expect(found(online.lines)).toEqual(EXPECTED);

  // The models freed, then the network cut: the next reading needs a new worker.
  await call(page, 'release');
  // The browser's HTTP cache is no place to keep a script offline (it is
  // evicted at will): emptied here, so the script comes from the precache or not at all.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await context.setOffline(true);
  offline = true;
  const afterRelease = await call<Reading>(page, 'read', scan, 'application/pdf');
  expect(afterRelease.source).toBe('pdf-scan');
  expect(found(afterRelease.lines)).toEqual(EXPECTED);
  expect(readingWorkers).toHaveLength(2);
  expect(failedOffline).toEqual([]);

  // Its script, from the precache with the isolation headers, by a name of its own.
  const [script = ''] = readingWorkers;
  expect(script).toMatch(/^\/assets\/ocr-worker-[\w-]+\.js$/);
  expect(await call(page, 'script', script)).toEqual({
    status: 200,
    coop: 'same-origin',
    coep: 'require-corp',
  });
  console.log(JSON.stringify({ script, lines: afterRelease.lines }, null, 2));
});
