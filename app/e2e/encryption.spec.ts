// SPDX-License-Identifier: MIT
// A phone updated from a version that kept the profiles in clear (before
// SCRUM-39): the first code after the update seals every profile, history
// entry and contact, and makes the code's verifier again; then nothing of
// her is readable anywhere in the browser's storage, and everything still
// works without the Internet. The names, numbers and texts here are made up.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  addFirstCandidate,
  CODE,
  expectWelcome,
  seedBeforeUpdate,
  storedCodeLength,
  unlock,
  waitForServiceWorkerControl,
} from './support.js';

const AMINATA = 'Aminata Seck';
const NDEYE = 'Ndeye Fall';
const CONTACT = 'Awa Diop';
const PHONE = '000 000 001';
const FREE_TEXT = 'pilule secrete zx';

interface OldFormat {
  /** The day her weeks were given, and the first day of the other one's last period (ISO). */
  givenOn: string;
  lmp: string;
  /** The salt of the code's verifier, as the old version stored it. */
  salt: string;
}

/**
 * Writes what the version before SCRUM-39 left on a phone, in its format: the
 * settings, the code's verifier (its hash is the PBKDF2 output itself), two
 * profiles, a history entry and a contact, all in clear.
 */
async function seedOldFormat(page: Page): Promise<OldFormat> {
  const day = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const givenOn = day(15);
  const lmp = day(100);
  const now = new Date().toISOString();
  const profile = (id: string, pseudonym: string, patch: Record<string, unknown>) => ({
    id,
    self: false,
    pseudonym,
    pregnant: true,
    breastfeeding: false,
    longTermItems: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
  const salt = await seedBeforeUpdate(page, {
    settings: { lang: 'fr', mode: 'accompanied', onboarded: true },
    profiles: [
      profile('p-aminata', AMINATA, {
        term: { kind: 'weeks', weeks: 23, givenOn },
        conditions: ['hiv-cotrimoxazole'],
      }),
      profile('p-ndeye', NDEYE, {
        term: { kind: 'lmp', date: lmp },
        conditions: ['sickle-cell'],
      }),
    ],
    history: [
      {
        id: 'h-aminata',
        profileId: 'p-aminata',
        at: now,
        packVersion: '0.1.0',
        level: 'unknown',
        ruleIds: [],
        items: [{ ref: { kind: 'unrecognised', text: FREE_TEXT } }],
        signs: ['fever'],
      },
    ],
    contacts: [{ id: 'c-1', role: 'midwife', name: CONTACT, phone: PHONE }],
  });
  return { givenOn, lmp, salt };
}

/** Every store of the app's IndexedDB, keys and values, and the page's local and session storage. */
function dumpStorage(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('siapso');
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(new Error('cannot open the database'));
      };
    });
    const stores: Record<string, { keys: unknown[]; values: unknown[] }> = {};
    for (const name of Array.from(db.objectStoreNames)) {
      const store = db.transaction(name).objectStore(name);
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve) => {
          request.onsuccess = () => {
            resolve(request.result);
          };
        });
      stores[name] = { keys: await read(store.getAllKeys()), values: await read(store.getAll()) };
    }
    db.close();
    const entries = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, i) => {
        const key = storage.key(i) ?? '';
        return [key, storage.getItem(key)];
      });
    return { stores, local: entries(localStorage), session: entries(sessionStorage) };
  });
}

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

/** Every store but the knowledge pack, which names every situation, product and remedy. */
function personal(dump: Awaited<ReturnType<typeof dumpStorage>>) {
  return Object.entries(dump.stores).filter(([name]) => name !== 'pack');
}

test('a phone updated from the version in clear: sealed at the first code, readable by the app only, offline too', async ({
  page,
  context,
}) => {
  // The app opens once (its database is made), then holds what the old version left.
  await page.goto('/');
  await expectWelcome(page);
  await waitForServiceWorkerControl(page);
  const old = await seedOldFormat(page);

  // The update: the app opens again on what was stored, and asks the code.
  await page.reload();
  await unlock(page);

  const list = page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
  await expect(list.getByRole('button', { name: new RegExp(`^${AMINATA}`) })).toBeVisible({
    timeout: 20_000,
  });
  await expect(list.getByRole('button', { name: new RegExp(`^${NDEYE}`) })).toBeVisible();

  // Nothing of them is readable anywhere in storage.
  const dump = await dumpStorage(page);
  const everything = JSON.stringify(dump);
  for (const clear of [AMINATA, NDEYE, CONTACT, PHONE, FREE_TEXT]) {
    expect(everything, clear).not.toContain(clear);
  }
  // Their situations, terms and dates either, outside the knowledge pack (which
  // names every situation, and dates its sources: one may be the day of her term).
  const theirs = JSON.stringify([personal(dump), dump.local, dump.session]);
  for (const clear of [
    old.givenOn,
    old.lmp,
    'hiv-cotrimoxazole',
    'sickle-cell',
    '"weeks"',
    '"lmp"',
    'pregnant',
    'fever',
    'midwife',
  ]) {
    expect(theirs, clear).not.toContain(clear);
  }
  // The code's verifier was made again, with another salt.
  const code = dump.stores['settings']?.values.find(
    (value) => typeof value === 'object' && value !== null && 'hash' in value,
  ) as { salt: string; version?: number } | undefined;
  expect(code?.version).toBe(2);
  expect(code?.salt).not.toBe(old.salt);

  // The contact saved is still there to call, once the code is given.
  await page.getByRole('link', { name: 'Signes de danger' }).click();
  await page.getByRole('link', { name: 'Voir qui appeler' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await expect(page.getByText(CONTACT)).toBeVisible();

  // Without the Internet: the code opens the sealed profiles, a check works.
  await context.setOffline(true);
  await page.goto('/#/');
  await page.reload();
  await unlock(page);
  await list.getByRole('button', { name: new RegExp(`^${AMINATA}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ce qu'elle prend" })).toBeVisible();
  await page.getByRole('searchbox').fill('kinkeliba');
  await addFirstCandidate(page);
  // The danger signs present now, on the check (SCRUM-56, S13).
  await page.getByRole('button', { name: 'Non, aucun de ces signes' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: `Résultat pour ${AMINATA}` }),
  ).toBeVisible();

  // Her profile opens with her answers; her situations show at a tap only.
  await page.goto('/#/');
  // "de" or "d'" before the name, as French elides it before a vowel.
  await list
    .getByRole('link', { name: new RegExp(`^Modifier le profil (de |d')${AMINATA}$`) })
    .click();
  await expect(page.getByRole('textbox', { name: 'Surnom' })).toHaveValue(AMINATA);
  await expect(page.getByText('VIH, avec cotrimoxazole')).toHaveCount(0);
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: /^Situations masquées/ }).click();
  await expect(page.getByRole('checkbox', { name: 'VIH, avec cotrimoxazole' })).toBeChecked();

  // The result just kept is sealed too.
  const after = JSON.stringify(personal(await dumpStorage(page)));
  expect(after).not.toContain(AMINATA);
  expect(after).not.toContain('kinkeliba');
});

/** The version of the code's verifier as stored (undefined for the format before the update). */
function storedVersion(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('siapso');
        open.onerror = () => {
          reject(new Error('cannot open the database'));
        };
        open.onsuccess = () => {
          const get = open.result.transaction('settings').objectStore('settings').get('code');
          get.onsuccess = () => {
            open.result.close();
            resolve((get.result as { version?: unknown } | undefined)?.version);
          };
        };
      }),
  );
}

test('"Quitter" in another tab while the first code after the update is worked out opens nothing', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expectWelcome(page);
  await seedOldFormat(page);
  // As on a slow phone: the code takes a while to work out in this tab.
  await page.addInitScript(() => {
    const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
    crypto.subtle.deriveBits = async (...args: Parameters<SubtleCrypto['deriveBits']>) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return derive(...args);
    };
  });
  await page.reload();
  const other = await context.newPage();
  await other.goto('/#/danger');
  const exit = other.getByRole('banner').getByRole('button', { name: 'Quitter' });
  await expect(exit).toBeVisible();

  await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(CODE);
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await exit.click();

  // The tab that was opening shows the neutral screen, never her profiles.
  await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
  await expect(list).toHaveCount(0);
  await page.waitForTimeout(4000);
  await expect(list).toHaveCount(0);
  await expect(page.getByText(AMINATA)).toHaveCount(0);

  // The update itself went through, all or nothing; the code opens it.
  await expect.poll(() => storedVersion(page), { timeout: 20_000 }).toBe(2);
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await unlock(page);
  await expect(list.getByRole('button', { name: new RegExp(`^${AMINATA}`) })).toBeVisible({
    timeout: 20_000,
  });
});

test('a code kept without its length waits for "Ouvrir"; once kept, its 4th digit opens it', async ({
  page,
}) => {
  await page.goto('/');
  await expectWelcome(page);
  await seedBeforeUpdate(page, { settings: { lang: 'fr', mode: 'woman', onboarded: true } });
  await page.reload();
  const title = page.getByRole('heading', { level: 1, name: 'Entrez votre code' });
  await expect(title).toBeVisible();
  expect(await storedCodeLength(page)).toBeNull();

  // No length kept: the 4 digits wait, nothing is tried before "Ouvrir".
  await page.getByLabel('Code', { exact: true }).fill(CODE);
  await expect(page.getByRole('status').filter({ hasText: 'Ouverture en cours.' })).toHaveCount(0);
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible({
    timeout: 20_000,
  });
  // Kept with the right code, in the transaction that made the verifier again.
  expect(await storedCodeLength(page)).toBe(4);

  // The next opening: the 4th digit on the keys tries the code, nothing to press.
  await page.reload();
  await expect(title).toBeVisible();
  const keypad = page.getByRole('group', { name: 'Clavier du code' });
  for (const digit of CODE) await keypad.getByRole('button', { name: digit, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
});
