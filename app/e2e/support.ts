// SPDX-License-Identifier: MIT
// Steps shared by the journeys: the welcome with its code, and the code
// screen. The code is a made-up one for tests.
import { expect, type Page } from '@playwright/test';

export const CODE = '2468';

const WORDS = {
  fr: {
    language: 'Français',
    woman: /^Je suis enceinte/,
    accompanied: /^J'accompagne/,
    next: 'Continuer',
    again: 'Le même code',
    save: 'Enregistrer le code',
    open: 'Ouvrir',
    unlockTitle: 'Entrez votre code',
    home: 'Regarder un produit',
    profiles: 'Profils',
  },
  en: {
    language: 'English',
    woman: /^I am pregnant/,
    accompanied: /^I support women/,
    next: 'Continue',
    again: 'The same code',
    save: 'Save the code',
    open: 'Open',
    unlockTitle: 'Enter your code',
    home: 'Look up a product',
    profiles: 'Profiles',
  },
} as const;

export type Lang = keyof typeof WORDS;
export type Mode = 'woman' | 'accompanied';

/** Makes the code at the end of the welcome: typed, then typed again. */
export async function makeCode(page: Page, code: string = CODE, lang: Lang = 'fr') {
  const words = WORDS[lang];
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: words.next }).click();
  await page.getByLabel(words.again, { exact: true }).fill(code);
  await page.getByRole('button', { name: words.save }).click();
}

/** Waits for the start of a mode once open: Home in woman mode, the profiles in accompanied mode. */
export async function expectStart(page: Page, mode: Mode, lang: Lang = 'fr') {
  const words = WORDS[lang];
  await (mode === 'woman'
    ? expect(page.getByRole('button', { name: words.home })).toBeVisible()
    : expect(page.getByRole('heading', { level: 1, name: words.profiles })).toBeVisible());
}

/** The welcome: the language, the mode, then the code; ends on the start of the mode. */
export async function onboard(page: Page, mode: Mode, lang: Lang = 'fr', code: string = CODE) {
  const words = WORDS[lang];
  await page.goto('/');
  await page.getByRole('button', { name: words.language }).click();
  await page.getByRole('button', { name: words[mode] }).click();
  await makeCode(page, code, lang);
  await expectStart(page, mode, lang);
}

/** The code screen: the code, then "Ouvrir". */
export async function unlock(page: Page, code: string = CODE, lang: Lang = 'fr') {
  const words = WORDS[lang];
  await expect(page.getByRole('heading', { level: 1, name: words.unlockTitle })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: words.open }).click();
}

/**
 * Waits until the service worker is active and controls the page. A first
 * install does not claim the page that registered it, so reload until the
 * worker serves the navigation (normally once).
 */
export async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(async () => {
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
      await page.reload();
    }
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }).toPass({ timeout: 15_000 });
}
