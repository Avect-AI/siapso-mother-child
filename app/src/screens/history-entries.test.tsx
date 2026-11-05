// SPDX-License-Identifier: MIT
// The browser writes the state of every history entry to disk to restore a
// session: nothing about a profile or a contact may ever go there, not even
// for the moment a screen says it was saved or deleted.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import { addDays, todayIso } from '../domain/dates.js';
import type { Settings } from '../domain/types.js';
import { profileOf } from '../test/knowledge-pack.js';
import { renderApp, storeTestCode } from '../test/render-app.js';

beforeEach(async () => {
  await storeTestCode();
});

afterEach(() => {
  vi.restoreAllMocks();
});

vi.setConfig({ testTimeout: 30_000 });

const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };

/** Every state given to a history entry from now on, as the browser would write it. */
function recordEntries(): () => string {
  return recordStates().text;
}

/** The states given to history entries from now on, as given and as the browser would write them. */
function recordStates(): { all: () => unknown[]; text: () => string } {
  const states: unknown[] = [];
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, 'pushState').mockImplementation((state, unused, url) => {
    states.push(state);
    push(state, unused, url);
  });
  vi.spyOn(window.history, 'replaceState').mockImplementation((state, unused, url) => {
    states.push(state);
    replace(state, unused, url);
  });
  return { all: () => states, text: () => JSON.stringify(states) };
}

/**
 * What an entry may hold in clear: the random marks of entry-state.ts, and
 * two flags that say nothing of her (`back: true`, `next: '/check'`).
 */
function harmless(state: unknown): boolean {
  if (state === null || state === undefined) return true;
  if (typeof state !== 'object') return false;
  return Object.entries(state).every(([key, value]) => {
    if (key === 'visit' || key === 'epoch' || key === 'held') return typeof value === 'string';
    if (key === 'back') return value === true;
    if (key === 'next') return value === '/check';
    return false;
  });
}

function radio(group: string | RegExp, name: string) {
  return within(screen.getByRole('group', { name: group })).getByRole('radio', { name });
}

describe('history entries', () => {
  it('hold only random marks and harmless flags on the way through an outdated term', async () => {
    const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
    // Weeks given long ago: past 42 weeks today, the term is outdated.
    await saveProfile(
      profileOf({
        self: true,
        term: { kind: 'weeks', weeks: 30, givenOn: addDays(todayIso(new Date()), -120) },
      }),
    );
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/' });
    const states = recordStates();
    await user.click(await screen.findByRole('button', { name: 'Regarder un produit' }));
    await user.click(await screen.findByRole('button', { name: 'Oui, le bébé est né' }));

    // Her profile opens to say the baby is born, then comes back to the check.
    expect(await screen.findByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
    expect(radio(/^Enceinte/, 'Non')).toBeChecked();
    expect(states.text()).not.toMatch(/born|term|update/);
    expect(states.all().filter((state) => !harmless(state))).toEqual([]);
  });

  it('never hold the pseudonym of a profile saved, then deleted', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/profile/new' });
    const name = await screen.findByRole('textbox', { name: 'Surnom' });
    const entries = recordEntries();
    await user.clear(name);
    await user.type(name, 'Mariama');
    await user.click(radio(/^Enceinte/, 'Non'));
    await user.click(radio(/^Allaite/, 'Oui'));
    await user.click(radio('Âge du bébé', 'En semaines'));
    await user.type(screen.getByRole('textbox', { name: 'Âge en semaines' }), '6');
    await user.click(radio(/^Né avant terme/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Profil enregistré : Mariama.')).toBeVisible();
    await user.click(await screen.findByRole('link', { name: 'Modifier le profil de Mariama' }));
    await user.click(await screen.findByRole('button', { name: 'Supprimer ce profil' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer le profil' }));

    expect(await screen.findByText(/^Profil supprimé\s: Mariama\.$/)).toBeVisible();
    expect(entries()).not.toContain('Mariama');
  });

  it('never hold the name or the number of a contact saved', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/contacts/new' });
    const entries = recordEntries();
    await user.click(await screen.findByRole('radio', { name: 'Sage-femme' }));
    await user.type(screen.getByRole('textbox', { name: /^Nom/ }), 'Awa Diop');
    await user.type(screen.getByRole('textbox', { name: /^Numéro/ }), '000 000 001');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Contact enregistré : Awa Diop (Sage-femme).')).toBeVisible();
    expect(entries()).not.toMatch(/Awa|000 000 001/);
  });
});
