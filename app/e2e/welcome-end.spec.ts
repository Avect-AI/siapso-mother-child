// SPDX-License-Identifier: MIT
// A welcome cut short: the app closed after the code was stored, before the
// welcome ended. The code made then still opens the app, which asks for the
// mode once, then works as usual. The code here is made up.
import { expect, test, type Page } from '@playwright/test';
import { expectStart, onboard, unlock } from './support.js';

/** Writes the settings straight into the app's IndexedDB, as an app closed half-way leaves them. */
function leaveSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const tx = open.result.transaction('settings', 'readwrite');
          tx.objectStore('settings').put(value, 'settings');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    settings,
  );
}

/** The settings as the app's IndexedDB holds them. */
function storedSettings(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const get = open.result.transaction('settings').objectStore('settings').get('settings');
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result);
          };
        };
      }),
  );
}

test('a welcome cut short after the code asks for the code, then the mode, then opens Home', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await leaveSettings(page, { lang: 'fr', mode: null, onboarded: false });

  await page.reload();

  // The code screen, never a second welcome that would make another code.
  await unlock(page);
  await expect(page.getByRole('heading', { name: /^Qui utilise l'application/ })).toBeVisible();
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await expectStart(page, 'woman');
  // The screen follows the choice at once; the phone keeps it just after.
  await expect.poll(() => storedSettings(page)).toMatchObject({ mode: 'woman', onboarded: true });

  // Kept: the next start is the usual one.
  await page.reload();
  await unlock(page);
  await expectStart(page, 'woman');
});
