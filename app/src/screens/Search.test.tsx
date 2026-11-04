// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, noPack, renderApp } from '../test/render-app.js';

// Whole journeys (search, confirm, back to the check) through the real pack: on a
// loaded machine with coverage they take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Opens the check, then the search of one list, as the user does. */
async function openSearch(list: 'Ajouter un médicament' | 'Ajouter un remède', settings = woman) {
  await saveProfile(profileOf());
  const probe = probeCheck();
  await renderApp({
    settings,
    hash: '#/check',
    packLoader: loaderOf(pack),
    children: probe.element,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: list }));
  const field = await screen.findByRole('searchbox');
  return { user, field, probe };
}

function candidates() {
  const list = screen.queryByRole('list');
  return list ? within(list).getAllByRole('button') : [];
}

describe('Search', () => {
  it('opens on the list chosen, with one large field and its hint', async () => {
    const { field } = await openSearch('Ajouter un remède');

    expect(screen.getByRole('heading', { level: 1, name: 'Ajouter un remède' })).toBeVisible();
    expect(field).toHaveAccessibleName('Nom du remède');
    expect(field).toHaveAccessibleDescription('En français ou en wolof, même avec des fautes.');
    expect(window.location.hash).toBe('#/search/plant');
  });

  it('shows Moringa first for its Wolof name, with the local name and its language', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'nebeday');

    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
    const first = candidates()[0];
    expect(first).toHaveTextContent('Moringa oleifera');
    expect(first).toHaveTextContent('Nom local : nebeday (wolof)');
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
      'Choisissez celui qui correspond.',
    );
  });

  it('shows a product with paracetamol in its detail for doliprane, and still for doliprann', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'doliprane');

    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent('DOLIPRANE');
    });
    expect(candidates()[0]).toHaveTextContent('Paracétamol');
    // No strength the user did not type: the brand stands for its strengths.
    expect(candidates()[0]).not.toHaveTextContent(/\d+ mg/);

    await user.clear(field);
    await user.type(field, 'doliprann');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent('DOLIPRANE');
    });
    expect(candidates()[0]).toHaveTextContent('Paracétamol');
  });

  it('names the strength typed in the query', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'doliprane 1000');

    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent('DOLIPRANE 1000 mg');
    });
    expect(candidates()[0]).toHaveTextContent('Paracétamol 1000 mg');
  });

  it('proposes at most three candidates, in the list searched only', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'acide');

    await waitFor(() => {
      expect(candidates().length).toBeGreaterThan(0);
    });
    expect(candidates().length).toBeLessThanOrEqual(3);
  });

  it('waits for a pause in typing before it searches', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'nebeday');

    // Typed at once: the candidates follow only after the pause.
    expect(screen.queryByRole('list')).toBeNull();
    expect(await screen.findByRole('list')).toBeVisible();
  });

  it('says when no product matches, and still offers the text typed', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'zzzzqx');

    expect(await screen.findByText('Aucun produit ne correspond à ce nom.')).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: 'Je ne trouve pas ce produit' })).toBeVisible();
  });

  it('says what "not found" does, and keeps it quiet while a candidate is on offer', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'nebeday');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });

    const notFound = screen.getByRole('button', { name: 'Je ne trouve pas ce remède' });
    expect(notFound).toHaveClass('button--quiet');
    expect(notFound).toHaveAccessibleDescription(
      "Il sera ajouté tel qu'il est écrit, comme remède non reconnu.",
    );

    await user.clear(field);
    await user.type(field, 'zzzzqx');
    expect(await screen.findByText('Aucun remède ne correspond à ce nom.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Je ne trouve pas ce remède' })).toHaveClass(
      'button--secondary',
    );
  });

  it('tells a screen reader how many candidates there are and the first one', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'nebeday');

    const status = within(screen.getByRole('main')).getByRole('status');
    await waitFor(() => {
      expect(status).toHaveTextContent(
        /^(Une proposition|\d propositions, la première) : Moringa\. Choisissez celui qui correspond\.$/,
      );
    });
  });

  it('names the list of candidates', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'nebeday');

    expect(await screen.findByRole('list', { name: 'Propositions' })).toBeVisible();
  });

  it('says a text typed in the remedies is a remedy not recognised', async () => {
    const { user, field, probe } = await openSearch('Ajouter un remède');
    await user.type(field, 'feuilles du marché');
    await user.click(await screen.findByRole('button', { name: 'Je ne trouve pas ce remède' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'unrecognised', text: 'feuilles du marché' } },
    ]);
    expect(screen.getByText('Remède non reconnu')).toBeVisible();
    expect(screen.queryByText('Produit non reconnu')).toBeNull();
  });

  it('preselects from the text the candidate was found by, not text typed since', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'doliprane 1000');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent('DOLIPRANE 1000 mg');
    });
    // Typed after the list showed and chosen at once, before the pause that
    // searches again: the candidate still comes from "doliprane 1000".
    fireEvent.change(field, { target: { value: 'doliprane 10000' } });
    fireEvent.click(candidates()[0] as HTMLElement);

    const checked = (await screen.findAllByRole('radio')).filter(
      (radio) => (radio as HTMLInputElement).checked,
    );
    expect(checked.map((radio) => radio.getAttribute('value'))).toEqual([
      expect.stringMatching(/^doliprane-1000-mg-/),
    ]);
  });

  it('offers no "not found" before anything is typed', async () => {
    await openSearch('Ajouter un médicament');

    expect(screen.queryByRole('button', { name: 'Je ne trouve pas ce produit' })).toBeNull();
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent('');
  });

  it('adds the text typed as an unrecognised item, and goes back to the check', async () => {
    const { user, field, probe } = await openSearch('Ajouter un médicament');
    await user.type(field, '  poudre du marché ');
    await user.click(screen.getByRole('button', { name: 'Je ne trouve pas ce produit' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'unrecognised', text: 'poudre du marché' } },
    ]);
    expect(screen.getByText('poudre du marché')).toBeVisible();
    expect(screen.getByText('Produit non reconnu')).toBeVisible();
  });

  it('adds nothing when a candidate is chosen: the confirm screen opens', async () => {
    const { user, field, probe } = await openSearch('Ajouter un remède');
    await user.type(field, 'nebeday');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
    await user.click(candidates()[0] as HTMLElement);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Est-ce bien ce remède ?' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/confirm/plant/moringa');
    expect(probe.current().items).toEqual([]);
  });

  it('opens the best candidate from the keyboard with Enter', async () => {
    const { user, field, probe } = await openSearch('Ajouter un remède');
    await user.type(field, 'kinkeliba{Enter}');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Est-ce bien ce remède ?' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/confirm/plant/kinkeliba');
    expect(probe.current().items).toEqual([]);
  });

  it('offers the other list when the name is only found there, keeping the text', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'kinkeliba');

    // In the live region, after "no product matches", so a screen reader hears the way out too.
    expect(
      await screen.findByText(
        'Aucun produit ne correspond à ce nom. Ce nom correspond à un remède.',
      ),
    ).toBe(within(screen.getByRole('main')).getByRole('status'));
    await user.click(screen.getByRole('button', { name: 'Chercher parmi les remèdes' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajouter un remède' }),
    ).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('kinkeliba');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Kinkéliba/);
    });
  });

  it('keeps what was typed when coming back from the confirm screen', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'nebeday');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
    await user.click(candidates()[0] as HTMLElement);
    await user.click(await screen.findByRole('button', { name: 'Non, chercher encore' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajouter un remède' }),
    ).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('nebeday');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
  });

  it('says the product information is missing, and still takes the text typed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await saveProfile(profileOf());
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/search/product',
      packLoader: noPack,
      children: probe.element,
    });
    const user = userEvent.setup();

    expect(
      await screen.findByText(/^Les informations sur les produits ne sont pas encore/),
    ).toBeVisible();
    await user.type(screen.getByRole('searchbox'), 'doliprane');
    await user.click(screen.getByRole('button', { name: 'Je ne trouve pas ce produit' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([{ ref: { kind: 'unrecognised', text: 'doliprane' } }]);
  });
});
