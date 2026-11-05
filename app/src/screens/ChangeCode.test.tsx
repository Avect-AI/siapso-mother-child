// SPDX-License-Identifier: MIT
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredLockout, getStoredVerifier } from '../data/db.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import { checkCode, type CodeVerifier } from '../domain/code.js';
import type { Settings } from '../domain/types.js';
import { profileOf } from '../test/knowledge-pack.js';
import { renderApp, storeTestCode, TEST_CODE } from '../test/render-app.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

// Each code is worked out at 600 000 PBKDF2 iterations.
vi.setConfig({ testTimeout: 30_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };

type User = ReturnType<typeof userEvent.setup>;

async function typeCode(user: User, label: string, code: string, submit: string) {
  const field = await screen.findByLabelText(label);
  await user.type(field, code);
  await user.click(screen.getByRole('button', { name: submit }));
}

describe('ChangeCode', () => {
  it('is offered in the settings once the code is given, never before', async () => {
    const view = await renderApp({ settings: woman, hash: '#/settings', locked: true });
    await screen.findByRole('heading', { level: 1, name: 'Réglages' });
    expect(screen.queryByRole('link', { name: 'Changer le code' })).toBeNull();
    view.unmount();

    await renderApp({ settings: woman, hash: '#/settings' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Changer le code' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Changer le code' })).toBeVisible();
    expect(screen.getByLabelText('Code actuel')).toBeVisible();
  });

  it('asks the current code, then the new one twice with the easy-code warning, and keeps her data', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await renderApp({ settings: woman, hash: '#/settings/code' });
    const user = userEvent.setup();

    await typeCode(user, 'Code actuel', TEST_CODE, 'Continuer');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choisissez le nouveau code' }),
    ).toBeVisible();
    await typeCode(user, 'Nouveau code', '1212', 'Continuer');
    // An easy code: the same warning as when the first code is made.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce code est facile à deviner' }),
    ).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Garder ce code' }));
    await typeCode(user, 'Le même code', '1212', 'Enregistrer le code');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Le code est changé' }),
    ).toBeVisible();
    const stored = (await getStoredVerifier()) as CodeVerifier;
    expect(await checkCode('1212', stored)).toBe(true);
    expect(await checkCode(TEST_CODE, stored)).toBe(false);
    expect(await listProfiles()).toMatchObject([{ id: 'a', pseudonym: 'Awa' }]);
    await user.click(screen.getByRole('button', { name: 'Revenir aux réglages' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
  });

  it('starts again when the two new codes differ, and refuses the same code as now', async () => {
    await renderApp({ settings: woman, hash: '#/settings/code' });
    const user = userEvent.setup();

    await typeCode(user, 'Code actuel', TEST_CODE, 'Continuer');
    await typeCode(user, 'Nouveau code', TEST_CODE, 'Continuer');
    expect(screen.getByLabelText('Nouveau code')).toHaveAccessibleDescription(
      /^Le nouveau code est le même que l'actuel/,
    );

    await typeCode(user, 'Nouveau code', '7392', 'Continuer');
    await typeCode(user, 'Le même code', '7391', 'Enregistrer le code');
    expect(await screen.findByLabelText('Nouveau code')).toHaveAccessibleDescription(
      /^Les deux codes ne sont pas les mêmes/,
    );
    expect(screen.getByLabelText('Nouveau code')).toHaveValue('');
    expect(await checkCode(TEST_CODE, (await getStoredVerifier()) as CodeVerifier)).toBe(true);
  });

  it('checks the current code first: a wrong one is said, counted, before any new code is asked', async () => {
    await renderApp({ settings: woman, hash: '#/settings/code' });
    const user = userEvent.setup();

    await typeCode(user, 'Code actuel', '1357', 'Continuer');

    const field = await screen.findByLabelText('Code actuel');
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription(
        "Ce n'est pas le bon code. Encore 4 essais avant une attente.",
      );
    });
    expect(field).toHaveValue('');
    expect(screen.queryByLabelText('Nouveau code')).toBeNull();
    expect(await getStoredLockout()).toEqual({ failures: 1, lockedUntil: null });
    expect(await checkCode(TEST_CODE, (await getStoredVerifier()) as CodeVerifier)).toBe(true);
  });
});
