// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';

test('the production build never serves the design gallery', async ({ page }) => {
  await page.goto('/#/design');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SIAPSO');
  await expect(page.getByText('SIAPSO visual system')).toHaveCount(0);
});

test('the self-hosted font loads and the page uses it', async ({ page }) => {
  await page.goto('/');
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px "Atkinson Hyperlegible Next"');
  });
  expect(loaded).toBe(true);
  await expect(page.locator('body')).toHaveCSS('font-family', /Atkinson Hyperlegible Next/);
});
