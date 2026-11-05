// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isIsoDate } from '../domain/dates.js';
import type { Settings } from '../domain/types.js';
import { knowledgePack } from '../test/knowledge-pack.js';
import { loaderOf, noPack, pendingPack, renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
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
    expect(text).toContain(real.date);
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
    expect(screen.queryByText(/Base périmée/)).toBeNull();
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
    expect(screen.queryByText(/Base périmée/)).toBeNull();
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
        /^Base périmée\s: plus de 90 jours\. Faites-la mettre à jour au poste de santé\.$/,
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
    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  });
});
