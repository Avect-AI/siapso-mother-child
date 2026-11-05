// SPDX-License-Identifier: MIT
// Usage modes, the code and the quick exit, as on a shared family phone:
// nothing about a profile shows without the code, and the quick exit hides
// everything at once. The codes here are made up.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CODE, expectStart, makeCode, onboard, unlock } from './support.js';

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

function answer(page: Page, question: string | RegExp, label: string) {
  return page.getByRole('group', { name: question }).getByText(label, { exact: true });
}

/** What the settings store of the app's IndexedDB holds under `key`. */
function stored(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (name) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const get = open.result.transaction('settings').objectStore('settings').get(name);
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result);
          };
        };
      }),
    key,
  );
}

/** The profile screen, filled in the common way: pregnant, 20 weeks, no situation. */
async function fillProfile(page: Page) {
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill('20');
  // The day the weeks were known: asked in accompanied mode, today by default for her own.
  await answer(page, /^Ce terme date de quand/, "Aujourd'hui").click();
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
}

/** Every text of the page, to look for what must not be there. */
function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

test('woman mode: the code is made at the welcome, asked after a reload, wrong then right', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Français' }).click();
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();

  // Typed twice: two different codes start again.
  await expect(page.getByRole('heading', { level: 1, name: 'Choisissez un code' })).toBeVisible();
  const field = page.getByLabel('Code', { exact: true });
  await expect(field).toHaveAttribute('inputmode', 'numeric');
  // A password field (never read out in clear), a one-time code with no name:
  // no browser offers to keep it.
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(field).not.toHaveAttribute('name');
  await field.fill('1357');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tapez le code une deuxième fois' }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);
  await page.getByLabel('Le même code').fill('1358');
  await page.getByRole('button', { name: 'Enregistrer le code' }).click();
  await expect(page.getByLabel('Code', { exact: true })).toHaveAccessibleDescription(
    /Les deux codes ne sont pas les mêmes/,
  );
  await makeCode(page);
  await expectStart(page, 'woman');
  await expect(page.getByRole('banner').getByRole('button', { name: 'Quitter' })).toBeVisible();

  // Only the verifier is kept: the HKDF check of PBKDF2 at 600 000
  // iterations (version 2), never the code nor the key of the data.
  const verifier = await stored(page, 'code');
  expect(verifier).toEqual({
    salt: expect.stringMatching(/^[\w-]{22}$/) as unknown,
    hash: expect.stringMatching(/^[\w-]{43}$/) as unknown,
    iterations: 600_000,
    version: 2,
  });

  // Her profile, then a reload: locked.
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await page.getByRole('textbox', { name: 'Surnom' }).fill('Aminata');
  await fillProfile(page);
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
  await page.reload();

  await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Quitter' })).toHaveCount(0);
  expect(await pageText(page)).not.toContain('Aminata');
  await expectNoSeriousViolation(page);

  await unlock(page, '1111');
  await expect(page.getByLabel('Code', { exact: true })).toHaveAccessibleDescription(
    "Ce n'est pas le bon code. Encore 4 essais avant une attente.",
  );
  await unlock(page, CODE);
  await expectStart(page, 'woman');
});

test('accompanied mode: the code, the profiles, then a quick exit that Back cannot undo', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await expect(page.getByText('Aucun profil sur ce téléphone pour le moment.')).toBeVisible();
  await expectNoSeriousViolation(page);

  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await page.getByRole('textbox', { name: 'Surnom' }).fill('Ndeye');
  await fillProfile(page);
  const list = page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
  await expect(list.getByRole('button', { name: 'Ndeye' })).toBeVisible();
  await expect(page.getByText('Profil enregistré : Ndeye.')).toBeVisible();
  await expectNoSeriousViolation(page);

  // Her check and its result, then the quick exit.
  await list.getByRole('button', { name: 'Ndeye' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ce qu'elle prend" })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un remède' }).click();
  await page.getByRole('searchbox').fill('kinkeliba');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await page.getByText('Aucun de ces signes', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat pour Ndeye' })).toBeVisible();

  await page.getByRole('banner').getByRole('button', { name: 'Quitter' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveText(['Ouvrir']);
  for (const secret of ['Ndeye', 'Kinkéliba', 'Résultat']) {
    expect(await pageText(page)).not.toContain(secret);
  }
  await expectNoSeriousViolation(page);

  // Back through every entry of the visit (the signs, the check, the list,
  // the welcome): never the result, the check or the list.
  for (let step = 0; step < 4; step += 1) {
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
    const text = await pageText(page);
    for (const secret of ['Ndeye', 'Kinkéliba', 'Résultat', 'Profils']) {
      expect(text, `back ${String(step + 1)}: ${secret}`).not.toContain(secret);
    }
  }

  // "Ouvrir", the code, and the list again; the check was forgotten.
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await unlock(page);
  await expect(list.getByRole('button', { name: 'Ndeye' })).toBeVisible();
});

test('five wrong codes wait 30 seconds, and a reload keeps the wait', async ({ page }) => {
  await onboard(page, 'woman');
  await page.reload();
  const field = page.getByLabel('Code', { exact: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await unlock(page, '0000');
    // Worked out and refused: the field is emptied for the next try.
    await expect(field).toHaveValue('');
  }

  // Read aloud as "30 s" (minutes and seconds past a minute), never "119 secondes".
  const wait = /^Trop d'essais\. Attendez \d+\ss, puis essayez encore\.$/;
  await expect(field).toHaveAccessibleDescription(wait);
  await expect(page.getByRole('button', { name: 'Ouvrir' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await page.reload();
  await expect(field).toHaveAccessibleDescription(wait);
  await expect(page.getByRole('button', { name: 'Ouvrir' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('locks after two minutes without a touch, and gives the same screen back', async ({
  page,
}) => {
  await page.clock.install();
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();

  await page.clock.fastForward('02:01');

  await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  // The address while locked is neutral.
  expect(new URL(page.url()).hash).toBe('#/unlock');
  await unlock(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
});

test('who to call from a fever result: once locked, and after a reload, no instruction or sign of the check', async ({
  page,
}) => {
  await page.clock.install();
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await fillProfile(page);
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await page.getByRole('button', { name: 'Ajouter un remède' }).click();
  await page.getByRole('searchbox').fill('kinkeliba');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await page.getByText('Fièvre', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await page.getByRole('button', { name: 'Voir qui appeler' }).click();
  const own = 'Allez au poste de santé maintenant pour faire un test.';
  await expect(page.getByRole('heading', { level: 2, name: own })).toBeVisible();
  await expect(page.getByText('Fièvre', { exact: true })).toBeVisible();

  // Two minutes without a touch on who to call.
  await page.clock.fastForward('02:01');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Allez au poste de santé maintenant.' }),
  ).toBeVisible();
  expect(await pageText(page)).not.toContain('pour faire un test');
  await expect(page.getByText('Fièvre', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  expect(await pageText(page)).not.toContain('pour faire un test');
  await expect(page.getByText('Fièvre', { exact: true })).toHaveCount(0);
});

test('a product never shows in the address, even after an auto-lock and a reload', async ({
  page,
}) => {
  await page.clock.install();
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await fillProfile(page);
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await page.getByRole('searchbox').fill('efavirenz');
  await page.locator('.candidate').first().click();
  await expect(page.getByRole('button', { name: "Oui, c'est ce produit" })).toBeVisible();
  expect(page.url()).not.toMatch(/favirenz/i);
  expect(new URL(page.url()).hash).toBe('#/confirm/product');

  await page.clock.fastForward('02:01');
  await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/unlock');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  expect(page.url()).not.toMatch(/favirenz/i);
  expect(JSON.stringify(await page.evaluate(() => window.history.state as unknown))).not.toMatch(
    /favirenz/i,
  );
});

test('a forgotten code erases the profiles after EFFACER and a last yes, then the welcome', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await page.getByRole('textbox', { name: 'Surnom' }).fill('Aminata');
  await fillProfile(page);
  await page.reload();

  await page.getByRole('button', { name: "J'ai oublié le code" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Code oublié' })).toBeVisible();
  await expectNoSeriousViolation(page);
  await page.getByLabel('Pour continuer, écrivez EFFACER').fill('EFFACER');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tout effacer maintenant ?' }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Effacer les profils' }).click();

  // The welcome again, in the language kept; then nothing of her is left.
  await expect(page.getByRole('button', { name: 'Français' })).toBeVisible();
  await page.getByRole('button', { name: 'Français' }).click();
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await makeCode(page);
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await expect(page.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Moi');
  expect(await pageText(page)).not.toContain('Aminata');
});

test('changing the mode in the settings needs the code and deletes nothing', async ({ page }) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await fillProfile(page);
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();

  await page.getByRole('link', { name: 'Réglages' }).click();
  await page.getByText("J'accompagne des femmes", { exact: true }).click();
  // The answer alone changes nothing: the mode changes with its button.
  await page.getByRole('button', { name: 'Changer de mode' }).click();
  await expect(page.getByText('Réglage enregistré.')).toBeVisible();
  await page.getByRole('button', { name: "Revenir à l'accueil" }).click();

  await expect(
    page
      .getByRole('list', { name: 'Profils enregistrés sur ce téléphone' })
      .getByRole('button', { name: /^Moi / }),
  ).toBeVisible();
});

test.describe('at 360 px with text at 200 percent', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  async function expectFits(page: Page) {
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('a, button')]
        .map((el) => ({ text: el.textContent, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width < 48 || box.height < 48)
        .map(({ text }) => text),
    );
    expect(small).toEqual([]);
  }

  test('the code, the neutral screen and the profiles fit, every target 48 px', async ({
    page,
  }) => {
    await onboard(page, 'accompanied');
    await expectFits(page);
    await page.getByRole('button', { name: 'Quitter' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
    await expectFits(page);
    await page.getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
    await expectFits(page);
  });
});
