// SPDX-License-Identifier: MIT
// The pieces of the fluidity journeys (spec section 3.1): the set-up a
// journey assumes, done before it and not counted, and the metered steps.
// Common answers: code 2468 tapped on the keypad, pregnant at 24 weeks given
// today, not breastfeeding, no long-term situation.
import type { Locator, Page } from '@playwright/test';
import { checkField, CODE, herCheckThenProfiles, onboard } from '../support.js';
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
  await checkField(page).waitFor();
}

/** Accompanied mode with two saved profiles, Awa and Fatou: ends on the list of profiles. */
export async function relayWithProfiles(page: Page): Promise<void> {
  await onboard(page, 'accompanied');
  for (const name of ['Awa', 'Fatou']) {
    await button(page, 'Ajouter un profil').click();
    await page.getByRole('textbox', { name: 'Surnom' }).fill(name);
    await fillPregnant(page);
    await button(page, 'Enregistrer').click();
    await herCheckThenProfiles(page, name);
  }
}

/** The app opened again from its icon: a new load of the start address locks it. */
export async function openAgain(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('heading', { level: 1, name: 'Entrez votre code' }).waitFor();
}

// ---------- metered ----------

/** The code on the keypad: its 4th digit opens it (SCRUM-56 P2), no "Ouvrir". */
export async function unlock(j: Journey): Promise<void> {
  await j.keypad(CODE, 'code', {
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
 * One product added on the check (SCRUM-56, S12): the name typed in its
 * field (which has the focus when the check opens and after each add), the
 * first row, then "Est-ce bien ... ?" under it when it has something to ask
 * (otherwise the tap on the row adds it). `strength`: the answer tapped when a
 * strength question shows ("Je ne sais pas" by default).
 */
export async function addProduct(
  j: Journey,
  query: string,
  { strength = 'Je ne sais pas' }: { strength?: string } = {},
): Promise<void> {
  const { page } = j;
  const field = checkField(page);
  const listed = await page.locator('.check__item').count();
  // The product the add lists, at the end of the list.
  const added = page.locator('.check__item').nth(listed);
  await j.type(field, query, `typed ${query}`, { then: page.locator('.candidate') });
  const yes = button(page, /^Oui, c'est ce/);
  await j.tap(page.locator('.candidate'), `candidate ${query}`, { then: yes.or(added) });
  if (await added.isVisible()) {
    j.notes.push(`${query}: added at one tap`);
    return;
  }
  const form = page.locator('.check__question form.confirm__form');
  const answers = form.locator('input[type="radio"]');
  const chosen = form.locator('input[type="radio"]:checked');
  if ((await answers.count()) > 0 && (await chosen.count()) === 0) {
    j.notes.push(`${query}: strength question with ${String(await answers.count())} answers`);
    let target = form.locator('label').filter({ hasText: strength });
    if ((await target.count()) === 0) {
      // A long list: every strength on demand.
      await j.tap(button(page, /^Voir tous les dosages/), 'voir tous les dosages');
      target = form.locator('label').filter({ hasText: strength });
    }
    await j.tap(target, `strength ${strength}`);
  }
  await j.tap(yes, `oui ${query}`, { then: added });
}

/** The prescription of the pharmacist's journey (spec section 3.1), as typed at the counter. */
export const PRESCRIPTION = ['clamoxyl 1g', 'bi profenid', 'doliprane 1000', 'tardyferon b9'];

/** Every "Pourquoi ?" of the result opened, from the first card down. */
export async function openEveryWhy(j: Journey): Promise<void> {
  const whys = j.page.locator('main details.result-card__why:not([open]) > summary');
  let opened = 0;
  while ((await whys.count()) > 0) {
    opened += 1;
    await j.tap(whys.first(), `pourquoi ${String(opened)}`);
  }
  j.notes.push(`"Pourquoi ?" opened: ${String(opened)}`);
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
