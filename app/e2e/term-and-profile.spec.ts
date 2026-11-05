// SPDX-License-Identifier: MIT
// Live test round 1 (SCRUM-45): an outdated term is asked about before any
// check, what is typed in the profile is never cut, a pseudonym is used once,
// one profile can be deleted, and the danger signs now are asked afresh.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { onboard, unlock } from './support.js';

const DAY_MS = 86_400_000;

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

/** Every record of one store of the app's IndexedDB. */
function storedAll(page: Page, store: 'profiles' | 'history'): Promise<unknown[]> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const all = open.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve(all.result as unknown[]);
          };
        };
      }),
    store,
  );
}

/** The profile screen filled: a pseudonym, pregnant at `weeks` weeks, no situation; then saved. */
async function pregnantProfile(page: Page, weeks: number, pseudonym?: string) {
  if (pseudonym !== undefined) await page.getByRole('textbox', { name: 'Surnom' }).fill(pseudonym);
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill(String(weeks));
  await answer(page, /^Ce terme date de quand/, "Aujourd'hui").click();
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
}

/** The phone's clock `days` later, then a reload (the code is asked again). */
async function daysLater(page: Page, days: number) {
  await page.clock.setFixedTime(new Date(Date.now() + days * DAY_MS));
  await page.reload();
  await unlock(page);
}

test('an outdated term asks whether the baby is born before any check, then updates the profile', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await pregnantProfile(page, 30);
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();

  // 100 days later she has given birth: 30 weeks then is past 42 now.
  await daysLater(page, 100);
  await page.getByRole('button', { name: 'Regarder un produit' }).click();

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /^Votre terme noté a passé 42 semaines\. Votre bébé est-il né/,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter un médicament' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Voir le résultat' })).toHaveCount(0);
  // The danger signs stay one tap away.
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Signes de danger' }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);

  await page.getByRole('button', { name: 'Oui, le bébé est né' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: /^Enceinte/ }).getByRole('radio', { name: 'Non' }),
  ).toBeChecked();
  // Not breastfeeding: the app no longer covers her, and no save that does nothing.
  await answer(page, /^Allaite/, 'Non').click();
  await expect(page.getByRole('button', { name: 'Supprimer mon profil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0);
  await answer(page, /^Allaite/, 'Oui').click();
  await answer(page, 'Âge du bébé', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Âge en semaines' }).fill('2');
  await answer(page, /^Né avant terme/, 'Non').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  // Back on her check, as a breastfeeding mother now.
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
  await expect(page.getByText('Allaite, bébé de 2 semaines')).toBeVisible();
  expect(await storedAll(page, 'profiles')).toEqual([
    expect.objectContaining({ pregnant: false, breastfeeding: true, babyAgeWeeks: 2 }),
  ]);
});

test('the list marks an outdated profile, and "still pregnant" asks for the term again', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await pregnantProfile(page, 38, 'Bineta');
  const list = page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
  await expect(list.getByRole('button', { name: /^Bineta/ })).toHaveAccessibleName(
    'Bineta Environ 38 semaines',
  );

  await daysLater(page, 60);
  await expect(list.getByRole('button', { name: /^Bineta/ })).toHaveAccessibleName(
    'Bineta À mettre à jour',
  );
  await list.getByRole('button', { name: /^Bineta/ }).click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /^Le terme noté a passé 42 semaines\. Le bébé est-il né/,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Non, toujours enceinte' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Modifier le profil' })).toBeVisible();
  const weeks = page.getByRole('textbox', { name: 'Nombre de semaines' });
  await expect(weeks).toHaveValue('');
  await weeks.fill('40');
  await answer(page, /^Ce terme date de quand/, "Aujourd'hui").click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ce qu'elle prend" })).toBeVisible();
  await expect(page.getByText('Environ 40 semaines')).toBeVisible();
});

/** Her profile: pregnant, "Je ne sais pas" to the term, no breastfeeding, no situation. */
async function unknownTermProfile(page: Page) {
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'Je ne sais pas').click();
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
}

test('an unknown term said 40 days ago may be past the birth: the check goes on with breastfeeding', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await unknownTermProfile(page);
  const list = page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
  await expect(list.getByRole('button', { name: /^Femme 1/ })).toBeVisible();

  await daysLater(page, 40);
  await expect(list.getByRole('button', { name: /^Femme 1/ })).toHaveAccessibleName(
    /^Femme 1 Terme inconnu À confirmer\s: le bébé est peut-être né$/,
  );
  await expect(
    list.getByRole('link', { name: 'Mettre à jour le profil de Femme 1' }),
  ).toBeVisible();
  await list.getByRole('button', { name: /^Femme 1/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ce qu'elle prend" })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await page.getByRole('searchbox').fill('codeine');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();

  // The signs after the birth and of the baby are asked up front, with the pregnancy's.
  const signs = page.getByRole('group', { name: /^A-t-elle un de ces signes maintenant/ });
  for (const group of ['Pendant la grossesse', "Après l'accouchement", 'Chez le bébé']) {
    await expect(signs.getByRole('group', { name: group })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Voir tous les signes' })).toHaveCount(0);
  await page.getByText('Aucun de ces signes', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: /^Résultat pour Femme 1/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Nous ne savons pas si le bébé est né\s: ce résultat tient compte/),
  ).toBeVisible();
  // The breastfeeding rule on codeine applies, as for a baby of unknown age.
  await expect(page.getByText('Règle : codeine-breastfeeding')).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('an unknown term said 300 days ago asks whether the baby is born first', async ({ page }) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await unknownTermProfile(page);
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();

  await daysLater(page, 300);
  await page.getByRole('button', { name: 'Regarder un produit' }).click();

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /^Votre terme noté a passé 42 semaines\. Votre bébé est-il né/,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter un médicament' })).toHaveCount(0);
});

test('a last period with the phone date set back is read as unknown, and the result says why', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'Date des dernières règles').click();
  const lmp = page.getByLabel('Premier jour des dernières règles');
  const today = (await lmp.getAttribute('max')) ?? '';
  const twentyWeeksAgo = await page.evaluate((iso) => {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 140);
    return date.toISOString().slice(0, 10);
  }, today);
  await lmp.fill(twentyWeeksAgo);
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();

  // The phone's date set 30 days back: before the day the profile was saved.
  await daysLater(page, -30);
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await page.getByRole('searchbox').fill('ibuprofene');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  // The real date is later: the baby may be born, its signs are asked too.
  await expect(page.getByRole('group', { name: 'Chez le bébé' })).toBeVisible();
  await page.getByText('Aucun de ces signes', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();

  await expect(
    page.getByText(
      /la date du téléphone est avant un jour où l'application a déjà servi\. Votre bébé est peut-être né\s: ce résultat tient compte de toute la grossesse et de l'allaitement/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/^Terme inconnu\s: ce résultat tient compte de toute la grossesse/),
  ).toBeVisible();
});

test('the month field keeps "34", says it looks like weeks, and takes it as weeks in one tap', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En mois').click();
  const months = page.getByRole('textbox', { name: /^Dans quel mois de grossesse/ });

  await months.pressSequentially('34');

  await expect(months).toHaveValue('34');
  await expect(page.getByText(/^Ce nombre ressemble à des semaines/)).toBeVisible();
  await expect(page.getByText(/^Entre/)).toHaveCount(0);
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Ce sont 34 semaines' }).click();

  await expect(page.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveValue('34');
  await expect(page.getByText('Environ 34 semaines')).toBeVisible();
});

test('a pseudonym is used once on the phone, and a long one is refused, never cut', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await pregnantProfile(page, 12, 'Awa');
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();

  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  const pseudonym = page.getByRole('textbox', { name: 'Surnom' });
  await pseudonym.fill('Awa Diop Ndiaye fille de Moussa du quartier HLM');
  await expect(pseudonym).toHaveValue('Awa Diop Ndiaye fille de Moussa du quartier HLM');
  await expect(page.getByText('Écrivez un surnom de 40 caractères au plus.')).toBeVisible();

  await pregnantProfile(page, 32, ' àwa ');
  await expect(page.getByText(/^Ce surnom est déjà sur ce téléphone/)).toBeVisible();
  await expect(pseudonym).toBeFocused();
  expect(await storedAll(page, 'profiles')).toHaveLength(1);
});

test('a double tap on save makes one profile', async ({ page }) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'Je ne sais pas').click();
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();

  // Two clicks in the same task, before the page can render.
  await page.evaluate(() => {
    const save = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Enregistrer',
    );
    save?.click();
    save?.click();
  });

  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
  expect(await storedAll(page, 'profiles')).toHaveLength(1);
});

test('one profile is deleted with its history after a last yes; the others stay', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  for (const name of ['Awa', 'Binta']) {
    await page.getByRole('button', { name: 'Ajouter un profil' }).click();
    await pregnantProfile(page, 20, name);
    await expect(page.getByText(new RegExp(`^Profil enregistré\\s: ${name}\\.$`))).toBeVisible();
  }
  // A result for Awa, kept in the history of the phone.
  const list = page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
  await list.getByRole('button', { name: /^Awa/ }).click();
  await page.getByRole('button', { name: 'Ajouter un remède' }).click();
  await page.getByRole('searchbox').fill('kinkeliba');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await page.getByText('Aucun de ces signes', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat pour Awa' })).toBeVisible();
  await expect.poll(async () => (await storedAll(page, 'history')).length).toBe(1);

  await page.goto('/#/');
  await list.getByRole('link', { name: 'Modifier le profil de Awa' }).click();
  await page.getByRole('button', { name: 'Supprimer ce profil' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: /^Supprimer le profil Awa/ }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Supprimer le profil' }).click();

  await expect(page.getByText(/^Profil supprimé\s: Awa\.$/)).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('button', { name: /^Binta/ })).toBeVisible();
  expect(await storedAll(page, 'profiles')).toEqual([
    expect.objectContaining({ pseudonym: 'Binta' }),
  ]);
  expect(await storedAll(page, 'history')).toEqual([]);
});

test('the danger signs now start unticked at each check, and a sign ticked after Back counts', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await pregnantProfile(page, 28);
  await page.getByRole('button', { name: 'Ajouter un remède' }).click();
  await page.getByRole('searchbox').fill('kinkeliba');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();

  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await page.getByText('Aucun de ces signes', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
  await expect(page.getByText(/^Terme retenu/)).toHaveText(/environ 28 semaines/);

  // Back: asked again, nothing ticked; a fever ticked then is in the result Forward opens.
  await page.goBack();
  const fever = page.getByRole('checkbox', { name: 'Fièvre', exact: true });
  await expect(page.getByRole('checkbox', { name: 'Aucun de ces signes' })).not.toBeChecked();
  await fever.check();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
  await expect(page.locator('article.level--danger').first()).toBeVisible();

  // A new look from the list: nothing ticked from before.
  await page.getByRole('button', { name: 'Revenir à la liste' }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await expect(page.getByRole('checkbox', { name: 'Aucun de ces signes' })).not.toBeChecked();
  await expect(fever).not.toBeChecked();
});
