// SPDX-License-Identifier: MIT
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getStoredSettings } from '../data/db.js';
import { listHistory, recordHistory } from '../data/history.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import { loadSavedContacts, saveContacts } from '../data/referral.js';
import type { Settings } from '../domain/types.js';
import { profileOf } from '../test/knowledge-pack.js';
import { renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };

describe('Settings', () => {
  it('changes the language at once, even before the code, and never shows the mode then', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/settings', locked: true });

    expect(await screen.findByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    expect(screen.queryByRole('group', { name: "Qui utilise l'application\u00a0?" })).toBeNull();
    expect(document.body.textContent).not.toContain('Je suis enceinte');
    const language = screen.getByRole('group', { name: 'Langue' });
    expect(within(language).getByRole('radio', { name: 'Français' })).toBeChecked();
    expect(within(language).getByText('English')).toHaveAttribute('lang', 'en');

    await user.click(within(language).getByRole('radio', { name: 'English' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByText('Setting saved.')).toBeVisible();
    expect((await getStoredSettings())?.lang).toBe('en');
    // Back to the start: the code, since the session is locked.
    await user.click(screen.getByRole('button', { name: 'Back to the start' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Enter your code' })).toBeVisible();
  });

  it('changes the mode once the code is given, and deletes nothing', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await saveProfile(profileOf({ id: 'b', pseudonym: 'Fatou' }));
    const contact = { id: 'c1', role: 'relay', name: 'Mariama', phone: '000 000 001' } as const;
    await saveContacts([contact]);
    await recordHistory({
      id: 'h1',
      profileId: 'a',
      at: '2026-11-04T10:00:00.000Z',
      packVersion: '0.1.0',
      level: 'unknown',
      ruleIds: [],
      items: [{ ref: { kind: 'plant', id: 'kinkeliba' } }],
      signs: [],
    });
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/settings' });

    const mode = await screen.findByRole('group', { name: "Qui utilise l'application\u00a0?" });
    expect(mode).toHaveAccessibleDescription(/^Changer de mode ne supprime aucune donnée\./);
    expect(
      within(mode).getByRole('radio', { name: "Je suis enceinte ou j'allaite" }),
    ).toBeChecked();
    await user.click(within(mode).getByRole('radio', { name: "J'accompagne des femmes" }));
    expect((await getStoredSettings())?.mode).toBe('accompanied');
    expect(screen.getAllByRole('button', { name: "Revenir à l'accueil" })).toHaveLength(1);
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: "Revenir à l'accueil" }));
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(await listProfiles()).toHaveLength(2);
    expect(await loadSavedContacts()).toEqual([contact]);
    expect(await listHistory('a')).toHaveLength(1);
  });
});
