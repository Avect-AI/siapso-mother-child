// SPDX-License-Identifier: MIT
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import { storeSettings } from './data/db.js';
import { AppProvider } from './state/app-state.js';
import { hangIndexedDB } from './test/idb.js';
import { loaderOf, renderApp, shellPack } from './test/render-app.js';

const onboarded = { lang: 'fr', mode: 'woman', onboarded: true } as const;
// Her check, the start in woman mode (SCRUM-56, S4); a no-break space before "?".
const START = 'Un médicament ou un remède\u00a0?';

describe('App', () => {
  it('opens on the welcome screen at first launch', async () => {
    await renderApp();
    expect(
      await screen.findByRole('heading', { name: /^Qui utilise l'application/ }),
    ).toBeVisible();
  });

  it('opens on her check once onboarded in woman mode', async () => {
    await renderApp({ settings: onboarded });
    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
  });

  it('shows no screen but the danger signs until the stored settings are known', async () => {
    hangIndexedDB();
    await renderApp({ storageTimeoutMs: 60_000 });

    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Qui utilise l'application/ })).toBeNull();
  });

  it('sends an unknown route to the start', async () => {
    await renderApp({ settings: onboarded, hash: '#/nowhere' });
    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(window.location.hash).toBe('#/');
  });

  it('keeps what it holds after the screens (the update prompt) mounted across a redirect', async () => {
    let mounts = 0;
    function Slot() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <p>update slot</p>;
    }
    await storeSettings(onboarded);
    window.location.hash = '#/nowhere';
    render(
      <AppProvider packLoader={loaderOf(shellPack())} session={{ startUnlocked: true }}>
        <App>
          <Slot />
        </App>
      </AppProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(screen.getByText('update slot')).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it('goes to the danger signs from the header and back home with the app name', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: onboarded });
    const banner = await screen.findByRole('banner');

    await user.click(within(banner).getByRole('link', { name: 'Signes de danger' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Signes de danger' }),
    ).toHaveFocus();

    await user.click(within(banner).getByRole('link', { name: 'Carnet' }));
    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    // No profile yet: the questions about her take the focus (SCRUM-56, 8.3).
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'À propos de vous' })).toHaveFocus();
    });
  });
});
