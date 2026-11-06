// SPDX-License-Identifier: MIT
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addOnCheck, onboard, type Mode } from './support.js';

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

/**
 * Welcome in French, a mode and the code, then the profile: pregnant at
 * `weeks` weeks, no situation. Woman mode goes from Home, accompanied mode
 * adds the profile in the list, then opens it.
 */
async function pregnantAt(page: Page, weeks: number, mode: Mode = 'woman') {
  await onboard(page, mode);
  await (mode === 'woman'
    ? page.getByRole('button', { name: 'Regarder un produit' }).click()
    : page.getByRole('button', { name: 'Ajouter un profil' }).click());
  await expect(page.getByRole('heading', { level: 1, name: /profil$/i })).toBeVisible();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill(String(weeks));
  // The day the weeks were known: asked in accompanied mode, today by default for her own.
  await answer(page, /^Ce terme date de quand/, "Aujourd'hui").click();
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  // Saved, her check opens, a new profile in accompanied mode included (SCRUM-56).
  await page.getByRole('button', { name: /^Enregistrer/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ce qu/ })).toBeVisible();
}

const womanAt = (page: Page, weeks: number) => pregnantAt(page, weeks, 'woman');

/** From the check: "Voir le résultat", "Aucun de ces signes" on the danger signs now, then the result. */
async function seeResult(page: Page) {
  // The danger signs present now, on the check (SCRUM-56, S13).
  await page.getByRole('button', { name: 'Non, aucun de ces signes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Résultat/ })).toBeVisible();
}

/** Adds the first candidate for `query` on the check's field (both lists, SCRUM-56), confirmed. */
async function add(page: Page, query: string) {
  await addOnCheck(page, query);
  // "Ce que vous prenez" in woman mode, "Ce qu'elle prend" in accompanied mode.
  await expect(page.getByRole('heading', { level: 1, name: /^Ce qu/ })).toBeVisible();
}

test('ibuprofen at 30 weeks: show it before the next dose, to whom, and the closing lines', async ({
  page,
}) => {
  await womanAt(page, 30);
  await add(page, 'ibuprofene');
  await seeResult(page);

  const card = page.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.result-card__level')).toHaveText(
    'À montrer avant la prochaine prise',
  );
  await expect(card.getByRole('heading', { level: 2 })).toHaveAccessibleName(
    'À montrer avant la prochaine prise. Ibuprofène (générique)',
  );
  await expect(card.locator('.result-card__orientation')).toHaveText(
    "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
  );
  // Woman mode: no number in what she reads, no source.
  await expect(card.locator('.result-card__meta')).toHaveCount(0);
  await expect(page.locator('.result__closing p').last()).toHaveText(
    'Cet outil ne remplace pas un soignant.',
  );
  // The version and "not clinically validated": short before the card, in full at the end.
  const version = page.getByText(/^Base de connaissances \d+\.\d+\.\d+ du \d{2}\/\d{2}\/\d{4}$/);
  await expect(version).toHaveCount(2);
  const basis = page.locator('.result__basis');
  await expect(basis).toContainText(/^Base de connaissances .*Contenu non validé cliniquement\.$/);
  // Above the card, in the first screen.
  const top = await basis.boundingBox();
  const first = await card.boundingBox();
  expect(top?.y ?? Infinity).toBeLessThan(first?.y ?? 0);
  await expect(page.locator('.result__closing')).toContainText(
    /Contenu non validé cliniquement\s: ne l'utilisez pas seul pour décider\./,
  );
  await expectNoSeriousViolation(page);

  // Back keeps the list, so a forgotten product can be added.
  await page.getByRole('button', { name: 'Revenir à la liste' }).click();
  await expect(page.getByRole('list', { name: 'Produits ajoutés' })).toContainText(
    'Ibuprofène (générique)',
  );
});

test('kinkeliba without a danger sign: we do not know, and who to show it to', async ({ page }) => {
  await womanAt(page, 14);
  await add(page, 'kinkeliba');
  await seeResult(page);

  const card = page.getByRole('article', { name: 'On ne sait pas. Kinkéliba' });
  await expect(card).toBeVisible();
  await expect(card.locator('.result-card__level')).toHaveText('On ne sait pas');
  // Its risk says that nobody knows whether it can harm: the orientation says who and when.
  await expect(card).toContainText('On ne sait pas si le kinkéliba peut faire du mal');
  await expect(card).not.toContainText('sans risque');
  await expect(card.locator('.result-card__orientation')).toHaveText(
    'Montrez ce produit à la sage-femme ou au pharmacien à la prochaine visite.',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectNoSeriousViolation(page);
});

test('accompanied mode: who and when before the details, sources, nothing sideways at 200 percent text', async ({
  page,
}) => {
  await pregnantAt(page, 30, 'accompanied');
  await add(page, 'advil 400');
  await seeResult(page);

  const card = page.getByRole('article');
  // The details, evidence, sources and rules wait behind one "Pourquoi ?".
  const details = card.locator('.result-card__details');
  await expect(details).toBeHidden();
  await card.getByText('Pourquoi ?').click();
  await expect(details).toBeVisible();
  await expect(details).toContainText('anti-inflammatoire');
  // The evidence level sits with the detailed risk it belongs to.
  await expect(card.locator('.result-card__risk')).toContainText('Niveau de preuve A');
  await expect(card.getByRole('link').first()).toHaveAttribute('href', /^https:\/\//);
  // Sources in French, an English document said as such.
  await expect(card.locator('.result-card__meta')).toContainText(
    'Notices de médicaments des États-Unis (openFDA), documents en anglais',
  );
  await expect(page.getByRole('heading', { level: 2, name: 'Rappels' })).toBeVisible();
  await expectNoSeriousViolation(page);

  // Long source records (a DOI, a label set id) break instead of widening the page.
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const width = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
});
