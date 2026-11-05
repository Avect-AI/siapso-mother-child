// SPDX-License-Identifier: MIT
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { onboard } from './support.js';

const NBSP = ' ';

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

/** Welcome in French, woman mode, then her profile (pregnant, term unknown), as the check asks for it. */
async function startWithProfile(page: Page) {
  await onboard(page, 'woman');
  await page.getByRole('button', { name: 'Regarder un produit' }).click();

  // No profile yet: the profile screen comes first, then the check.
  await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
  await page
    .getByRole('group', { name: /^Enceinte/ })
    .getByText('Oui', { exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Terme de la grossesse' })
    .getByText('Je ne sais pas')
    .click();
  await page
    .getByRole('group', { name: /^Allaite/ })
    .getByText('Non', { exact: true })
    .click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
}

/** Presses Tab until `target` has the focus (at most 20 times). */
async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 20; presses += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** From the check, adds a product by keyboard only: the search, its first candidate, yes. */
async function addByKeyboard(page: Page, list: string, query: string, expected: RegExp) {
  await tabTo(page, page.getByRole('button', { name: list }));
  await page.keyboard.press('Enter');
  const field = page.getByRole('searchbox');
  await tabTo(page, field);
  await page.keyboard.type(query);
  const first = page.locator('.candidate').first();
  await expect(first).toContainText(expected);
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');

  const yes = page.getByRole('button', { name: /^Oui, c'est ce/ });
  await tabTo(page, yes);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
}

test('a woman adds ibuprofen and kinkeliba by keyboard, confirming each, and sees the result', async ({
  page,
}) => {
  await startWithProfile(page);

  await addByKeyboard(page, 'Ajouter un médicament', 'ibuprofene', /^Ibuprofène/);
  await addByKeyboard(page, 'Ajouter un remède', 'kinkiliba', /^Kinkéliba/);

  const items = page.getByRole('list', { name: 'Produits ajoutés' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Ibuprofène (générique)');
  await expect(items.nth(1)).toContainText('Kinkéliba');

  // Back from the check goes home: the search and confirm steps are not stacked behind it.
  await tabTo(page, page.getByRole('button', { name: 'Voir le résultat' }));
  await page.keyboard.press('Enter');
  // The danger signs present now, by keyboard too: "none" first, then on to the result.
  const signsTitle = 'Avez-vous un de ces signes maintenant ?';
  await expect(page.getByRole('heading', { level: 1, name: signsTitle })).toBeVisible();
  await tabTo(page, page.getByRole('checkbox', { name: 'Aucun de ces signes' }));
  await page.keyboard.press('Space');
  await tabTo(page, page.getByRole('button', { name: 'Voir le résultat' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Résumé' })).toContainText('Ibuprofène (générique)');
  await expect(page.getByRole('article', { name: 'On ne sait pas. Kinkéliba' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('checkbox', { name: 'Aucun de ces signes' })).toBeChecked();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
});

test('the strength on the box is asked for a brand, and units for a daily maximum', async ({
  page,
}) => {
  await startWithProfile(page);
  await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
  await page.getByRole('searchbox').fill('doliprann');
  await expect(page.locator('.candidate').first()).toContainText('DOLIPRANE');
  await page.locator('.candidate').first().click();

  const question = page.getByRole('group', { name: `Quel dosage est écrit sur la boîte${NBSP}?` });
  await expect(question).toBeVisible();
  await expect(question.getByRole('radio', { checked: true })).toHaveCount(0);
  // The brand is said once above the question: each answer starts with what the box shows.
  await question.getByText('1000 mg, comprimé', { exact: true }).click();
  await page.getByRole('button', { name: 'Une unité de plus' }).click();
  await page.getByRole('button', { name: 'Une unité de plus' }).click();
  await expect(
    page.getByRole('textbox', { name: `Combien d'unités par jour${NBSP}?` }),
  ).toHaveValue('2');
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();

  const items = page.getByRole('list', { name: 'Produits ajoutés' });
  await expect(items).toContainText('DOLIPRANE 1000 mg, comprimé');
  await expect(items).toContainText('2 unités par jour');
  await expect(page.locator('.check__status')).toHaveText(
    'DOLIPRANE 1000 mg, comprimé est ajouté à la liste.',
  );
});

test('check, search and confirm have no serious accessibility violation', async ({ page }) => {
  await startWithProfile(page);
  await expectNoSeriousViolation(page);

  await page.getByRole('button', { name: 'Ajouter un remède' }).click();
  await page.getByRole('searchbox').fill('nebeday');
  await expect(page.locator('.candidate').first()).toContainText('Moringa');
  await expectNoSeriousViolation(page);

  await page.locator('.candidate').first().click();
  await expect(page.getByRole('button', { name: "Oui, c'est ce remède" })).toBeVisible();
  await expectNoSeriousViolation(page);

  // Back on the remedies: a medicine name offers the other list, keeping the text.
  await page.getByRole('button', { name: 'Non, chercher encore' }).click();
  await page.getByRole('searchbox').fill('doliprane');
  await expect(page.getByText('Ce nom correspond à un médicament.')).toBeVisible();
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Chercher parmi les médicaments' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ajouter un médicament' }),
  ).toBeVisible();
  await expect(page.locator('.candidate').first()).toContainText('DOLIPRANE');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
  await expect(page.getByText(/^Choisissez un dosage, ou/)).toBeVisible();
  await expectNoSeriousViolation(page);
});

test.describe('at 360 px with text at 200 percent', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  async function expectFitsAndTargets(page: Page) {
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'main a, main button, main label.option, main input',
        ),
      ]
        .filter((el) => !(el instanceof HTMLInputElement && el.closest('label.option')))
        .map((el) => ({
          text: el.textContent || el.getAttribute('type'),
          box: el.getBoundingClientRect(),
        }))
        .filter(({ box }) => box.width < 48 || box.height < 48)
        .map(({ text }) => text),
    );
    expect(small).toEqual([]);
  }

  test('check, search and confirm never scroll sideways and every control is a 48 px target', async ({
    page,
  }) => {
    await startWithProfile(page);
    await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
    await page.getByRole('searchbox').fill('doliprane');
    await page.locator('.candidate').first().click();
    await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
    await expectFitsAndTargets(page);

    await page.getByRole('radio', { name: 'Je ne sais pas' }).check();
    await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
    await expectFitsAndTargets(page);

    await page.getByRole('button', { name: 'Ajouter un remède' }).click();
    await page.getByRole('searchbox').fill('nebeday');
    await expect(page.locator('.candidate').first()).toContainText('Moringa');
    await expectFitsAndTargets(page);
  });

  test('a long product name breaks inside its column instead of pushing the page sideways', async ({
    page,
  }) => {
    await startWithProfile(page);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
    await page.getByRole('searchbox').fill('acide acetylsalicylique biogaran 100');
    await expect(page.locator('.candidate').first()).toContainText('ACETYLSALICYLIQUE');
    await expectFitsAndTargets(page);

    await page.locator('.candidate').first().click();
    await expect(page.locator('.confirm__name')).toContainText('ACETYLSALICYLIQUE');
    await expectFitsAndTargets(page);

    await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
    await expectFitsAndTargets(page);
  });
});
