// SPDX-License-Identifier: MIT
// The pieces of the fluidity journeys (spec section 3.1): the set-up a
// journey assumes, done before it and not counted, and the metered steps.
// Common answers: code 2468 tapped on the keypad, pregnant at 24 weeks given
// today, not breastfeeding, no long-term situation.
import type { Locator, Page } from '@playwright/test';
import { CODE, onboard } from '../support.js';
import type { Journey } from './meter.js';

export const WEEKS = 24;

export const group = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('group', { name });
export const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name });

// ---------- set-up, not counted ----------

async function fillPregnant(page: Page): Promise<void> {
  await group(page, /^Enceinte/)
    .getByText('Oui', { exact: true })
    .click();
  await group(page, 'Terme de la grossesse').getByText('En semaines', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill(String(WEEKS));
  const when = group(page, /^Ce terme date de quand/);
  if ((await when.count()) > 0) await when.getByText("Aujourd'hui", { exact: true }).click();
  await group(page, /^Allaite/)
    .getByText('Non', { exact: true })
    .click();
  await page.getByText('Aucune de ces situations').click();
}

/** Woman mode, her profile saved: ends on her check. */
export async function womanWithProfile(page: Page): Promise<void> {
  await onboard(page, 'woman');
  await button(page, 'Regarder un produit').click();
  await fillPregnant(page);
  await button(page, 'Enregistrer').click();
  await button(page, 'Ajouter un médicament').waitFor();
}

/** Accompanied mode with two saved profiles, Awa and Fatou: ends on the list of profiles. */
export async function relayWithProfiles(page: Page): Promise<void> {
  await onboard(page, 'accompanied');
  for (const name of ['Awa', 'Fatou']) {
    await button(page, 'Ajouter un profil').click();
    await page.getByRole('textbox', { name: 'Surnom' }).fill(name);
    await fillPregnant(page);
    await button(page, 'Enregistrer').click();
    await page.getByText(`Profil enregistré : ${name}.`).waitFor();
  }
}

/** The app opened again from its icon: a new load of the start address locks it. */
export async function openAgain(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('heading', { level: 1, name: 'Entrez votre code' }).waitFor();
}

// ---------- metered ----------

/** The code on the keypad, then "Ouvrir". */
export async function unlock(j: Journey): Promise<void> {
  await j.keypad(CODE, 'code');
  await j.tap(button(j.page, 'Ouvrir'), 'ouvrir', {
    then: j.page.locator('main h1').filter({ hasNotText: 'Entrez votre code' }),
  });
}

/** An answer of a question, tapped only when it is not already chosen (a default). */
export async function answer(
  j: Journey,
  question: string | RegExp,
  label: string,
  step: string,
): Promise<void> {
  const option = group(j.page, question).getByRole('radio', { name: label, exact: true });
  if (await option.isChecked()) return;
  await j.tap(group(j.page, question).getByText(label, { exact: true }), step);
}

/** Pregnant at 24 weeks given today, not breastfeeding, no long-term situation. */
export async function pregnantAnswers(j: Journey): Promise<void> {
  const { page } = j;
  await answer(j, /^Enceinte/, 'Oui', 'enceinte oui');
  await answer(j, 'Terme de la grossesse', 'En semaines', 'en semaines');
  await j.type(page.getByRole('textbox', { name: 'Nombre de semaines' }), String(WEEKS), 'weeks');
  if ((await group(page, /^Ce terme date de quand/).count()) > 0) {
    await answer(j, /^Ce terme date de quand/, "Aujourd'hui", 'aujourdhui');
  }
  await answer(j, /^Allaite/, 'Non', 'allaite non');
  await j.tap(page.getByText('Aucune de ces situations'), 'aucune situation');
}

/**
 * One product added from the check: the add button, the name typed, the first
 * candidate, then the confirm screen. `strength`: the answer tapped when a
 * strength question shows ("Je ne sais pas" by default).
 */
export async function addProduct(
  j: Journey,
  query: string,
  { strength = 'Je ne sais pas' }: { strength?: string } = {},
): Promise<void> {
  const { page } = j;
  await j.tap(button(page, 'Ajouter un médicament'), `add ${query}`);
  await j.type(page.getByRole('searchbox'), query, `typed ${query}`, {
    then: page.locator('.candidate'),
  });
  await j.tap(page.locator('.candidate'), `candidate ${query}`, {
    then: button(page, /^Oui, c'est ce/),
  });
  const answers = page.locator('form.confirm__form input[type="radio"]');
  const chosen = page.locator('form.confirm__form input[type="radio"]:checked');
  if ((await answers.count()) > 0 && (await chosen.count()) === 0) {
    j.notes.push(`${query}: strength question with ${String(await answers.count())} answers`);
    let target = page.locator('form.confirm__form label').filter({ hasText: strength });
    if ((await target.count()) === 0) {
      // A long list: every strength on demand.
      await j.tap(button(page, /^Voir tous les dosages/), 'voir tous les dosages');
      target = page.locator('form.confirm__form label').filter({ hasText: strength });
    }
    await j.tap(target, `strength ${strength}`);
  }
  await j.tap(button(page, /^Oui, c'est ce/), `oui ${query}`, {
    then: page.getByRole('heading', { level: 1, name: /^Ce qu/ }),
  });
}

/** From the list to the result: "Voir le résultat", no sign (or `sign`), "Voir le résultat". */
export async function toResult(j: Journey, { sign }: { sign?: string } = {}): Promise<void> {
  const { page } = j;
  await j.tap(button(page, 'Voir le résultat'), 'voir le resultat', {
    then: page.getByRole('heading', { level: 1, name: /signes maintenant/ }),
  });
  await j.tap(
    page.getByText(sign ?? 'Aucun de ces signes', { exact: true }),
    sign === undefined ? 'aucun signe' : `signe ${sign}`,
  );
  await j.tap(button(page, 'Voir le résultat'), 'voir le resultat 2', {
    then: page.getByRole('heading', { level: 1, name: /^Résultat/ }),
  });
}
