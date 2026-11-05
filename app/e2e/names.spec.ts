// SPDX-License-Identifier: MIT
// Names typed that the lists know under another name (live test round of
// 2026-11-05): "not found" asks first, and a name kept as typed is still
// evaluated as what it looks like, so the result is never lower than the base
// knows for it.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { onboard } from './support.js';

const NBSP = ' ';

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

/** Welcome in French, woman mode, then her profile: pregnant at `weeks` weeks, with `situation`. */
async function pregnantAt(page: Page, weeks: number, situation: string) {
  await onboard(page, 'woman');
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill(String(weeks));
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText(situation, { exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
}

/** Types `name` among the medicines, then keeps it as typed through the question "not found" asks first. */
async function addAsTyped(page: Page, name: string, lookalike: RegExp) {
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  // The field has the focus: the name is typed at once.
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.type(name);
  await page.getByRole('button', { name: 'Je ne trouve pas ce produit' }).click();

  const lookalikes = page.getByRole('list', { name: `Ce nom ressemble à${NBSP}:` });
  await expect(lookalikes.locator('.candidate').first()).toContainText(lookalike);
  // The usual results are hidden under the question, on screen too (CSS).
  await expect(page.locator('.search__results')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Je ne trouve pas ce produit' })).toHaveCount(0);
  await expectNoSeriousViolation(page);
  // The question follows the list shown (medicines, remedies or both).
  await page.getByRole('button', { name: /^Non, aucun de ces / }).click();

  const items = page.getByRole('list', { name: 'Produits ajoutés' });
  await expect(items).toContainText(name);
  await expect(items).toContainText('Produit non reconnu');
}

async function seeResult(page: Page) {
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await page.getByText('Aucun de ces signes', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
}

test('huile de ricin typed among the medicines at term with a scar: asked first, the danger stays', async ({
  page,
}) => {
  await pregnantAt(page, 37, "Ancienne césarienne (cicatrice sur l'utérus)");
  await addAsTyped(page, 'huile de ricin', /^Huile de ricin/);
  await seeResult(page);

  await expect(page.getByRole('alert')).toContainText('Danger');
  await expect(page.getByRole('button', { name: 'Voir qui appeler' })).toBeVisible();
  await expect(
    page.getByRole('article', { name: `Danger${NBSP}: à montrer maintenant. huile de ricin` }),
  ).toContainText(
    `Ce nom ressemble à Huile de ricin (Ricinus communis). Si c'est ce remède${NBSP}:`,
  );
  // The name typed keeps its own grey card: it is still not recognised.
  await expect(page.getByRole('article', { name: 'On ne sait pas. huile de ricin' })).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('Advil typed as free text at 28 weeks: the card of what it looks like, before the next dose', async ({
  page,
}) => {
  await pregnantAt(page, 28, 'Aucune de ces situations');
  // The strength held to its unit by a no-break space ("\s" reads it).
  await addAsTyped(page, 'Advil 400 mg comprimé pelliculé', /^ADVIL 400\smg/);
  await seeResult(page);

  const possible = page.getByRole('article', {
    name: 'À montrer avant la prochaine prise. Advil 400 mg comprimé pelliculé',
  });
  await expect(possible).toContainText('Ce nom ressemble à ADVIL 400 mg, comprimé enrobé');
  await expect(possible.locator('.result-card__orientation')).toHaveText(
    "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
  );
  await expect(
    page.getByRole('article', { name: 'On ne sait pas. Advil 400 mg comprimé pelliculé' }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('a brand typed for a generic keeps the name typed, up to the result', async ({ page }) => {
  await pregnantAt(page, 10, 'Aucune de ces situations');
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await page.keyboard.type('cytotec');
  await page.locator('.candidate').first().click();
  await expect(page.locator('.confirm__product')).toContainText(`Vous avez écrit${NBSP}: cytotec`);
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
  await expect(page.getByRole('list', { name: 'Produits ajoutés' })).toContainText(
    `Vous avez écrit${NBSP}: cytotec`,
  );
  await seeResult(page);
  await expect(page.getByRole('article')).toContainText(`Vous avez écrit${NBSP}: cytotec`);
});

/** Types `name` among the medicines and keeps it as typed: through the question when one is asked. */
async function addTyped(page: Page, name: string) {
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.type(name);
  await page.getByRole('button', { name: 'Je ne trouve pas ce produit' }).click();
  const none = page.getByRole('button', { name: /^Non, aucun de ces / });
  const check = page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' });
  await expect(none.or(check)).toBeVisible();
  if (await none.isVisible()) await none.click();
  await expect(check).toBeVisible();
}

test('weak resemblances kept as typed never alert: oils, a first name, close spellings', async ({
  page,
}) => {
  await pregnantAt(page, 37, "Ancienne césarienne (cicatrice sur l'utérus)");
  const names = [
    'huile de coco',
    'huile de lin',
    'huile',
    'vitamines',
    'Moussa',
    'Anta',
    'clotrimazole',
    'Efferalgan 1g cpr eff',
  ];
  for (const name of names) await addTyped(page, name);
  await seeResult(page);

  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/Huile de ricin/)).toHaveCount(0);
  await expect(page.getByText(/ricin|codéine|CLARELUX|ANTALCALM|COTRIMOXAZOLE/i)).toHaveCount(0);
  // The abbreviations of the box are read: the effervescent EFFERALGAN 1000 mg, not Efferalgan codéine.
  await expect(
    page
      .getByRole('article', { name: /Efferalgan 1g cpr eff$/ })
      .filter({ hasText: 'Ce nom ressemble' }),
  ).toContainText('EFFERALGAN 1000 mg, comprimé effervescent');
});

test('"huile de ricin bio" kept as typed after "none of these" keeps the danger at term with a scar', async ({
  page,
}) => {
  await pregnantAt(page, 37, "Ancienne césarienne (cicatrice sur l'utérus)");
  await addTyped(page, 'huile de ricin bio');
  await seeResult(page);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Danger');
  await expect(alert).toContainText('(ressemble à Huile de ricin)');
  await expect(page.getByRole('button', { name: 'Voir qui appeler' })).toBeVisible();
});
