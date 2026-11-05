// SPDX-License-Identifier: MIT
// Cross-origin isolation: the service worker answers with COOP and COEP, so
// the speech model may run on several threads (docs/voice.md). Everything
// else the app loads must keep working under those headers.
import { expect, test, type Page } from '@playwright/test';
import { onboard, waitForServiceWorkerControl } from './support.js';

function isolated(page: Page): Promise<boolean> {
  return page.evaluate(() => self.crossOriginIsolated);
}

test('the first visit is not isolated, then every page the service worker serves is', async ({
  page,
}) => {
  await page.goto('/');
  // Served by the preview server, which sends no isolation header: one thread for the voice.
  expect(await isolated(page)).toBe(false);

  await waitForServiceWorkerControl(page);
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(response?.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(await isolated(page)).toBe(true);
  // What ONNX Runtime needs for its threads.
  expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
});

test('isolated, the fonts, the pack, the referral file and the screens still load', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('requestfailed', (request) => failures.push(request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });

  await onboard(page, 'woman');
  await waitForServiceWorkerControl(page);
  // A page loaded before the worker took control stays as it was: load it again.
  await page.reload();
  await page.goto('/#/danger');
  await expect(page.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
  expect(await isolated(page)).toBe(true);

  // The self-hosted font, under COEP.
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (face) => face.family.includes('Atkinson') && face.status === 'loaded',
    );
  });
  expect(fontLoaded).toBe(true);

  // The pack loaded (the list of signs, never "not on this phone").
  await expect(
    page
      .getByRole('group', { name: 'Quels signes voyez-vous maintenant ?' })
      .or(page.getByText(/n'a pas encore été ajoutée/)),
  ).toBeVisible();
  await expect(page.getByText(/n'est pas encore sur ce téléphone/)).toHaveCount(0);

  // The deployment file and the pack manifest, fetched as the app fetches them.
  const fetched = await page.evaluate(async () => {
    const referral = await fetch('config/referral.example.json');
    const manifest = await fetch('pack/manifest.json', { cache: 'no-cache' });
    return [referral.ok, manifest.ok];
  });
  expect(fetched).toEqual([true, true]);

  // Who to call, the status and about screens.
  await page.goto('/#/danger/call');
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await page.goto('/#/about');
  await expect(page.getByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
  expect(failures).toEqual([]);
});
