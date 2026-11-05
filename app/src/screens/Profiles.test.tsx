// SPDX-License-Identifier: MIT
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { enterCode } from '../test/code-steps.js';
import { profileOf } from '../test/knowledge-pack.js';
import { renderApp } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };

describe('Profiles', () => {
  it('lists the women by pseudonym, each with a way to her profile, and adds one', async () => {
    for (const [id, pseudonym] of [
      ['a', 'Femme 10'],
      ['b', 'Awa'],
      ['c', 'Femme 2'],
    ] as const) {
      await saveProfile(profileOf({ id, pseudonym }));
    }
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/' });

    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    const rows = within(list).getAllByRole('listitem');
    // In the order of the pseudonyms, numbers read as numbers.
    expect(rows.map((row) => within(row).getAllByRole('button')[0]?.textContent)).toEqual([
      'Awa',
      'Femme 2',
      'Femme 10',
    ]);
    expect(within(list).getByRole('link', { name: 'Modifier le profil de Awa' })).toHaveAttribute(
      'href',
      '#/profile/b',
    );
    const add = screen.getByRole('button', { name: 'Ajouter un profil' });
    expect(add).toHaveClass('button--primary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);

    await user.click(add);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nouveau profil' })).toBeVisible();
  });

  it('says when there is no profile yet', async () => {
    await renderApp({ settings: accompanied, hash: '#/' });

    expect(await screen.findByText('Aucun profil sur ce téléphone pour le moment.')).toBeVisible();
    expect(screen.queryByRole('list', { name: /^Profils enregistrés/ })).toBeNull();
  });

  it('is never rendered while locked: the code first, then the list', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/', locked: true });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    expect(screen.queryByRole('list', { name: /^Profils enregistrés/ })).toBeNull();
    expect(document.body.textContent).not.toContain('Awa');

    await enterCode(user);
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    expect(within(list).getByRole('button', { name: 'Awa' })).toBeVisible();
  });
});
