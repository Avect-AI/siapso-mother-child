// SPDX-License-Identifier: MIT
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { checkField, onboard } from './support.js';

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

/**
 * On the check, adds a product by keyboard only (SCRUM-56, S12): its field,
 * its first row, then "yes" in the question under it when the row asks.
 */
async function addByKeyboard(page: Page, query: string, expected: RegExp) {
  const field = checkField(page);
  await tabTo(page, field);
  await page.keyboard.type(query);
  const first = page.locator('.candidate').first();
  await expect(first).toContainText(expected);
  // Field, then the microphone beside it (where the browser can record), then the candidates.
  await page.keyboard.press('Tab');
  const mic = page.getByRole('button', { name: 'Dire le nom' });
  if ((await mic.count()) > 0) {
    await expect(mic).toBeFocused();
    await page.keyboard.press('Tab');
  }
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');

  // A whole name with nothing to ask is added by its row (SCRUM-56); otherwise "yes".
  const yes = page.getByRole('button', { name: /^Oui, c'est ce/ });
  await expect
    .poll(async () => (await yes.isVisible()) || (await field.inputValue()) === '')
    .toBe(true);
  if (await yes.isVisible()) {
    // The question under the row has the focus: its answers follow it.
    await expect(page.getByRole('heading', { level: 2, name: /^Est-ce bien/ })).toBeFocused();
    await tabTo(page, yes);
    await page.keyboard.press('Enter');
  }
  // The field again, empty, for the next name.
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
}

test('a woman adds ibuprofen and kinkeliba by keyboard, confirming each, and sees the result', async ({
  page,
}) => {
  await startWithProfile(page);
  // She came to look up a product: the field has the focus.
  await expect(checkField(page)).toBeFocused();

  await addByKeyboard(page, 'ibuprofene', /^Ibuprofène/);
  await addByKeyboard(page, 'kinkiliba', /^Kinkéliba/);

  const items = page.getByRole('list', { name: 'Produits ajoutés' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Ibuprofène (générique)');
  await expect(items.nth(1)).toContainText('Kinkéliba');

  // The danger signs present now, by keyboard too, on the check (SCRUM-56, S13).
  await expect(
    page.getByRole('heading', { level: 2, name: 'Avez-vous un de ces signes maintenant ?' }),
  ).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Non, aucun de ces signes' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Résumé' })).toContainText('Ibuprofène (générique)');
  await expect(page.getByRole('article', { name: 'On ne sait pas. Kinkéliba' })).toBeVisible();
  // Back from the result asks the signs again, nothing chosen ("now" may have changed).
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Oui, au moins un' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  // Back from the check goes home: no step of the search is stacked behind it.
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
});

test('DOLIPRANE without a count is added with its strength not given (SCRUM-56, S10)', async ({
  page,
}) => {
  await startWithProfile(page);
  await page.getByRole('searchbox').fill('doliprane');
  await page.locator('.candidate').first().click();

  // No strength asked while no rule reads it; the daily count in sight.
  await expect(
    page.getByRole('textbox', { name: `Combien d'unités par jour${NBSP}?` }),
  ).toHaveValue('');
  await expect(
    page.getByRole('group', { name: `Quel dosage est écrit sur la boîte${NBSP}?` }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();

  const items = page.getByRole('list', { name: 'Produits ajoutés' });
  await expect(items).toContainText('DOLIPRANE');
  // Never a silent strength.
  await expect(items).toContainText('Dosage non précisé');
});

test('the strength on the box is asked once a daily count is given, and kept with it', async ({
  page,
}) => {
  await startWithProfile(page);
  await page.getByRole('searchbox').fill('doliprann');
  await expect(page.locator('.candidate').first()).toContainText('DOLIPRANE');
  await page.locator('.candidate').first().click();

  // The count first: the strength then counts for the daily maximum.
  await page.getByRole('button', { name: 'Une unité de plus' }).click();
  await page.getByRole('button', { name: 'Une unité de plus' }).click();
  await expect(
    page.getByRole('textbox', { name: `Combien d'unités par jour${NBSP}?` }),
  ).toHaveValue('2');
  const question = page.getByRole('group', { name: `Quel dosage est écrit sur la boîte${NBSP}?` });
  await expect(question).toBeVisible();
  await expect(question.getByRole('radio', { checked: true })).toHaveCount(0);
  // The brand is said once above the question: each answer starts with what the box shows.
  await question.getByText('1000 mg, comprimé', { exact: true }).click();
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();

  const items = page.getByRole('list', { name: 'Produits ajoutés' });
  await expect(items).toContainText('DOLIPRANE 1000 mg, comprimé');
  await expect(items).toContainText('2 unités par jour');
  await expect(page.locator('.check__status')).toHaveText(
    'DOLIPRANE 1000 mg, comprimé est ajouté à la liste.',
  );
});

test('the check with its rows and questions, and the search screen, have no serious accessibility violation', async ({
  page,
}) => {
  await startWithProfile(page);
  await expectNoSeriousViolation(page);

  await checkField(page).fill('nebeday');
  await expect(page.locator('.candidate').first()).toContainText('Moringa');
  await expectNoSeriousViolation(page);

  // A local name asks first, under its row.
  await page.locator('.candidate').first().click();
  await expect(page.getByRole('button', { name: "Oui, c'est ce remède" })).toBeVisible();
  await expect(page.locator('.candidate').first()).toHaveAttribute('aria-expanded', 'true');
  await expectNoSeriousViolation(page);

  await page.getByRole('button', { name: 'Non, chercher encore' }).click();
  await checkField(page).fill('doliprane');
  await expect(page.locator('.candidate').first()).toContainText('DOLIPRANE');
  await page.locator('.candidate').first().click();
  // A daily count: the strength is then asked (SCRUM-56).
  await page.getByRole('button', { name: 'Une unité de plus' }).click();
  await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
  await expect(page.getByText(/^Choisissez un dosage, ou/)).toBeVisible();
  await expectNoSeriousViolation(page);

  // A name it does not find, that looks like products: the search screen asks first.
  await checkField(page).fill('advill');
  await expect(page.locator('.candidate').first()).toContainText('ADVIL');
  await page.getByRole('button', { name: 'Je ne trouve pas ce produit' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^Ce nom ressemble à/ })).toBeFocused();
  await expectNoSeriousViolation(page);
  await page.locator('.search__lookalikes .candidate').first().click();
  await expect(
    page.getByRole('heading', { level: 1, name: /^Est-ce bien ce produit/ }),
  ).toBeVisible();
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
    await page.getByRole('searchbox').fill('doliprane');
    await page.locator('.candidate').first().click();
    // A daily count: the strength is then asked (SCRUM-56).
    await page.getByRole('button', { name: 'Une unité de plus' }).click();
    await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
    await expectFitsAndTargets(page);

    await page.getByRole('radio', { name: 'Je ne sais pas' }).check();
    await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
    await expectFitsAndTargets(page);

    await page.getByRole('searchbox').fill('nebeday');
    await expect(page.locator('.candidate').first()).toContainText('Moringa');
    await expectFitsAndTargets(page);
  });

  test('a long product name breaks inside its column instead of pushing the page sideways', async ({
    page,
  }) => {
    await startWithProfile(page);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await page.getByRole('searchbox').fill('acide acetylsalicylique biogaran 100');
    await expect(page.locator('.candidate').first()).toContainText('ACETYLSALICYLIQUE');
    await expectFitsAndTargets(page);

    // Enter opens the question of the first row (the strength typed agrees: a tap would add it).
    await checkField(page).press('Enter');
    await expect(page.locator('.confirm__name')).toContainText('ACETYLSALICYLIQUE');
    await expectFitsAndTargets(page);

    await page.getByRole('button', { name: "Oui, c'est ce produit" }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
    await expectFitsAndTargets(page);
  });
});
