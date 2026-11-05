// SPDX-License-Identifier: MIT
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expectWelcome, makeCode, onboard } from './support.js';

/** Runs axe on the page as it is and fails on any serious or critical violation. */
async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

test('Welcome has no serious accessibility violation, at every step', async ({ page }) => {
  await page.goto('/');
  await expectWelcome(page);
  await expect(page.getByRole('button', { name: /^J'accompagne des femmes/ })).toBeVisible();
  await expectNoSeriousViolation(page);

  await page.getByRole('button', { name: /^J'accompagne/ }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Choisissez un code de 6 chiffres' }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);

  // The second typing, then the warning about a code easy to guess.
  await page.getByLabel('Code', { exact: true }).fill('739215');
  await expect(page.getByLabel('Tapez-le encore', { exact: true })).toBeFocused();
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Changer de mode' }).click();
  await page.getByRole('button', { name: /^J'accompagne/ }).click();
  await page.getByLabel('Code', { exact: true }).fill('123456');
  await expect(page.getByRole('heading', { name: 'Ce code est facile à deviner' })).toBeFocused();
  await expectNoSeriousViolation(page);
});

test('Home has no serious accessibility violation, online and offline', async ({
  page,
  context,
}) => {
  await onboard(page, 'woman', 'en');
  await expectNoSeriousViolation(page);

  await context.setOffline(true);
  await expect(page.getByRole('banner').getByText('Offline')).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('the danger signs screen has no serious accessibility violation', async ({ page }) => {
  await page.goto('/#/danger');
  await expect(page.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
  await expectNoSeriousViolation(page);
});

test.describe('at 360 px with text at 200 percent', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  /** Doubles the root font size, as a phone set to its largest text would. */
  async function largeText(page: Page) {
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  }

  async function expectNoSidewaysScroll(page: Page) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test('nothing scrolls sideways on Welcome, the code, Home and the danger signs', async ({
    page,
  }) => {
    await page.goto('/');
    await largeText(page);
    await expectWelcome(page);
    await expectNoSidewaysScroll(page);

    await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Choisissez un code de 4 chiffres' }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);

    await makeCode(page);
    await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.getByRole('link', { name: 'Signes de danger' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test('every control is at least 48 px in both directions', async ({ page }) => {
  await onboard(page, 'accompanied');

  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a, button')]
      .map((el) => ({ text: el.textContent, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 48 || box.height < 48)
      .map(({ text }) => text),
  );
  expect(small).toEqual([]);
});
