// SPDX-License-Identifier: MIT
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredSettings } from '../data/db.js';
import type { PhoneHints } from '../domain/country.js';
import type { Settings } from '../domain/types.js';
import { inVisit } from '../state/entry-state.js';
import { renderApp, storeTestCode } from '../test/render-app.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
  // No deployment file.
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('Not found', { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const ELSEWHERE: PhoneHints = { languages: ['fr-BE'], timeZone: 'Europe/Brussels' };
const TITLE = 'Dans quel pays êtes-vous ?';

/** The names of the countries listed, in order. */
function listed(): string[] {
  const list = screen.queryByRole('list', { name: 'Pays' });
  if (list === null) return [];
  return within(list)
    .getAllByRole('button')
    .map((button) => button.querySelector('.country__name')?.textContent ?? '');
}

describe('Country of use', () => {
  it('lists the countries of the emergency numbers file by name, then a country not in the list', async () => {
    await renderApp({ settings: woman, hash: '#/country', phone: ELSEWHERE });

    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    const names = listed();
    expect(names).toHaveLength(25);
    expect(names.slice(0, 3)).toEqual(['Algérie', 'Bénin', 'Burkina Faso']);
    expect(names).toContain('Sénégal');
    expect(names).toEqual(
      [...names].sort((a, b) => new Intl.Collator('fr', { sensitivity: 'base' }).compare(a, b)),
    );
    // The country not in the list comes after it, set apart.
    const other = screen.getByRole('button', { name: "Mon pays n'est pas dans la liste" });
    const list = screen.getByRole('list', { name: 'Pays' });
    expect(list.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Answers, never the screen's one primary action.
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(0);
  });

  it('finds a country by a part of its name, without case or accents, in either language', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/country', phone: ELSEWHERE });
    const search = await screen.findByRole('searchbox', { name: 'Chercher un pays' });

    await user.type(search, 'SENEG');
    expect(listed()).toEqual(['Sénégal']);
    await user.clear(search);
    await user.type(search, 'congo');
    expect(listed()).toEqual(['Congo (Brazzaville)', 'RD Congo (Kinshasa)']);
    // The English name finds the country too.
    await user.clear(search);
    await user.type(search, 'cabo');
    expect(listed()).toEqual(['Cap-Vert']);
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(listed()).toEqual([]);
    expect(screen.getByText('Aucun pays de la liste ne porte ce nom.')).toHaveAttribute(
      'role',
      'status',
    );
    // A country not in the list stays there to choose.
    expect(screen.getByRole('button', { name: "Mon pays n'est pas dans la liste" })).toBeVisible();
  });

  it('keeps the country chosen in the settings and goes back to the screen it came from', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/settings', phone: ELSEWHERE });
    await screen.findByRole('heading', { level: 1, name: 'Réglages' });
    window.history.pushState(inVisit({ countryBack: true }), '', '#/country');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    await user.click(await screen.findByRole('button', { name: 'Mali' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    await waitFor(async () => {
      expect((await getStoredSettings())?.country).toBe('ML');
    });
    expect(screen.getByText('Pays : Mali')).toBeVisible();
  });

  it('marks the country chosen, and keeps a country not in the list as such', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: { ...woman, country: 'GH' }, hash: '#/country' });
    const ghana = await screen.findByRole('button', { name: 'Ghana Pays choisi' });
    expect(ghana).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByText('Pays choisi')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: "Mon pays n'est pas dans la liste" }));
    await waitFor(async () => {
      expect((await getStoredSettings())?.country).toBe('other');
    });
    // Opened by its address: nowhere to go back to, so the start.
    await waitFor(() => {
      expect(window.location.hash).toBe('#/');
    });
  });

  it('opens at once, locked or before the welcome, and keeps the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderApp({
      settings: woman,
      hash: '#/country',
      locked: true,
      phone: ELSEWHERE,
    });
    await user.click(await screen.findByRole('button', { name: 'Togo' }));
    await waitFor(async () => {
      expect((await getStoredSettings())?.country).toBe('TG');
    });
    unmount();

    // A phone opened for the first time, in an emergency: no settings, no code.
    await renderApp({ hash: '#/country', phone: ELSEWHERE });
    expect(screen.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  });

  it('puts first the two countries the phone names when its language and time zone disagree', async () => {
    const user = userEvent.setup();
    await renderApp({
      settings: woman,
      hash: '#/country',
      phone: { languages: ['fr-SN'], timeZone: 'Africa/Bamako' },
    });
    await screen.findByRole('heading', { level: 1, name: TITLE });
    const names = listed();
    expect(names.slice(0, 2)).toEqual(['Sénégal', 'Mali']);
    expect(names).toHaveLength(25);
    expect(screen.getByRole('button', { name: 'Sénégal Selon le téléphone' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mali Selon le téléphone' })).toBeVisible();
    // The rest in the order of their names.
    const rest = names.slice(2);
    expect(rest).toEqual(
      [...rest].sort((a, b) => new Intl.Collator('fr', { sensitivity: 'base' }).compare(a, b)),
    );

    await user.click(screen.getByRole('button', { name: 'Mali Selon le téléphone' }));
    await waitFor(async () => {
      expect((await getStoredSettings())?.country).toBe('ML');
    });
  });

  it('words the screen in English', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/country',
      phone: ELSEWHERE,
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Which country are you in?' }),
    ).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search for a country' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'The Gambia' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'My country is not in the list' })).toBeVisible();
  });
});
