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
