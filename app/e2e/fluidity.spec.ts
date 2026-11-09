// SPDX-License-Identifier: MIT
// Fluidity of the main journeys (SCRUM-56, docs/superpowers/specs/2026-11-05-ux-fluidity-design.md):
// each journey is measured at 360 x 800 in French (taps, keystrokes, screens,
// scroll gestures, words read, app waits, modelled time; fluidity/meter.ts),
// its measure is kept as a JSON file of the run (test-results/fluidity) and
// attached to the report, and it fails when a count goes over its budget.
// The budgets start at the measured baseline of 2026-11-05 (spec section
// 4.1) and only go down: a change that adds a step to a journey says so here.
import { expect, test, type Page } from '@playwright/test';
import { addOnCheck, checkField, CODE } from './support.js';
import { Journey, overBudget, report, resultFacts, type Budget } from './fluidity/meter.js';
import {
  addProduct,
  button,
  openAgain,
  openEveryWhy,
  PRESCRIPTION,
  pregnantAnswers,
  relayWithProfiles,
  toResult,
  unlock,
  womanWithProfile,
} from './fluidity/steps.js';

/** taps / keys / screens / scrolls each journey may take at most. */
// SCRUM-56, from the baseline of 2026-11-05 (spec section 4.1): P1 the welcome
// in one screen, P2 the code opening at its length (no "Ouvrir"), P3 lighter
// profile answers (weeks by default, a new profile opens her check, "Aujourd'hui"
// for a passer-by), P4 the strength asked only when a rule reads it, P5 a
// product added in one tap, P6 the search on the check screen (no add button,
// no search or confirm screen per product), P7 the danger signs asked on the
// check ("Non, aucun de ces signes" in one tap), P8 the result on the check
// (no result screen), P9 the woman's start on her check (no Home, her first
// answers on it). The danger journeys (J5) never take more taps.
//
// One scroll was traded for two taps and a screen at P7: the signs of her
// groups are written in full right above "Non, aucun de ces signes" (the
// safety rule of the spec, S13), which puts that answer under the fold of a
// 360 x 800 phone once a product is listed (the target of spec section 8.11
// is not met there; the PR says so). Her first answers are saved by an
// explicit "Enregistrer" on her check (P9): one tap above the target of J1.
const BUDGETS: Record<string, Budget> = {
  j1: { taps: 7, keys: 20, screens: 2, scrolls: 4 }, // baseline 17 / 20 / 12 / 3
  j2a: { taps: 2, keys: 14, screens: 2, scrolls: 1 }, // baseline 8 / 14 / 8 / 0
  j2b: { taps: 4, keys: 25, screens: 2, scrolls: 0 }, // baseline 12 / 25 / 11 / 1
  j3a: { taps: 3, keys: 14, screens: 3, scrolls: 1 }, // baseline 8 / 14 / 8 / 0
  j3b: { taps: 9, keys: 22, screens: 4, scrolls: 4 }, // baseline 17 / 22 / 10 / 4
  j4: { taps: 7, keys: 16, screens: 4, scrolls: 4 }, // baseline 15 / 16 / 9 / 4
  j5a: { taps: 3, keys: 0, screens: 3, scrolls: 0 },
  j5b: { taps: 4, keys: 0, screens: 3, scrolls: 0 },
  j5c: { taps: 5, keys: 0, screens: 2, scrolls: 1 }, // from the check (baseline 4 from the signs)
  j6a: { taps: 2, keys: 9, screens: 1, scrolls: 0 }, // baseline 4 / 9 / 4 / 1
  j6b: { taps: 2, keys: 14, screens: 1, scrolls: 0 }, // baseline 3 / 14 / 4 / 0
  j6c: { taps: 2, keys: 11, screens: 1, scrolls: 0 }, // baseline 4 / 11 / 4 / 1
  j7: { taps: 12, keys: 55, screens: 4, scrolls: 5 }, // baseline 25 / 55 / 18 / 7
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
      .getByRole('heading', { level: 2, name: /^Résultat/ })
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
  // Her check opens with the questions about her (SCRUM-56, S4 and 8.3).
  await j.keypad(CODE, 'code again', {
    then: page.getByRole('region', { name: 'À propos de vous' }),
  });
  await pregnantAnswers(j);
  await j.tap(button(page, 'Enregistrer'), 'enregistrer profil', {
    then: checkField(page),
  });
  await addProduct(j, 'ibuprofene');
  await toResult(j);
});

journey('j2a', 'returning woman, one product', async (page, j) => {
  await womanWithProfile(page);
  await openAgain(page);
  await j.begin('code screen');
  // Her check is her start (SCRUM-56, S4).
  await unlock(j);
  await checkField(page).waitFor();
  await addProduct(j, 'ibuprofene');
  await toResult(j);
});

journey('j2b', 'returning woman, two products', async (page, j) => {
  await womanWithProfile(page);
  await openAgain(page);
  await j.begin('code screen');
  // Her check is her start (SCRUM-56, S4).
  await unlock(j);
  await checkField(page).waitFor();
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
    then: checkField(page),
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
    then: checkField(page),
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
    then: checkField(page),
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
  // Her start is her check (SCRUM-56, S4).
  await womanWithProfile(page);
  await j.begin('start');
  await j.tap(band(page), 'band signes de danger');
  await j.tap(page.getByText('Saignement par le vagin', { exact: true }), 'saignement');
  await j.tap(button(page, "C'est grave maintenant"), 'cest grave maintenant');
  await j.tapCountOnly(callLink(page), 'appeler');
});

// From the check with one product listed (spec section 10.2: 5 taps from the
// check, the baseline's 4 counted from the signs screen).
journey('j5c', 'danger sign ticked during a check, to a call', async (page, j) => {
  await womanWithProfile(page);
  await addOnCheck(page, 'ibuprofene');
  await j.begin('check');
  await toResult(j, { sign: 'Fièvre' });
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

// The pharmacist's nearest path until the professional mode (spec sections 4.1
// and 9.4): accompanied mode, a passer-by, the four products of a
// prescription, then every "Pourquoi ?" of the result opened.
journey('j7', 'pharmacist at the counter, 4 products, details opened', async (page, j) => {
  await relayWithProfiles(page);
  await openAgain(page);
  await j.begin('code screen');
  await unlock(j);
  await j.tap(button(page, 'Regarder sans enregistrer'), 'regarder sans enregistrer');
  await pregnantAnswers(j);
  await j.tap(button(page, 'Regarder ses produits'), 'regarder ses produits', {
    then: checkField(page),
  });
  // A strength typed is the one chosen; a strength asked otherwise, "Je ne sais pas".
  for (const name of PRESCRIPTION) await addProduct(j, name);
  await toResult(j);
  await openEveryWhy(j);
});
