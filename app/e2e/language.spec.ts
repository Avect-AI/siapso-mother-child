// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';
import { expectWelcome, onboard, unlock } from './support.js';

test('the language choice persists across a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  await onboard(page, 'accompanied', 'en');
  const title = page.getByRole('heading', { level: 1, name: 'Profiles' });
  await expect(title).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();

  // A reload locks: the code screen asks in English, then the profiles come back.
  await unlock(page, undefined, 'en');
  await expect(title).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Danger signs' })).toBeVisible();
});

test.describe('a phone set to English', () => {
  test.use({ locale: 'en-US' });

  test('the welcome speaks English, with French one tap away, and keeps the choice', async ({
    page,
  }) => {
    await page.goto('/');

    // No question about the language: the phone's is used, the other is a switch.
    await expectWelcome(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const french = page.getByRole('button', { name: 'Français', exact: true });
    await expect(french).toHaveAttribute('lang', 'fr');
    await french.click();

    await expectWelcome(page, 'fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible();
    await page.reload();
    await expectWelcome(page, 'fr');
  });
});
