// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';

test('the language choice persists across a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'I support women' }).click();
  const title = page.getByRole('heading', { level: 1, name: 'A medicine or a remedy?' });
  await expect(title).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();

  await expect(title).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Danger signs' })).toBeVisible();
});
