// SPDX-License-Identifier: MIT
// Measured evidence, not a CI test: `pnpm voice:bench` after
// `pnpm voice:convert` and `pnpm voice:install-local`. Installs the Wolof pack,
// goes offline, transcribes a fixed FLEURS utterance (fixtures/README.md) and
// records the time with no throttling and with CPU throttling 4x and 6x
// (Chrome DevTools Protocol), rough stand-ins for mid-range and entry-level
// phones. Real phones must be measured by the team (docs/voice.md).
//
// DevTools throttling slows the page thread, not workers: the throttled runs
// use the same pipeline and settings on the page thread. BENCH_RATES sets the
// rates (default 1,4,6); BENCH_ISOLATED=1 serves the page cross-origin
// isolated, so ONNX Runtime can use several threads (then only rate 1 means
// something, as its threads are workers too).
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const PACK = 'voice/whisper-small-wolof-q8/';
const FIXTURE = new URL('./fixtures/fleurs-wo_sn-test-9405789794868564555.wav', import.meta.url);
const WARM_RUNS = 3;
const RATES = (process.env['BENCH_RATES'] ?? '1,4,6').split(',').map(Number);

interface Transcription {
  text: string;
  ms: number;
}

interface Bench {
  loadBeforeInstall(url: string): Promise<string>;
  install(url: string): Promise<{ id: string; totalBytes: number; ms: number }>;
  loadWorker(): Promise<{ ms: number; device: string | undefined }>;
  transcribeWorker(samples: number[], language: string): Promise<Transcription>;
  loadPage(): Promise<number>;
  transcribePage(samples: number[], language: string): Promise<Transcription>;
  environment(): Promise<Record<string, unknown>>;
  cacheState(): Promise<Record<string, unknown>>;
}

const cacheState = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { siapsoBench: Bench }).siapsoBench.cacheState());

/** 16-bit PCM mono WAV to samples between -1 and 1. */
function readWav(file: URL): { samples: number[]; rate: number } {
  const data = readFileSync(file);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a WAV');
  let offset = 12;
  let rate = 0;
  let bits = 0;
  let channels = 0;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = data.readUInt16LE(body + 2);
      rate = data.readUInt32LE(body + 4);
      bits = data.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16 || channels !== 1) throw new Error('expected 16-bit mono PCM');
      const samples: number[] = [];
      for (let i = body; i + 1 < body + size; i += 2) samples.push(data.readInt16LE(i) / 32768);
      return { samples, rate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

async function runs(
  page: Page,
  mode: 'worker' | 'page',
  samples: number[],
  count: number,
): Promise<Transcription[]> {
  const results: Transcription[] = [];
  for (let i = 0; i < count; i++) {
    results.push(
      await page.evaluate(
        ([m, s]) => {
          const bench = (globalThis as unknown as { siapsoBench: Bench }).siapsoBench;
          return m === 'worker' ? bench.transcribeWorker(s, 'wo') : bench.transcribePage(s, 'wo');
        },
        [mode, samples] as const,
      ),
    );
  }
  return results;
}

test('transcribes a Wolof utterance offline, with and without CPU throttling', async ({
  page,
  context,
}) => {
  test.setTimeout(30 * 60_000);
  const requests: string[] = [];
  let offline = false;
  const afterOffline: string[] = [];
  context.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http')) return;
    requests.push(url);
    if (offline) afterOffline.push(url);
  });

  const { samples, rate } = readWav(FIXTURE);
  expect(rate).toBe(16000);
  const seconds = samples.length / rate;
  expect(seconds).toBeGreaterThanOrEqual(3);
  expect(seconds).toBeLessThanOrEqual(5);

  await page.goto('/');
  const environment = await page.evaluate(() =>
    (globalThis as unknown as { siapsoBench: Bench }).siapsoBench.environment(),
  );
  // The worker script comes from the network here (the app precaches it with
  // its service worker; this bench page has none). Before installation,
  // loading fails and downloads nothing.
  const workerScript = page.waitForResponse((response) =>
    response.url().includes('/assets/worker-'),
  );
  const beforeInstall = await page.evaluate(
    (url) => (globalThis as unknown as { siapsoBench: Bench }).siapsoBench.loadBeforeInstall(url),
    PACK,
  );
  expect(beforeInstall).toBe('unavailable');
  expect((await workerScript).ok()).toBe(true);
  const modelRequests = () =>
    requests.filter((url) => url.includes('/onnx/') || url.includes('/runtime/'));
  expect(modelRequests()).toEqual([]);

  const installed = await page.evaluate(
    (url) => (globalThis as unknown as { siapsoBench: Bench }).siapsoBench.install(url),
    PACK,
  );
  const cacheAfterInstall = await cacheState(page);
  console.log('Cache after install:', JSON.stringify(cacheAfterInstall));

  // Then the network goes off: the model and the ONNX Runtime binaries load
  // from the Cache API only.
  await context.setOffline(true);
  offline = true;
  const cdp = await context.newCDPSession(page);
  const throttle = (value: number) => cdp.send('Emulation.setCPUThrottlingRate', { rate: value });

  const workerLoad = await page.evaluate(() =>
    (globalThis as unknown as { siapsoBench: Bench }).siapsoBench.loadWorker(),
  );
  const [workerCold] = await runs(page, 'worker', samples, 1);
  const workerWarm = await runs(page, 'worker', samples, WARM_RUNS);
  // Shows whether DevTools throttling reaches the worker.
  await throttle(4);
  const workerThrottled4 = await runs(page, 'worker', samples, 1);
  await throttle(1);

  const cacheBeforePage = await cacheState(page);
  console.log('Cache before the page-thread load:', JSON.stringify(cacheBeforePage));
  const pageLoadMs = await page.evaluate(() =>
    (globalThis as unknown as { siapsoBench: Bench }).siapsoBench.loadPage(),
  );
  const [pageCold] = await runs(page, 'page', samples, 1);
  const pageRuns: Record<string, Transcription[]> = {};
  for (const value of RATES) {
    await throttle(value);
    pageRuns[`${String(value)}x`] = await runs(page, 'page', samples, WARM_RUNS);
  }
  await throttle(1);

  const report = {
    date: new Date().toISOString(),
    environment,
    loadBeforeInstall: beforeInstall,
    pack: installed,
    cache: { afterInstall: cacheAfterInstall, beforePageLoad: cacheBeforePage },
    utterance: {
      file: 'fleurs-wo_sn-test-9405789794868564555.wav',
      seconds: Number(seconds.toFixed(2)),
    },
    reference: 'great pyramid bi ci giza dong mo taxaw batay',
    worker: {
      loadMs: workerLoad.ms,
      device: workerLoad.device,
      cold: workerCold,
      warm: workerWarm,
      medianMs: median(workerWarm.map((r) => r.ms)),
      throttled4x: workerThrottled4,
    },
    page: {
      loadMs: pageLoadMs,
      cold: pageCold,
      runs: pageRuns,
      medianMs: Object.fromEntries(
        Object.entries(pageRuns).map(([key, values]) => [key, median(values.map((r) => r.ms))]),
      ),
    },
    requestsAfterOffline: afterOffline,
    hosts: [...new Set(requests.map((url) => new URL(url).host))],
  };
  console.log(JSON.stringify(report, null, 2));
  const out = process.env['BENCH_OUT'];
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  // Nothing leaves the bench origin, and nothing at all once offline.
  expect(report.hosts).toEqual([new URL(page.url()).host]);
  expect(afterOffline).toEqual([]);
  expect(workerWarm.every((r) => r.text.length > 0)).toBe(true);
});
