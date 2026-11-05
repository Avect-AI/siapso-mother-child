// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { enterCode } from '../test/code-steps.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

/** The list of profiles, then Awa's check opened from it, as an accompanying person does. */
async function openAwasCheck() {
  await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
  const probe = probeCheck();
  await renderApp({
    settings: accompanied,
    hash: '#/',
    packLoader: loaderOf(pack),
    children: probe.element,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Awa / }));
  expect(await screen.findByText('Profil : Awa')).toBeVisible();
  return { user, probe };
}

describe('Quick exit', () => {
  it('is in the header of every screen once open, and hides everything in one tap', async () => {
    const { user, probe } = await openAwasCheck();
    expect(probe.current().profileId).toBe('a');

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Quitter' }));

    // The neutral screen: the app's name and one button, nothing else.
    expect(await screen.findByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
    const main = screen.getByRole('main');
    expect(
      within(main)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Ouvrir']);
    expect(document.body.textContent).not.toContain('Awa');
    expect(screen.queryByRole('button', { name: 'Quitter' })).toBeNull();
    // What was in memory is gone: the check, and the history entry's state.
    expect(probe.current().profileId).toBeNull();
    expect(probe.current().items).toEqual([]);
    expect(window.location.hash).toBe('#/');
    expect(window.history.state).toBeNull();
  });

  it('leaves Back nothing to show: each earlier entry gives the neutral screen', async () => {
    const { user } = await openAwasCheck();
    await user.click(screen.getByRole('button', { name: 'Ajouter un remède' }));
    await screen.findByRole('searchbox');

    await user.click(screen.getByRole('button', { name: 'Quitter' }));
    await screen.findByRole('heading', { level: 1, name: 'Carnet' });

    // The search's entry became the neutral one. Back to the check, then to
    // the list of profiles: still the neutral screen, which takes each entry's
    // place as it is reached.
    for (const left of ['#/check', '#/']) {
      const reached = new Promise<string>((resolve) => {
        window.addEventListener(
          'popstate',
          () => {
            resolve(window.location.hash);
          },
          { once: true },
        );
      });
      window.history.back();
      expect(await reached).toBe(left);
      await waitFor(() => {
        expect(window.location.hash).toBe('#/');
      });
      expect(screen.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
      expect(document.body.textContent).not.toContain('Awa');
      expect(screen.queryByRole('searchbox')).toBeNull();
    }
  });

  it('opens again with "Ouvrir" and the code, at the start', async () => {
    const { user } = await openAwasCheck();
    await user.click(screen.getByRole('button', { name: 'Quitter' }));

    await user.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    expect(window.location.hash).toBe('#/unlock');
    await enterCode(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/');
    });
    // The check was forgotten: Awa is chosen again from the list.
    expect(await screen.findByRole('button', { name: /^Awa / })).toBeVisible();
  });

  it('keeps the danger signs one tap away from the neutral screen', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman });
    await user.click(await screen.findByRole('button', { name: 'Quitter' }));
    await screen.findByRole('heading', { level: 1, name: 'Carnet' });

    await user.click(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Signes de danger' }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Signes de danger' }),
    ).toBeVisible();
    // The signs are ticked without the code: the quick exit hides them there too.
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Quitter' }),
    ).toBeVisible();
  });
});
