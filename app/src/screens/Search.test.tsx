// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { inSession, sessionState } from '../state/entry-state.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, noPack, renderApp, storeTestCode } from '../test/render-app.js';
import { openSearchScreen } from '../test/search-screen.js';
import { navigate } from 'wouter/use-hash-location';
import { SEARCH_DEBOUNCE_MS } from './Search.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

// Whole journeys (search, confirm, back to the check) through the real pack: on a
// loaded machine with coverage they take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const NBSP = ' ';
const LOOKALIKE = `Ce nom ressemble à${NBSP}:`;
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

afterEach(() => {
  vi.useRealTimers();
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
  await openSearchScreen(list);
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
    // Read with Wolof and Latin rules, not French ones (WCAG 3.1.2).
    expect(within(first as HTMLElement).getByText('nebeday')).toHaveAttribute('lang', 'wo');
    expect(within(first as HTMLElement).getByText('Moringa oleifera')).toHaveAttribute(
      'lang',
      'la',
    );
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
      'Choisissez celui qui correspond.',
    );
  });

  it('calls a French name another name, never a local name', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'argile');

    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent('Autre nom : argile');
    });
    expect(candidates()[0]).not.toHaveTextContent('Nom local');
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
    const { field } = await openSearch('Ajouter un remède');
    // The pause on the test's own clock: on a loaded machine a key can take
    // longer than the pause itself, and the list would show while typing.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const wait = (ms: number) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    };

    // Each key starts the pause again: nothing while she types, a key every 100 ms.
    for (const typed of ['n', 'ne', 'neb', 'nebe', 'nebed', 'nebeda', 'nebeday']) {
      fireEvent.change(field, { target: { value: typed } });
      wait(100);
      expect(screen.queryByRole('list'), typed).toBeNull();
    }
    wait(SEARCH_DEBOUNCE_MS - 101);
    expect(screen.queryByRole('list')).toBeNull();
    // The pause is over: the candidates follow.
    wait(1);
    expect(screen.getByRole('list')).toBeVisible();
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
    // On the list, quoted: her words, never a name the app confirmed.
    const name = screen.getByText('« poudre du marché »');
    expect(name).toBeVisible();
    expect(name).toHaveClass('typed');
    expect(screen.getByText('Produit non reconnu')).toBeVisible();
    // The line that says it was added quotes it too.
    await waitFor(() => {
      expect(document.querySelector('.check__status')).toHaveTextContent(
        '« poudre du marché » est ajouté à la liste.',
      );
    });
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
    expect(window.location.hash).toBe('#/confirm/plant');
    expect(sessionState()).toMatchObject({ id: 'moringa' });
    expect(probe.current().items).toEqual([]);
  });

  it('never brings back a name typed before a lock, and takes it off the history entry', async () => {
    await saveProfile(profileOf());
    await renderApp({
      settings: woman,
      hash: '#/search/product',
      packLoader: loaderOf(pack),
      entryState: { query: 'efavirenz', stepsToCheck: 1, visit: 'a visit', epoch: 'before a lock' },
    });

    expect(await screen.findByRole('searchbox')).toHaveValue('');
    // The screen's effect rewrites its entry just after the field shows.
    await waitFor(() => {
      expect(JSON.stringify(window.history.state)).not.toContain('efavirenz');
    });
    // A name typed in this session is kept on the entry, with its epoch.
    window.history.replaceState(inSession({ query: 'doliprane' }), '');
    expect(sessionState()).toMatchObject({ query: 'doliprane' });
  });

  it('opens the best candidate from the keyboard with Enter', async () => {
    const { user, field, probe } = await openSearch('Ajouter un remède');
    await user.type(field, 'kinkeliba{Enter}');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Est-ce bien ce remède ?' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/confirm/plant');
    expect(sessionState()).toMatchObject({ id: 'kinkeliba' });
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

  it('moves to the other list once when two clicks come in the same task', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'kinkeliba');
    const other = await screen.findByRole('button', { name: 'Chercher parmi les remèdes' });
    const replace = vi.spyOn(window.history, 'replaceState');

    act(() => {
      other.click();
      other.click();
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajouter un remède' }),
    ).toBeVisible();
    const moves = replace.mock.calls.filter(([, , url]) => String(url).endsWith('/search/plant'));
    expect(moves).toHaveLength(1);
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

  it('takes the focus to the field when it opens, so a name can be typed at once', async () => {
    const { field } = await openSearch('Ajouter un médicament');

    await waitFor(() => {
      expect(field).toHaveFocus();
    });
  });

  it('shows the length of the name near its limit of 80 characters', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    expect(field).toHaveAttribute('maxLength', '80');
    await user.type(field, 'x'.repeat(59));
    expect(screen.queryByText(/caractères sur 80/)).toBeNull();

    await user.type(field, 'x');
    expect(screen.getByText('60 caractères sur 80')).toBeVisible();
    expect(field).toHaveAccessibleDescription(
      'Le nom et le dosage écrits sur la boîte, même avec des fautes. 60 caractères sur 80',
    );
    await user.type(field, 'y'.repeat(25));
    expect(field).toHaveValue(`${'x'.repeat(60)}${'y'.repeat(20)}`);
    expect(
      screen.getByText("80 caractères au plus : la suite ne s'écrit pas.", {
        selector: '.search__limit',
      }),
    ).toBeVisible();
    // Said once reached, while typing (the description is read only when the field takes the focus).
    const said = document.querySelector('.search__limit-said');
    expect(said).toHaveAttribute('aria-live', 'polite');
    expect(said).toHaveTextContent("80 caractères au plus : la suite ne s'écrit pas.");
  });

  it('asks first when the name looks like a remedy: "huile de ricin" among the medicines', async () => {
    const { user, field, probe } = await openSearch('Ajouter un médicament');
    await user.type(field, 'huile de ricin');
    await user.click(await screen.findByRole('button', { name: 'Je ne trouve pas ce produit' }));

    const heading = await screen.findByRole('heading', { level: 2, name: LOOKALIKE });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    // The question follows the list shown: one remedy here.
    expect(screen.getByText("Est-ce l'un de ces remèdes ?")).toBeVisible();
    const lookalikes = screen.getByRole('list', { name: LOOKALIKE });
    const [first] = within(lookalikes).getAllByRole('button');
    expect(first).toHaveTextContent(/^Huile de ricin/);
    expect(first).toHaveTextContent('Remède');
    // The usual results are hidden under the question: one "not found" only.
    expect(screen.queryByRole('button', { name: 'Je ne trouve pas ce produit' })).toBeNull();
    expect(probe.current().items).toEqual([]);

    const none = screen.getByRole('button', { name: 'Non, aucun de ces remèdes' });
    expect(none).toHaveAccessibleDescription(
      "Le nom sera ajouté tel qu'il est écrit. S'il ressemble beaucoup à l'un d'eux, le résultat en tiendra compte aussi.",
    );
    await user.click(none);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'unrecognised', text: 'huile de ricin' } },
    ]);
    // She said it is none of them: the result keeps only a strong resemblance.
    expect(
      probe.current().declinedOf({ ref: { kind: 'unrecognised', text: 'huile de ricin' } }),
    ).toBe(true);
  });

  it('asks first about a lookalike of the other list, even one found by its whole name, the name typed kept', async () => {
    const { user, field, probe } = await openSearch('Ajouter un remède');
    await user.type(field, 'cytotec');
    await user.click(await screen.findByRole('button', { name: 'Je ne trouve pas ce remède' }));

    const lookalikes = await screen.findByRole('list', { name: LOOKALIKE });
    const [first] = within(lookalikes).getAllByRole('button');
    expect(first).toHaveTextContent(/^Misoprostol \(générique\)/);
    expect(first).toHaveTextContent('Médicament');
    expect(first).toHaveTextContent('Nom sur la boîte : Cytotec');
    expect(screen.getByText("Est-ce l'un de ces médicaments ?")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Non, aucun de ces médicaments' })).toBeVisible();
    // She said she does not find it: a resemblance always asks (SCRUM-56, spec section 11).
    expect(first).not.toHaveAccessibleName(/Ajouter$/);
    await user.click(first as HTMLElement);

    expect(
      await screen.findByRole('heading', { level: 1, name: `Est-ce bien ce produit${NBSP}?` }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([]);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'misoprostol-generic' } },
    ]);
    expect(screen.getByRole('list', { name: 'Produits ajoutés' })).toHaveTextContent('cytotec');
  });

  it('asks "Ce nom ressemble à :" at once when the check opened it for a name it does not find (SCRUM-56)', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/check', packLoader: loaderOf(pack) });
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    act(() => {
      navigate('/search/product', {
        state: inSession({ stepsToCheck: 1, query: 'huile de ricin', notFound: true }),
      });
    });

    const heading = await screen.findByRole('heading', { level: 2, name: LOOKALIKE });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByRole('searchbox')).toHaveValue('huile de ricin');
    expect(screen.getByRole('button', { name: 'Non, aucun de ces remèdes' })).toBeVisible();
  });

  it('says the name on the box a misspelt brand was found by, in the question too', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'cytotek');
    await user.click(await screen.findByRole('button', { name: 'Je ne trouve pas ce remède' }));

    const lookalikes = await screen.findByRole('list', { name: LOOKALIKE });
    const [first] = within(lookalikes).getAllByRole('button');
    expect(first).toHaveTextContent(/^Misoprostol \(générique\)/);
    expect(first).toHaveTextContent('Nom sur la boîte : Cytotec');
  });

  it('says no name on the box when the name shown already holds it', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'doliprane 1000');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent('DOLIPRANE 1000 mg');
    });
    expect(candidates()[0]).not.toHaveTextContent('Nom sur la boîte');
  });

  it('closes the question when the name typed changes', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'advil');
    await user.click(await screen.findByRole('button', { name: 'Je ne trouve pas ce produit' }));
    expect(await screen.findByRole('list', { name: LOOKALIKE })).toBeVisible();

    await user.type(field, 'x');
    expect(screen.queryByRole('list', { name: LOOKALIKE })).toBeNull();
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

describe('Search: a tap adds at once when nothing is to ask (SCRUM-56, S11)', () => {
  it('adds ibuprofen found by its whole name at a tap: the check says it is added', async () => {
    const { user, field, probe } = await openSearch('Ajouter un médicament');
    await user.type(field, 'ibuprofene');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Ibuprofène/);
    });
    // The row says the tap adds it, where a row that opens a screen has its chevron.
    expect(candidates()[0]).toHaveAccessibleName(/Ajouter$/);

    await user.click(candidates()[0] as HTMLElement);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/check');
    expect(probe.current().items).toHaveLength(1);
    expect(probe.current().items[0]?.ref).toMatchObject({ kind: 'product' });
    expect(await screen.findByText(/est ajouté à la liste\.$/)).toBeVisible();
  });

  it('adds once and goes back once when two clicks come before the screen renders again', async () => {
    const { user, field, probe } = await openSearch('Ajouter un médicament');
    await user.type(field, 'ibuprofene');
    await waitFor(() => {
      expect(candidates()[0]).toHaveAccessibleName(/Ajouter$/);
    });
    const go = vi.spyOn(window.history, 'go');
    const row = candidates()[0] as HTMLElement;

    // A quick double tap: both clicks in the same task, before React renders.
    act(() => {
      row.click();
      row.click();
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(go).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/check');
    expect(probe.current().items).toHaveLength(1);
  });

  it('opens one confirm screen when two clicks on a row to confirm come in the same task', async () => {
    const { user, field } = await openSearch('Ajouter un médicament');
    await user.type(field, 'doliprane');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^DOLIPRANE/);
    });
    const length = window.history.length;
    const row = candidates()[0] as HTMLElement;

    act(() => {
      row.click();
      row.click();
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: `Est-ce bien ce produit${NBSP}?` }),
    ).toBeVisible();
    // One step forward, not two: Back from the confirm screen comes back to the search.
    expect(window.history.length).toBe(length + 1);
  });

  it('opens "Est-ce bien ce produit ?" when the daily count is to ask (doliprane)', async () => {
    const { user, field, probe } = await openSearch('Ajouter un médicament');
    await user.type(field, 'doliprane');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^DOLIPRANE/);
    });
    expect(candidates()[0]).not.toHaveAccessibleName(/Ajouter$/);

    await user.click(candidates()[0] as HTMLElement);

    expect(
      await screen.findByRole('heading', { level: 1, name: `Est-ce bien ce produit${NBSP}?` }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([]);
  });

  it('never adds from Enter, which picks no row by its name: the confirm screen opens', async () => {
    const { user, field, probe } = await openSearch('Ajouter un médicament');
    await user.type(field, 'ibuprofene{Enter}');

    expect(
      await screen.findByRole('heading', { level: 1, name: `Est-ce bien ce produit${NBSP}?` }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([]);
  });
});
