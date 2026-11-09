// SPDX-License-Identifier: MIT
// The end of the welcome when something got in the way: the app closed
// between the code and the end of the welcome, another tab made the code
// first, or the phone did not keep the code.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getStoredSettings, openAppDb, storeNewVerifier, storeSettings } from '../data/db.js';
import { enterCode, makeCode } from '../test/code-steps.js';
import { renderApp, storeTestCode } from '../test/render-app.js';
import { verifierOf } from '../test/verifier.js';

vi.setConfig({ testTimeout: 30_000 });
// Her check, the start in woman mode (SCRUM-56, S4); a no-break space before "?".
const START = 'Un médicament ou un remède\u00a0?';

/** How many reads of the settings never answer, as a slow storage (the reads of the code do). */
const hang = vi.hoisted(() => ({ settings: 0 }));

vi.mock('../data/db.js', async (importOriginal) => {
  const db = await importOriginal<typeof import('../data/db.js')>();
  return {
    ...db,
    getStoredSettings: () => {
      if (hang.settings === 0) return db.getStoredSettings();
      hang.settings -= 1;
      return new Promise<never>(() => undefined);
    },
  };
});

/** The settings as stored, read past the slow storage of the test. */
async function storedSettings() {
  const db = await vi.importActual<typeof import('../data/db.js')>('../data/db.js');
  return db.getStoredSettings();
}

describe('a welcome cut short', () => {
  it('keeps the language and the mode stored when only their first read gave up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // As the welcome left them: English, accompanied mode, her code; not ended.
    await storeSettings({ lang: 'en', mode: 'accompanied', onboarded: false });
    await storeTestCode();
    hang.settings = 1;
    const user = userEvent.setup();
    await renderApp({ locked: true, storageTimeoutMs: 300 });

    // The defaults meanwhile: the code screen in French.
    await enterCode(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Profiles' })).toBeVisible();
    await vi.waitFor(async () => {
      expect(await storedSettings()).toEqual({
        lang: 'en',
        mode: 'accompanied',
        onboarded: true,
      });
    });
    vi.restoreAllMocks();
  });

  it('stores nothing over the stored settings while they still cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await storeSettings({ lang: 'en', mode: 'accompanied', onboarded: false });
    await storeTestCode();
    hang.settings = 2;
    const user = userEvent.setup();
    await renderApp({ locked: true, storageTimeoutMs: 300 });

    await enterCode(user);

    // The welcome is over in this tab; the mode is asked again, nothing is stored.
    expect(
      await screen.findByRole('heading', { name: /^Qui utilise l'application/ }),
    ).toBeVisible();
    expect(await storedSettings()).toEqual({
      lang: 'en',
      mode: 'accompanied',
      onboarded: false,
    });
    vi.restoreAllMocks();
  });

  it('asks for the code stored, then the mode, then opens Home', async () => {
    // The app closed after the code was stored, before the welcome ended.
    await storeSettings({ lang: 'fr', mode: null, onboarded: false });
    await storeTestCode();
    const user = userEvent.setup();
    await renderApp({ locked: true });

    await enterCode(user);
    // A no-break space comes before "?": the accessible name keeps it.
    expect(
      await screen.findByRole('heading', { name: /^Qui utilise l'application/ }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Je suis enceinte/ }));

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: 'woman', onboarded: true });
  });

  it('with the mode already chosen, opens Home after the code and ends the welcome', async () => {
    await storeSettings({ lang: 'fr', mode: 'woman', onboarded: false });
    await storeTestCode();
    const user = userEvent.setup();
    await renderApp({ locked: true });

    await enterCode(user);

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    await vi.waitFor(async () => {
      expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: 'woman', onboarded: true });
    });
  });
});

describe('a code that could not be made', () => {
  it('says that a code already exists, on the code screen, when another tab made it first', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(await screen.findByRole('button', { name: /^Je suis enceinte/ }));
    // Meanwhile, another tab made her code.
    await storeNewVerifier(await verifierOf('2468'));

    await makeCode(user, '1397');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    // Testing Library reads the no-break space before ":" as a plain space.
    expect(
      screen.getByText(
        "Un code existe déjà sur ce téléphone : entrez-le pour ouvrir l'application.",
      ),
    ).toBeVisible();
  });

  it('says so when the phone did not keep the code, and lets her try again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    await renderApp();
    await user.click(await screen.findByRole('button', { name: /^Je suis enceinte/ }));
    const db = await openAppDb();
    const transaction = vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await makeCode(user, '1357');

    expect(
      await screen.findByRole('heading', { name: 'Choisissez un code de 4 chiffres' }),
    ).toBeVisible();
    // Said on the field, which starts again empty.
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
        /Le code n'a pas pu être enregistré sur ce téléphone\. Essayez encore\.$/,
      );
    });
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText('Code')).toBeEnabled();
    expect(screen.queryByRole('heading', { level: 1, name: START })).toBeNull();
    transaction.mockRestore();
  });
});
