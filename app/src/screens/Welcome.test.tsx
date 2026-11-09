// SPDX-License-Identifier: MIT
import { act, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getStoredSettings, getStoredVerifier } from '../data/db.js';
import { checkCode } from '../domain/code.js';
import { makeCode } from '../test/code-steps.js';
import { hangIndexedDB } from '../test/idb.js';
import { phoneSetTo } from '../test/phone.js';
import { renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

const QUESTION = /^Qui utilise l'application/;

/** Digits tapped on the keys of the screen, as most people type a code. */
async function tapDigits(user: UserEvent, digits: string) {
  const keypad = screen.getByRole('group', { name: /^(Clavier du code|Code keypad)$/ });
  for (const digit of digits) {
    await user.click(within(keypad).getByRole('button', { name: digit }));
  }
}

describe('Welcome', () => {
  it('opens after a storage timeout with a notice that choices may not be kept', async () => {
    hangIndexedDB();
    await renderApp({ storageTimeoutMs: 50 });

    expect(await screen.findByRole('heading', { name: QUESTION })).toBeVisible();
    expect(
      screen.getByText(
        "Ce téléphone n'a pas pu garder vos réglages. Vos choix seront peut-être à refaire.",
      ),
    ).toBeVisible();
  });

  it('takes the language of the phone, the other one a tap away, and asks no language', async () => {
    phoneSetTo(['en-GB', 'fr']);
    const user = userEvent.setup();
    await renderApp();

    expect(await screen.findByRole('heading', { name: 'Who is using the app?' })).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
    expect(screen.queryByText('Choose your language')).toBeNull();
    // The switch names the other language in that language.
    const french = screen.getByRole('button', { name: 'Français' });
    expect(french).toHaveAttribute('lang', 'fr');
    expect(screen.queryByRole('button', { name: 'English' })).toBeNull();

    await user.click(french);

    expect(await screen.findByRole('heading', { name: QUESTION })).toBeVisible();
    expect(document.documentElement.lang).toBe('fr');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('lang', 'en');
    expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: null, onboarded: false });
  });

  it('asks who uses the app and the code on one screen, then opens Home', async () => {
    const user = userEvent.setup();
    await renderApp();
    const question = await screen.findByRole('heading', { name: QUESTION });

    await user.click(screen.getByRole('button', { name: /^Je suis enceinte ou j'allaite/ }));

    // The answer folds into one line under the question, which stays.
    expect(question).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Je suis enceinte/ })).toBeNull();
    expect(screen.getByText("Je suis enceinte ou j'allaite")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Changer de mode' })).toHaveTextContent('Changer');
    // The code part, under it, takes the focus: 4 digits by default for her.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Choisissez un code de 4 chiffres' }),
    ).toHaveFocus();
    expect(
      screen.getByText('Il ouvre votre profil. Retenez-le et gardez-le pour vous.'),
    ).toBeVisible();
    const length = screen.getByRole('group', { name: 'Nombre de chiffres' });
    expect(within(length).getByRole('radio', { name: '4' })).toBeChecked();
    // Not onboarded until the code is made.
    expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: 'woman', onboarded: false });

    // No "Continuer": the 4th digit moves on to the second typing.
    expect(screen.queryByRole('button', { name: 'Continuer' })).toBeNull();
    await tapDigits(user, '1357');
    const again = await screen.findByLabelText('Tapez-le encore');
    expect(again).toHaveValue('');
    expect(again).toHaveFocus();
    // No "Enregistrer le code": the code is kept once both match.
    expect(screen.queryByRole('button', { name: 'Enregistrer le code' })).toBeNull();
    await tapDigits(user, '1357');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède ?' }),
    ).toBeVisible();
    expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: 'woman', onboarded: true });
    const verifier = await getStoredVerifier();
    expect(verifier === undefined ? false : await checkCode('1357', verifier)).toBe(true);
  });

  it('offers 6 digits by default in accompanied mode, then shows the profiles in English', async () => {
    phoneSetTo(['en-US']);
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole('button', { name: /^I support women/ }));

    expect(screen.getByRole('heading', { level: 2, name: 'Choose a 6-digit code' })).toHaveFocus();
    expect(
      screen.getByText(
        'It opens the profiles of the women you support. Remember it and keep it to yourself.',
      ),
    ).toBeVisible();
    const length = screen.getByRole('group', { name: 'Number of digits' });
    expect(within(length).getByRole('radio', { name: '6' })).toBeChecked();
    // Why 6: a longer code is harder to guess.
    expect(length).toHaveAccessibleDescription(/harder to guess/);
    expect(await getStoredSettings()).toEqual({
      lang: 'en',
      mode: 'accompanied',
      onboarded: false,
    });
    // 4 digits do not move on yet.
    await tapDigits(user, '1357');
    expect(screen.getByLabelText('Code')).toHaveValue('1357');
    await tapDigits(user, '90');
    await tapDigits(user, '135790');

    expect(await screen.findByRole('heading', { level: 1, name: 'Profiles' })).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
    expect(await getStoredSettings()).toEqual({
      lang: 'en',
      mode: 'accompanied',
      onboarded: true,
    });
    const verifier = await getStoredVerifier();
    expect(verifier === undefined ? false : await checkCode('135790', verifier)).toBe(true);
  });

  it('keeps the length choice in sight, and moves on at the length chosen', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(await screen.findByRole('button', { name: /^Je suis enceinte/ }));

    await user.click(screen.getByRole('radio', { name: '6' }));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Choisissez un code de 6 chiffres' }),
    ).toBeVisible();
    await tapDigits(user, '13579');
    expect(screen.queryByLabelText('Tapez-le encore')).toBeNull();
    await tapDigits(user, '2');
    expect(await screen.findByLabelText('Tapez-le encore')).toHaveFocus();
    await tapDigits(user, '135792');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède ?' }),
    ).toBeVisible();
    const verifier = await getStoredVerifier();
    expect(verifier === undefined ? false : await checkCode('135792', verifier)).toBe(true);
  });

  it('keeps the danger signs one tap away in the band, and comes back to the code part', async () => {
    const user = userEvent.setup();
    await renderApp();
    const dangerLink = () =>
      within(screen.getByRole('banner')).getByRole('link', { name: 'Signes de danger' });

    await screen.findByRole('heading', { name: QUESTION });
    expect(dangerLink()).toHaveAttribute('href', '#/danger');
    // The welcome shows the mark and the name itself: the band has no way home to itself.
    expect(within(screen.getByRole('banner')).queryByRole('link', { name: 'Carnet' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Je suis enceinte ou j'allaite/ }));
    await screen.findByRole('heading', { name: 'Choisissez un code de 4 chiffres' });

    await user.click(dangerLink());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Signes de danger' }),
    ).toBeVisible();
    act(() => {
      window.history.back();
    });
    // Back to the code part, her answer kept.
    expect(
      await screen.findByRole('heading', { name: 'Choisissez un code de 4 chiffres' }),
    ).toBeVisible();
    expect(
      screen.getByText('Il ouvre votre profil. Retenez-le et gardez-le pour vous.'),
    ).toBeVisible();
  });

  it('names each mode with its label and hint, and lets her change the mode', async () => {
    phoneSetTo(['en']);
    const user = userEvent.setup();
    await renderApp();

    // Everything a choice shows is in its name, so voice control finds it by what it reads.
    expect(
      await screen.findByRole('button', {
        name: 'I support women Relais, Bajenu Gox, health worker, nurse, midwife, depot keeper',
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'I am pregnant or breastfeeding For myself' }),
    );
    await tapDigits(user, '13');

    await user.click(screen.getByRole('button', { name: 'Change mode' }));

    expect(screen.getByRole('heading', { name: 'Who is using the app?' })).toHaveFocus();
    expect(screen.queryByLabelText('Code')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^I support women/ }));
    // A new code part: nothing typed before is kept.
    expect(screen.getByRole('heading', { name: 'Choose a 6-digit code' })).toBeVisible();
    expect(screen.getByLabelText('Code')).toHaveValue('');
  });

  it('makes the code through the shared test steps', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(await screen.findByRole('button', { name: /^J'accompagne/ }));

    await makeCode(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
  });
});
