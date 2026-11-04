// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listProfiles, saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp } from '../test/render-app.js';

// Whole journeys (search, confirm, back to the check) through the real pack: on a
// loaded machine with coverage they take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

beforeEach(() => {
  // Only the clock: IndexedDB and user events keep their real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openCheckFromHome(settings: Settings = woman) {
  const probe = probeCheck();
  await renderApp({ settings, hash: '#/', packLoader: loaderOf(pack), children: probe.element });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Regarder un produit' }));
  return { user, probe };
}

/** Adds an item through the search and confirm screens, as the user does. */
async function addThrough(
  user: ReturnType<typeof userEvent.setup>,
  list: 'Ajouter un médicament' | 'Ajouter un remède',
  query: string,
) {
  await user.click(await screen.findByRole('button', { name: list }));
  await user.type(await screen.findByRole('searchbox'), query);
  const candidates = await screen.findByRole('list');
  await user.click(within(candidates).getAllByRole('button')[0] as HTMLElement);
  await user.click(await screen.findByRole('button', { name: /^Oui, c'est ce/ }));
  await screen.findByRole('button', { name: 'Voir le résultat' });
}

describe('Check', () => {
  it('opens from Home for her profile, empty, with the result out of reach until an item is added', async () => {
    await saveProfile(profileOf());
    await openCheckFromHome();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/check');
    const result = screen.getByRole('button', { name: 'Voir le résultat' });
    expect(result).toBeDisabled();
    expect(result).toHaveClass('button--primary');
    expect(result).toHaveAccessibleDescription(
      "Rien n'est encore ajouté. Ajoutez au moins un produit pour voir le résultat.",
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ajouter un médicament' })).toHaveClass(
      'button--secondary',
    );
    expect(screen.getByRole('button', { name: 'Ajouter un remède' })).toHaveClass(
      'button--secondary',
    );
  });

  it('opens the profile screen first when there is no profile, then comes back to the check', async () => {
    const { user, probe } = await openCheckFromHome();

    expect(await screen.findByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
    await user.click(
      within(screen.getByRole('group', { name: /^Enceinte/ })).getByRole('radio', { name: 'Oui' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Je ne sais pas' }));
    await user.click(
      within(screen.getByRole('group', { name: /^Allaite/ })).getByRole('radio', { name: 'Non' }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    const [saved] = await listProfiles();
    await waitFor(() => {
      expect(probe.current().profileId).toBe(saved?.id);
    });
  });

  it('is for the profile saved last in accompanied mode, and names it', async () => {
    await saveProfile(
      profileOf({ id: 'a', pseudonym: 'Awa', updatedAt: '2026-11-01T08:00:00.000Z' }),
    );
    await saveProfile(
      profileOf({ id: 'b', pseudonym: 'Fatou', updatedAt: '2026-11-03T08:00:00.000Z' }),
    );
    const { probe } = await openCheckFromHome(accompanied);

    expect(
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" }),
    ).toBeVisible();
    // Text matchers read the no-break space before the colon as a space.
    expect(await screen.findByText('Profil : Fatou')).toBeVisible();
    expect(probe.current().profileId).toBe('b');
  });

  it('lists each item added with its substances and units, and removes one', async () => {
    await saveProfile(profileOf());
    const { user, probe } = await openCheckFromHome();
    await addThrough(user, 'Ajouter un médicament', 'paracetamol 500');
    await addThrough(user, 'Ajouter un remède', 'kinkeliba');

    const list = screen.getByRole('list', { name: 'Produits ajoutés' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Paracétamol 500 mg (générique)');
    expect(rows[0]).toHaveTextContent('Paracétamol 500 mg');
    expect(rows[1]).toHaveTextContent('Kinkéliba');
    expect(rows[1]).toHaveTextContent('Combretum micranthum');
    expect(screen.getByRole('button', { name: 'Voir le résultat' })).toBeEnabled();

    await user.click(
      screen.getByRole('button', { name: 'Retirer Paracétamol 500 mg (générique) de la liste' }),
    );

    expect(probe.current().items).toEqual([{ ref: { kind: 'plant', id: 'kinkeliba' } }]);
    expect(screen.getByRole('button', { name: 'Retirer Kinkéliba de la liste' })).toHaveFocus();
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
      'Paracétamol 500 mg (générique) est retiré de la liste.',
    );

    await user.click(screen.getByRole('button', { name: 'Retirer Kinkéliba de la liste' }));
    expect(screen.getByRole('button', { name: 'Ajouter un médicament' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Voir le résultat' })).toBeDisabled();
  });

  it('says what was just added, and puts a removed item back at its place', async () => {
    await saveProfile(profileOf());
    const { user, probe } = await openCheckFromHome();
    await addThrough(user, 'Ajouter un médicament', 'paracetamol 500');
    const status = () => within(screen.getByRole('main')).getByRole('status');
    await waitFor(() => {
      expect(status()).toHaveTextContent('Paracétamol 500 mg (générique) est ajouté à la liste.');
    });
    await addThrough(user, 'Ajouter un remède', 'kinkeliba');
    await waitFor(() => {
      expect(status()).toHaveTextContent('Kinkéliba est ajouté à la liste.');
    });

    await user.click(
      screen.getByRole('button', { name: 'Retirer Paracétamol 500 mg (générique) de la liste' }),
    );
    expect(status()).toHaveTextContent('Paracétamol 500 mg (générique) est retiré de la liste.');
    await user.click(screen.getByRole('button', { name: 'Remettre dans la liste' }));

    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'paracetamol-500-generic' } },
      { ref: { kind: 'plant', id: 'kinkeliba' } },
    ]);
    expect(status()).toHaveTextContent('Paracétamol 500 mg (générique) est remis dans la liste.');
    expect(
      screen.getByRole('button', { name: 'Retirer Paracétamol 500 mg (générique) de la liste' }),
    ).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Remettre dans la liste' })).toBeNull();
  });

  it('says an added item once: not again when Home opens the check again', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'Ajouter un remède', 'kinkeliba');
    await screen.findByText('Kinkéliba est ajouté à la liste.');

    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Carnet' }));
    await user.click(await screen.findByRole('button', { name: 'Regarder un produit' }));

    expect(await screen.findByText('Kinkéliba')).toBeVisible();
    expect(screen.queryByText('Kinkéliba est ajouté à la liste.')).toBeNull();
  });

  it('keeps the check when Home opens it again for the same profile', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'Ajouter un remède', 'kinkeliba');

    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Carnet' }));
    await user.click(await screen.findByRole('button', { name: 'Regarder un produit' }));

    expect(await screen.findByText('Kinkéliba')).toBeVisible();
  });

  it('goes back to Home, not to the search, after an item is added', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'Ajouter un remède', 'kinkeliba');

    window.history.back();

    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  });
});

describe('Check to result', () => {
  it('shows the level the engine gives for the confirmed items', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'Ajouter un remède', 'kinkeliba');
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    // Kinkeliba has no rule and evidence 0: we do not know, never reassurance.
    expect(await screen.findByRole('article', { name: 'On ne sait pas. Kinkéliba' })).toHaveClass(
      'level--unknown',
    );
  });
});
