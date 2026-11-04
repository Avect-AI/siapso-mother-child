// SPDX-License-Identifier: MIT
import type { DangerSign } from '@siapso/engine';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hangIndexedDB } from '../test/idb.js';
import { loaderOf, noPack, pendingPack, renderApp, shellPack } from '../test/render-app.js';

const signs: DangerSign[] = [
  { id: 'bleeding', group: 'pregnancy', label: { fr: 'Saignement', en: 'Bleeding' }, sources: [] },
  { id: 'fever', group: 'baby', label: { fr: 'Fièvre du bébé', en: 'Baby fever' }, sources: [] },
];

const missingFr = "La liste des signes de danger n'est pas encore sur ce téléphone.";
const missingEn = 'The list of danger signs is not on this phone yet.';
const emptyEn = 'The list of danger signs has not been added yet.';

describe('Danger signs', () => {
  it('says when to go to the health post, then lists the pack danger signs', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'accompanied', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(shellPack(signs)),
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Danger signs' })).toBeVisible();
    expect(screen.getByText('If you see a danger sign:')).toBeVisible();
    expect(screen.getByText('Go to the health post now.')).toBeVisible();
    const list = await screen.findByRole('list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Bleeding', 'Baby fever']);
    expect(screen.queryByText(missingEn)).toBeNull();
    expect(screen.queryByText(emptyEn)).toBeNull();
    expect(screen.getByRole('link', { name: 'Danger signs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('while the pack is loading, shows the orientation and claims nothing about the list', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: pendingPack,
    });

    expect(await screen.findByText('Go to the health post now.')).toBeVisible();
    expect(screen.getByText('If you see a danger sign:')).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(missingEn)).toBeNull();
    expect(screen.queryByText(emptyEn)).toBeNull();
  });

  it('says the list is not on the phone when no pack could be loaded', async () => {
    await renderApp({
      settings: { lang: 'fr', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: noPack,
    });

    expect(await screen.findByText(missingFr)).toBeVisible();
    // Testing Library turns the no-break space before ":" into a plain space when it reads the page.
    expect(screen.getByText('Si vous voyez un signe de danger :')).toBeVisible();
    expect(screen.getByText('Allez au poste de santé maintenant.')).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says the list has not been added yet when the loaded pack has no danger sign', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(shellPack([])),
    });

    expect(await screen.findByText(emptyEn)).toBeVisible();
    expect(screen.queryByText(missingEn)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('opens before the welcome questions are answered', async () => {
    await renderApp({ hash: '#/danger' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Signes de danger' }),
    ).toBeVisible();
    expect(screen.getByRole('banner')).toBeVisible();
  });

  it('opens at once, without waiting for storage that does not answer', async () => {
    hangIndexedDB();
    await renderApp({ hash: '#/danger', storageTimeoutMs: 60_000 });

    expect(screen.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
    expect(screen.getByText('Allez au poste de santé maintenant.')).toBeVisible();
  });
});
