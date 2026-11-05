// SPDX-License-Identifier: MIT
// The flows of a visit and of a sale (live test round 2): a relay moving
// between women keeps each list, a depot keeper checks a passer-by without
// saving anything, a midwife finds a woman among many, a long list of
// strengths keeps the one typed and "yes" in view, and an easy code is warned
// about. The codes and pseudonyms here are made up.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { expectStart, onboard, unlock } from './support.js';

// Whole journeys with accessibility scans of long forms: on a loaded runner
// they can take longer than the 30 s default.
test.setTimeout(60_000);

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

/** The questions of a profile: pregnant at `weeks` weeks known today, not breastfeeding, no situation. */
async function answerPregnant(page: Page, weeks: string) {
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill(weeks);
  await answer(page, /^Ce terme date de quand/, "Aujourd'hui").click();
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
}

async function addProfile(page: Page, pseudonym: string) {
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await page.getByRole('textbox', { name: 'Surnom' }).fill(pseudonym);
  await answerPregnant(page, '20');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(`Profil enregistré : ${pseudonym}.`)).toBeVisible();
}

/** From the check: a remedy found by its name, confirmed. */
async function addRemedy(page: Page, name: string) {
  await page.getByRole('button', { name: 'Ajouter un remède' }).click();
  await page.getByRole('searchbox').fill(name);
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();
}

/** How many records a store of the app's IndexedDB holds. */
function countIn(page: Page, store: 'profiles' | 'history'): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const count = open.result.transaction(name).objectStore(name).count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
    store,
  );
}

const profilesList = (page: Page) =>
  page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });

test('a relay keeps the list of each woman while she looks at another one', async ({ page }) => {
  await onboard(page, 'accompanied');
  await addProfile(page, 'Bineta');
  await addProfile(page, 'Coumba');

  await profilesList(page)
    .getByRole('button', { name: /^Bineta/ })
    .click();
  await addRemedy(page, 'kinkeliba');
  await expect(page.getByText('Kinkéliba', { exact: true })).toBeVisible();

  // Back to the list through the app's mark, as on the phone.
  await page.getByRole('banner').getByRole('link').first().click();
  await expect(profilesList(page).getByRole('button', { name: /^Bineta/ })).toContainText(
    /Liste en cours\s:\s1 produit/,
  );
  await profilesList(page)
    .getByRole('button', { name: /^Coumba/ })
    .click();
  await expect(page.getByText(/^Rien n'est encore ajouté/)).toBeVisible();
  await page.goBack();
  await profilesList(page)
    .getByRole('button', { name: /^Bineta/ })
    .click();

  // Nothing to type again.
  await expect(page.getByText('Kinkéliba', { exact: true })).toBeVisible();

  // The quick exit forgets every list.
  await page.getByRole('banner').getByRole('button', { name: 'Quitter' }).click();
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await unlock(page);
  await expect(profilesList(page).getByRole('button', { name: /^Bineta/ })).not.toContainText(
    'Liste en cours',
  );
});

test('a depot keeper checks a passer-by without a profile, and nothing is kept', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Regarder sans enregistrer' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Regarder sans enregistrer' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Surnom' })).toHaveCount(0);
  await expectNoSeriousViolation(page);
  await answerPregnant(page, '24');
  await page.getByRole('button', { name: 'Regarder ses produits' }).click();

  await expect(page.getByRole('heading', { level: 1, name: "Ce qu'elle prend" })).toBeVisible();
  await expect(page.locator('.check__profile')).toContainText('Femme de passage');
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await page.getByRole('searchbox').fill('Advil 400');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await page.getByText('Aucun de ces signes', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Résultat, sans enregistrer' }),
  ).toBeVisible();
  // An anti-inflammatory at 24 weeks, as for a profile.
  await expect(
    page.getByRole('heading', { level: 2, name: /^À montrer avant la prochaine prise/ }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);
  expect(await countIn(page, 'profiles')).toBe(0);
  expect(await countIn(page, 'history')).toBe(0);

  // The way back leads to the list of profiles, never to her answers.
  await page.getByRole('button', { name: 'Revenir à la liste' }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
});

test('a midwife finds a woman among many, with "Ajouter un profil" at the top', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  const names = [
    'Awa',
    'Aïssatou',
    'Bineta',
    'Coumba',
    'Diarra',
    'Fatou',
    'Khady',
    'Mariama',
    'Ndeye',
  ];
  await page.evaluate(
    (pseudonyms) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const today = new Date().toISOString().slice(0, 10);
          const write = open.result.transaction('profiles', 'readwrite');
          pseudonyms.forEach((pseudonym, index) => {
            write.objectStore('profiles').put({
              id: `e2e-${String(index)}`,
              self: false,
              pseudonym,
              pregnant: true,
              term: { kind: 'weeks', weeks: 20, givenOn: today },
              breastfeeding: false,
              conditions: [],
              longTermItems: [],
              createdAt: `${today}T08:00:00.000Z`,
              updatedAt: `${today}T08:00:00.000Z`,
            });
          });
          write.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    names,
  );
  await page.reload();
  await unlock(page);
  await expectStart(page, 'accompanied');

  await expect(profilesList(page).getByRole('listitem')).toHaveCount(9);
  // In the first screen, above the list.
  await expect(page.getByRole('button', { name: 'Ajouter un profil' })).toBeInViewport();
  await page.getByRole('searchbox', { name: 'Chercher un profil' }).fill('aiss');
  await expect(profilesList(page).getByRole('listitem')).toHaveCount(1);
  await expect(profilesList(page).getByRole('button', { name: /^Aïssatou/ })).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('a long list of strengths keeps the one typed and "yes" in the first screen', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await answerPregnant(page, '20');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await page.getByRole('searchbox').fill('Doliprane 1000 mg');
  await page.locator('.candidate').first().click();

  const question = page.getByRole('group', { name: /^Quel dosage est écrit sur la boîte/ });
  await expect(question.getByRole('radio', { checked: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: "Oui, c'est ce produit" })).toBeInViewport();
  await expectNoSeriousViolation(page);

  // Every strength on demand; "yes" stays in reach while the list scrolls.
  await page.getByRole('button', { name: /^Voir tous les dosages/ }).click();
  await expect(question.getByRole('radio')).not.toHaveCount(0);
  await question.getByRole('radio').last().scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: "Oui, c'est ce produit" })).toBeInViewport();
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
});

for (const { width, height } of [
  { width: 320, height: 640 },
  { width: 360, height: 800 },
]) {
  test.describe(`at ${String(width)} x ${String(height)} with text at 200 percent`, () => {
    test.use({ viewport: { width, height } });

    test('arrowing through every strength never leaves the focused one under "yes"', async ({
      page,
    }) => {
      await onboard(page, 'woman');
      await page.getByRole('link', { name: 'Mon profil' }).click();
      await answerPregnant(page, '20');
      await page.getByRole('button', { name: 'Enregistrer' }).click();
      await page.getByRole('button', { name: 'Regarder un produit' }).click();
      await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
      await page.getByRole('searchbox').fill('doliprane');
      await page.locator('.candidate').first().click();
      await page.addStyleTag({ content: 'html { font-size: 200%; }' });

      const question = page.getByRole('group', { name: /^Quel dosage est écrit sur la boîte/ });
      const answers = question.getByRole('radio');
      const count = await answers.count();
      expect(count).toBeGreaterThan(10);
      await answers.first().focus();
      for (let step = 0; step < count; step += 1) {
        // Once drawn (two frames): the answer with the focus, its whole label, is clear of the held bar.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  resolve();
                });
              });
            }),
        );
        const covered = await page.evaluate(() => {
          const focused = document.activeElement?.closest('label') ?? document.activeElement;
          const bar = document.querySelector('.confirm__decide');
          if (focused === null || bar === null) return 'nothing focused';
          if (getComputedStyle(bar).position !== 'sticky') return null;
          const answer = focused.getBoundingClientRect();
          const held = bar.getBoundingClientRect();
          return answer.bottom > held.top + 1 && answer.top < held.bottom
            ? focused.textContent
            : null;
        });
        expect(covered, `step ${String(step)}`).toBeNull();
        await page.keyboard.press('ArrowDown');
      }
      // Held, it never takes more than a third of the screen; taller, it is in the flow.
      const bar = await page.locator('.confirm__decide').evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        held: getComputedStyle(element).position === 'sticky',
      }));
      expect(bar.held ? bar.height : 0).toBeLessThanOrEqual(height / 3);
      expect(bar.held || bar.height > height / 3, JSON.stringify(bar)).toBe(true);
    });
  });
}

test('an easy code is warned about, then kept on a second yes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Français' }).click();
  await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
  await page.getByLabel('Code', { exact: true }).fill('1990');
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Ce code est facile à deviner' }),
  ).toBeFocused();
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Garder ce code' }).click();
  await page.getByLabel('Le même code', { exact: true }).fill('1990');
  await page.getByRole('button', { name: 'Enregistrer le code' }).click();
  await expectStart(page, 'woman');

  // The keypad never says the word of the erase.
  await page.reload();
  const keypad = page.getByRole('group', { name: 'Clavier du code' });
  await expect(keypad.getByRole('button', { name: 'Corriger le dernier chiffre' })).toHaveText(
    'Corriger',
  );
  await unlock(page, '1990');
  await expectStart(page, 'woman');
});
