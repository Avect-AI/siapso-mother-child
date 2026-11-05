// SPDX-License-Identifier: MIT
// Two tabs of the app on one shared phone: two pages of one browser context
// share its storage, as two tabs of one phone do. "Quitter" in one hides the
// other; the forgotten-code erase in one sends the other to the welcome, and
// a tab that missed the message cannot write her profile back. The code here
// is made up.
import { expect, test, type Page } from '@playwright/test';
import { CODE, makeCode, onboard, unlock } from './support.js';

function answer(page: Page, question: string | RegExp, label: string) {
  return page.getByRole('group', { name: question }).getByText(label, { exact: true });
}

/** Her profile form, filled with something only she knows: pregnant, 20 weeks, HIV. */
async function fillHerProfile(page: Page) {
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await page.getByRole('textbox', { name: 'Surnom' }).fill('Aminata');
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill('20');
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('VIH, avec cotrimoxazole').click();
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
  await expect(other.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  return other;
}

/** The forgotten-code erase, from the code screen of `page`. */
async function eraseFrom(page: Page) {
  await page.getByRole('button', { name: "J'ai oublié le code" }).click();
  await page.getByLabel('Pour continuer, écrivez EFFACER').fill('EFFACER');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Effacer les profils' }).click();
  await expect(page.getByRole('button', { name: 'Français' })).toBeVisible();
}

test('"Quitter" in one tab hides her profile in the other at once', async ({ page }) => {
  await onboard(page, 'woman');
  await fillHerProfile(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();

  const other = await secondTab(page);
  await other.getByRole('banner').getByRole('button', { name: 'Quitter' }).click();
  await expect(other.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();

  // The first tab, untouched since: the neutral screen, nothing of her.
  await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
  await expect(page.getByText('Aminata')).toHaveCount(0);
  await expect(page.getByText('VIH, avec cotrimoxazole')).toHaveCount(0);
  expect(page.url()).toMatch(/#\/$/);
  // The code opens the start, not the form it was on.
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await unlock(page);
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
});

test('her profile deleted in one tab leaves the other, which can never write it back', async ({
  page,
}) => {
  // Live test round 2 (privacy-offline#0).
  await onboard(page, 'woman');
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await expect(page.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Aminata');

  const other = await secondTab(page);
  await other.getByRole('link', { name: 'Mon profil' }).click();
  await other.getByRole('button', { name: 'Supprimer ce profil' }).click();
  await other.getByRole('button', { name: 'Supprimer le profil' }).click();
  await expect(other.getByText('Votre profil est supprimé.')).toBeVisible();
  expect(await storedProfiles(other)).toBe(0);

  // The first tab leaves her form at once: nothing of her stays on screen.
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  await expect(page.getByText('Aminata')).toHaveCount(0);
  await expect(page.getByText('VIH, avec cotrimoxazole')).toHaveCount(0);
  expect(await storedProfiles(page)).toBe(0);
  // The id of the profile is never in the storage the tabs share.
  const marks = await page.evaluate(() => localStorage.getItem('siapso-session-epoch') ?? '');
  expect(marks).not.toMatch(/erase|quick|exit|lock|profile|-/);
});

test('a frozen tab that missed a deletion takes the quick exit when it comes back, then the code opens the start', async ({
  page,
}) => {
  // Fix round 1 of PR #61: the token stores no meaning, a missed event is a quick exit.
  await onboard(page, 'woman');
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
  // A tab that hears nothing until it comes back: no channel, no storage event.
  const frozen = await page.context().newPage();
  await frozen.addInitScript(() => {
    Reflect.deleteProperty(window, 'BroadcastChannel');
    window.addEventListener(
      'storage',
      (event) => {
        event.stopImmediatePropagation();
      },
      true,
    );
  });
  await frozen.goto('/');
  await unlock(frozen);
  await frozen.getByRole('link', { name: 'Mon profil' }).click();
  await expect(frozen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Aminata');

  // The other tab (which heard only a new token from it, and took the quick exit) deletes her profile.
  await page.bringToFront();
  await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await unlock(page);
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await page.getByRole('button', { name: 'Supprimer ce profil' }).click();
  await page.getByRole('button', { name: 'Supprimer le profil' }).click();
  await expect(page.getByText('Votre profil est supprimé.')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('siapso-session-epoch'));
  expect(token).toMatch(/^[0-9a-f]{32}$/);

  // The frozen tab comes back: it cannot tell what happened, so the quick exit.
  await frozen.bringToFront();
  await frozen.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(frozen.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
  await expect(frozen.getByText('Aminata')).toHaveCount(0);
  await expect(frozen.getByText('VIH, avec cotrimoxazole')).toHaveCount(0);
  await frozen.getByRole('button', { name: 'Ouvrir' }).click();
  await unlock(frozen);
  await expect(frozen.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  await frozen.getByRole('link', { name: 'Mon profil' }).click();
  await expect(frozen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Moi');
});

test('in accompanied mode the form of a woman deleted in another tab is left, her HIV situation with it', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await page.getByRole('textbox', { name: 'Surnom' }).fill('Ndeye');
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'Je ne sais pas').click();
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('VIH, avec cotrimoxazole').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('link', { name: 'Modifier le profil de Ndeye' }).click();
  await expect(page.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Ndeye');

  const other = await page.context().newPage();
  await other.goto('/');
  await unlock(other);
  await other.getByRole('link', { name: 'Modifier le profil de Ndeye' }).click();
  await other.getByRole('button', { name: 'Supprimer ce profil' }).click();
  await other.getByRole('button', { name: 'Supprimer le profil' }).click();
  await expect(other.getByText(/^Profil supprimé/)).toBeVisible();

  // The first tab is back on the list, where she is no more; nothing wrote her back.
  await expect(page.getByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
  await expect(page.getByText('Ndeye')).toHaveCount(0);
  await expect(page.getByText('VIH, avec cotrimoxazole')).toHaveCount(0);
  expect(await storedProfiles(page)).toBe(0);
});

test('a code changed in one tab locks the other; the new code opens her profile, the old one nothing', async ({
  page,
}) => {
  // Live test round 2 (privacy-offline#1).
  await onboard(page, 'woman');
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
  const other = await secondTab(page);

  await page.getByRole('link', { name: 'Réglages' }).click();
  await page.getByRole('link', { name: 'Changer le code' }).click();
  await page.getByLabel('Code actuel', { exact: true }).fill(CODE);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Nouveau code', { exact: true }).fill('7392');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Le même code', { exact: true }).fill('7392');
  await page.getByRole('button', { name: 'Enregistrer le code' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Le code est changé' })).toBeVisible({
    timeout: 20_000,
  });

  // The other tab asks for the code; the old one opens nothing.
  await expect(other.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  await other.getByLabel('Code', { exact: true }).fill(CODE);
  await other.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(other.getByLabel('Code', { exact: true })).toHaveAccessibleDescription(
    /^Ce n'est pas le bon code/,
    { timeout: 15_000 },
  );
  await unlock(other, '7392');
  await other.getByRole('link', { name: 'Mon profil' }).click();
  await expect(other.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Aminata');
});

test('an erase in one tab sends the other to the welcome', async ({ page }) => {
  await onboard(page, 'woman');
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
  await page.getByRole('link', { name: 'Mon profil' }).click();

  const other = await page.context().newPage();
  await other.goto('/');
  await eraseFrom(other);

  await expect(page.getByRole('button', { name: 'Français' })).toBeVisible();
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

  await expect(other.getByRole('button', { name: 'Français' })).toBeVisible();
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
    // Frozen: not even the storage event of another tab reaches it.
    window.addEventListener(
      'storage',
      (event) => {
        event.stopImmediatePropagation();
      },
      true,
    );
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
  const french = page.getByRole('button', { name: 'Français' });
  await expect(french.or(unlockTitle)).toBeVisible();
  if (await french.isVisible()) await french.click();
  const woman = page.getByRole('button', { name: /^Je suis enceinte/ });
  await expect(woman.or(unlockTitle)).toBeVisible();
  if (await woman.isVisible()) await woman.click();
  const create = page.getByRole('heading', { level: 1, name: 'Choisissez un code' });
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
  await expect(other.getByRole('button', { name: 'Français' })).toBeVisible();

  // She makes her code again and saves her profile.
  await page.getByRole('button', { name: 'Français' }).click();
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await makeCode(page);
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
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
  await expect(deaf.getByRole('button', { name: 'Français' })).toBeVisible();

  await onboard(page, 'woman');
  await fillHerProfile(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
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
  await page.getByRole('button', { name: 'Français' }).click();
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await makeCode(page, '1397');
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();

  await stale.getByRole('button', { name: 'Enregistrer' }).click();

  // Refused (or the tab asks for the code first): nothing of her is kept.
  await expect(
    stale
      .getByText("Ce profil n'a pas pu être enregistré sur ce téléphone. Essayez encore.")
      .or(stale.getByRole('heading', { level: 1, name: 'Entrez votre code' })),
  ).toBeVisible();
  expect(await storedProfiles(page)).toBe(0);
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await expect(page.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Moi');
});
