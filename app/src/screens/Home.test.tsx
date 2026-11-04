// SPDX-License-Identifier: MIT
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { storeSettings } from '../data/db.js';
import { AppProvider } from '../state/app-state.js';
import { breakIndexedDB } from '../test/idb.js';
import { loaderOf, noPack, pendingPack, renderApp, shellPack } from '../test/render-app.js';

const onboarded = { lang: 'fr', mode: 'woman', onboarded: true } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Home', () => {
  it('shows the app name, the danger signs shortcut and one primary action', async () => {
    await renderApp({ settings: onboarded });

    const banner = await screen.findByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Carnet' })).toBeVisible();
    expect(within(banner).getByRole('link', { name: 'Signes de danger' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Un médicament');
    const check = screen.getByRole('button', { name: 'Regarder un produit' });
    expect(check).toHaveClass('button--primary');
    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);
    expect(screen.getByText('Cet outil ne remplace pas un soignant.')).toBeVisible();
  });

  it('links to no screen that does not exist yet', async () => {
    await renderApp({ settings: onboarded });
    await screen.findByRole('banner');

    const targets = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(targets.sort()).toEqual(['#/', '#/danger', '#/profile']);
  });

  it('opens her one profile in woman mode', async () => {
    await renderApp({ settings: onboarded });

    const profile = await screen.findByRole('link', { name: 'Mon profil' });
    expect(profile).toHaveAttribute('href', '#/profile');
    expect(profile).toHaveClass('button--secondary');
  });

  it('opens a new profile in accompanied mode', async () => {
    await renderApp({ settings: { ...onboarded, mode: 'accompanied' } });

    expect(await screen.findByRole('link', { name: 'Nouveau profil' })).toHaveAttribute(
      'href',
      '#/profile/new',
    );
    expect(screen.queryByRole('link', { name: 'Mon profil' })).toBeNull();
  });

  it('says once that the profile was saved, and not again after a reload', async () => {
    // As the profile screen leaves it, set before anything renders.
    await storeSettings(onboarded);
    window.history.replaceState({ profileSaved: 'Awa' }, '', '#/');
    const { unmount } = render(
      <AppProvider packLoader={loaderOf(shellPack())}>
        <App />
      </AppProvider>,
    );

    expect(await screen.findByText('Profil enregistré : Awa.')).toBeVisible();
    // Home takes the note off the history entry in an effect: wait for it, not for the clock.
    await waitFor(() => {
      expect(window.history.state).toBeNull();
    });

    unmount();
    await renderApp({ settings: onboarded, hash: '#/' });
    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
    expect(screen.queryByText(/^Profil enregistré/)).toBeNull();
  });

  it('says so when the knowledge base could not be loaded', async () => {
    await renderApp({ settings: onboarded, packLoader: noPack });

    expect(
      await screen.findByText(
        "Les informations sur les produits ne sont pas encore sur ce téléphone. Ouvrez l'application une fois avec Internet.",
      ),
    ).toBeVisible();
  });

  it('says nothing about the knowledge base while it is still loading', async () => {
    await renderApp({ settings: onboarded, packLoader: pendingPack });

    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
    expect(screen.queryByText(/Les informations sur les produits/)).toBeNull();
  });

  it('says when the choices made at the welcome screen could not be kept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    breakIndexedDB('SecurityError');
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole('button', { name: 'Français' }));
    await user.click(await screen.findByRole('button', { name: /^Je suis enceinte/ }));

    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
    expect(
      screen.getByText(
        "Ce téléphone n'a pas pu garder vos réglages. Vos choix seront peut-être à refaire.",
      ),
    ).toBeVisible();
  });

  it('says nothing about settings when they are stored', async () => {
    await renderApp({ settings: onboarded });

    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
    expect(screen.queryByText(/n'a pas pu garder vos réglages/)).toBeNull();
  });

  it('shows the offline badge when the phone is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await renderApp({ settings: onboarded });

    expect(within(await screen.findByRole('banner')).getByText('Hors ligne')).toBeVisible();
  });
});
