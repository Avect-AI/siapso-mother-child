// SPDX-License-Identifier: MIT
// Steps shared by the journeys: the welcome with its code, and the code
// screen. The code is a made-up one for tests. The phone of the tests is set
// to French (playwright.config.ts): the welcome speaks it, English is one tap.
import { expect, type Page } from '@playwright/test';

export const CODE = '2468';

const WORDS = {
  fr: {
    // The switch that turns the welcome into this language.
    language: 'Français',
    question: /^Qui utilise l'application/,
    woman: /^Je suis enceinte/,
    accompanied: /^J'accompagne/,
    length: 'Nombre de chiffres',
    again: 'Tapez-le encore',
    open: 'Ouvrir',
    unlockTitle: 'Entrez votre code',
    home: 'Regarder un produit',
    profiles: 'Profils',
  },
  en: {
    language: 'English',
    question: /^Who is using the app/,
    woman: /^I am pregnant/,
    accompanied: /^I support women/,
    length: 'Number of digits',
    again: 'Type it again',
    open: 'Open',
    unlockTitle: 'Enter your code',
    home: 'Look up a product',
    profiles: 'Profiles',
  },
} as const;

export type Lang = keyof typeof WORDS;
export type Mode = 'woman' | 'accompanied';

/** The welcome is on screen: who uses the app is asked. */
export async function expectWelcome(page: Page, lang: Lang = 'fr') {
  await expect(page.getByRole('heading', { name: WORDS[lang].question })).toBeVisible();
}

/**
 * Makes the code in the code part of the welcome: its length chosen when
 * another one is offered, typed, then typed again; each typing moves on at
 * its last digit.
 */
export async function makeCode(page: Page, code: string = CODE, lang: Lang = 'fr') {
  const words = WORDS[lang];
  const length = page
    .getByRole('group', { name: words.length })
    .getByRole('radio', { name: String(code.length), exact: true });
  if (!(await length.isChecked())) await length.check();
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByLabel(words.again, { exact: true }).fill(code);
}

/** Waits for the start of a mode once open: Home in woman mode, the profiles in accompanied mode. */
export async function expectStart(page: Page, mode: Mode, lang: Lang = 'fr') {
  const words = WORDS[lang];
  await (mode === 'woman'
    ? expect(page.getByRole('button', { name: words.home })).toBeVisible()
    : expect(page.getByRole('heading', { level: 1, name: words.profiles })).toBeVisible());
}

/** The welcome turned into `lang` when the phone's language is the other one. */
export async function welcomeIn(page: Page, lang: Lang) {
  const other = lang === 'fr' ? 'en' : 'fr';
  await expect(
    page
      .getByRole('heading', { name: WORDS[lang].question })
      .or(page.getByRole('heading', { name: WORDS[other].question })),
  ).toBeVisible();
  if (await page.getByRole('heading', { name: WORDS[other].question }).isVisible()) {
    await page.getByRole('button', { name: WORDS[lang].language, exact: true }).click();
  }
  await expectWelcome(page, lang);
}

/** The welcome: the mode, then the code; ends on the start of the mode. */
export async function onboard(page: Page, mode: Mode, lang: Lang = 'fr', code: string = CODE) {
  const words = WORDS[lang];
  await page.goto('/');
  await welcomeIn(page, lang);
  await page.getByRole('button', { name: words[mode] }).click();
  await makeCode(page, code, lang);
  await expectStart(page, mode, lang);
}

/** Records in clear, store by store, as the version before SCRUM-39 kept them. */
export interface BeforeUpdate {
  settings?: Record<string, unknown>;
  profiles?: Record<string, unknown>[];
  history?: Record<string, unknown>[];
  /** The saved contacts, kept as one record. */
  contacts?: Record<string, unknown>[];
}

/**
 * Writes what a phone updated from the version before SCRUM-39 holds: the
 * code's verifier in that version's format (its hash is the PBKDF2 output of
 * `code` itself) and the records given, in clear. The app must have opened
 * once (its database is made). After a reload, the first code seals them and
 * makes the verifier again (app/src/data/migration.ts); a record in clear
 * written next to a newer verifier is never read. Returns the salt written.
 */
export function seedBeforeUpdate(
  page: Page,
  records: BeforeUpdate,
  code: string = CODE,
): Promise<string> {
  return page.evaluate(
    async ({ records, code }) => {
      const base64url = (bytes: Uint8Array) =>
        btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(code),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      const hash = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
          key,
          256,
        ),
      );
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onsuccess = () => {
          resolve(open.result);
        };
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
      });
      const tx = db.transaction(['settings', 'profiles', 'history', 'contacts'], 'readwrite');
      if (records.settings) tx.objectStore('settings').put(records.settings, 'settings');
      tx.objectStore('settings').put(
        { salt: base64url(salt), hash: base64url(hash), iterations: 600_000 },
        'code',
      );
      for (const profile of records.profiles ?? []) tx.objectStore('profiles').put(profile);
      for (const entry of records.history ?? []) tx.objectStore('history').put(entry);
      if (records.contacts) tx.objectStore('contacts').put(records.contacts, 'saved');
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(new Error('not written'));
        };
      });
      db.close();
      return base64url(salt);
    },
    { records, code },
  );
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
