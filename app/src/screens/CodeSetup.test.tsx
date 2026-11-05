// SPDX-License-Identifier: MIT
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getStoredVerifier, storeSettings } from '../data/db.js';
import { checkCode } from '../domain/code.js';
import { makeCode } from '../test/code-steps.js';
import { renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

async function toCodeStep(mode: RegExp) {
  const user = userEvent.setup();
  await renderApp();
  await user.click(await screen.findByRole('button', { name: 'Français' }));
  await user.click(await screen.findByRole('button', { name: mode }));
  await screen.findByRole('heading', { level: 1, name: 'Choisissez un code' });
  return user;
}

describe('Code setup', () => {
  it('asks for the code twice and starts again when the two differ', async () => {
    const user = await toCodeStep(/^Je suis enceinte/);
    const field = screen.getByLabelText('Code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAccessibleDescription(
      "De 4 à 6 chiffres. Gardez-le pour vous\u00a0: sans lui, votre profil ne s'ouvre pas.",
    );

    await user.type(field, '1357');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tapez le code une deuxième fois' }),
    ).toBeVisible();
    // A new field: nothing of the first typing is in it.
    expect(screen.getByLabelText('Le même code')).toHaveValue('');
    expect(screen.getByLabelText('Le même code')).toHaveFocus();
    // The keys on the screen say how many digits are in, for a screen reader.
    const keypad = screen.getByRole('group', { name: 'Clavier du code' });
    for (const digit of ['1', '3', '5']) {
      await user.click(within(keypad).getByRole('button', { name: digit }));
    }
    expect(screen.getByText('3 chiffres')).toHaveAttribute('aria-live', 'polite');
    await user.click(within(keypad).getByRole('button', { name: '8' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer le code' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choisissez un code' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
      /Les deux codes ne sont pas les mêmes\. Choisissez un code à nouveau\./,
    );
    expect(await getStoredVerifier()).toBeUndefined();

    await makeCode(user, '1357');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède\u00a0?' }),
    ).toBeVisible();
    const verifier = await getStoredVerifier();
    expect(verifier === undefined ? false : await checkCode('1357', verifier)).toBe(true);
  });

  it('refuses fewer than 4 digits, and keeps at most 6', async () => {
    const user = await toCodeStep(/^J'accompagne/);
    expect(screen.getByText('Ce code ouvre les profils des femmes que vous suivez.')).toBeVisible();
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
      "De 4 à 6 chiffres. Gardez-le pour vous : sans lui, les profils ne s'ouvrent pas.",
    );

    await user.type(screen.getByLabelText('Code'), '123');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
      /Écrivez de 4 à 6 chiffres\.$/,
    );

    await user.type(screen.getByLabelText('Code'), '4567a8');
    expect(screen.getByLabelText('Code')).toHaveValue('123456');
    const keypad = screen.getByRole('group', { name: 'Clavier du code' });
    await user.click(within(keypad).getByRole('button', { name: '9' }));
    expect(screen.getByLabelText('Code')).toHaveValue('123456');
  });

  it('goes back to the choice of mode', async () => {
    const user = await toCodeStep(/^J'accompagne/);

    await user.click(screen.getByRole('button', { name: 'Changer de mode' }));

    expect(
      await screen.findByRole('heading', { name: "Qui utilise l'application\u00a0?" }),
    ).toHaveFocus();
  });

  it('makes the code first for a phone onboarded before codes existed', async () => {
    // Onboarded, and no verifier (renderApp stores one only with the settings it is given).
    await storeSettings({ lang: 'fr', mode: 'woman', onboarded: true });
    await renderApp({ hash: '#/', locked: true });
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choisissez un code' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Signes de danger' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Changer de mode' })).toBeNull();
    await makeCode(user);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède\u00a0?' }),
    ).toBeVisible();
  });
});
