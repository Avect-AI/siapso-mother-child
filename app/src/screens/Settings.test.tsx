// SPDX-License-Identifier: MIT
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredSettings } from '../data/db.js';
import { listHistory, recordHistory } from '../data/history.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import { loadSavedContacts, saveContacts } from '../data/referral.js';
import type { Settings } from '../domain/types.js';
import { profileOf } from '../test/knowledge-pack.js';
import { renderApp, storeTestCode, TEST_CODE } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };

describe('Settings', () => {
  it('changes the language with its button, even before the code, and never shows the mode then', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/settings', locked: true });

    expect(await screen.findByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    expect(screen.queryByRole('group', { name: "Qui utilise l'application\u00a0?" })).toBeNull();
    expect(document.body.textContent).not.toContain('Je suis enceinte');
    const language = screen.getByRole('group', { name: 'Langue' });
    expect(within(language).getByRole('radio', { name: 'Français' })).toBeChecked();
    expect(within(language).getByText('English')).toHaveAttribute('lang', 'en');
    // Nothing to apply while the language chosen is the one in use.
    expect(screen.queryByRole('button', { name: 'Switch to English' })).toBeNull();

    // Choosing the answer changes nothing yet: the screen stays in French.
    await user.click(within(language).getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    expect((await getStoredSettings())?.lang).toBe('fr');
    // The button says what it does in the language chosen.
    const apply = screen.getByRole('button', { name: 'Switch to English' });
    expect(apply).toHaveAttribute('lang', 'en');
    // While a choice waits, applying it is the one primary action: the way
    // back, which would leave it, steps down.
    expect(apply).toHaveClass('button--primary');
    expect(screen.getByRole('button', { name: "Revenir à l'accueil" })).toHaveClass(
      'button--secondary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);

    await user.click(apply);

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByText('Setting saved.')).toBeVisible();
    expect((await getStoredSettings())?.lang).toBe('en');
    // The button is gone with the change: the focus goes back to the answer chosen.
    expect(screen.queryByRole('button', { name: 'Switch to English' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'English' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Back to the start' })).toHaveClass(
      'button--primary',
    );
    // A new answer clears what the last one said, so the next one is said again.
    await user.click(screen.getByRole('radio', { name: 'Français' }));
    expect(screen.queryByText('Setting saved.')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'English' }));
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
    // The answer alone changes nothing: the mode changes with its button.
    expect((await getStoredSettings())?.mode).toBe('woman');
    expect(screen.queryByText('Réglage enregistré.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Changer de mode' }));
    expect((await getStoredSettings())?.mode).toBe('accompanied');
    expect(screen.getByText('Réglage enregistré.')).toBeVisible();
    expect(within(mode).getByRole('radio', { name: "J'accompagne des femmes" })).toHaveFocus();
    expect(screen.getAllByRole('button', { name: "Revenir à l'accueil" })).toHaveLength(1);
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: "Revenir à l'accueil" }));
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(await listProfiles()).toHaveLength(2);
    expect(await loadSavedContacts()).toEqual([contact]);
    expect(await listHistory('a')).toHaveLength(1);
  });

  it('lets the arrow keys go through the answers without changing the mode or the language', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/settings' });
    const mode = await screen.findByRole('group', { name: "Qui utilise l'application ?" });

    // Native radios: the arrow keys move to the next answer and choose it, as
    // screen readers expect; nothing is applied until its button is pressed.
    within(mode).getByRole('radio', { name: "Je suis enceinte ou j'allaite" }).focus();
    await user.keyboard('{ArrowDown}');
    expect(within(mode).getByRole('radio', { name: "J'accompagne des femmes" })).toBeChecked();
    screen.getByRole('radio', { name: 'Français' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();

    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    expect(await getStoredSettings()).toMatchObject({ lang: 'fr', mode: 'woman' });
    expect(screen.queryByText('Réglage enregistré.')).toBeNull();

    // Back to the answer in use: nothing left to apply.
    await user.keyboard('{ArrowUp}');
    expect(screen.queryByRole('button', { name: 'Switch to English' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Changer de mode' })).toBeVisible();
  });

  it('forgets a choice not applied when the session locks', async () => {
    const user = userEvent.setup();
    const session = probeSession();
    await renderApp({ settings: woman, hash: '#/settings', children: session.element });
    const question = "Qui utilise l'application ?";
    const mode = await screen.findByRole('group', { name: question });
    await user.click(within(mode).getByRole('radio', { name: "J'accompagne des femmes" }));
    await user.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('button', { name: 'Switch to English' })).toBeVisible();

    act(() => {
      session.current().lock();
    });
    // Locked: no mode, the language in use, nothing left to apply.
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: question })).toBeNull();
    });
    expect(screen.getByRole('radio', { name: 'Français' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Switch to English' })).toBeNull();

    // Whoever gives the code next finds the mode in use, not a choice left before the lock.
    await act(async () => {
      await session.current().unlock(TEST_CODE);
    });
    const again = await screen.findByRole('group', { name: question });
    expect(
      within(again).getByRole('radio', { name: "Je suis enceinte ou j'allaite" }),
    ).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Changer de mode' })).toBeNull();
    expect(await getStoredSettings()).toMatchObject({ lang: 'fr', mode: 'woman' });
  });
});

describe('Settings, country of use', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says the country whose emergency numbers who to call shows, with the way to change it, locked too', async () => {
    await renderApp({ settings: woman, hash: '#/settings', locked: true });
    expect(await screen.findByText('Pays : Sénégal')).toBeVisible();
    expect(screen.getByText("Qui appeler montre les numéros d'urgence de ce pays.")).toBeVisible();
    const change = screen.getByRole('link', { name: 'Changer le pays' });
    expect(change).toHaveAttribute('href', '#/country');
    expect(change).toHaveClass('button--secondary');
    // The way back stays the one primary action.
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
  });

  it('says when the country is not known, or not in the list', async () => {
    const { unmount } = await renderApp({
      settings: woman,
      hash: '#/settings',
      phone: { languages: ['en-US'], timeZone: 'UTC' },
    });
    expect(await screen.findByText('Pays : inconnu')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Choisir le pays' })).toHaveAttribute(
      'href',
      '#/country',
    );
    unmount();

    await renderApp({ settings: { ...woman, country: 'other' }, hash: '#/settings' });
    expect(await screen.findByText('Pays : autre pays')).toBeVisible();
  });

  it('says the country is to choose when the language and the time zone of the phone disagree', async () => {
    await renderApp({
      settings: woman,
      hash: '#/settings',
      phone: { languages: ['fr-SN'], timeZone: 'Africa/Bamako' },
    });
    expect(await screen.findByText('Pays : à choisir')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Choisir le pays' })).toHaveAttribute(
      'href',
      '#/country',
    );
  });

  it('says the country fixed by the deployment, with no way to change it', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ country: 'CI' })));
    await renderApp({ settings: { ...woman, country: 'GH' }, hash: '#/settings' });
    expect(await screen.findByText("Pays : Côte d'Ivoire")).toBeVisible();
    expect(screen.getByText("Ce pays est fixé avec l'application.")).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Changer le pays' })).toBeNull();
  });
});
