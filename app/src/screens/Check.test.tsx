// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAppDb } from '../data/db.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';
import { fakeSpeech } from '../test/voice.js';
import { createVoiceService, type VoiceService } from '../voice/voice-service.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

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

const FIELD = 'Nom du médicament ou du remède';

function field() {
  return screen.getByRole('searchbox', { name: FIELD });
}

/** The candidate rows under the check's field (the question under a row has buttons too). */
function rows(): HTMLElement[] {
  const list = screen.queryByRole('list', { name: 'Propositions' });
  return list
    ? within(list)
        .getAllByRole('button')
        .filter((button) => button.classList.contains('candidate'))
    : [];
}

/** The row whose name starts with `name`. */
async function rowOf(name: RegExp): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: 'Propositions' });
  return await waitFor(() => {
    const row = within(list)
      .getAllByRole('button')
      .find((button) => button.classList.contains('candidate') && name.test(button.textContent));
    if (row === undefined) throw new Error(`no row ${String(name)}`);
    return row;
  });
}

/** The check's change line (added, taken off, put back). */
function changeLine() {
  return document.querySelector('.check__status');
}

/**
 * Adds an item through the check's field, as the user does (SCRUM-56):
 * Enter opens the question under the best row, "yes" adds it.
 */
async function addThrough(user: ReturnType<typeof userEvent.setup>, query: string) {
  const input = await screen.findByRole('searchbox', { name: FIELD });
  await user.clear(input);
  await user.type(input, query);
  await screen.findByRole('list', { name: 'Propositions' });
  // Enter opens the question of the best row, never adds (a tap may add it at once).
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: /^Oui, c'est ce/ }));
  await waitFor(() => {
    expect(input).toHaveValue('');
  });
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
    // One field for medicines and remedies (SCRUM-56, S12), no screen to open first.
    expect(field()).toHaveAccessibleDescription(
      'Le nom sur la boîte ou celui du remède, même mal écrit.',
    );
    expect(screen.queryByRole('button', { name: 'Ajouter un médicament' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter un remède' })).toBeNull();
  });

  it('never shows the check, nor gives it the focus, before the profile screen it opens', async () => {
    const headings: string[] = [];
    const observer = new MutationObserver(() => {
      const text = document.querySelector('main h1')?.textContent;
      if (text !== undefined && headings.at(-1) !== text) headings.push(text);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await openCheckFromHome();
      const profile = await screen.findByRole('heading', { level: 1, name: 'Mon profil' });
      await waitFor(() => {
        expect(profile).toHaveFocus();
      });
    } finally {
      observer.disconnect();
    }
    // From Home straight to her profile: no screen reader hears "Ce que vous prenez" first.
    expect(headings).not.toContain('Ce que vous prenez');
  });

  it('says the profiles could not be read, under its heading with the focus, when the list fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/', packLoader: loaderOf(pack) });
    const user = userEvent.setup();
    const start = await screen.findByRole('button', { name: 'Regarder un produit' });
    // The phone's storage refuses to open from now on.
    closeAppDb();
    breakIndexedDB('storage refused');
    await user.click(start);

    const heading = await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    expect(screen.getByText(/^Les profils n'ont pas pu être lus sur ce téléphone/)).toBeVisible();
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it('says it is loading after a moment, then that the profiles could not be read, when storage never answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await saveProfile(profileOf());
    await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      storageTimeoutMs: 2500,
    });
    const user = userEvent.setup();
    const start = await screen.findByRole('button', { name: 'Regarder un produit' });
    closeAppDb();
    hangIndexedDB();
    await user.click(start);

    // Not at once (a fast phone never shows it), and never as the check's heading.
    const loading = within(screen.getByRole('main')).getByRole('status');
    expect(loading).toHaveTextContent('');
    expect(await screen.findByText('Chargement en cours.', {}, { timeout: 2000 })).toBe(loading);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    const heading = await screen.findByRole(
      'heading',
      { level: 1, name: 'Ce que vous prenez' },
      { timeout: 5000 },
    );
    expect(screen.getByText(/^Les profils n'ont pas pu être lus sur ce téléphone/)).toBeVisible();
    expect(screen.queryByText('Chargement en cours.')).toBeNull();
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it('gives the focus to its field once her profile is read: she came to look up a product (SCRUM-56)', async () => {
    await saveProfile(profileOf());
    await openCheckFromHome();
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    await waitFor(() => {
      expect(field()).toHaveFocus();
    });
  });

  it('opens the profile screen first when there is no profile, then comes back to the check', async () => {
    const { user, probe } = await openCheckFromHome();

    expect(await screen.findByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
    await user.click(
      within(screen.getByRole('group', { name: /^Enceinte/ })).getByRole('radio', { name: 'Oui' }),
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Terme de la grossesse' })).getByRole('radio', {
        name: 'Je ne sais pas',
      }),
    );
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

  it('is for the woman chosen in the list in accompanied mode, and names her', async () => {
    await saveProfile(
      profileOf({ id: 'a', pseudonym: 'Awa', updatedAt: '2026-11-01T08:00:00.000Z' }),
    );
    await saveProfile(
      profileOf({ id: 'b', pseudonym: 'Fatou', updatedAt: '2026-11-03T08:00:00.000Z' }),
    );
    const probe = probeCheck();
    await renderApp({
      settings: accompanied,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });

    await user.click(within(list).getByRole('button', { name: /^Awa / }));

    expect(
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" }),
    ).toBeVisible();
    // Text matchers read the no-break space before the colon as a space.
    expect(await screen.findByText('Profil : Awa')).toBeVisible();
    // The term used, so the right woman and term are seen before the result.
    expect(screen.getByText('Environ 26 semaines')).toBeVisible();
    expect(probe.current().profileId).toBe('a');
  });

  it('lets the situations answered be seen with one tap, "none" as any other, the same screen before it (SCRUM-56)', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa', conditions: [] }));
    await saveProfile(
      profileOf({ id: 'b', pseudonym: 'Fatou', conditions: ['hiv-cotrimoxazole'] }),
    );
    await renderApp({ settings: accompanied, hash: '#/', packLoader: loaderOf(pack) });
    const user = userEvent.setup();
    const open = async (name: string) => {
      // Back to the list of profiles by the band, from a check.
      const home = screen.queryByRole('link', { name: 'Carnet' });
      if (home !== null) await user.click(home);
      const list = await screen.findByRole('list', {
        name: 'Profils enregistrés sur ce téléphone',
      });
      await user.click(within(list).getByRole('button', { name: new RegExp(`^${name} `) }));
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" });
      return within(document.querySelector('.check__profile') as HTMLElement);
    };

    const awa = await open('Awa');
    // Before any tap the line is the same whatever she answered: one says HIV.
    const before = document.querySelector('.check__profile')?.textContent.replace('Awa', '');
    await user.click(awa.getByRole('button', { name: 'Situations : touchez pour les afficher' }));
    expect(awa.getByText('Situations : aucune')).toBeVisible();

    const fatou = await open('Fatou');
    expect(document.querySelector('.check__profile')?.textContent.replace('Fatou', '')).toBe(
      before,
    );
    expect(document.body.textContent).not.toMatch(/VIH/);
    await user.click(fatou.getByRole('button', { name: 'Situations : touchez pour les afficher' }));
    expect(fatou.getByText('Situations : VIH, avec cotrimoxazole')).toBeVisible();
  });

  it('asks first whether the baby is born when her term is past 42 weeks, and lists nothing', async () => {
    await saveProfile(
      profileOf({
        id: 'a',
        pseudonym: 'Bineta',
        term: { kind: 'months', months: 7, givenOn: '2026-07-01' },
      }),
    );
    const probe = probeCheck();
    await renderApp({
      settings: accompanied,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    expect(within(list).getByRole('button', { name: /^Bineta/ })).toHaveAccessibleName(
      'Bineta À mettre à jour',
    );

    await user.click(within(list).getByRole('button', { name: /^Bineta/ }));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Le terme noté a passé 42 semaines\. Le bébé est-il né/,
      }),
    ).toBeVisible();
    // The question takes the focus, so a screen reader starts there.
    expect(
      screen.getByRole('heading', { level: 1, name: /^Le terme noté a passé 42 semaines/ }),
    ).toHaveFocus();
    expect(screen.getByText('Profil : Bineta')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Voir le résultat' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    // Danger signs stay one tap away.
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Signes de danger' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Non, toujours enceinte' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Modifier le profil' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ })).toHaveValue('');
    // Her id is never in the address (edit-route.ts).
    expect(window.location.hash).toBe('#/profile/edit');
  });

  it('asks her in her own words in woman mode, and "the baby is born" opens her profile', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-07-01' } }));
    const { user } = await openCheckFromHome();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Votre terme noté a passé 42 semaines\. Votre bébé est-il né/,
      }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Oui, le bébé est né' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
    expect(
      within(screen.getByRole('group', { name: /^Enceinte/ })).getByRole('radio', { name: 'Non' }),
    ).toBeChecked();
  });

  it('goes on when the baby may only be born (month 9 a week ago), and says to confirm it', async () => {
    await saveProfile(
      profileOf({
        id: 'a',
        pseudonym: 'Bineta',
        term: { kind: 'months', months: 9, givenOn: '2026-10-27' },
      }),
    );
    await renderApp({ settings: accompanied, hash: '#/', packLoader: loaderOf(pack) });
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    expect(within(list).getByRole('button', { name: /^Bineta/ })).toHaveAccessibleName(
      /^Bineta Entre 37 et 42 semaines \(estimé\) À confirmer\s: le bébé est peut-être né$/,
    );
    // Her id goes in the entry's state, never in the address (edit-route.ts).
    expect(
      within(list).getByRole('link', { name: 'Mettre à jour le profil de Bineta' }),
    ).toHaveAttribute('href', '#/profile/edit');

    await user.click(within(list).getByRole('button', { name: /^Bineta/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" }),
    ).toBeVisible();
    expect(await screen.findByText(/^À confirmer\s: le bébé est peut-être né$/)).toBeVisible();
    expect(field()).toBeVisible();
  });

  it('sends accompanied mode to the list when no woman is chosen, never to one by default', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await renderApp({ settings: accompanied, hash: '#/check', packLoader: loaderOf(pack) });

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    expect(window.location.hash).toBe('#/');
  });

  it('lists each item added with its substances and units, and removes one', async () => {
    await saveProfile(profileOf());
    const { user, probe } = await openCheckFromHome();
    await addThrough(user, 'paracetamol 500');
    await addThrough(user, 'kinkeliba');

    const list = screen.getByRole('list', { name: 'Produits ajoutés' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Paracétamol 500 mg (générique)');
    expect(rows[0]).toHaveTextContent('Paracétamol 500 mg');
    expect(rows[1]).toHaveTextContent('Kinkéliba');
    expect(rows[1]).toHaveTextContent('Combretum micranthum');
    // A Latin name is read with Latin rules (WCAG 3.1.2).
    expect(within(rows[1] as HTMLElement).getByText('Combretum micranthum')).toHaveAttribute(
      'lang',
      'la',
    );
    expect(screen.getByRole('button', { name: 'Voir le résultat' })).toBeEnabled();

    await user.click(
      screen.getByRole('button', { name: 'Retirer Paracétamol 500 mg (générique) de la liste' }),
    );

    expect(probe.current().items).toEqual([{ ref: { kind: 'plant', id: 'kinkeliba' } }]);
    expect(screen.getByRole('button', { name: 'Retirer Kinkéliba de la liste' })).toHaveFocus();
    expect(changeLine()).toHaveTextContent(
      'Paracétamol 500 mg (générique) est retiré de la liste.',
    );

    await user.click(screen.getByRole('button', { name: 'Retirer Kinkéliba de la liste' }));
    expect(field()).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Voir le résultat' })).toBeDisabled();
  });

  it('says what was just added, and puts a removed item back at its place', async () => {
    await saveProfile(profileOf());
    const { user, probe } = await openCheckFromHome();
    await addThrough(user, 'paracetamol 500');
    const status = () => changeLine();
    await waitFor(() => {
      expect(status()).toHaveTextContent('Paracétamol 500 mg (générique) est ajouté à la liste.');
    });
    await addThrough(user, 'kinkeliba');
    await waitFor(() => {
      expect(status()).toHaveTextContent('Kinkéliba est ajouté à la liste.');
    });

    await user.click(
      screen.getByRole('button', { name: 'Retirer Paracétamol 500 mg (générique) de la liste' }),
    );
    expect(status()).toHaveTextContent('Paracétamol 500 mg (générique) est retiré de la liste.');
    await user.click(screen.getByRole('button', { name: 'Remettre dans la liste' }));

    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'paracetamol-500-generic' } },
      { ref: { kind: 'plant', id: 'kinkeliba' } },
    ]);
    expect(status()).toHaveTextContent('Paracétamol 500 mg (générique) est remis dans la liste.');
    expect(
      screen.getByRole('button', { name: 'Retirer Paracétamol 500 mg (générique) de la liste' }),
    ).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Remettre dans la liste' })).toBeNull();
  });

  it('says an added item once: not again when Home opens the check again', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'kinkeliba');
    await screen.findByText('Kinkéliba est ajouté à la liste.');

    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Carnet' }));
    await user.click(await screen.findByRole('button', { name: 'Regarder un produit' }));

    expect(await screen.findByText('Kinkéliba')).toBeVisible();
    expect(screen.queryByText('Kinkéliba est ajouté à la liste.')).toBeNull();
  });

  it('keeps the check when Home opens it again for the same profile', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'kinkeliba');

    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Carnet' }));
    await user.click(await screen.findByRole('button', { name: 'Regarder un produit' }));

    expect(await screen.findByText('Kinkéliba')).toBeVisible();
  });

  it('goes back to Home, not to the search, after an item is added', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'kinkeliba');

    window.history.back();

    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  });
});

/** Her check, open, with nothing listed. */
async function openCheck(settings: Settings = woman, options: { voice?: VoiceService } = {}) {
  await saveProfile(profileOf());
  const probe = probeCheck();
  await renderApp({
    settings,
    hash: '#/check',
    packLoader: loaderOf(pack),
    children: probe.element,
    ...options,
  });
  await screen.findByRole('heading', { level: 1, name: /^Ce qu/ });
  return { user: userEvent.setup(), probe };
}

/** Types `query` in the check's field and waits for the row `name`. */
async function typeAndFind(user: ReturnType<typeof userEvent.setup>, query: string, name: RegExp) {
  await user.type(field(), query);
  return rowOf(name);
}

/** The question open under a row, by its heading ("Est-ce bien <nom> ?"). */
async function question(name: RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name });
  const section = heading.closest('section');
  if (section === null) throw new Error('no question');
  return section;
}

describe('Check: the search on the check screen (SCRUM-56, S12)', () => {
  it('searches the medicines and the remedies in one field, each row saying its list', async () => {
    const { user } = await openCheck();
    const remedy = await typeAndFind(user, 'kinkeliba', /^Kinkéliba/);
    expect(remedy).toHaveTextContent('Remède');
    // Read with Latin rules (WCAG 3.1.2), as on the search screen.
    expect(within(remedy).getByText('Combretum micranthum')).toHaveAttribute('lang', 'la');

    await user.clear(field());
    const medicine = await typeAndFind(user, 'ibuprofene', /^Ibuprofène/);
    expect(medicine).toHaveTextContent('Médicament');
    expect(rows().length).toBeLessThanOrEqual(4);
    // In the live region: how many, the first, what to do.
    expect(document.querySelector('.check__search .search__status')).toHaveTextContent(
      /propositions, la première : Ibuprofène \(générique\)\. Choisissez celui qui correspond\.$/,
    );
    // The address never says what is looked up.
    expect(window.location.hash).toBe('#/check');
  });

  it('adds nothing from what is typed alone', async () => {
    const { user, probe } = await openCheck();
    await typeAndFind(user, 'ibuprofene', /^Ibuprofène/);
    expect(probe.current().items).toEqual([]);
  });

  it('adds an INN found whole at a tap: the field empty with the focus, the check says so (S11)', async () => {
    const { user, probe } = await openCheck();
    const length = window.history.length;
    const row = await typeAndFind(user, 'ibuprofene', /^Ibuprofène \(générique\)/);
    // Its name ends with what a tap does.
    expect(row).toHaveAccessibleName(/Ajouter$/);
    expect(row).not.toHaveAttribute('aria-expanded');

    await user.click(row);

    expect(probe.current().items).toEqual([{ ref: { kind: 'product', id: 'ibuprofen-generic' } }]);
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    await waitFor(() => {
      expect(changeLine()).toHaveTextContent('Ibuprofène (générique) est ajouté à la liste.');
    });
    expect(screen.getByRole('list', { name: 'Produits ajoutés' })).toHaveTextContent(
      'Ibuprofène (générique)',
    );
    // No screen and no history entry for it.
    expect(window.location.hash).toBe('#/check');
    expect(window.history.length).toBe(length);
  });

  it('adds a brand found whole at a tap, the name typed kept (cytotec)', async () => {
    const { user, probe } = await openCheck();
    const row = await typeAndFind(user, 'cytotec', /^Misoprostol/);
    expect(row).toHaveAccessibleName(/Ajouter$/);
    await user.click(row);

    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'misoprostol-generic' } },
    ]);
    expect(screen.getByRole('list', { name: 'Produits ajoutés' })).toHaveTextContent(
      'Vous avez écrit : « cytotec »',
    );
  });

  it('adds at a tap a brand whose strength typed agrees with its box (clamoxyl 1g)', async () => {
    const { user, probe } = await openCheck();
    const row = await typeAndFind(user, 'clamoxyl 1g', /^CLAMOXYL/);
    expect(row).toHaveAccessibleName(/Ajouter$/);
    await user.click(row);

    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'clamoxyl-1-g-64539416' } },
    ]);
  });

  it('adds once when two clicks on a row come in the same task', async () => {
    const { user, probe } = await openCheck();
    const row = await typeAndFind(user, 'ibuprofene', /^Ibuprofène \(générique\)/);

    act(() => {
      row.click();
      row.click();
    });

    expect(probe.current().items).toHaveLength(1);
    await waitFor(() => {
      expect(changeLine()).toHaveTextContent('Ibuprofène (générique) est ajouté à la liste.');
    });
  });

  it('asks "Est-ce bien ... ?" under the row of a prefix (ibupro), and adds only on its yes', async () => {
    const { user, probe } = await openCheck();
    const row = await typeAndFind(user, 'ibupro', /^Ibuprofène \(générique\)/);
    expect(row).not.toHaveAccessibleName(/Ajouter$/);
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await user.click(row);

    const asked = await question(/^Est-ce bien Ibuprofène \(générique\)\s\?$/);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    // Under its own row, in the list of candidates.
    expect(row.closest('li')).toContainElement(asked);
    await waitFor(() => {
      expect(within(asked).getByRole('heading', { level: 2 })).toHaveFocus();
    });
    expect(probe.current().items).toEqual([]);
    // "Yes" is an answer: the check keeps its one primary action (the result).
    const yes = within(asked).getByRole('button', { name: "Oui, c'est ce produit" });
    expect(yes).toHaveClass('button--secondary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);

    await user.click(yes);

    expect(probe.current().items).toEqual([{ ref: { kind: 'product', id: 'ibuprofen-generic' } }]);
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(screen.queryByRole('heading', { level: 2, name: /^Est-ce bien/ })).toBeNull();
  });

  it('closes the question on "Non", the text kept and the field focused', async () => {
    const { user, probe } = await openCheck();
    await user.click(await typeAndFind(user, 'ibupro', /^Ibuprofène \(générique\)/));
    const asked = await question(/^Est-ce bien/);

    await user.click(within(asked).getByRole('button', { name: 'Non, chercher encore' }));

    expect(screen.queryByRole('heading', { level: 2, name: /^Est-ce bien/ })).toBeNull();
    expect(field()).toHaveValue('ibupro');
    expect(field()).toHaveFocus();
    expect(probe.current().items).toEqual([]);
  });

  it('keeps one question open when two clicks on its row come in the same task', async () => {
    const { user } = await openCheck();
    const row = await typeAndFind(user, 'ibupro', /^Ibuprofène \(générique\)/);

    act(() => {
      row.click();
      row.click();
    });

    expect(await question(/^Est-ce bien/)).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2, name: /^Est-ce bien/ })).toHaveLength(1);
  });

  it('closes the question when the name typed changes', async () => {
    const { user } = await openCheck();
    await user.click(await typeAndFind(user, 'ibupro', /^Ibuprofène \(générique\)/));
    await question(/^Est-ce bien/);

    await user.type(field(), 'f');

    expect(screen.queryByRole('heading', { level: 2, name: /^Est-ce bien/ })).toBeNull();
  });

  it('says "Vous avez écrit" in the question of a close spelling (cytotek)', async () => {
    const { user, probe } = await openCheck();
    const row = await typeAndFind(user, 'cytotek', /^Misoprostol/);
    // The name on the box it was found by, on the row.
    expect(row).toHaveTextContent('Nom sur la boîte : Cytotec');
    expect(row).not.toHaveAccessibleName(/Ajouter$/);
    await user.click(row);

    const asked = await question(/^Est-ce bien Misoprostol/);
    expect(asked).toHaveTextContent('Vous avez écrit : « cytotek »');
    expect(probe.current().items).toEqual([]);
  });

  it('says what a product lacks of the substances typed (doliprane vitamine c)', async () => {
    const { user } = await openCheck();
    await user.click(await typeAndFind(user, 'doliprane vitamine c', /^DOLIPRANE/));

    const asked = await question(/^Est-ce bien DOLIPRANE/);
    expect(asked).toHaveTextContent(
      /ce produit n'en contient pas\. Comparez avec le nom sur la boîte\./,
    );
  });

  it('says a strength typed that no box has, and asks it (clamoxyl 3g)', async () => {
    const { user, probe } = await openCheck();
    const row = await typeAndFind(user, 'clamoxyl 3g', /^CLAMOXYL/);
    expect(row).not.toHaveAccessibleName(/Ajouter$/);
    await user.click(row);

    const asked = await question(/^Est-ce bien CLAMOXYL/);
    expect(asked).toHaveTextContent(
      "Aucune boîte de ce produit à 3000 mg n'est connue. Comparez avec le dosage écrit sur la boîte.",
    );
    expect(
      within(asked).getByRole('group', { name: /^Quel dosage est écrit sur la boîte/ }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([]);
  });

  it('says the local name a remedy was found by, and asks (nebeday)', async () => {
    const { user, probe } = await openCheck();
    const row = await typeAndFind(user, 'nebeday', /^Moringa/);
    expect(row).toHaveTextContent('Nom local : nebeday (wolof)');
    expect(row).not.toHaveAccessibleName(/Ajouter$/);
    await user.click(row);

    const asked = await question(/^Est-ce bien Moringa/);
    expect(asked).toHaveTextContent('Nom local : nebeday (wolof)');
    await user.click(within(asked).getByRole('button', { name: "Oui, c'est ce remède" }));
    expect(probe.current().items).toEqual([{ ref: { kind: 'plant', id: 'moringa' } }]);
  });

  it('asks the daily count in the question of a product under a daily maximum, in sight (doliprane)', async () => {
    const { user, probe } = await openCheck();
    await user.click(await typeAndFind(user, 'doliprane', /^DOLIPRANE/));

    const asked = await question(/^Est-ce bien DOLIPRANE/);
    // Open without a tap, never with the focus (the question's heading has it).
    expect(
      within(asked).getByRole('textbox', { name: /^Combien d'unités par jour/ }),
    ).toBeVisible();
    await user.click(within(asked).getByRole('button', { name: "Oui, c'est ce produit" }));
    // Left blank: the count is not known, never 0 or 1.
    expect(probe.current().items).toEqual([
      {
        ref: { kind: 'product', id: expect.stringMatching(/^doliprane-/) as string },
        strengthUnknown: true,
      },
    ]);
  });

  it('opens the question of the best row with Enter, and adds nothing', async () => {
    const { user, probe } = await openCheck();
    await user.type(field(), 'ibuprofene{Enter}');

    expect(await question(/^Est-ce bien Ibuprofène/)).toBeVisible();
    expect(probe.current().items).toEqual([]);
  });

  it('says under the row that a product is listed already, never twice (S11)', async () => {
    const { user, probe } = await openCheck();
    await user.click(await typeAndFind(user, 'ibuprofene', /^Ibuprofène \(générique\)/));
    // Its family again: no longer added at a tap.
    const row = await typeAndFind(user, 'ibuprofene', /^Ibuprofène \(générique\)/);
    expect(row).not.toHaveAccessibleName(/Ajouter$/);
    await user.click(row);

    const asked = await question(/^Est-ce bien Ibuprofène/);
    expect(asked).toHaveTextContent('Ibuprofène (générique) est déjà dans la liste.');
    await user.click(within(asked).getByRole('button', { name: 'Revenir à la liste' }));
    expect(probe.current().items).toEqual([{ ref: { kind: 'product', id: 'ibuprofen-generic' } }]);
    await waitFor(() => {
      expect(changeLine()).toHaveTextContent('Ibuprofène (générique) est déjà dans la liste.');
    });
  });

  it('adds the text as typed when nothing looks like it, on the check, quoted', async () => {
    const { user, probe } = await openCheck();
    await user.type(field(), '  poudre du marché ');
    const notFound = await screen.findByRole('button', { name: 'Je ne trouve pas ce produit' });
    expect(notFound).toHaveClass('button--secondary');
    expect(notFound).toHaveAccessibleDescription(
      "Il sera ajouté tel qu'il est écrit, comme produit non reconnu.",
    );
    await user.click(notFound);

    expect(probe.current().items).toEqual([
      { ref: { kind: 'unrecognised', text: 'poudre du marché' } },
    ]);
    expect(window.location.hash).toBe('#/check');
    expect(screen.getByText('« poudre du marché »')).toHaveClass('typed');
    expect(field()).toHaveValue('');
  });

  it('asks "Ce nom ressemble à :" on the search screen when the name looks like products', async () => {
    const { user, probe } = await openCheck();
    await user.type(field(), 'advill');
    await rowOf(/^ADVIL/);
    const notFound = screen.getByRole('button', { name: 'Je ne trouve pas ce produit' });
    // Quiet while rows are on offer.
    expect(notFound).toHaveClass('button--quiet');
    await user.click(notFound);

    expect(
      await screen.findByRole('heading', { level: 2, name: /^Ce nom ressemble à/ }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/search/product');
    expect(probe.current().items).toEqual([]);
    await user.click(screen.getByRole('button', { name: /^Non, aucun de ces/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/check');
    expect(probe.current().items).toEqual([{ ref: { kind: 'unrecognised', text: 'advill' } }]);
    expect(probe.current().declinedOf({ ref: { kind: 'unrecognised', text: 'advill' } })).toBe(
      true,
    );
    // The item is added: the text is not brought back in the field.
    expect(field()).toHaveValue('');
  });

  it('keeps the text on the check entry for the way back from the search screen', async () => {
    const { user } = await openCheck();
    await user.type(field(), 'advill');
    await rowOf(/^ADVIL/);
    await user.click(screen.getByRole('button', { name: 'Je ne trouve pas ce produit' }));
    await screen.findByRole('heading', { level: 2, name: /^Ce nom ressemble à/ });

    window.history.back();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(field()).toHaveValue('advill');
  });
});

describe('Check: saying a name on the check screen (SCRUM-56, S12)', () => {
  it('puts what the voice heard in the field: a whole name adds at a tap', async () => {
    const speech = fakeSpeech({ installed: ['fr'], transcript: 'ibuprofene' });
    const { user, probe } = await openCheck(woman, { voice: createVoiceService(speech.port) });
    const mic = screen.getByRole('button', { name: 'Dire le nom' });
    expect(mic.closest('.search__entry')).toContainElement(field());

    await user.click(mic);
    await user.click(await screen.findByRole('button', { name: "Terminer l'enregistrement" }));

    await waitFor(() => {
      expect(field()).toHaveValue('ibuprofene');
    });
    const row = await rowOf(/^Ibuprofène \(générique\)/);
    expect(row).toHaveAccessibleName(/Ajouter$/);
    await user.click(row);
    expect(probe.current().items).toEqual([{ ref: { kind: 'product', id: 'ibuprofen-generic' } }]);
  });

  it('asks with "Vous avez dit" for a name heard that is not a whole name', async () => {
    const speech = fakeSpeech({ installed: ['fr'], transcript: 'cytotek' });
    const { user, probe } = await openCheck(woman, { voice: createVoiceService(speech.port) });
    await user.click(screen.getByRole('button', { name: 'Dire le nom' }));
    await user.click(await screen.findByRole('button', { name: "Terminer l'enregistrement" }));

    const row = await rowOf(/^Misoprostol/);
    expect(row).not.toHaveAccessibleName(/Ajouter$/);
    await user.click(row);
    const asked = await question(/^Est-ce bien Misoprostol/);
    expect(asked).toHaveTextContent('Vous avez dit : « cytotek »');
    // The machine's text is never added as typed while rows are on offer.
    expect(screen.queryByRole('button', { name: 'Je ne trouve pas ce produit' })).toBeNull();
    expect(probe.current().items).toEqual([]);
  });

  it('offers either whole list when the name heard matches nothing, on the search screen', async () => {
    const speech = fakeSpeech({ installed: ['fr'], transcript: 'zzzzqx' });
    const { user } = await openCheck(woman, { voice: createVoiceService(speech.port) });
    await user.click(screen.getByRole('button', { name: 'Dire le nom' }));
    await user.click(await screen.findByRole('button', { name: "Terminer l'enregistrement" }));

    expect(
      await screen.findByText('Aucun médicament ni remède ne correspond à ce nom.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Choisir dans la liste des remèdes' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: /^Tous les remèdes/ }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/search/plant');
  });
});

describe('Check to result', () => {
  it('shows the level the engine gives for the confirmed items', async () => {
    await saveProfile(profileOf());
    const { user } = await openCheckFromHome();
    await addThrough(user, 'kinkeliba');
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    // The danger signs present now come first.
    await user.click(await screen.findByRole('checkbox', { name: 'Aucun de ces signes' }));
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    // Kinkeliba has no rule and evidence 0: we do not know, never reassurance.
    expect(await screen.findByRole('article', { name: 'On ne sait pas. Kinkéliba' })).toHaveClass(
      'level--unknown',
    );
  });
});
