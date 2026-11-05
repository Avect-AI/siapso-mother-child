// SPDX-License-Identifier: MIT
import { expect, test, type Page } from '@playwright/test';
import { onboard, unlock, waitForServiceWorkerControl } from './support.js';

/** Number of packs kept in the app's IndexedDB ('current', and 'previous' after an update). */
function storedPacks(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error(open.error?.message ?? 'open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const count = db.transaction('pack').objectStore('pack').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
        };
      }),
  );
}

/** Empties the pack store, so that only the service worker can provide the pack. */
async function clearStoredPack(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error(open.error?.message ?? 'open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('pack', 'readwrite');
          tx.objectStore('pack').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
}

/** Every path the service worker caches, as pathnames. */
function cachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls.map((url) => new URL(url).pathname);
  });
}

test('after one load the precache alone starts the app, Home and the danger signs in airplane mode', async ({
  page,
  context,
}) => {
  await onboard(page, 'woman');
  await waitForServiceWorkerControl(page);

  // Take the stored pack away: offline, only the precache can provide it now.
  // The page may still be storing the pack it just loaded: clear until it stays empty.
  await expect.poll(() => storedPacks(page)).toBeGreaterThan(0);
  await expect(async () => {
    await clearStoredPack(page);
    await page.waitForTimeout(250);
    expect(await storedPacks(page)).toBe(0);
  }).toPass({ timeout: 10_000 });

  await context.setOffline(true);
  await page.reload();

  // A reload locks: the code, offline too.
  await unlock(page);
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Hors ligne')).toBeVisible();
  await expect(page.getByText(/Les informations sur les produits/)).toHaveCount(0);

  await page.getByRole('link', { name: 'Signes de danger' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
  await expect(page.getByText('Allez au poste de santé maintenant.')).toBeVisible();
  // The pack loaded: its list, or the loaded-but-empty notice; never "not on this phone".
  await expect(
    page
      .getByRole('group', { name: 'Quels signes voyez-vous maintenant ?' })
      .or(page.getByText(/n'a pas encore été ajoutée/)),
  ).toBeVisible();
  await expect(page.getByText(/n'est pas encore sur ce téléphone/)).toHaveCount(0);
  // The pack served by the precache was stored again in the background.
  await expect.poll(() => storedPacks(page)).toBeGreaterThan(0);

  // A cold start straight on the danger route, still offline.
  const fresh = await context.newPage();
  await fresh.goto('/#/danger');
  await expect(fresh.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
  await expect(fresh.getByText('Allez au poste de santé maintenant.')).toBeVisible();
});

test('Home says the phone is ready without the Internet once the precache controls the page', async ({
  page,
  context,
}) => {
  await onboard(page, 'woman');

  // Until then it asks to keep the Internet on; then, without a reload, it is ready.
  const ready = page.getByRole('main').getByText('Prêt sans Internet', { exact: true });
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Gardez Internet encore un moment/)).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const cached = await cachedPaths(page);
  expect(cached).toEqual(expect.arrayContaining(['/index.html', '/pack/manifest.json']));

  // In airplane mode it opens, and the status screen says the same.
  await context.setOffline(true);
  await page.reload();
  await unlock(page);
  await expect(ready).toBeVisible();
  await page.getByRole('link', { name: 'Base de connaissances' }).click();
  const phone = page.getByRole('region', { name: 'Sur ce téléphone' });
  await expect(phone.getByText('Prêt sans Internet', { exact: true })).toBeVisible();
});

test('the service worker precaches every fragment the pack manifest lists', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorkerControl(page);

  const manifest = (await (await page.request.get('/pack/manifest.json')).json()) as {
    fragments: { path: string }[];
    keyId?: string;
  };
  const cached = await cachedPaths(page);

  expect(manifest.fragments.length).toBeGreaterThanOrEqual(9);
  expect(cached).toEqual(
    expect.arrayContaining([
      '/index.html',
      '/fonts/atkinson-hyperlegible-next-latin.woff2',
      '/pack/manifest.json',
      ...manifest.fragments.map((fragment) => `/pack/${fragment.path}`),
      // A signed pack keeps its signature offline (the CI test build is unsigned).
      ...(manifest.keyId === undefined ? [] : ['/pack/manifest.sig']),
    ]),
  );
  expect(cached).not.toContain('/pack/pack.json');
});

test('the web app manifest follows the base URL, the app name and the tokens', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = (await (await page.request.get(href ?? '')).json()) as Record<string, unknown>;

  // This build's base URL is "/": start_url and scope follow it, and the id defaults to start_url.
  expect(manifest).toMatchObject({
    name: 'Carnet',
    short_name: 'Carnet',
    lang: 'fr',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    theme_color: '#22379a',
    background_color: '#f3f5fa',
  });
  expect(manifest['id']).toBeUndefined();
  expect((manifest['icons'] as { purpose?: string }[]).map((icon) => icon.purpose)).toContain(
    'maskable',
  );
});
