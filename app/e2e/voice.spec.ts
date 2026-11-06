// SPDX-License-Identifier: MIT
// Voice input (SCRUM-31) in the built app, with a mocked speech client: the
// speech worker is replaced by a fake that answers the worker protocol
// (no model runs), the microphone is Chromium's fake device, and the voice
// pack is a small fake pack served by the test. The real recorder, voice pack
// installer, speech client and service worker run. One test runs the real
// speech worker, offline, from the cache the service worker keeps for it.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  expectWelcome,
  makeCode,
  onboard,
  unlock,
  waitForServiceWorkerControl,
} from './support.js';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

// Whole journeys (welcome, profile, install, record): more than the default on a loaded machine.
test.describe.configure({ timeout: 60_000 });

const PACKS = {
  wo: { id: 'whisper-small-wolof-q8', prompt: [50258] },
  fr: { id: 'whisper-base-fr-q8', prompt: [50258, 50265, 50359, 50363] },
} as const;

/** ORT_WEB_VERSION of @siapso/speech: the runtime files live under runtime/<version>/. */
const ORT_WEB_VERSION = '1.31.0-dev.20260914-8d85527a0';
const RUNTIME = [
  `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.mjs`,
  `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.wasm`,
];
const FILES = [
  'config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
  ...RUNTIME,
];
const FILE_BYTES = 4096;

/** Serves a small fake voice pack of each language under /voice/<id>/, and counts the requests. */
async function serveFakePacks(
  context: BrowserContext,
  files: readonly string[] = FILES,
): Promise<string[]> {
  const requested: string[] = [];
  context.on('request', (request) => {
    if (request.url().includes('/voice/')) requested.push(new URL(request.url()).pathname);
  });
  for (const [lang, pack] of Object.entries(PACKS)) {
    await context.route(`**/voice/${pack.id}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname.split(`/voice/${pack.id}/`)[1] ?? '';
      if (path === 'voice-pack.json') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            id: pack.id,
            licence: 'MIT',
            languages: [lang],
            prompts: { [lang]: pack.prompt },
            runtime: { 'onnxruntime-web': ORT_WEB_VERSION, licence: 'MIT' },
            files: files.map((file) => ({ path: file, bytes: FILE_BYTES })),
            totalBytes: files.length * FILE_BYTES,
          }),
        });
      } else if (files.includes(path)) {
        await route.fulfill({
          contentType: 'application/octet-stream',
          body: 'x'.repeat(FILE_BYTES),
        });
      } else {
        await route.fulfill({ status: 404 });
      }
    });
  }
  return requested;
}

/**
 * Replaces the speech worker (and only it) by a fake that answers the
 * worker protocol: a load is answered loaded, a transcription with the text
 * the test set. It records what it was sent.
 */
async function mockSpeechWorker(page: Page, transcript: string) {
  await page.addInitScript((heard: string) => {
    interface Message {
      type: 'load' | 'transcribe';
      id: number;
      samples?: Float32Array;
    }
    const seen = { loads: 0, transcribes: 0, samples: 0 };
    (window as unknown as { __speech: typeof seen }).__speech = seen;
    const RealWorker = window.Worker;
    class FakeSpeechWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        // As the real worker does when it starts: the address of its script.
        setTimeout(() => {
          this.onmessage?.({ data: { type: 'hello', id: 0, url } });
        }, 0);
      }
      postMessage(message: Message) {
        setTimeout(() => {
          if (message.type === 'load') {
            seen.loads += 1;
            this.onmessage?.({ data: { type: 'loaded', id: message.id, device: 'wasm' } });
          } else {
            seen.transcribes += 1;
            seen.samples = message.samples?.length ?? 0;
            this.onmessage?.({ data: { type: 'result', id: message.id, text: heard, ms: 5 } });
          }
        }, 100);
      }
      terminate() {
        // Nothing runs.
      }
    }
    window.Worker = function Worker(url: string | URL, options?: WorkerOptions) {
      if (options?.name === 'siapso-speech') {
        return new FakeSpeechWorker(new URL(url, location.href).href);
      }
      return new RealWorker(url, options);
    } as unknown as typeof Worker;
  }, transcript);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
};

/** Serves a file of the build copy in `dir`, as the preview server does. */
async function serveFile(dir: string, url: string, response: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(new URL(url, 'http://copy').pathname);
  const file = path.join(dir, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(dir)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

/** Welcome in French, woman mode, then her profile, as the check asks for it. */
async function startWithProfile(page: Page) {
  await onboard(page, 'woman');
  await profileAndCheck(page);
}

/** The same, on the page already open (another origin than the test server's). */
async function startWithProfileHere(page: Page) {
  await expectWelcome(page);
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await makeCode(page);
  await profileAndCheck(page);
}

/** Her first check (SCRUM-56, S4 and 8.3): her answers on it, then its field. */
async function profileAndCheck(page: Page) {
  await expect(page.getByRole('region', { name: 'À propos de vous' })).toBeVisible();
  await page
    .getByRole('group', { name: /^Enceinte/ })
    .getByText('Oui', { exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Terme de la grossesse' })
    .getByText('Je ne sais pas')
    .click();
  await page
    .getByRole('group', { name: /^Allaite/ })
    .getByText('Non', { exact: true })
    .click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Nom du médicament ou du remède' }),
  ).toBeVisible();
}

const mic = (page: Page) => page.getByRole('button', { name: 'Dire le nom' });

/** The speech worker scripts in each cache of the page's origin. */
function workerScripts(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const found: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const urls = (await (await caches.open(name)).keys())
        .map((request) => request.url)
        .filter((url) => /\/assets\/worker-[\w-]+\.js$/.test(url));
      if (urls.length > 0) found[name] = urls;
    }
    return found;
  });
}

/** From the search: the voice screen, Wolof, installed, back to the search. */
async function installWolof(page: Page) {
  await mic(page).click();
  await expect(
    page.getByRole('heading', { level: 1, name: "Parler au lieu d'écrire" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole('radio', { name: /^Wolof, 326/ }).check();
  await page.getByRole('button', { name: 'Installer la voix en wolof' }).click();
  await expect(page.getByText(/^La voix en wolof est installée/)).toBeVisible();
  await page.getByRole('button', { name: 'Revenir à la recherche' }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
}

/** Says a name: a tap, a second of the fake microphone, a tap. */
async function sayName(page: Page) {
  await mic(page).click();
  await expect(page.getByText("J'écoute en wolof.")).toBeVisible();
  await expect(page.getByText(/^\d s sur 8$/)).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: "Terminer l'enregistrement" }).click();
}

test('the app never fetches a voice file before the install button', async ({ page, context }) => {
  const requested = await serveFakePacks(context);
  await mockSpeechWorker(page, 'nebeday');
  await startWithProfile(page);
  await page.getByRole('searchbox').fill('nebeday');
  // The first test of a browser also waits for the knowledge pack, while the
  // service worker fills its precache through the routed network.
  await expect(page.locator('.candidate').first()).toContainText('Moringa', { timeout: 30_000 });

  // The microphone without a voice installed: the voice screen, its sizes, nothing fetched.
  await mic(page).click();
  // The first tap loads the small speech chunk to look at the phone: slower on a loaded machine.
  await expect(page.getByRole('radio', { name: /^Wolof, 326/ })).toBeVisible({ timeout: 15_000 });
  // No language is chosen for her: the install asks for one first.
  await expect(page.getByRole('radio', { name: /^Français, 137/ })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: /^Wolof, 326/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Installer la voix', exact: true }).click();
  await expect(page.getByText('Choisissez une langue.')).toBeVisible();
  await page.getByRole('radio', { name: /^Wolof, 326/ }).check();
  await page.getByRole('button', { name: 'Revenir à la recherche' }).click();
  // The letters typed before the microphone are still there.
  await expect(page.getByRole('searchbox')).toHaveValue('nebeday');
  await page.goto('/#/settings');
  await page.getByRole('link', { name: "Parler au lieu d'écrire" }).click();
  await page.getByRole('radio', { name: /^Français, 137/ }).check();
  await expect(page.getByRole('button', { name: 'Installer la voix en français' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(requested).toEqual([]);

  // The install button, and only it, downloads the pack.
  await page.getByRole('button', { name: 'Installer la voix en français' }).click();
  await expect(page.getByText(/^La voix en français est installée/)).toBeVisible();
  expect(requested).toContain('/voice/whisper-base-fr-q8/voice-pack.json');
  expect(requested).toEqual(
    expect.arrayContaining(FILES.map((file) => `/voice/whisper-base-fr-q8/${file}`)),
  );
  expect(requested.some((path) => path.includes('whisper-small-wolof'))).toBe(false);
});

test('say "nebeday", see Moringa, confirm it, and it is added', async ({ page, context }) => {
  await serveFakePacks(context);
  await mockSpeechWorker(page, 'nebeday');
  await startWithProfile(page);
  await installWolof(page);
  await expectNoSeriousViolation(page);

  await mic(page).click();
  await expect(page.getByText("J'écoute en wolof.")).toBeVisible();
  await expect(page.locator('.mic--recording')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Annuler' })).toBeVisible();
  await page.waitForTimeout(1200);
  // Finished by a tap, or by itself at 8 s on a slow machine: the same result.
  await page
    .getByRole('button', { name: "Terminer l'enregistrement" })
    .click({ timeout: 5000 })
    .catch(() => undefined);

  await expect(page.getByText("J'ai entendu : nebeday")).toBeVisible({ timeout: 15_000 });
  await expectNoSeriousViolation(page);
  await expect(page.getByRole('searchbox')).toHaveValue('nebeday');
  const moringa = page.getByRole('list', { name: 'Propositions' }).locator('.candidate').first();
  await expect(moringa).toContainText('Moringa');
  await expect(moringa).toContainText('Nom local : nebeday (wolof)');
  // The fake microphone was recorded, resampled and sent to the (fake) model.
  const seen = await page.evaluate(
    () => (window as unknown as { __speech: { transcribes: number; samples: number } }).__speech,
  );
  expect(seen.transcribes).toBe(1);
  expect(seen.samples).toBeGreaterThan(8000);
  // Nothing is added before the confirmation.
  await moringa.click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();
  const items = page.getByRole('list', { name: 'Produits ajoutés' }).getByRole('listitem');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Moringa');
});

test('in airplane mode, an installed voice still finds Moringa', async ({ page, context }) => {
  await serveFakePacks(context);
  await mockSpeechWorker(page, 'nebeday');
  await startWithProfile(page);
  await installWolof(page);
  await waitForServiceWorkerControl(page);

  // The speech worker's own script is kept once the voice is installed: the real one starts offline too.
  expect((await workerScripts(page))['siapso-voice-worker']).toHaveLength(1);

  await context.setOffline(true);
  await page.reload();
  await unlock(page);
  await page.goto('/#/check');
  await sayName(page);
  await expect(page.getByText("J'ai entendu : nebeday")).toBeVisible();
  await page.getByRole('list', { name: 'Propositions' }).locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();
  await expect(
    page.getByRole('list', { name: 'Produits ajoutés' }).getByRole('listitem').first(),
  ).toContainText('Moringa');
});

test.describe('with an update waiting', () => {
  // The update must be a real one (new bytes of sw.js at the same address),
  // which the test cannot route: this test serves its own copy of the build,
  // on its own origin, and changes that copy's sw.js, so no other test sees it.
  let origin = '';
  let copy = '';
  let server: Server | undefined;

  test.beforeAll(async () => {
    copy = await mkdtemp(path.join(tmpdir(), 'siapso-update-'));
    await cp(fileURLToPath(new URL('../dist-demo/', import.meta.url)), copy, { recursive: true });
    server = createServer((request, response) => {
      void serveFile(copy, request.url ?? '/', response);
    });
    await new Promise<void>((resolve) => server?.listen(0, 'localhost', resolve));
    const address = server.address();
    origin = `http://localhost:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) resolve();
      else
        server.close(() => {
          resolve();
        });
    });
    await rm(copy, { recursive: true, force: true });
  });

  test('the worker in control keeps the very script the page runs', async ({ page, context }) => {
    const requested = await serveFakePacks(context, RUNTIME);
    await page.goto(`${origin}/`);
    await startWithProfileHere(page);
    await waitForServiceWorkerControl(page);
    await page.reload();
    await unlock(page);

    // An update waits, a broken one: it never answers about the speech worker
    // script. Only the worker in control can keep it.
    const sw = path.join(copy, 'sw.js');
    await writeFile(
      sw,
      "self.addEventListener('message', (event) => { if (event.data && event.data.type === 'CACHE_VOICE_WORKER') event.stopImmediatePropagation(); });\n" +
        (await readFile(sw, 'utf8')),
    );
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(page.getByText('Une nouvelle version est prête.')).toBeVisible({
      timeout: 30_000,
    });

    await page.goto(`${origin}/#/check`);
    await installWolof(page);
    expect((await workerScripts(page))['siapso-voice-worker']).toHaveLength(1);

    // Offline, still under the worker in control (the update still waits): the page's own worker starts.
    const before = requested.length;
    await context.setOffline(true);
    await page.reload();
    await unlock(page);
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
    await page.goto(`${origin}/#/check`);
    await mic(page).click();
    await expect(page.getByText(/^La voix n'est pas complète sur ce téléphone\./)).toBeVisible({
      timeout: 30_000,
    });
    expect(requested.slice(before)).toEqual([]);
  });
});

test('the real speech worker is kept with the voice only, survives a new install, and starts offline under isolation', async ({
  page,
  context,
}) => {
  // A pack of runtime files only: the real worker finds no model in it and says so.
  const requested = await serveFakePacks(context, RUNTIME);
  await startWithProfile(page);
  await waitForServiceWorkerControl(page);
  // No voice yet: the worker script is not downloaded with the app.
  expect(await workerScripts(page)).toEqual({});

  // A reload locks: the code, then the check again.
  await page.reload();
  await unlock(page);
  await page.goto('/#/check');
  await installWolof(page);
  expect(await workerScripts(page)).toEqual({ 'siapso-voice-worker': [expect.any(String)] });

  // A new install of the app (an update): its install brings the script of
  // the voice installed, or fails. Here the script is gone and the service
  // worker is installed again.
  await page.evaluate(async () => {
    await caches.delete('siapso-voice-worker');
    await (await navigator.serviceWorker.getRegistration())?.unregister();
  });
  await page.reload();
  await waitForServiceWorkerControl(page);
  expect((await workerScripts(page))['siapso-voice-worker']).toHaveLength(1);

  // Offline, the page is served by the service worker, so isolated.
  const before = requested.length;
  await context.setOffline(true);
  await page.reload();
  await unlock(page);
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  await page.goto('/#/check');
  await mic(page).click();
  // The real worker started from its cache, read the pack from the Cache API
  // only, and answered that the model is not there: unavailable.
  await expect(page.getByText(/^La voix n'est pas complète sur ce téléphone\./)).toBeVisible({
    timeout: 30_000,
  });
  expect(requested.slice(before)).toEqual([]);
});

test('a refused microphone is explained in words, and typing goes on', async ({
  page,
  context,
}) => {
  await serveFakePacks(context);
  await mockSpeechWorker(page, 'nebeday');
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await startWithProfile(page);
  await installWolof(page);
  await mic(page).click();
  await expect(page.getByText('Le micro est bloqué pour cette application.')).toBeVisible();
  await expect(page.getByText('Touchez Paramètres des sites, puis Micro.')).toBeVisible();
  await page.getByRole('button', { name: 'Écrire le nom' }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.type('kinkeliba');
  await expect(page.locator('.candidate').first()).toContainText('Kinkéliba');
  await expectNoSeriousViolation(page);
});

test('offline, the install button is off and says to connect, and nothing is requested', async ({
  page,
  context,
}) => {
  const requested = await serveFakePacks(context);
  await mockSpeechWorker(page, 'nebeday');
  await startWithProfile(page);
  await mic(page).click();
  await page.getByRole('radio', { name: /^Français, 137/ }).check({ timeout: 15_000 });
  await context.setOffline(true);
  const install = page.getByRole('button', { name: 'Installer la voix en français' });
  await expect(install).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Connectez-vous à Internet pour installer la voix.')).toBeVisible();
  // A tap anyway (aria-disabled keeps it focusable): nothing happens.
  await install.click({ force: true });
  await page.waitForTimeout(500);
  expect(requested).toEqual([]);
  await expect(page.getByText(/Reprendre|interrompu/)).toHaveCount(0);
  await expectNoSeriousViolation(page);
});

test('a server that answers the voice with the app page says the voice is not available', async ({
  page,
  context,
}) => {
  await context.route('**/voice/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Carnet</title>' }),
  );
  await startWithProfile(page);
  await mic(page).click();
  await page.getByRole('radio', { name: /^Français, 137/ }).check({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Installer la voix en français' }).click();
  await expect(
    page.getByText(/^La voix ne peut pas être téléchargée pour le moment/),
  ).toBeVisible();
  await expect(page.getByText(/dites-le au poste de santé|ne sont pas bons/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: "Reprendre l'installation" })).toHaveCount(0);
});

test.describe('at 360 px with text at 200 percent', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  /** Nothing scrolls sideways and every control of the main area is a 48 px target. */
  async function expectFitsAndTargets(page: Page) {
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'main a, main button, main label.option, main input, main summary',
        ),
      ]
        .filter((el) => !(el instanceof HTMLInputElement && el.closest('label.option')))
        .map((el) => ({ text: el.textContent, box: el.getBoundingClientRect() }))
        // Hidden ones (the results while the whole list shows) have no box.
        .filter(({ box }) => box.width > 0 || box.height > 0)
        .filter(({ box }) => box.width < 48 || box.height < 48)
        .map(({ text }) => text),
    );
    expect(small).toEqual([]);
  }

  test('the voice screen, the voice panel and the licences fit, with 48 px targets', async ({
    page,
    context,
  }) => {
    await serveFakePacks(context);
    await mockSpeechWorker(page, 'zzqxw');
    await startWithProfile(page);
    await mic(page).click();
    await expect(
      page.getByRole('button', { name: 'Installer la voix', exact: true }),
    ).toBeVisible();
    await expectFitsAndTargets(page);

    await page.getByRole('button', { name: 'Revenir à la recherche' }).click();
    await installWolof(page);
    await sayName(page);
    await expect(page.getByText("J'ai entendu : zzqxw")).toBeVisible();
    await page.getByRole('button', { name: 'Choisir dans la liste des remèdes' }).click();
    await expect(page.getByRole('region', { name: 'Tous les remèdes' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Aller à une lettre' })).toBeVisible();
    await expectFitsAndTargets(page);
    await expectNoSeriousViolation(page);

    await page.goto('/#/licences');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Licences des logiciels tiers' }),
    ).toBeVisible();
    await expectFitsAndTargets(page);
    await expectNoSeriousViolation(page);
  });
});
