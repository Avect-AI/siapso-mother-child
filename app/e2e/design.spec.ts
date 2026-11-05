// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';
import { expectWelcome } from './support.js';

test('the production build never serves the design gallery', async ({ page }) => {
  await page.goto('/#/design');
  await expectWelcome(page);
  await expect(page.getByText('SIAPSO visual system')).toHaveCount(0);
});

test('the self-hosted font loads and the page uses it', async ({ page }) => {
  await page.goto('/');
  // The screen renders once the stored settings are read; the font loads when text needs it.
  await expectWelcome(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check('16px "Atkinson Hyperlegible Next"');
      }),
    )
    .toBe(true);
  await expect(page.locator('body')).toHaveCSS('font-family', /Atkinson Hyperlegible Next/);
});
