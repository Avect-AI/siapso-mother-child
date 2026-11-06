// SPDX-License-Identifier: MIT
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { herCheckThenProfiles, onboard, unlock } from './support.js';

/**
 * Taps the way a thumb does on the mobile project (clicks on desktop) and
 * counts every one: the profile must take at most 8 taps and one typed field
 * in the common case, a step count rather than a wall-clock time.
 */
function stepCounter(testInfo: TestInfo) {
  const touch = testInfo.project.use.hasTouch === true;
  const steps = { taps: 0, typedFields: 0 };
  return {
    steps,
    async tap(target: Locator) {
      steps.taps += 1;
      await (touch ? target.tap() : target.click());
    },
    async type(field: Locator, text: string) {
      steps.taps += 1;
      await (touch ? field.tap() : field.click());
      steps.typedFields += 1;
      await field.pressSequentially(text);
    },
  };
}

function answer(page: Page, question: string | RegExp, label: string) {
  return page.getByRole('group', { name: question }).getByText(label, { exact: true });
}

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

test('a woman gives "26 weeks, no situation" in at most 8 taps and one typed field, then edits it', async ({
  page,
}, testInfo) => {
  await onboard(page, 'woman');
  const counter = stepCounter(testInfo);

  await counter.tap(page.getByRole('link', { name: 'Mon profil' }));
  await counter.tap(answer(page, /^Enceinte/, 'Oui'));
  await counter.tap(answer(page, 'Terme de la grossesse', 'En semaines'));
  await counter.type(page.getByRole('textbox', { name: 'Nombre de semaines' }), '26');
  await expect(page.getByText('Environ 26 semaines')).toBeVisible();
  await counter.tap(answer(page, /^Allaite/, 'Non'));
  await counter.tap(page.getByText('Aucune de ces situations'));
  await counter.tap(page.getByRole('button', { name: 'Enregistrer' }));

  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();
  expect(counter.steps.taps).toBeLessThanOrEqual(8);
  expect(counter.steps.typedFields).toBe(1);

  // Edit: the saved answers come back, a change is kept across a reload. The
  // situations saved show at a tap (one of them says HIV).
  await page.getByRole('link', { name: 'Mon profil' }).click();
  const weeks = page.getByRole('textbox', { name: 'Nombre de semaines' });
  await expect(weeks).toHaveValue('26');
  await expect(page.getByRole('checkbox', { name: 'Aucune de ces situations' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Situations masquées/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Aucune de ces situations' })).toBeChecked();
  await weeks.fill('27');
  // A new number on her saved profile: the day it was known is asked again.
  await answer(page, /^Ce terme date de quand/, "Aujourd'hui").click();
  await page.getByText("Ancienne césarienne (cicatrice sur l'utérus)").click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Profil enregistré/)).toBeVisible();

  await page.reload();
  await unlock(page);
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  await expect(page.getByText(/^Profil enregistré/)).toBeHidden();
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await expect(weeks).toHaveValue('27');
  await expect(page.getByText('Environ 27 semaines')).toBeVisible();
  await page.getByRole('button', { name: /^Situations masquées/ }).click();
  await expect(
    page.getByRole('checkbox', { name: "Ancienne césarienne (cicatrice sur l'utérus)" }),
  ).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Aucune de ces situations' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Drépanocytose' })).toHaveCount(0);
});

test('an accompanying person creates a profile from a last period date and a breastfed baby', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Nouveau profil' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Femme 1');
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'Date des dernières règles').click();
  const lmp = page.getByLabel('Premier jour des dernières règles');
  const today = await lmp.getAttribute('max');
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Ten weeks before today, computed in the page so it uses the same calendar.
  const tenWeeksAgo = await page.evaluate((iso) => {
    const date = new Date(`${iso ?? ''}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 70);
    return date.toISOString().slice(0, 10);
  }, today);
  await lmp.fill(tenWeeksAgo);
  await expect(page.getByText('Environ 10 semaines')).toBeVisible();

  await answer(page, /^Allaite/, 'Oui').click();
  await answer(page, 'Âge du bébé', 'En mois').click();
  await page.getByRole('textbox', { name: 'Âge en mois' }).fill('14');
  await answer(page, /^Né avant terme/, 'Je ne sais pas').click();
  await page.getByText('Drépanocytose').click();
  await page.getByRole('button', { name: 'Enregistrer et regarder ses produits' }).click();

  await herCheckThenProfiles(page, 'Femme 1');
  // Stored sealed: its random id and the sealed record, nothing readable.
  const stored = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const all = open.result.transaction('profiles').objectStore('profiles').getAll();
          all.onsuccess = () => {
            resolve(all.result as unknown[]);
          };
        };
      }),
  );
  expect(stored).toEqual([
    { id: expect.any(String) as unknown, sealed: expect.any(Object) as unknown },
  ]);
  for (const clear of ['Femme 1', tenWeeksAgo, 'sickle-cell', 'pregnant', 'lmp']) {
    expect(JSON.stringify(stored)).not.toContain(clear);
  }
  // What was given comes back on the profile screen.
  await page
    .getByRole('list', { name: 'Profils enregistrés sur ce téléphone' })
    .getByRole('link', { name: 'Modifier le profil de Femme 1' })
    .click();
  await expect(page.getByLabel('Premier jour des dernières règles')).toHaveValue(tenWeeksAgo);
  await expect(page.getByRole('textbox', { name: 'Âge en mois' })).toHaveValue('14');
  await expect(
    page
      .getByRole('group', { name: /^Né avant terme/ })
      .getByRole('radio', { name: 'Je ne sais pas' }),
  ).toBeChecked();
  await page.getByRole('button', { name: /^Situations masquées/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Drépanocytose' })).toBeChecked();
});

test('the profile screen names what is missing, in words next to each question', async ({
  page,
}) => {
  await onboard(page, 'woman');
  await page.getByRole('link', { name: 'Mon profil' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page.getByRole('radio', { name: 'Oui' }).first()).toBeFocused();
  await expect(
    page.getByRole('group', { name: /^Enceinte/ }).getByText('Répondez oui ou non.'),
  ).toBeVisible();
  await expect(page.getByText('Cochez au moins une case.')).toBeVisible();
});

test('the profile screen has no serious accessibility violation, empty, with errors and filled', async ({
  page,
}) => {
  await onboard(page, 'accompanied');
  await page.getByRole('button', { name: 'Ajouter un profil' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
  await expectNoSeriousViolation(page);

  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Cochez au moins une case.')).toBeVisible();
  await expectNoSeriousViolation(page);

  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En mois').click();
  await page.getByRole('textbox', { name: /^Dans quel mois de grossesse/ }).fill('5');
  await answer(page, /^Allaite/, 'Oui').click();
  await answer(page, 'Âge du bébé', 'Date de naissance').click();
  await expect(page.getByText('Entre 19 et 28 semaines (estimé)')).toBeVisible();
  await expectNoSeriousViolation(page);
});

test.describe('at 360 px with text at 200 percent', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('the profile screen never scrolls sideways and every answer is a 48 px target', async ({
    page,
  }) => {
    await onboard(page, 'accompanied');
    await page.getByRole('button', { name: 'Ajouter un profil' }).click();
    await answer(page, /^Enceinte/, 'Oui').click();
    await answer(page, 'Terme de la grossesse', 'Date des dernières règles').click();
    await answer(page, /^Allaite/, 'Oui').click();
    await answer(page, 'Âge du bébé', 'Date de naissance').click();
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

    // No answer breaks a word across two lines (the mark goes above the words instead).
    const split = await page.evaluate(() => {
      const broken: string[] = [];
      for (const span of document.querySelectorAll('label.option > span')) {
        const text = span.firstChild;
        if (!(text instanceof Text)) continue;
        for (const word of text.data.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, word.index);
          range.setEnd(text, word.index + word[0].length);
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
          if (lines.size > 1) broken.push(word[0]);
        }
      }
      return broken;
    });
    expect(split).toEqual([]);
  });
});
