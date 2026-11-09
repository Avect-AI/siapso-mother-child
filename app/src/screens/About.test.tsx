// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { INTENDED_USE } from '../domain/intended-use.js';
import type { Settings } from '../domain/types.js';
import { fr } from '../i18n/fr.js';
import { knowledgePack } from '../test/knowledge-pack.js';
import { loaderOf, noPack, renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const english: Settings = { ...woman, lang: 'en' };

let real: Pack;
beforeAll(async () => {
  real = await knowledgePack();
});

describe('About: an unsigned base (test or demo build)', () => {
  it('says so on a line of its own', async () => {
    await renderApp({
      settings: woman,
      hash: '#/about',
      packLoader: loaderOf(real, { origin: { signed: false, reason: 'the pack is not signed' } }),
    });

    expect(
      await screen.findByText('Version de test : base de connaissances non signée.'),
    ).toBeVisible();
  });

  it('says it whenever the build accepts unsigned packs', async () => {
    await renderApp({
      settings: woman,
      hash: '#/about',
      acceptsUnsigned: true,
      packLoader: loaderOf(real, { origin: { signed: true, keyId: 'team-1' } }),
    });

    expect(
      await screen.findByText('Version de test : base de connaissances non signée.'),
    ).toBeVisible();
  });

  it('says nothing of the kind for a signed base', async () => {
    await renderApp({
      settings: english,
      hash: '#/about',
      packLoader: loaderOf(real, { origin: { signed: true, keyId: 'team-1' } }),
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'About' })).toBeVisible();
    expect(screen.queryByText(/Test version/)).toBeNull();
  });
});

describe('About', () => {
  it('shows the intended use in French, the fixed sentence, the licences and the repository', async () => {
    await renderApp({ settings: woman, hash: '#/about', packLoader: loaderOf(real) });

    expect(await screen.findByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
    expect(screen.getByText(fr.about.intendedUse)).toBeVisible();
    // The French name of the app on a French screen (PRODUCT.md, Brand Commitments).
    expect(fr.about.intendedUse).toMatch(/^SIAPSO Mère-Enfant /);
    expect(document.body.textContent).not.toContain('Mother-Child');
    expect(screen.getByText('Cet outil ne remplace pas un soignant.')).toBeVisible();
    expect(screen.getByText(/licence MIT/)).toBeVisible();
    expect(screen.getByText(/CC BY 4\.0/)).toBeVisible();
    expect(screen.getByText(/SIL OFL 1\.1/)).toBeVisible();
    expect(screen.getByText('https://github.com/Avect-AI/siapso-mother-child')).toBeVisible();
    expect(
      screen.getByText('Le code source est public : chacun peut le lire et vérifier les règles.'),
    ).toBeVisible();
  });

  it('shows the intended use in English, identical to the shared source', async () => {
    await renderApp({ settings: english, hash: '#/about', packLoader: loaderOf(real) });

    expect(await screen.findByRole('heading', { level: 1, name: 'About' })).toBeVisible();
    expect(screen.getByText(INTENDED_USE)).toBeVisible();
    expect(screen.getByText('This tool does not take the place of a health worker.')).toBeVisible();
    expect(
      screen.getByText('The source code is public: anyone can read it and check the rules.'),
    ).toBeVisible();
  });

  it('lists every source of the pack with its licence, and a link when it has an address', async () => {
    await renderApp({ settings: woman, hash: '#/about', packLoader: loaderOf(real) });

    const list = await screen.findByRole('list', { name: 'Sources de la base' });
    const items = within(list).getAllByRole('listitem');
    expect(real.sources.length).toBeGreaterThan(0);
    expect(items).toHaveLength(real.sources.length);
    for (const [index, source] of real.sources.entries()) {
      const item = items[index];
      if (item === undefined) throw new Error('missing item');
      // In French on a French screen: name, licence and version.
      expect(source.fr).toBeDefined();
      expect(item.textContent).toContain(source.fr?.name);
      expect(item.textContent).toContain(source.fr?.licence);
      expect(item.textContent).toContain(source.fr?.version);
      // A source of English documents says so.
      expect(item.textContent.includes('(documents en anglais)')).toBe(source.documents === 'en');
    }
    // No English label as the screen's own words.
    for (const english of [
      'Peer-reviewed literature',
      'Public domain',
      'downloaded on',
      'Varies',
    ]) {
      expect(list.textContent).not.toContain(english);
    }
    // The download date written as the screen writes dates.
    expect(list.textContent).toContain('téléchargés le 04/11/2026');
    const linked = real.sources.filter((source) => /^https?:\/\//.test(source.url));
    for (const link of within(list).getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(within(list).queryAllByRole('link')).toHaveLength(linked.length);
  });

  it('keeps the English words of the sources on an English screen, and says which documents are French', async () => {
    await renderApp({ settings: english, hash: '#/about', packLoader: loaderOf(real) });

    const list = await screen.findByRole('list', { name: 'Sources of the base' });
    expect(within(list).getByText('Peer-reviewed literature')).toBeVisible();
    const bdpm = within(list)
      .getByText(/^Base de données publique des médicaments/)
      .closest('li');
    expect(bdpm).toHaveTextContent('(documents in French)');
    expect(bdpm).toHaveTextContent('downloaded on 4 November 2026');
  });

  it('says the links of the sources open with the Internet, and says nothing without a link', async () => {
    const { unmount } = await renderApp({
      settings: woman,
      hash: '#/about',
      packLoader: loaderOf(real),
    });
    expect(await screen.findByText("Ces liens s'ouvrent avec Internet.")).toBeVisible();
    unmount();

    const source = { id: 's', name: 'Offline source', licence: 'x', url: 'urn:no-link' };
    await renderApp({
      settings: woman,
      hash: '#/about',
      packLoader: loaderOf({ ...real, sources: [source] }),
    });
    await screen.findByRole('list', { name: 'Sources de la base' });
    expect(screen.queryByText("Ces liens s'ouvrent avec Internet.")).toBeNull();
  });

  it('does not make a link of an address that is not http or https', async () => {
    const source = { id: 's', name: 'Odd source', licence: 'x', url: 'javascript:alert(1)' };
    await renderApp({
      settings: woman,
      hash: '#/about',
      packLoader: loaderOf({ ...real, sources: [source] }),
    });
    const list = await screen.findByRole('list', { name: 'Sources de la base' });
    expect(within(list).getByText(/Odd source/)).toBeVisible();
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
  });

  it('says what third-party software is and is not in the app', async () => {
    await renderApp({ settings: woman, hash: '#/about', packLoader: loaderOf(real) });
    expect(await screen.findByText(/Transformers\.js \(licence Apache-2\.0\)/)).toBeVisible();
    // A development tool, not shipped: it is in the repository notices only.
    expect(document.body.textContent).not.toMatch(/impeccable/i);
  });

  it('says the sources cannot be listed when there is no pack', async () => {
    await renderApp({ settings: woman, hash: '#/about', packLoader: noPack });
    expect(await screen.findByText(/^La base de connaissances n'est pas chargée/)).toBeVisible();
    expect(screen.getByText(fr.about.intendedUse)).toBeVisible();
  });

  it('opens before the code and has no invented contact', async () => {
    await renderApp({ settings: woman, hash: '#/about', packLoader: loaderOf(real), locked: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/@|mailto:|\+221/);
  });

  it('has one primary action, back to the start, and a link to the status screen', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/about', packLoader: loaderOf(real) });
    await screen.findByRole('heading', { level: 1, name: 'À propos' });

    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Base de connaissances' })).toHaveAttribute(
      'href',
      '#/status',
    );
    await user.click(screen.getByRole('button', { name: "Revenir à l'accueil" }));
    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  });
});
