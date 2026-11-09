// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredLockout, getStoredVerifier, openAppDb, storeLockout } from '../data/db.js';
import { recordHistory } from '../data/history.js';
import { saveProfile } from '../data/profiles.js';
import { saveContacts } from '../data/referral.js';
import type { Settings } from '../domain/types.js';
import { translate, type MessageKey, type Vars } from '../i18n/index.js';
import { waitTime } from './code-words.js';
import { inSession } from '../state/entry-state.js';
import { enterCode } from '../test/code-steps.js';
import { failWrites } from '../test/idb.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode, TEST_CODE } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';
import { legacyVerifier, verifierOf, withoutLength } from '../test/verifier.js';
import { SESSION_CHANNEL } from '../state/tab-sync.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 30_000 });

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
/** The heading of Home in woman mode, a no-break space before "?". */
const HOME = 'Un médicament ou un remède ?';
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

  it('opens a phone updated from a version that kept the profiles in clear, sealing them', async () => {
    const user = userEvent.setup();
    await (await openAppDb()).put('profiles', profileOf({ id: 'a', pseudonym: 'Awa' }));
    await renderApp({
      settings: accompanied,
      locked: true,
      verifier: await legacyVerifier(TEST_CODE),
    });

    await enterCode(user);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Profils' }, { timeout: 15_000 }),
    ).toBeVisible();
    expect(await screen.findByText('Awa')).toBeVisible();
    expect(JSON.stringify(await (await openAppDb()).getAll('profiles'))).not.toContain('Awa');
  });

  it('says when the right code could not open the profiles on this phone, and asks it again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    await (await openAppDb()).put('profiles', profileOf({ id: 'a', pseudonym: 'Awa' }));
    await renderApp({ settings: woman, locked: true, verifier: await legacyVerifier(TEST_CODE) });
    const refused = failWrites((store) => store.name === 'profiles');

    await enterCode(user);

    expect(
      await screen.findByText(
        "Le code est bon, mais les profils n'ont pas pu être ouverts sur ce téléphone. Tapez le code encore une fois.",
        {},
        // Two derivations at 600 000 iterations: the code, then the verifier made again.
        { timeout: 15_000 },
      ),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
    // The field is empty: the code is typed again, never left on screen.
    expect(screen.getByLabelText('Code')).toHaveValue('');
    refused.restore();
    await enterCode(user);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: /^Un médicament ou un remède/ },
        { timeout: 15_000 },
      ),
    ).toBeVisible();
  });

  it('asks the code again when the app locked while it was opening (another tab)', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });

    // The code takes a moment to work out, as on a phone.
    const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return derive(...args);
    });

    await enterCode(user);
    // A lock in another tab, while the code is worked out.
    const other = new BroadcastChannel(SESSION_CHANNEL);
    other.postMessage({ event: 'lock', mark: crypto.randomUUID() });
    other.close();

    expect(
      await screen.findByText(
        "L'application s'est verrouillée pendant l'ouverture. Tapez le code encore une fois.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  });

  it('says a code of a newer version of the app cannot be opened here, and counts no try', async () => {
    const user = userEvent.setup();
    await renderApp({
      settings: woman,
      locked: true,
      verifier: { ...(await verifierOf(TEST_CODE)), version: 3 },
    });

    await enterCode(user);

    expect(
      await screen.findByText(
        "Ce code a été créé par une version plus récente de l'application. Mettez l'application à jour pour l'ouvrir.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/^Ce n'est pas le bon code/)).toBeNull();
  });

  it('says a code is 4 to 6 digits before trying it', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });

    await enterCode(user, '12');

    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription('Écrivez de 4 à 6 chiffres.');
  });

  it('types with the large keys on the screen, and takes the last digit off', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });
    const keypad = await screen.findByRole('group', { name: 'Clavier du code' });
    // Never the word of the data wipe (EFFACER): "Corriger", named for what it does.
    expect(within(keypad).queryByText(/effacer/i)).toBeNull();
    const erase = within(keypad).getByRole('button', { name: 'Corriger le dernier chiffre' });
    expect(erase).toHaveTextContent(/^Corriger$/);
    // Nothing to take off: it says so, and keeps the focus when tapped.
    expect(erase).toHaveAttribute('aria-disabled', 'true');
    expect(erase).not.toBeDisabled();
    await user.click(erase);
    expect(erase).toHaveFocus();
    expect(screen.getByLabelText('Code')).toHaveValue('');

    for (const digit of ['2', '4', '9']) {
      await user.click(within(keypad).getByRole('button', { name: digit }));
    }
    expect(screen.getByLabelText('Code')).toHaveValue('249');
    // A screen reader hears how many digits, never which.
    const counts = [...document.querySelectorAll('[aria-live]')].map(
      (region) => region.textContent,
    );
    expect(counts).toContain('3 chiffres');
    expect(counts.join(' ')).not.toMatch(/\d{2,}/);
    expect(erase).not.toHaveAttribute('aria-disabled');
    await user.click(erase);
    expect(screen.getByLabelText('Code')).toHaveValue('24');
    // The keys never take the field's place: the phone's keyboard stays closed.
    expect(screen.getByLabelText('Code')).not.toHaveFocus();
    // The last digit of the code opens it (its length is kept with it): no "Ouvrir".
    await user.click(within(keypad).getByRole('button', { name: '6' }));
    await user.click(within(keypad).getByRole('button', { name: '8' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Un médicament ou un remède\u00a0?' }),
    ).toBeVisible();
  });

  it('tries the code at its last digit, "Ouvrir" kept on screen for a keyboard or a screen reader', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });
    const field = await screen.findByLabelText('Code');
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toBeVisible();

    await user.type(field, TEST_CODE.slice(0, 3));
    // Nothing tried before the last digit.
    expect(screen.queryByText('Ouverture en cours.')).toBeNull();
    await user.type(field, TEST_CODE.slice(3));

    expect(await screen.findByRole('heading', { level: 1, name: HOME })).toBeVisible();
    expect(await getStoredLockout()).toEqual({ failures: 0, lockedUntil: null });
  });

  it('tries a wrong code at its last digit and counts it, as every wrong code', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });
    const field = await screen.findByLabelText('Code');

    await user.type(field, '1111');

    await waitFor(
      () => {
        expect(field).toHaveAccessibleDescription(
          "Ce n'est pas le bon code. Encore 4 essais avant une attente.",
        );
      },
      { timeout: 10_000 },
    );
    expect(field).toHaveValue('');
    expect(await getStoredLockout()).toEqual({ failures: 1, lockedUntil: null });
  });

  it('tries nothing during a wait after wrong codes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    const wait = { failures: 5, lockedUntil: Date.now() + 30_000 };
    await storeLockout(wait);
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true });

    await user.type(await screen.findByLabelText('Code'), TEST_CODE);

    expect(screen.queryByText('Ouverture en cours.')).toBeNull();
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
      "Trop d'essais. Attendez 30 s, puis essayez encore.",
    );
    expect(await getStoredLockout()).toEqual(wait);
  });

  it('keeps "Ouvrir" for a code kept without its length, and keeps the length once it opens', async () => {
    const before = withoutLength(await verifierOf(TEST_CODE));
    const user = userEvent.setup();
    await renderApp({ settings: woman, locked: true, verifier: before });
    const field = await screen.findByLabelText('Code');

    await user.type(field, TEST_CODE);
    expect(screen.queryByText('Ouverture en cours.')).toBeNull();
    expect(field).toHaveValue(TEST_CODE);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));

    expect(await screen.findByRole('heading', { level: 1, name: HOME })).toBeVisible();
    // The same code, its length now kept: the next time opens at the 4th digit.
    await waitFor(async () => {
      expect(await getStoredVerifier()).toEqual({ ...before, length: 4 });
    });
  });

  it('counts down the wait after five wrong codes, kept across a reload, and Ouvrir waits', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    await storeLockout({ failures: 5, lockedUntil: Date.now() + 30_000 });
    await renderApp({ settings: woman, locked: true });

    const field = await screen.findByLabelText('Code');
    expect(field).toHaveAccessibleDescription(
      "Trop d'essais. Attendez 30\u00a0s, puis essayez encore.",
    );
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('says a wait in minutes and seconds ("1 min 59 s"), and in words to a screen reader', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    // The seventh wrong code: a wait of 2 minutes, 1 second of it gone.
    await storeLockout({ failures: 7, lockedUntil: Date.now() + 119_000 });
    await renderApp({ settings: woman, locked: true });

    const field = await screen.findByLabelText('Code');
    expect(field).toHaveAccessibleDescription(
      "Trop d'essais. Attendez 1\u00a0min\u00a059\u00a0s, puis essayez encore.",
    );
    // A screen reader hears the wait once, as the screen first showed it, in words.
    const status = within(screen.getByRole('main')).getByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe(
        "Trop d'essais. Attendez 1 minute 59 secondes, puis essayez encore.",
      );
    });
  });

  it('says the wait to a screen reader in whole words, minutes and seconds', () => {
    const t = (key: MessageKey, vars?: Vars) => translate('fr', key, vars);
    expect(waitTime(t, 119_000, 'spoken')).toBe('1 minute 59 secondes');
    expect(waitTime(t, 61_000, 'spoken')).toBe('1 minute 1 seconde');
    expect(waitTime(t, 30_000, 'spoken')).toBe('30 secondes');
    expect(waitTime(t, 1_800_000, 'spoken')).toBe('30 minutes');
    const en = (key: MessageKey, vars?: Vars) => translate('en', key, vars);
    expect(waitTime(en, 119_000, 'spoken')).toBe('1 minute 59 seconds');
    expect(waitTime(en, 1_000, 'spoken')).toBe('1 second');
    // Shown: short, on one line.
    expect(waitTime(t, 119_000)).toBe('1\u00a0min\u00a059\u00a0s');
  });

  it('says the wait in English the same way', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    await storeLockout({ failures: 6, lockedUntil: Date.now() + 45_000 });
    await renderApp({ settings: { ...woman, lang: 'en' }, locked: true });

    const field = await screen.findByLabelText('Code');
    expect(field).toHaveAccessibleDescription('Too many tries. Wait 45\u00a0s, then try again.');
    const status = within(screen.getByRole('main')).getByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe('Too many tries. Wait 45 seconds, then try again.');
    });
    const keypad = screen.getByRole('group', { name: 'Code keypad' });
    expect(within(keypad).getByRole('button', { name: 'Delete the last digit' })).toHaveTextContent(
      /^Delete$/,
    );
  });

  it('says the time left of a wait to a screen reader after a reload, as the screen shows it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    // A 60 second wait (six wrong codes), the page loaded again 46 seconds into it.
    await storeLockout({ failures: 6, lockedUntil: Date.now() + 14_000 });
    await renderApp({ settings: woman, locked: true });

    const field = await screen.findByLabelText('Code');
    expect(field).toHaveAccessibleDescription(
      "Trop d'essais. Attendez 14\u00a0s, puis essayez encore.",
    );
    const status = within(screen.getByRole('main')).getByRole('status');
    // Empty when the screen appears, then filled, so a screen reader reads it.
    expect(status).toHaveTextContent('');
    await waitFor(() => {
      expect(status.textContent).toBe("Trop d'essais. Attendez 14 secondes, puis essayez encore.");
    });
    expect(document.body.textContent).not.toContain('1 minute');
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
