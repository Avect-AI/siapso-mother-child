// SPDX-License-Identifier: MIT
// Steps shared by the journeys: the welcome with its code, the code screen,
// and the longest danger instruction of the pack. The code is a made-up one
// for tests.
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

/**
 * The longest instruction the danger banner can give with the pack of this
 * build: the standard one, and the orientation of every danger rule and of
 * every danger sign, in both languages.
 */
export async function longestDangerInstruction(page: Page): Promise<string> {
  const fragment = async (file: string): Promise<unknown> =>
    (await page.request.get(`/pack/${file}`)).json();
  const rules = (await fragment('rules.json')) as { level: string; message: string }[];
  const signs = (await fragment('danger-signs.json')) as { message?: string }[];
  const ids = new Set([
    ...rules.filter((rule) => rule.level === 'danger').map((rule) => rule.message),
    ...signs.map((sign) => sign.message ?? 'danger-sign'),
  ]);
  const texts = ['Allez au poste de santé maintenant.', 'Go to the health post now.'];
  for (const lang of ['fr', 'en']) {
    const messages = (await fragment(`messages.${lang}.json`)) as Record<
      string,
      { orientation?: string }
    >;
    for (const id of ids) {
      const orientation = messages[id]?.orientation;
      if (orientation !== undefined) texts.push(orientation);
    }
  }
  return texts.reduce((longest, text) => (text.length > longest.length ? text : longest));
}

/** The danger banner says `words`, sized as the banner sizes a long instruction. */
export async function sayInBanner(page: Page, words: string) {
  await page
    .getByRole('alert')
    .getByRole('heading')
    .evaluate((heading, text) => {
      heading.textContent = text;
      heading.classList.toggle('danger-banner__title--long', text.length > 40);
    }, words);
  await expect(page.getByRole('alert')).toContainText(words);
}
