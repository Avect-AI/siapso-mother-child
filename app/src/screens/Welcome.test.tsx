// SPDX-License-Identifier: MIT
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getStoredSettings } from '../data/db.js';
import { hangIndexedDB } from '../test/idb.js';
import { renderApp } from '../test/render-app.js';

describe('Welcome', () => {
  it('opens after a storage timeout with a notice that choices may not be kept', async () => {
    hangIndexedDB();
    await renderApp({ storageTimeoutMs: 50 });

    expect(await screen.findByRole('button', { name: 'Français' })).toBeVisible();
    expect(
      screen.getByText(
        "Ce téléphone n'a pas pu garder vos réglages. Vos choix seront peut-être à refaire.",
      ),
    ).toBeVisible();
  });

  it('stores English and accompanied mode, then shows Home in English', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    await user.click(await screen.findByRole('button', { name: /^I support women/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'A medicine or a remedy?' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Look up a product' })).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
    expect(await getStoredSettings()).toEqual({
      lang: 'en',
      mode: 'accompanied',
      onboarded: true,
    });
  });

  it('asks for the language first, in both languages, each button in its own language', async () => {
    await renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Choisissez votre langue' })).toHaveAttribute(
      'lang',
      'fr',
    );
    expect(screen.getByText('Choose your language')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('lang', 'fr');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('lang', 'en');
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('stores French and woman mode, then shows Home in French', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole('button', { name: 'Français' }));
    const question = await screen.findByRole('heading', { name: "Qui utilise l'application ?" });
    expect(question).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /^Je suis enceinte ou j'allaite/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède ?' }),
    ).toBeVisible();
    expect(document.documentElement.lang).toBe('fr');
    expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: 'woman', onboarded: true });
  });

  it('names each mode with its label and hint and lets the user go back to the language', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole('button', { name: 'English' }));
    // Everything a choice shows is in its name, so voice control finds it by what it reads.
    expect(
      await screen.findByRole('button', {
        name: 'I support women Relais, Bajenu Gox, health worker, nurse, midwife, depot keeper',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'I am pregnant or breastfeeding For myself' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Change language' }));
    const choices = await screen.findByRole('group', { name: 'Choisissez votre langue' });
    expect(within(choices).getByRole('button', { name: 'Français' })).toBeVisible();
    expect(await getStoredSettings()).toEqual({ lang: 'en', mode: null, onboarded: false });
  });
});
