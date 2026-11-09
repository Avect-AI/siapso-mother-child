// SPDX-License-Identifier: MIT
import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getStoredVerifier, storeSettings } from '../data/db.js';
import { checkCode } from '../domain/code.js';
import { makeCode } from '../test/code-steps.js';
import { phoneSetTo } from '../test/phone.js';
import { renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

async function toCodePart(mode: RegExp) {
  const user = userEvent.setup();
  await renderApp();
  await user.click(await screen.findByRole('button', { name: mode }));
  await screen.findByRole('heading', { name: /^Choisissez un code de/ });
  return user;
}

async function tapDigits(user: UserEvent, digits: string) {
  const keypad = screen.getByRole('group', { name: /^(Clavier du code|Code keypad)$/ });
  for (const digit of digits) {
    await user.click(within(keypad).getByRole('button', { name: digit }));
  }
}

describe('Code setup', () => {
  it('asks for the code twice and starts again when the two differ', async () => {
    const user = await toCodePart(/^Je suis enceinte/);
    const field = screen.getByLabelText('Code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAttribute('maxlength', '4');

    await user.type(field, '1357');
    const again = await screen.findByLabelText('Tapez-le encore');
    // A new field: nothing of the first typing is in it.
    expect(again).toHaveValue('');
    expect(again).toHaveFocus();
    // The keys on the screen say how many digits are in, for a screen reader.
    await tapDigits(user, '135');
    expect(screen.getByText('3 chiffres')).toHaveAttribute('aria-live', 'polite');
    await tapDigits(user, '8');

    const first = await screen.findByLabelText('Code');
    expect(first).toHaveAccessibleDescription(
      /Les deux codes ne sont pas les mêmes\. Choisissez un code à nouveau\./,
    );
    expect(first).toHaveValue('');
    expect(first).toHaveFocus();
    expect(await getStoredVerifier()).toBeUndefined();

    await makeCode(user, '1357');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède ?' }),
    ).toBeVisible();
    const verifier = await getStoredVerifier();
    expect(verifier === undefined ? false : await checkCode('1357', verifier)).toBe(true);
  });

  it('warns about a code easy to guess, and keeps it after a second yes', async () => {
    const user = await toCodePart(/^Je suis enceinte/);

    await tapDigits(user, '1990');

    // Not refused: a plain warning in place of the field, then her choice.
    expect(
      await screen.findByRole('heading', { name: 'Ce code est facile à deviner' }),
    ).toHaveFocus();
    expect(screen.queryByLabelText('Code')).toBeNull();
    expect(screen.getByText(/N'utilisez pas une année de naissance\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choisir un autre code' })).toHaveClass(
      'button--primary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    // Never red: a weak code is not a danger sign.
    expect(document.querySelector('main .level--danger')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Garder ce code' }));

    expect(await screen.findByLabelText('Tapez-le encore')).toHaveFocus();
    await tapDigits(user, '1990');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède ?' }),
    ).toBeVisible();
    const verifier = await getStoredVerifier();
    expect(verifier === undefined ? false : await checkCode('1990', verifier)).toBe(true);
  });

  it('goes back to an empty field to choose another code after the warning', async () => {
    const user = await toCodePart(/^J'accompagne/);

    await tapDigits(user, '123456');
    await user.click(await screen.findByRole('button', { name: 'Choisir un autre code' }));

    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText('Code')).toHaveFocus();
    await makeCode(user, '739215');
    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    expect(await getStoredVerifier()).toBeDefined();
  });

  it('says the warning in English too', async () => {
    phoneSetTo(['en-US']);
    const user = userEvent.setup();
    await renderApp();
    await user.click(await screen.findByRole('button', { name: /^I am pregnant/ }));
    await user.type(await screen.findByLabelText('Code'), '0000');

    expect(
      await screen.findByRole('heading', { name: 'This code is easy to guess' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keep this code' })).toBeVisible();
  });

  it('asks for every digit before moving on, and keeps no more than the length chosen', async () => {
    const user = await toCodePart(/^J'accompagne/);
    expect(
      screen.getByText(
        'Il ouvre les profils des femmes que vous suivez. Retenez-le et gardez-le pour vous.',
      ),
    ).toBeVisible();

    // Enter before the last digit says how many are needed.
    await user.type(screen.getByLabelText('Code'), '123{Enter}');
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(/Tapez 6 chiffres\.$/);

    await user.click(screen.getByRole('radio', { name: '4' }));
    // Another length starts the code again.
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText('Code')).toHaveAttribute('maxlength', '4');
    await user.type(screen.getByLabelText('Code'), '45a');
    expect(screen.getByLabelText('Code')).toHaveValue('45');
  });

  it('goes back to the choice of mode', async () => {
    const user = await toCodePart(/^J'accompagne/);

    await user.click(screen.getByRole('button', { name: 'Changer de mode' }));

    expect(
      await screen.findByRole('heading', { name: "Qui utilise l'application ?" }),
    ).toHaveFocus();
  });

  it('makes the code first for a phone onboarded before codes existed', async () => {
    // Onboarded, and no verifier (renderApp stores one only with the settings it is given).
    await storeSettings({ lang: 'fr', mode: 'woman', onboarded: true });
    await renderApp({ hash: '#/', locked: true });
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choisissez un code de 4 chiffres' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Signes de danger' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Changer de mode' })).toBeNull();
    await makeCode(user);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède ?' }),
    ).toBeVisible();
  });
});
