// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';
import { onboard, unlock } from './support.js';

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
