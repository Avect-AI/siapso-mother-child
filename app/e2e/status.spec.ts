// SPDX-License-Identifier: MIT
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { onboard, unlock } from './support.js';

interface Manifest {
  version: string;
  date: string;
}

async function manifestOf(page: Page): Promise<Manifest> {
  return (await (await page.request.get('/pack/manifest.json')).json()) as Manifest;
}

/** Waits until the service worker controls the page (reloading once if needed). */
async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(async () => {
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
      await page.reload();
    }
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }).toPass({ timeout: 15_000 });
}

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

/** A date `days` after the pack's date, at noon. */
function daysAfter(date: string, days: number): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day + days, 12);
}

test('Status and About open from Home and the settings, offline, with the version of the pack', async ({
  page,
  context,
}) => {
  await onboard(page, 'woman');
  await waitForServiceWorkerControl(page);
  const manifest = await manifestOf(page);

  await context.setOffline(true);
  await page.reload();
  await unlock(page);

  await page.getByRole('link', { name: 'Base de connaissances' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Base de connaissances' }),
  ).toBeVisible();
  const facts = page.getByRole('list', { name: 'Contenu de la base' });
  await expect(facts).toContainText(manifest.version);
  await expect(facts).toContainText(manifest.date);
  await expect(page.getByText(/^Contenu non validé cliniquement/)).toBeVisible();
  await expectNoSeriousViolation(page);

  await page.getByRole('link', { name: 'À propos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
  await expect(page.getByText(/informations générales sur la santé/)).toBeVisible();
  await expect(page.getByText('https://github.com/Avect-AI/siapso-mother-child')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sources de la base' })).toBeVisible();
  await expectNoSeriousViolation(page);

  // From the settings too, then back to the start.
  await page.goto('/#/settings');
  await page.getByRole('link', { name: 'À propos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
  await page.getByRole('button', { name: "Revenir à l'accueil" }).click();
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
});

test('both screens open before the code and render in English', async ({ page }) => {
  await onboard(page, 'woman', 'en');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Enter your code' })).toBeVisible();

  await page.goto('/#/status');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Knowledge base' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toHaveCount(0);
  await expectNoSeriousViolation(page);

  await page.goto('/#/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible();
  await expect(
    page.getByText(
      /^SIAPSO Mother-Child provides general health information, education and referral/,
    ),
  ).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('the warning appears at 91 days after the pack date, not at 90', async ({ page }) => {
  await onboard(page, 'woman');
  const manifest = await manifestOf(page);

  await page.clock.setFixedTime(daysAfter(manifest.date, 90));
  await page.goto('/#/status');
  await page.reload();
  await expect(page.getByRole('list', { name: 'Contenu de la base' })).toBeVisible();
  await expect(page.getByText(/Base périmée/)).toHaveCount(0);

  await page.clock.setFixedTime(daysAfter(manifest.date, 91));
  await page.reload();
  await expect(page.getByText(/Base périmée/)).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('the screens fit 360 px at 200 percent text', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await onboard(page, 'woman');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  for (const hash of ['#/status', '#/about']) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

/** The packs stored by the app in IndexedDB ('current', and 'previous' after an update). */
function storedSlots(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error(open.error?.message ?? 'open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const keys = db.transaction('pack').objectStore('pack').getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result.map(String));
          };
        };
      }),
  );
}

/**
 * Keeps a copy of the stored pack, as version `version`, as the previous
 * pack: what an update leaves on the phone.
 */
async function keepPreviousVersion(page: Page, version: string) {
  await page.evaluate(
    (older) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error(open.error?.message ?? 'open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('pack', 'readwrite');
          const store = tx.objectStore('pack');
          const current = store.get('current');
          current.onsuccess = () => {
            const stored = current.result as { pack: { version: string }; fingerprint: string };
            store.put(
              {
                ...stored,
                pack: { ...stored.pack, version: older },
                fingerprint: `${older} kept`,
              },
              'previous',
            );
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    version,
  );
}

test('accompanied mode: the previous version kept on the phone is put back, and stays after a reload', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  const manifest = await manifestOf(page);
  await expect.poll(() => storedSlots(page)).toContain('current');
  await keepPreviousVersion(page, '0.0.9');
  await page.reload();
  await unlock(page);

  await page.getByRole('link', { name: 'Base de connaissances' }).click();
  const facts = page.getByRole('list', { name: 'Contenu de la base' });
  await expect(facts).toContainText(manifest.version);
  // This end-to-end build is a demo build: its pack is not signed, and the screen says so.
  await expect(page.getByText('Version de test : base de connaissances non signée.')).toBeVisible();

  await page.getByRole('button', { name: 'Revenir à la version 0.0.9' }).click();
  await expect(page.getByText(/la version 0\.0\.9 reprise/)).toBeVisible();
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Oui, revenir à la version 0.0.9' }).click();

  await expect(facts).toContainText('0.0.9');
  await expect(page.getByText(/La version précédente a été remise sur ce téléphone/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Revenir à la version/ })).toHaveCount(0);

  // The version it left is not taken again: a reload keeps 0.0.9 (Status
  // opens before the code, and offers no rollback while locked).
  await page.reload();
  await expect(facts).toContainText('0.0.9');
  await expect(page.getByRole('button', { name: /Revenir à la version/ })).toHaveCount(0);
  await expect(page.getByText(/La version précédente a été remise sur ce téléphone/)).toBeVisible();
  await expect(page.getByText(/Détail technique : .*was rolled back on this device/)).toBeVisible();
});

test('a demo build says what it is: its build-info.json marker and the test version line', async ({
  page,
}) => {
  const info = (await (await page.request.get('/build-info.json')).json()) as Record<
    string,
    unknown
  >;
  expect(info).toMatchObject({ mode: 'demo', acceptsUnsignedPack: true, packKeyId: null });

  await onboard(page, 'woman');
  await page.goto('/#/status');
  await expect(page.getByText('Version de test : base de connaissances non signée.')).toBeVisible();
  await page.goto('/#/about');
  await expect(page.getByText('Version de test : base de connaissances non signée.')).toBeVisible();
});
