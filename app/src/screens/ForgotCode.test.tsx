// SPDX-License-Identifier: MIT
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredSettings, getStoredVerifier, openAppDb, storeLockout } from '../data/db.js';
import { recordHistory } from '../data/history.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import { loadSavedContacts, saveContacts } from '../data/referral.js';
import type { Settings } from '../domain/types.js';
import { profileOf } from '../test/knowledge-pack.js';
import { renderApp, storeTestCode } from '../test/render-app.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 30_000 });

const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };

async function savedData() {
  await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
  await saveContacts([{ id: 'c1', role: 'relay', name: 'Mariama', phone: '000 000 001' }]);
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
}

async function openForgot() {
  const user = userEvent.setup();
  await renderApp({ settings: accompanied, locked: true });
  await user.click(await screen.findByRole('button', { name: "J'ai oublié le code" }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Code oublié' })).toHaveFocus();
  return user;
}

describe('Forgotten code', () => {
  it('explains, asks for EFFACER, then a last yes, erases, and goes back to the welcome', async () => {
    await savedData();
    // Even during a wait after wrong codes.
    await storeLockout({ failures: 12, lockedUntil: Date.now() + 1_800_000 });
    const user = await openForgot();

    expect(
      screen.getByText(
        "Sans le code, la seule solution est d'effacer les profils enregistrés sur ce téléphone, avec leur historique et les contacts enregistrés. La langue et les informations sur les produits restent.",
      ),
    ).toBeVisible();
    const word = screen.getByLabelText('Pour continuer, écrivez EFFACER');
    await user.type(word, 'effacé');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(word).toHaveAccessibleDescription('Écrivez EFFACER pour continuer, ou revenez au code.');
    expect(await listProfiles()).toHaveLength(1);

    await user.clear(word);
    await user.type(word, 'effacer');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tout effacer maintenant ?' }),
    ).toHaveFocus();
    expect(screen.getByText(/Cela ne peut pas être annulé\.$/)).toBeVisible();
    expect(await listProfiles()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Effacer les profils' }));

    expect(await screen.findByRole('button', { name: 'Français' })).toBeVisible();
    expect(await listProfiles()).toEqual([]);
    expect(await loadSavedContacts()).toEqual([]);
    expect(await (await openAppDb()).getAll('history')).toEqual([]);
    expect(await getStoredVerifier()).toBeUndefined();
    expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: null, onboarded: false });
  });

  it('goes back to the code from each step, erasing nothing', async () => {
    await savedData();
    const user = await openForgot();

    await user.click(screen.getByRole('button', { name: 'Revenir au code' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: "J'ai oublié le code" }));
    await user.type(await screen.findByLabelText('Pour continuer, écrivez EFFACER'), 'EFFACER');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByRole('heading', { level: 1, name: 'Tout effacer maintenant ?' });
    // One primary action: the erase; going back is secondary.
    expect(screen.getByRole('button', { name: 'Effacer les profils' })).toHaveClass(
      'button--primary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Revenir au code' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    expect(await listProfiles()).toHaveLength(1);
    expect(await getStoredVerifier()).toBeDefined();
  });

  it('says it in English too, and is only for a locked phone', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      locked: true,
    });
    await user.click(await screen.findByRole('button', { name: 'I forgot the code' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Forgotten code' })).toBeVisible();
    expect(screen.getByLabelText('To go on, type ERASE')).toBeVisible();
    unmount();

    // Open: there is nothing to forget, the start opens.
    await renderApp({ settings: accompanied, hash: '#/forgot' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
  });
});
