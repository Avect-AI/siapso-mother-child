// SPDX-License-Identifier: MIT
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { storeSettings } from '../data/db.js';
import { AppProvider } from '../state/app-state.js';
import { makeCode } from '../test/code-steps.js';
import { breakIndexedDB } from '../test/idb.js';
import { loaderOf, noPack, pendingPack, renderApp, shellPack } from '../test/render-app.js';
import { inSession } from '../state/entry-state.js';

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

  it('says when the knowledge base is out of date, near its action, and nothing while it is not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 11, 1, 12));
      const fresh = await renderApp({
        settings: onboarded,
        packLoader: loaderOf({ ...shellPack(), date: '2026-11-04' }),
      });
      await screen.findByRole('banner');
      expect(screen.queryByText(/^Base de connaissances ancienne/)).toBeNull();
      fresh.unmount();

      // Seven months after the pack date.
      vi.setSystemTime(new Date(2027, 5, 1, 12));
      await renderApp({
        settings: onboarded,
        packLoader: loaderOf({ ...shellPack(), date: '2026-11-04' }),
      });
      const stale = await screen.findByText(
        'Base de connaissances ancienne : plus de 90 jours. Faites-la mettre à jour au poste de santé.',
      );
      expect(stale).toBeVisible();
      const check = screen.getByRole('button', { name: 'Regarder un produit' });
      expect(stale.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('says, after its actions, whether the phone opens the app without the Internet', async () => {
    await renderApp({ settings: onboarded });
    await screen.findByRole('banner');

    // The test browser has no service worker: Home says so, and what to do.
    const line = document.querySelector('main .offline-ready');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveTextContent(
      "Ce navigateur ne peut pas garder l'application pour l'ouvrir sans Internet. Ouvrez-la dans Chrome.",
    );
    const profile = screen.getByRole('link', { name: 'Mon profil' });
    expect(profile.compareDocumentPosition(line as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('links to the profile, the settings, the knowledge base status and the about screen', async () => {
    await renderApp({ settings: onboarded });
    await screen.findByRole('banner');

    const targets = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(targets.sort()).toEqual([
      '#/',
      '#/about',
      '#/danger',
      '#/profile',
      '#/settings',
      '#/status',
    ]);
  });

  it('opens her one profile in woman mode', async () => {
    await renderApp({ settings: onboarded });

    const profile = await screen.findByRole('link', { name: 'Mon profil' });
    expect(profile).toHaveAttribute('href', '#/profile');
    expect(profile).toHaveClass('button--secondary');
  });

  it('is the list of profiles in accompanied mode', async () => {
    await renderApp({ settings: { ...onboarded, mode: 'accompanied' } });

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Mon profil' })).toBeNull();
  });

  it('says once that the profile was saved, and not again after a reload', async () => {
    // As the profile screen leaves it, set before anything renders.
    await storeSettings(onboarded);
    window.history.replaceState(inSession({ profileSaved: 'Awa' }), '', '#/');
    const { unmount } = render(
      <AppProvider packLoader={loaderOf(shellPack())} session={{ startUnlocked: true }}>
        <App />
      </AppProvider>,
    );

    // The status line is there empty first, then filled: a screen reader reads it out.
    await screen.findByRole('heading', { level: 1 });
    const status = document.querySelector('.home__saved');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent(/^$/);
    expect(await screen.findByText('Profil enregistré : Awa.')).toBe(status);
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

  it('opens nothing on a code the phone could not keep, and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    breakIndexedDB('SecurityError');
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole('button', { name: 'Français' }));
    await user.click(await screen.findByRole('button', { name: /^Je suis enceinte/ }));
    await makeCode(user);

    // A code storage did not keep opens nothing: the welcome asks again, and says why.
    await waitFor(() => {
      expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
        /Le code n'a pas pu être enregistré sur ce téléphone\. Essayez encore\.$/,
      );
    });
    expect(screen.queryByRole('button', { name: 'Regarder un produit' })).toBeNull();
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
