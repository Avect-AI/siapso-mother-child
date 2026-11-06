// SPDX-License-Identifier: MIT
// Two tabs of the app on one shared phone: two pages of one browser context
// share its storage, as two tabs of one phone do. "Quitter" in one hides the
// other; the forgotten-code erase in one sends the other to the welcome, and
// a tab that missed the message cannot write her profile back. The code here
// is made up.
import { expect, test, type Page } from '@playwright/test';
import {
  addOnCheck,
  checkField,
  CODE,
  expectStart,
  expectWelcome,
  makeCode,
  onboard,
  unlock,
} from './support.js';

function answer(page: Page, question: string | RegExp, label: string) {
  return page.getByRole('group', { name: question }).getByText(label, { exact: true });
}

/**
 * Her answers on her first check (SCRUM-56, 8.3), with something only she
 * knows: pregnant, 20 weeks, HIV; not saved yet.
 */
async function fillHerProfile(page: Page) {
  await expect(page.getByRole('region', { name: 'À propos de vous' })).toBeVisible();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill('20');
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('VIH, avec cotrimoxazole').click();
}

/** Her answers saved as her profile, then named Aminata on her profile screen, saved too. */
async function saveHerProfileAsAminata(page: Page) {
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await page.getByRole('textbox', { name: 'Surnom' }).fill('Aminata');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
}

/** How many profiles the app's IndexedDB holds (sealed: nothing in them is readable). */
function storedProfiles(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const count = open.result.transaction('profiles').objectStore('profiles').count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
  );
}

/** A second tab of the app, opened with the code. */
async function secondTab(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await other.goto('/');
  await unlock(other);
  await expectStart(other, 'woman');
  return other;
}

/** The forgotten-code erase, from the code screen of `page`. */
async function eraseFrom(page: Page) {
  await page.getByRole('button', { name: "J'ai oublié le code" }).click();
  await page.getByLabel('Pour continuer, écrivez EFFACER').fill('EFFACER');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Effacer les profils' }).click();
  await expectWelcome(page);
}

test('"Quitter" in one tab hides her profile in the other at once', async ({ page }) => {
  await onboard(page, 'woman');
  await fillHerProfile(page);

  const other = await secondTab(page);
  await other.getByRole('banner').getByRole('button', { name: 'Quitter' }).click();
  await expect(other.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();

  // The first tab, untouched since: the neutral screen, nothing of her.
  await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
  await expect(page.getByText('Aminata')).toHaveCount(0);
  await expect(page.getByText('VIH, avec cotrimoxazole')).toHaveCount(0);
  expect(page.url()).toMatch(/#\/$/);
  // The code opens the start, her check, its answers not kept.
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await unlock(page);
  await expectStart(page, 'woman');
  await expect(page.getByRole('checkbox', { name: 'VIH, avec cotrimoxazole' })).not.toBeChecked();
});

test('an erase in one tab sends the other to the welcome', async ({ page }) => {
  await onboard(page, 'woman');
  await saveHerProfileAsAminata(page);
  await page.getByRole('link', { name: 'Mon profil' }).click();

  const other = await page.context().newPage();
  await other.goto('/');
  await eraseFrom(other);

  await expectWelcome(page);
  await expect(page.getByText('Aminata')).toHaveCount(0);
  expect(await storedProfiles(other)).toBe(0);
});

test('a tab without the channel still follows the erase, through local storage', async ({
  page,
}) => {
  await onboard(page, 'woman');
  // No BroadcastChannel in this tab: the change of the epoch in local storage reaches it.
  const other = await page.context().newPage();
  await other.addInitScript(() => {
    Reflect.deleteProperty(window, 'BroadcastChannel');
  });
  await other.goto('/');
  await unlock(other);
  await fillHerProfile(other);

  await page.reload();
  await eraseFrom(page);

  await expectWelcome(other);
  await expect(other.getByText('Aminata')).toHaveCount(0);
  expect(await storedProfiles(page)).toBe(0);
});
/** A tab that hears no other tab and has no local storage: as a frozen tab in a strict browser. */
async function deafTab(page: Page): Promise<Page> {
  const deaf = await page.context().newPage();
  await deaf.addInitScript(() => {
    Reflect.deleteProperty(window, 'BroadcastChannel');
    const refuse = () => {
      throw new DOMException('Site storage is blocked', 'SecurityError');
    };
    Storage.prototype.getItem = refuse;
    Storage.prototype.setItem = refuse;
  });
  return deaf;
}

/** What the app's IndexedDB holds as the code (its verifier). */
function storedCode(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const get = open.result.transaction('settings').objectStore('settings').get('code');
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result);
          };
        };
      }),
  );
}

/**
 * Someone goes through the welcome of `page` to make `code`, as far as the app
 * lets him. `code` is not an easy one (0000, 1234, a year): those ask a second yes first.
 */
async function tryToMakeACode(page: Page, code: string) {
  const unlockTitle = page.getByRole('heading', { level: 1, name: 'Entrez votre code' });
  const woman = page.getByRole('button', { name: /^Je suis enceinte/ });
  await expect(woman.or(unlockTitle)).toBeVisible();
  if (await woman.isVisible()) await woman.click();
  const create = page.getByRole('heading', { name: 'Choisissez un code de 4 chiffres' });
  await expect(create.or(unlockTitle)).toBeVisible();
  if (await create.isVisible()) await makeCode(page, code);
}

test('a tab left on the welcome after an erase never makes a second code over hers', async ({
  page,
}) => {
  await onboard(page, 'woman');
  const other = await page.context().newPage();
  await other.goto('/');
  await page.reload();
  await eraseFrom(page);
  // The other tab went back to the welcome with the erase.
  await expectWelcome(other);

  // She makes her code again and saves her profile.
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await makeCode(page);
  await saveHerProfileAsAminata(page);
  const hers = await storedCode(page);

  // The partner, in the other tab, tries to make his own.
  await tryToMakeACode(other, '1397');

  await expect(other.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  expect(await storedCode(page)).toEqual(hers);
  await unlock(other, '1397');
  await expect(other.getByLabel('Code', { exact: true })).toHaveAccessibleDescription(
    /^Ce n'est pas le bon code\./,
  );
  await unlock(other, CODE);
  await other.getByRole('link', { name: 'Mon profil' }).click();
  await expect(other.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Aminata');
});

test('the app opened twice on a new phone keeps one code, even in a tab that hears nothing', async ({
  page,
}) => {
  const deaf = await deafTab(page);
  await deaf.goto('/');
  await expectWelcome(deaf);

  await onboard(page, 'woman');
  await saveHerProfileAsAminata(page);
  const hers = await storedCode(page);

  await tryToMakeACode(deaf, '1397');

  // Refused: the deaf tab asks for her code, and hers is the one kept.
  await expect(deaf.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  expect(await storedCode(page)).toEqual(hers);
  await unlock(deaf, CODE);
  await deaf.getByRole('link', { name: 'Mon profil' }).click();
  await expect(deaf.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Aminata');
});

test('a tab that missed the erase cannot write her profile under the next code either', async ({
  page,
}) => {
  await onboard(page, 'woman');
  const stale = await deafTab(page);
  await stale.goto('/');
  await unlock(stale);
  await fillHerProfile(stale);

  // Erased, then the partner makes his code, all in the other tab.
  await page.reload();
  await eraseFrom(page);
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await makeCode(page, '1397');
  await expectStart(page, 'woman');

  await stale.getByRole('button', { name: 'Enregistrer' }).click();

  // Refused (or the tab asks for the code first): nothing of her is kept.
  await expect(
    stale
      .getByText("Ce profil n'a pas pu être enregistré sur ce téléphone. Essayez encore.")
      .or(stale.getByRole('heading', { level: 1, name: 'Entrez votre code' })),
  ).toBeVisible();
  expect(await storedProfiles(page)).toBe(0);
  // Her check asks about her: no profile on the phone.
  await expect(page.getByRole('region', { name: 'À propos de vous' })).toBeVisible();
});

test('a lock while two tabs are open forgets the danger signs answer of a check (SCRUM-56, S14)', async ({
  page,
}) => {
  await page.clock.install();
  await onboard(page, 'woman');
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(checkField(page)).toBeFocused();
  await addOnCheck(page, 'kinkeliba');
  await page.getByRole('button', { name: 'Non, aucun de ces signes' }).click();
  const result = page.getByRole('heading', { level: 2, name: 'Résultat' });
  await expect(result).toBeVisible();

  // Another tab open, then two minutes without a touch: every tab locks.
  const other = await secondTab(page);
  await other.clock.fastForward('02:01');
  await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  await unlock(page);

  // Her check given back with its list; the answer never comes back after a lock.
  await expect(page.getByRole('list', { name: 'Produits ajoutés' })).toContainText('Kinkéliba');
  await expect(page.getByRole('button', { name: 'Non, aucun de ces signes' })).toBeVisible();
  await expect(result).toHaveCount(0);
});
