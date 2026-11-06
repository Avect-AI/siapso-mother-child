// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatDate, isIsoDate } from '../domain/dates.js';
import type { Settings } from '../domain/types.js';
import { knowledgePack } from '../test/knowledge-pack.js';
import { loaderOf, noPack, pendingPack, renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
// Her check, the start in woman mode (SCRUM-56, S4); a no-break space before "?".
const START = 'Un médicament ou un remède\u00a0?';
const english: Settings = { ...woman, lang: 'en' };

let real: Pack;
beforeAll(async () => {
  real = await knowledgePack();
});

/** The real pack, dated `date`, validated or not. */
function packOf(date: string, clinicallyValidated = false): Pack {
  return { ...real, date, clinicallyValidated };
}

/** The phone's date, at noon local time. */
function today(year: number, month: number, day: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(year, month - 1, day, 12));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Status', () => {
  it('shows the version and the date of the loaded pack, and what it holds', async () => {
    await renderApp({ settings: woman, hash: '#/status', packLoader: loaderOf(real) });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Base de connaissances' }),
    ).toBeVisible();
    const facts = await screen.findByRole('list', { name: 'Contenu de la base' });
    const text = facts.textContent;
    expect(text).toContain(real.version);
    // The date written as on the result: day, month, year.
    expect(within(facts).getByText('Date de la base').nextSibling).toHaveTextContent(
      formatDate(real.date, 'fr'),
    );
    expect(text).not.toContain(real.date);
    expect(within(facts).getByText('Règles').nextSibling).toHaveTextContent(
      String(real.rules.length),
    );
    expect(within(facts).getByText('Produits').nextSibling).toHaveTextContent(
      String(real.products.length),
    );
    expect(within(facts).getByText('Remèdes').nextSibling).toHaveTextContent(
      String(real.plants.length),
    );
  });

  it('is built from a pack whose date is a valid calendar date', () => {
    expect(isIsoDate(real.date)).toBe(true);
  });

  it('says "Date inconnue" and gives no staleness warning for a date that is not a calendar date', async () => {
    today(2030, 1, 1);
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(packOf('2026-02-30')),
    });
    const facts = await screen.findByRole('list', { name: 'Contenu de la base' });
    expect(within(facts).getByText('Date inconnue')).toBeVisible();
    expect(screen.queryByText(/Base de connaissances ancienne/)).toBeNull();
  });

  it('counts the collections of the pack as built', async () => {
    const small = { ...real, rules: real.rules.slice(0, 3), products: real.products.slice(0, 2) };
    await renderApp({ settings: woman, hash: '#/status', packLoader: loaderOf(small) });
    const facts = await screen.findByRole('list', { name: 'Contenu de la base' });
    expect(within(facts).getByText('Règles').nextSibling).toHaveTextContent('3');
    expect(within(facts).getByText('Produits').nextSibling).toHaveTextContent('2');
  });

  it('says the content is not clinically validated, and says nothing when it is', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(packOf('2026-11-04')),
    });
    expect(await screen.findByText(/^Contenu non validé cliniquement/)).toBeVisible();
  });

  it('does not say it for a validated pack', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(packOf('2026-11-04', true)),
    });
    await screen.findByRole('list', { name: 'Contenu de la base' });
    expect(screen.queryByText(/non validé cliniquement/)).toBeNull();
  });

  it('warns strictly after 90 days: not at 90, yes at 91', async () => {
    today(2027, 2, 2);
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(packOf('2026-11-04')),
    });
    await screen.findByRole('list', { name: 'Contenu de la base' });
    expect(screen.queryByText(/Base de connaissances ancienne/)).toBeNull();
  });

  it('warns at 91 days, in French', async () => {
    today(2027, 2, 3);
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(packOf('2026-11-04')),
    });
    // Testing Library reads a no-break space as a space.
    expect(
      await screen.findByText(
        /^Base de connaissances ancienne\s: plus de 90 jours\. Faites-la mettre à jour au poste de santé\.$/,
      ),
    ).toBeVisible();
  });

  it('renders in English too', async () => {
    today(2027, 2, 3);
    await renderApp({
      settings: english,
      hash: '#/status',
      packLoader: loaderOf(packOf('2026-11-04')),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Knowledge base' })).toBeVisible();
    expect(screen.getByText(/^Knowledge base out of date: more than 90 days old/)).toBeVisible();
    expect(screen.getByText(/^Content not clinically validated/)).toBeVisible();
    expect(screen.getByText('Rules')).toBeVisible();
    // The date as the English result writes it.
    expect(screen.getByText('4 November 2026')).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
  });

  it('says the pack was loaded with the app', async () => {
    await renderApp({ settings: woman, hash: '#/status', packLoader: loaderOf(real) });
    expect(
      await screen.findByText(/^Cette base est celle chargée avec l'application/),
    ).toBeVisible();
    expect(screen.queryByText(/n'a pas pu garder/)).toBeNull();
  });

  it('says the stored copy is used, and why in plain words', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(real, { source: 'cache', fallbackReason: 'HTTP 503' }),
    });
    expect(
      await screen.findByText('Cette base est la copie gardée sur ce téléphone.'),
    ).toBeVisible();
    expect(screen.getByText(/La copie gardée sur ce téléphone est utilisée/)).toBeVisible();
    // The technical reason is not shown.
    expect(document.body.textContent).not.toContain('503');
  });

  it('says plainly when the pack could not be stored on the phone', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      // The rejection is made when the loader runs, so it never goes unhandled.
      packLoader: () => loaderOf(real, { stored: Promise.reject(new Error('quota')) })(),
    });
    expect(await screen.findByText(/Ce téléphone n'a pas pu garder cette base/)).toBeVisible();
    expect(document.body.textContent).not.toContain('quota');
  });

  it('says so when there is no pack, and while it loads', async () => {
    await renderApp({ settings: woman, hash: '#/status', packLoader: noPack });
    expect(await screen.findByText(/n'est pas encore sur ce téléphone/)).toBeVisible();
  });

  it('waits for the pack without a message of failure', async () => {
    await renderApp({ settings: woman, hash: '#/status', packLoader: pendingPack });
    expect(await screen.findByText('La base de connaissances se charge.')).toBeVisible();
    expect(screen.queryByText(/pas encore sur ce téléphone/)).toBeNull();
  });

  it('opens before the code and shows no profile', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(real),
      locked: true,
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Base de connaissances' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Entrez votre code' })).toBeNull();
    // No quick exit: the session is locked; the danger signs shortcut stays.
    expect(screen.getByRole('link', { name: 'Signes de danger' })).toBeVisible();
  });

  it('has one primary action, back to the start, and a link to the about screen', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/status', packLoader: loaderOf(real) });
    await screen.findByRole('list', { name: 'Contenu de la base' });

    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'À propos' })).toHaveAttribute('href', '#/about');
    await user.click(screen.getByRole('button', { name: "Revenir à l'accueil" }));
    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
  });

  it('says whether this phone opens the app without the Internet, pack or not', async () => {
    await renderApp({ settings: woman, hash: '#/status', packLoader: noPack });

    const phone = await screen.findByRole('region', { name: 'Sur ce téléphone' });
    // The test browser has no service worker.
    expect(
      within(phone).getByText(
        "Ce navigateur ne peut pas garder l'application pour l'ouvrir sans Internet. Ouvrez-la dans Chrome.",
      ),
    ).toBeVisible();
  });
});

const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const UNSIGNED = 'Version de test : base de connaissances non signée.';

describe('Status: where the copy comes from', () => {
  it('says a new base was refused, and gives the reason in accompanied mode only', async () => {
    const refused = loaderOf(real, {
      source: 'cache',
      fallback: 'refused',
      fallbackReason: 'manifest.sig: the signature does not match manifest.json (key "team-1")',
    });

    await renderApp({ settings: accompanied, hash: '#/status', packLoader: refused });

    expect(
      await screen.findByText(/Une nouvelle base a été refusée par ce téléphone/),
    ).toBeVisible();
    // Said in English: labelled as such on a French screen.
    expect(
      screen.getByText(/Détail technique \(en anglais\)\s: manifest\.sig: the signature/),
    ).toBeVisible();
  });

  it('keeps the reason out of woman mode', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(real, {
        source: 'cache',
        fallback: 'refused',
        fallbackReason: 'manifest.sig: the signature does not match',
      }),
    });

    expect(await screen.findByText(/Une nouvelle base a été refusée/)).toBeVisible();
    expect(screen.queryByText(/Détail technique/)).toBeNull();
  });

  it('says the base could not be loaded when the phone is offline', async () => {
    await renderApp({
      settings: accompanied,
      hash: '#/status',
      packLoader: loaderOf(real, {
        source: 'cache',
        fallback: 'offline',
        fallbackReason: 'manifest.json: Failed to fetch',
      }),
    });

    expect(
      await screen.findByText(/La base n'a pas pu être chargée avec l'application/),
    ).toBeVisible();
    expect(screen.queryByText(/a été refusée/)).toBeNull();
  });

  it('says the previous version was put back after a rollback', async () => {
    await renderApp({
      settings: accompanied,
      hash: '#/status',
      packLoader: loaderOf(real, {
        source: 'cache',
        fallback: 'rolled-back',
        fallbackReason: 'manifest.json: version 0.2.0 was rolled back on this device',
      }),
    });

    expect(
      await screen.findByText(/La version précédente a été remise sur ce téléphone/),
    ).toBeVisible();
    expect(screen.queryByText(/n'a pas pu être chargée/)).toBeNull();
  });
});

describe('Status: an unsigned base (test or demo build)', () => {
  it('says so on a line of its own, in French and in English', async () => {
    const unsigned = loaderOf(real, {
      origin: { signed: false, reason: 'the pack is not signed' },
    });

    await renderApp({ settings: woman, hash: '#/status', packLoader: unsigned });
    expect(await screen.findByText(UNSIGNED)).toBeVisible();
  });

  it('says it in English too', async () => {
    await renderApp({
      settings: english,
      hash: '#/status',
      packLoader: loaderOf(real, { origin: { signed: false, reason: 'the pack is not signed' } }),
    });
    expect(await screen.findByText('Test version: unsigned knowledge base.')).toBeVisible();
  });

  it('says nothing of the kind for a signed base in a release build', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(real, { origin: { signed: true, keyId: 'team-1' } }),
    });
    await screen.findByRole('list', { name: 'Contenu de la base' });
    expect(screen.queryByText(UNSIGNED)).toBeNull();
  });

  it('says it whenever the build accepts unsigned packs, even with a signed base', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      acceptsUnsigned: true,
      packLoader: loaderOf(real, { origin: { signed: true, keyId: 'team-1' } }),
    });

    expect(await screen.findByText(UNSIGNED)).toBeVisible();
  });

  it('says it in a build that accepts unsigned packs even before a base is loaded', async () => {
    await renderApp({
      settings: woman,
      hash: '#/status',
      acceptsUnsigned: true,
      packLoader: noPack,
    });

    expect(await screen.findByText(UNSIGNED)).toBeVisible();
  });
});

describe('Status: going back to the previous version', () => {
  // Built when called: the real pack is only loaded in beforeAll.
  const restored = () =>
    Promise.resolve({
      pack: { ...real, version: '0.0.9' },
      source: 'cache' as const,
      fallbackReason: null,
      fallback: 'rolled-back' as const,
      stored: Promise.resolve('stored' as const),
    });
  const kept = () => Promise.resolve('0.0.9');

  it('asks to confirm, then puts the previous version back at once', async () => {
    const user = userEvent.setup();
    // As on the phone: once rolled back, no previous version is kept.
    let keptVersion: string | null = '0.0.9';
    const packRollback = vi.fn(() => {
      keptVersion = null;
      return restored();
    });
    const packPrevious = vi.fn(() => Promise.resolve(keptVersion));
    await renderApp({
      settings: accompanied,
      hash: '#/status',
      packLoader: loaderOf(real),
      packPrevious,
      packRollback,
    });

    await user.click(await screen.findByRole('button', { name: 'Revenir à la version 0.0.9' }));
    expect(
      screen.getByText(/sera retirée de ce téléphone et la version 0\.0\.9 reprise/),
    ).toBeVisible();
    expect(packRollback).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Oui, revenir à la version 0.0.9' }));

    expect(packRollback).toHaveBeenCalledTimes(1);
    const facts = await screen.findByRole('list', { name: 'Contenu de la base' });
    await waitFor(() => {
      expect(facts).toHaveTextContent('0.0.9');
    });
    expect(screen.getByText(/La version précédente a été remise/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Revenir à la version/ })).toBeNull();
  });

  it('changes nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const packRollback = vi.fn(restored);
    await renderApp({
      settings: accompanied,
      hash: '#/status',
      packLoader: loaderOf(real),
      packPrevious: kept,
      packRollback,
    });

    await user.click(await screen.findByRole('button', { name: 'Revenir à la version 0.0.9' }));
    await user.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(packRollback).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Revenir à la version 0.0.9' })).toBeVisible();
  });

  it('says plainly when it did not work, with the reason, and keeps the current base', async () => {
    const user = userEvent.setup();
    await renderApp({
      settings: accompanied,
      hash: '#/status',
      packLoader: loaderOf(real),
      packPrevious: kept,
      packRollback: () => Promise.reject(new Error('The previous pack is not valid: pack.schema')),
    });

    await user.click(await screen.findByRole('button', { name: 'Revenir à la version 0.0.9' }));
    await user.click(screen.getByRole('button', { name: 'Oui, revenir à la version 0.0.9' }));

    expect(
      await screen.findByText(/Le retour à la version précédente n'a pas marché/),
    ).toBeVisible();
    expect(
      screen.getByText(/Détail technique \(en anglais\)\s: The previous pack is not valid/),
    ).toBeVisible();
    expect(screen.getByRole('list', { name: 'Contenu de la base' })).toHaveTextContent(
      real.version,
    );
  });

  it('is not offered when no previous version is kept', async () => {
    await renderApp({ settings: accompanied, hash: '#/status', packLoader: loaderOf(real) });
    await screen.findByRole('list', { name: 'Contenu de la base' });

    expect(screen.queryByRole('heading', { name: 'Version précédente' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revenir à la version/ })).toBeNull();
  });

  it('is not offered in woman mode, and the previous version is not even read', async () => {
    const packPrevious = vi.fn(kept);
    await renderApp({
      settings: woman,
      hash: '#/status',
      packLoader: loaderOf(real),
      packPrevious,
    });
    await screen.findByRole('list', { name: 'Contenu de la base' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: /Revenir à la version/ })).toBeNull();
    expect(packPrevious).not.toHaveBeenCalled();
  });

  it('reads the previous version once Status opens in accompanied mode, not before', async () => {
    const packPrevious = vi.fn(kept);
    await renderApp({
      settings: accompanied,
      hash: '#/settings',
      packLoader: loaderOf(real),
      packPrevious,
    });
    await screen.findByRole('heading', { level: 1 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(packPrevious).not.toHaveBeenCalled();

    window.location.hash = '#/status';

    expect(await screen.findByRole('button', { name: 'Revenir à la version 0.0.9' })).toBeVisible();
    expect(packPrevious).toHaveBeenCalledTimes(1);
  });

  it('is not offered before the code', async () => {
    await renderApp({
      settings: accompanied,
      hash: '#/status',
      packLoader: loaderOf(real),
      packPrevious: kept,
      locked: true,
    });
    await screen.findByRole('list', { name: 'Contenu de la base' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: /Revenir à la version/ })).toBeNull();
  });
});
