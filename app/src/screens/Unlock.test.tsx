// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { storeLockout } from '../data/db.js';
import { recordHistory } from '../data/history.js';
import { saveProfile } from '../data/profiles.js';
import { saveContacts } from '../data/referral.js';
import type { Settings } from '../domain/types.js';
import { inSession } from '../state/entry-state.js';
import { enterCode } from '../test/code-steps.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, TEST_CODE } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';

vi.setConfig({ testTimeout: 30_000 });

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Unlock', () => {
  it('asks for the code at start, with the danger signs one tap away and no quick exit', async () => {
    await renderApp({ settings: woman, locked: true });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Signes de danger' })).toHaveAttribute(
      'href',
      '#/danger',
    );
    expect(within(banner).queryByRole('button', { name: 'Quitter' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toHaveClass('button--primary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    // The phone's numeric keypad; a password field (assistive technologies never
    // read the digits); a one-time code with no name and the password managers'
    // ignore marks, so no browser offers to keep it.
    const field = screen.getByLabelText('Code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).not.toHaveAttribute('name');
    expect(field).toHaveAttribute('data-lpignore', 'true');
    expect(field).toHaveAttribute('data-1p-ignore');
    expect(field).toHaveAttribute('maxlength', '6');
    expect(screen.getByRole('button', { name: "J'ai oublié le code" })).toHaveClass(
      'button--quiet',
    );
  });

  it('refuses a wrong code, says how many tries are left, then opens with the right one', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });

    await enterCode(user, '1111');
    const field = screen.getByLabelText('Code');
    // PBKDF2 at 600 000 iterations takes a moment.
    await waitFor(
      () => {
        expect(field).toHaveAccessibleDescription(
          "Ce n'est pas le bon code. Encore 4 essais avant une attente.",
        );
      },
      { timeout: 10_000 },
    );
    expect(field).toHaveValue('');
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
      "Ce n'est pas le bon code. Encore 4 essais avant une attente.",
    );

    await enterCode(user, TEST_CODE);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède\u00a0?' }),
    ).toHaveFocus();
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Quitter' }),
    ).toBeVisible();
  });

  it('says a code is 4 to 6 digits before trying it', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });

    await enterCode(user, '12');

    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription('Écrivez de 4 à 6 chiffres.');
  });

  it('types with the large keys on the screen, and erases the last digit', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });
    const keypad = await screen.findByRole('group', { name: 'Clavier du code' });
    // Nothing to erase: "Effacer" says so, and keeps the focus when tapped.
    const erase = within(keypad).getByRole('button', { name: 'Effacer' });
    expect(erase).toHaveAttribute('aria-disabled', 'true');
    expect(erase).not.toBeDisabled();
    await user.click(erase);
    expect(erase).toHaveFocus();
    expect(screen.getByLabelText('Code')).toHaveValue('');

    for (const digit of ['2', '4', '6', '9']) {
      await user.click(within(keypad).getByRole('button', { name: digit }));
    }
    expect(screen.getByLabelText('Code')).toHaveValue('2469');
    // A screen reader hears how many digits, never which.
    const counts = [...document.querySelectorAll('[aria-live]')].map(
      (region) => region.textContent,
    );
    expect(counts).toContain('4 chiffres');
    expect(counts.join(' ')).not.toMatch(/\d{2,}/);
    expect(erase).not.toHaveAttribute('aria-disabled');
    await user.click(within(keypad).getByRole('button', { name: 'Effacer' }));
    await user.click(within(keypad).getByRole('button', { name: '8' }));
    expect(screen.getByLabelText('Code')).toHaveValue(TEST_CODE);
    // The keys never take the field's place: the phone's keyboard stays closed.
    expect(screen.getByLabelText('Code')).not.toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède\u00a0?' }),
    ).toBeVisible();
  });

  it('counts down the wait after five wrong codes, kept across a reload, and Ouvrir waits', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    await storeLockout({ failures: 5, lockedUntil: Date.now() + 30_000 });
    await renderApp({ settings: woman, locked: true });

    const field = await screen.findByLabelText('Code');
    expect(field).toHaveAccessibleDescription(
      "Trop d'essais. Attendez 30 secondes, puis essayez encore.",
    );
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('brings back the screen it locked, once the code is given; the address meanwhile is neutral', async () => {
    const user = userEvent.setup();
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/check', locked: true });

    await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' });
    expect(window.location.hash).toBe('#/unlock');
    await enterCode(user);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/check');
  });

  it('locks a product screen into a neutral address, holding the product in memory only', async () => {
    const user = userEvent.setup();
    await saveProfile(profileOf());
    const session = probeSession();
    await renderApp({
      settings: woman,
      hash: '#/confirm/product',
      entryState: inSession({ id: 'efavirenz-generic' }),
      packLoader: loaderOf(pack),
      children: session.element,
    });
    expect(await screen.findAllByText(/favirenz/i, {}, { timeout: 10_000 })).not.toHaveLength(0);

    act(() => {
      session.current().lock();
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/unlock');
    expect(window.location.href).not.toContain('efavirenz');
    expect(JSON.stringify(window.history.state)).not.toContain('efavirenz');
    expect(document.body.textContent).not.toMatch(/favirenz/i);

    await enterCode(user);
    expect(await screen.findAllByText(/favirenz/i, {}, { timeout: 10_000 })).not.toHaveLength(0);
    expect(window.location.hash).toBe('#/confirm/product');
  });

  it('shows nothing about a profile, a check, a contact or the mode while locked', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await saveProfile(profileOf({ id: 'b', pseudonym: 'Fatou' }));
    await saveContacts([{ id: 'c1', role: 'relay', name: 'Mariama', phone: '000 000 001' }]);
    await recordHistory({
      id: 'h1',
      profileId: 'a',
      at: '2026-11-04T10:00:00.000Z',
      packVersion: '0.1.0',
      level: 'danger',
      ruleIds: ['nsaid-pregnancy-from-20-weeks'],
      items: [{ ref: { kind: 'plant', id: 'kinkeliba' } }],
      signs: ['fever'],
    });

    for (const hash of [
      '#/',
      '#/profile/a',
      '#/profile/new',
      '#/check',
      '#/signs',
      '#/result',
      '#/contacts',
      '#/contacts/c1',
      '#/search/product',
      '#/settings',
    ]) {
      const { unmount } = await renderApp({ settings: accompanied, hash, locked: true });
      await screen.findByRole('heading', { level: 1 });
      const text = document.body.textContent;
      for (const secret of ['Awa', 'Fatou', 'Mariama', 'Kinkéliba', "J'accompagne"]) {
        expect(text, `${hash}: ${secret}`).not.toContain(secret);
      }
      unmount();
    }
  });
});
