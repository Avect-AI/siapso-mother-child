// SPDX-License-Identifier: MIT
// Fluidity of the main journeys (SCRUM-56, docs/superpowers/specs/2026-11-05-ux-fluidity-design.md):
// each journey is measured at 360 x 800 in French (taps, keystrokes, screens,
// scroll gestures, words read, app waits, modelled time; fluidity/meter.ts),
// its measure is kept as a JSON file of the run (test-results/fluidity) and
// attached to the report, and it fails when a count goes over its budget.
// The budgets start at the measured baseline of 2026-11-05 (spec section
// 4.1) and only go down: a change that adds a step to a journey says so here.
import { expect, test, type Page } from '@playwright/test';
import { CODE } from './support.js';
import { Journey, overBudget, report, resultFacts, type Budget } from './fluidity/meter.js';
import {
  addProduct,
  button,
  openAgain,
  pregnantAnswers,
  relayWithProfiles,
  toResult,
  unlock,
  womanWithProfile,
} from './fluidity/steps.js';

/** taps / keys / screens / scrolls each journey may take at most. */
const BUDGETS: Record<string, Budget> = {
  // SCRUM-56 P1, the welcome in one screen: 17 taps and 12 screens before;
  // P3, lighter profile answers: 14 taps before.
  j1: { taps: 12, keys: 20, screens: 9, scrolls: 3 },
  // SCRUM-56 P2, the code opens at its length: one tap less ("Ouvrir") at each opening.
  j2a: { taps: 7, keys: 14, screens: 8, scrolls: 0 },
  j2b: { taps: 11, keys: 25, screens: 11, scrolls: 1 },
  j3a: { taps: 7, keys: 14, screens: 8, scrolls: 0 },
  // P3: a new profile opens her check, weeks by default, "Aujourd'hui" for a passer-by.
  j3b: { taps: 13, keys: 22, screens: 9, scrolls: 3 },
  j4: { taps: 11, keys: 16, screens: 9, scrolls: 3 },
  j5a: { taps: 3, keys: 0, screens: 3, scrolls: 0 },
  j5b: { taps: 4, keys: 0, screens: 3, scrolls: 0 },
  j5c: { taps: 4, keys: 0, screens: 3, scrolls: 0 },
  j6a: { taps: 4, keys: 9, screens: 4, scrolls: 1 },
  j6b: { taps: 3, keys: 14, screens: 4, scrolls: 0 },
  j6c: { taps: 4, keys: 11, screens: 4, scrolls: 1 },
};

// The study's conditions (spec section 3.1): a 360 x 800 touch phone, in French.
test.use({ locale: 'fr-FR' });
test.describe.configure({ timeout: 180_000 });
test.beforeEach(({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-chromium' || page.viewportSize()?.width !== 360,
    'measured on a 360 x 800 touch phone only',
  );
});

/** Measures `run`, keeps its measure, then checks it against the journey's budget. */
function journey(id: string, title: string, run: (page: Page, j: Journey) => Promise<void>) {
  test(`${id}: ${title}`, async ({ page }, testInfo) => {
    const j = new Journey(page, id, title);
    await run(page, j);
    const result = await page
      .getByRole('heading', { level: 1, name: /^Résultat/ })
      .isVisible()
      .then((shown) => (shown ? resultFacts(page) : undefined));
    const measure = j.end(result);
    await report(testInfo, measure);
    const budget = BUDGETS[id];
    expect(budget, `a budget for ${id}`).toBeDefined();
    if (budget !== undefined) expect(overBudget(measure, budget)).toEqual([]);
  });
}

journey('j1', 'first use, woman mode, ibuprofen', async (page, j) => {
  await page.goto('/');
  await button(page, /^Je suis enceinte/).waitFor();
  await j.begin('welcome');
  // The language of the phone: nothing to choose. Mode and code on one screen.
  await j.tap(button(page, /^Je suis enceinte/), 'mode woman');
  await j.keypad(CODE, 'code typed');
  await j.keypad(CODE, 'code again', { then: button(page, 'Regarder un produit') });
  await j.tap(button(page, 'Regarder un produit'), 'regarder un produit');
  await pregnantAnswers(j);
  await j.tap(button(page, 'Enregistrer'), 'enregistrer profil', {
    then: button(page, 'Ajouter un médicament'),
  });
  await addProduct(j, 'ibuprofene');
  await toResult(j);
});

journey('j2a', 'returning woman, one product', async (page, j) => {
  await womanWithProfile(page);
  await openAgain(page);
  await j.begin('code screen');
  await unlock(j);
  await j.tap(button(page, 'Regarder un produit'), 'regarder un produit', {
    then: button(page, 'Ajouter un médicament'),
  });
  await addProduct(j, 'ibuprofene');
  await toResult(j);
});

journey('j2b', 'returning woman, two products', async (page, j) => {
  await womanWithProfile(page);
  await openAgain(page);
  await j.begin('code screen');
  await unlock(j);
  await j.tap(button(page, 'Regarder un produit'), 'regarder un produit', {
    then: button(page, 'Ajouter un médicament'),
  });
  await addProduct(j, 'ibuprofene');
  await addProduct(j, 'paracetamol');
  await toResult(j);
});

const savedProfiles = (page: Page) =>
  page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });

journey('j3a', 'relay, existing woman, one product', async (page, j) => {
  await relayWithProfiles(page);
  await openAgain(page);
  await j.begin('code screen');
  await unlock(j);
  await j.tap(savedProfiles(page).getByRole('button', { name: /^Awa/ }), 'choose Awa', {
    then: button(page, 'Ajouter un médicament'),
  });
  await addProduct(j, 'ibuprofene');
  await toResult(j);
});

journey('j3b', 'relay, new woman, one product', async (page, j) => {
  await relayWithProfiles(page);
  await openAgain(page);
  await j.begin('code screen');
  await unlock(j);
  await j.tap(button(page, 'Ajouter un profil'), 'ajouter un profil');
  // The pseudonym offered is selected by the tap that gives its field the focus
  // (SCRUM-56, S9): the name typed takes its place.
  await j.type(page.getByRole('textbox', { name: 'Surnom' }), 'Coumba', 'pseudonym');
  await pregnantAnswers(j);
  // Saved, her check opens (S8).
  await j.tap(button(page, 'Enregistrer et regarder ses produits'), 'enregistrer profil', {
    then: button(page, 'Ajouter un médicament'),
  });
  await addProduct(j, 'ibuprofene');
  await toResult(j);
});

journey('j4', 'passer-by at a depot, one product', async (page, j) => {
  await relayWithProfiles(page);
  await openAgain(page);
  await j.begin('code screen');
  await unlock(j);
  await j.tap(button(page, 'Regarder sans enregistrer'), 'regarder sans enregistrer');
  await pregnantAnswers(j);
  await j.tap(button(page, 'Regarder ses produits'), 'regarder ses produits', {
    then: button(page, 'Ajouter un médicament'),
  });
  await addProduct(j, 'ibuprofene');
  await toResult(j);
});

const band = (page: Page) =>
  page.getByRole('banner').getByRole('link', { name: 'Signes de danger' });
const callLink = (page: Page) => page.getByRole('link', { name: /^Appeler/ });

journey('j5a', 'danger from the locked phone, to a call', async (page, j) => {
  await womanWithProfile(page);
  await openAgain(page);
  await j.begin('code screen');
  await j.tap(band(page), 'band signes de danger');
  await j.tap(
    button(page, 'Voir qui appeler').or(page.getByRole('link', { name: 'Voir qui appeler' })),
    'voir qui appeler',
  );
  await j.tapCountOnly(callLink(page), 'appeler');
});

journey('j5b', 'danger from the start, one sign ticked, to a call', async (page, j) => {
  await womanWithProfile(page);
  await page.getByRole('banner').getByRole('link').first().click();
  await button(page, 'Regarder un produit').waitFor();
  await j.begin('home');
  await j.tap(band(page), 'band signes de danger');
  await j.tap(page.getByText('Saignement par le vagin', { exact: true }), 'saignement');
  await j.tap(button(page, "C'est grave maintenant"), 'cest grave maintenant');
  await j.tapCountOnly(callLink(page), 'appeler');
});

journey('j5c', 'danger sign ticked during a check, to a call', async (page, j) => {
  await womanWithProfile(page);
  await button(page, 'Ajouter un médicament').click();
  await page.getByRole('searchbox').fill('ibuprofene');
  await page.locator('.candidate').first().click();
  await button(page, /^Oui, c'est ce/).click();
  await button(page, 'Voir le résultat').click();
  await page.getByText('Aucun de ces signes', { exact: true }).waitFor();
  await j.begin('signs now');
  await j.tap(page.getByText('Fièvre', { exact: true }), 'fievre');
  await j.tap(button(page, 'Voir le résultat'), 'voir le resultat', {
    then: page.getByRole('heading', { level: 1, name: /^Résultat/ }),
  });
  const main = page.getByRole('main');
  await j.tap(
    main
      .getByRole('button', { name: 'Voir qui appeler' })
      .or(main.getByRole('link', { name: 'Voir qui appeler' })),
    'voir qui appeler',
  );
  await j.tapCountOnly(callLink(page), 'appeler');
});

journey('j6a', 'strength to choose: "doliprane", box DOLIPRANE 1000 mg', async (page, j) => {
  await womanWithProfile(page);
  await j.begin('check');
  await addProduct(j, 'doliprane', { strength: '1000 mg, comprimé' });
});

journey('j6b', 'strength typed: "doliprane 1000"', async (page, j) => {
  await womanWithProfile(page);
  await j.begin('check');
  await addProduct(j, 'doliprane 1000', { strength: '1000 mg, comprimé' });
});

journey('j6c', 'strength unknown: "paracetamol"', async (page, j) => {
  await womanWithProfile(page);
  await j.begin('check');
  await addProduct(j, 'paracetamol');
});
