// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAppDb } from '../data/db.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { inSession, sessionState } from '../state/entry-state.js';
import { probeCheck } from '../test/check-probe.js';
import { makeCode } from '../test/code-steps.js';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, noPack, pendingPack, renderApp, storeTestCode } from '../test/render-app.js';
import { fakeSpeech } from '../test/voice.js';
import { createVoiceService, type VoiceService } from '../voice/voice-service.js';
import { untilMidnight } from './Check.js';

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

/** Her start in woman mode: her check, at #/ (SCRUM-56, S4). */
async function openStart() {
  const probe = probeCheck();
  await renderApp({
    settings: woman,
    hash: '#/',
    packLoader: loaderOf(pack),
    children: probe.element,
  });
  return { user: userEvent.setup(), probe };
}

/** Her check opened from another screen (the about screen), by the band's "Carnet". */
async function openStartFromAbout(options: { storageTimeoutMs?: number } = {}) {
  const probe = probeCheck();
  await renderApp({
    settings: woman,
    hash: '#/about',
    packLoader: loaderOf(pack),
    children: probe.element,
    ...options,
  });
  const user = userEvent.setup();
  const home = within(await screen.findByRole('banner')).getByRole('link', { name: 'Carnet' });
  return { user, probe, home };
}

// Her start's heading: a no-break space before "?", as French writes it.
const START = 'Un médicament ou un remède ?';
const FIELD = 'Nom du médicament ou du remède';

/** Answers the questions about her: pregnant at `weeks` weeks, not breastfeeding, no situation. */
async function answerAboutHer(user: ReturnType<typeof userEvent.setup>, weeks: string) {
  await user.click(
    within(screen.getByRole('group', { name: /^Enceinte/ })).getByRole('radio', { name: 'Oui' }),
  );
  await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), weeks);
  await user.click(
    within(screen.getByRole('group', { name: /^Allaite/ })).getByRole('radio', { name: 'Non' }),
  );
  await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
}

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
  it('is her start in woman mode, at #/, empty, with the result out of reach until an item is added (SCRUM-56, S4)', async () => {
    await saveProfile(profileOf());
    await openStart();

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(window.location.hash).toBe('#/');
    // The start of the app: the band's "Carnet" says it is the page shown.
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Carnet' }),
    ).toHaveAttribute('aria-current', 'page');
    // What the app is for, while nothing is listed.
    expect(screen.getByText('Sachez à qui le montrer, et quand.')).toBeVisible();
    // Nothing listed: no danger signs question and no way to a result yet (SCRUM-56, S13).
    expect(
      screen.getByText(
        "Rien n'est encore ajouté. Ajoutez au moins un produit pour voir le résultat.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Non, aucun de ces signes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Voir le résultat' })).toBeNull();
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(0);
    // One field for medicines and remedies (SCRUM-56, S12), no screen to open first.
    expect(field()).toHaveAccessibleDescription(
      'Le nom sur la boîte ou celui du remède, même mal écrit.',
    );
    expect(screen.queryByRole('button', { name: 'Ajouter un médicament' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter un remède' })).toBeNull();
  });

  it('opens #/check at #/ in woman mode: one address for her check', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/check', packLoader: loaderOf(pack) });

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/');
    });
  });

  it('asks about her on her first check, then keeps her answers as her profile (SCRUM-56, 8.3)', async () => {
    const { user, probe, home } = await openStartFromAbout();
    await user.click(home);

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    const about = screen.getByRole('region', { name: 'À propos de vous' });
    // The first thing to answer takes the focus: the questions start under it.
    await waitFor(() => {
      expect(within(about).getByRole('heading', { level: 2 })).toHaveFocus();
    });
    expect(within(about).getByText('Ces réponses restent sur ce téléphone.')).toBeVisible();
    // Her own profile: no pseudonym to give; nothing to look up before her term is known.
    expect(within(about).queryByRole('textbox', { name: /^Surnom/ })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Modifier' })).toBeNull();

    await answerAboutHer(user, '24');
    await user.click(within(about).getByRole('button', { name: 'Enregistrer' }));

    // Folded into the line of her term; the field takes the focus for the first name.
    await waitFor(() => {
      expect(field()).toHaveFocus();
    });
    expect(screen.queryByRole('region', { name: 'À propos de vous' })).toBeNull();
    expect(screen.getByText('Environ 24 semaines')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Modifier' })).toHaveAttribute('href', '#/profile');
    expect(screen.getByText('Profil enregistré : Moi.')).toBeVisible();
    const [saved] = await listProfiles();
    expect(saved).toMatchObject({
      pseudonym: 'Moi',
      self: true,
      pregnant: true,
      term: { kind: 'weeks', weeks: 24, givenOn: '2026-11-04' },
      breastfeeding: false,
      conditions: [],
    });
    await waitFor(() => {
      expect(probe.current().profileId).toBe(saved?.id);
    });
    expect(window.location.hash).toBe('#/');
  });

  it('never shows the search, nor a heading other than its own, before her first answers', async () => {
    const headings: string[] = [];
    const observer = new MutationObserver(() => {
      const text = document.querySelector('main h1')?.textContent;
      if (text !== undefined && headings.at(-1) !== text) headings.push(text);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await openStart();
      await screen.findByRole('region', { name: 'À propos de vous' });
    } finally {
      observer.disconnect();
    }
    expect(headings).toEqual([START]);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Mon profil' })).toBeNull();
  });

  it('says the profiles could not be read, under its heading with the focus, when the list fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await saveProfile(profileOf());
    const { user, home } = await openStartFromAbout();
    // The phone's storage refuses to open from now on.
    closeAppDb();
    breakIndexedDB('storage refused');
    await user.click(home);

    const heading = await screen.findByRole('heading', { level: 1, name: START });
    expect(screen.getByText(/^Les profils n'ont pas pu être lus sur ce téléphone/)).toBeVisible();
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });

  it('says it is loading after a moment, then that the profiles could not be read, when storage never answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await saveProfile(profileOf());
    const { user, home } = await openStartFromAbout({ storageTimeoutMs: 2500 });
    closeAppDb();
    hangIndexedDB();
    await user.click(home);

    // Not at once (a fast phone never shows it), and never as the check's heading.
    const loading = within(screen.getByRole('main')).getByRole('status');
    expect(loading).toHaveTextContent('');
    expect(await screen.findByText('Chargement en cours.', {}, { timeout: 2000 })).toBe(loading);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    const heading = await screen.findByRole(
      'heading',
      { level: 1, name: START },
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
    const { user, home } = await openStartFromAbout();
    await user.click(home);
    await screen.findByRole('heading', { level: 1, name: START });
    await waitFor(() => {
      expect(field()).toHaveFocus();
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
    const { user } = await openStart();

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
    const { user, probe } = await openStart();
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
    // Listed: the danger signs present now are asked under the list (SCRUM-56, S13).
    expect(screen.getByRole('button', { name: 'Non, aucun de ces signes' })).toBeVisible();

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
    expect(screen.queryByRole('button', { name: 'Non, aucun de ces signes' })).toBeNull();
  });

  it('says what was just added, and puts a removed item back at its place', async () => {
    await saveProfile(profileOf());
    const { user, probe } = await openStart();
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

  it('says an added item once: not again when she comes back to her check', async () => {
    await saveProfile(profileOf());
    const { user } = await openStart();
    await addThrough(user, 'kinkeliba');
    await screen.findByText('Kinkéliba est ajouté à la liste.');

    await user.click(screen.getByRole('link', { name: 'Réglages' }));
    await screen.findByRole('heading', { level: 1, name: 'Réglages' });
    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Carnet' }));

    // Her list is kept for her profile; what was added is not said again.
    expect(await screen.findByText('Kinkéliba')).toBeVisible();
    expect(screen.queryByText('Kinkéliba est ajouté à la liste.')).toBeNull();
  });

  it('is one history entry: adding items leaves none, Back leaves the check', async () => {
    await saveProfile(profileOf());
    const { user, home } = await openStartFromAbout();
    await user.click(home);
    await screen.findByRole('heading', { level: 1, name: START });
    const entries = window.history.length;
    await addThrough(user, 'kinkeliba');
    await addThrough(user, 'paracetamol 500');
    expect(window.history.length).toBe(entries);

    window.history.back();

    expect(await screen.findByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
  });
});

// What Home said in woman mode is on her check, her start (SCRUM-56, S4).
describe('Check: her start in woman mode', () => {
  it('shows the app name, the danger signs shortcut and the closing line, and no primary action', async () => {
    await saveProfile(profileOf());
    await openStart();

    const banner = await screen.findByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Carnet' })).toBeVisible();
    expect(within(banner).getByRole('link', { name: 'Signes de danger' })).toBeVisible();
    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(document.querySelectorAll('.button--primary')).toHaveLength(0);
    expect(screen.getByText('Cet outil ne remplace pas un soignant.')).toBeVisible();
  });

  it('says when the knowledge base is out of date, above the field, and nothing while it is not', async () => {
    await saveProfile(profileOf());
    const fresh = await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf({ ...pack, date: '2026-11-01' }),
    });
    await screen.findByRole('searchbox', { name: FIELD });
    expect(screen.queryByText(/^Base de connaissances ancienne/)).toBeNull();
    fresh.unmount();

    // More than 90 days after the pack date.
    await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf({ ...pack, date: '2026-07-01' }),
    });
    const stale = await screen.findByText(
      'Base de connaissances ancienne : plus de 90 jours. Faites-la mettre à jour au poste de santé.',
    );
    expect(stale).toBeVisible();
    expect(stale.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('says at its end whether the phone opens the app without the Internet, then its links', async () => {
    await saveProfile(profileOf());
    await openStart();
    await screen.findByRole('heading', { level: 1, name: START });

    // The test browser has no service worker: the check says so, and what to do.
    const line = document.querySelector('main .offline-ready');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveTextContent(
      "Ce navigateur ne peut pas garder l'application pour l'ouvrir sans Internet. Ouvrez-la dans Chrome.",
    );
    expect(field().compareDocumentPosition(line as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const settings = screen.getByRole('link', { name: 'Réglages' });
    expect(
      (line as Node).compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('links to her profile, the settings, the knowledge base status and the about screen', async () => {
    await saveProfile(profileOf());
    await openStart();
    await screen.findByRole('heading', { level: 1, name: START });

    const targets = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(targets.sort()).toEqual([
      '#/',
      '#/about',
      '#/danger',
      '#/profile',
      '#/profile',
      '#/settings',
      '#/status',
    ]);
    // "Modifier" in the line of her term, "Mon profil" with the quiet links at the end.
    const edit = screen.getByRole('link', { name: 'Modifier' });
    expect(document.querySelector('.check__profile')).toContainElement(edit);
    expect(screen.getByRole('link', { name: 'Mon profil' })).toHaveClass('button--quiet');
  });

  it('is the list of profiles in accompanied mode', async () => {
    await renderApp({ settings: accompanied, hash: '#/', packLoader: loaderOf(pack) });

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Mon profil' })).toBeNull();
  });

  it('says once that her profile was saved, and not again after a reload', async () => {
    await saveProfile(profileOf({ pseudonym: 'Moi', self: true }));
    // As the profile screen leaves it, set before anything renders.
    const { unmount } = await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      entryState: inSession({ profileSaved: 'Moi' }),
    });

    expect(await screen.findByText('Profil enregistré : Moi.')).toBeVisible();
    // The check takes the note off the history entry in an effect: wait for it, not for the clock.
    await waitFor(() => {
      expect(sessionState()['profileSaved']).toBeUndefined();
    });

    unmount();
    await renderApp({ settings: woman, hash: '#/', packLoader: loaderOf(pack) });
    expect(await screen.findByRole('searchbox', { name: FIELD })).toBeVisible();
    expect(screen.queryByText(/^Profil enregistré/)).toBeNull();
  });

  it('says so when the knowledge base could not be loaded', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/', packLoader: noPack });

    expect(
      await screen.findByText(
        "Les informations sur les produits ne sont pas encore sur ce téléphone. Ouvrez l'application une fois avec Internet.",
      ),
    ).toBeVisible();
  });

  it('says nothing about the knowledge base while it is still loading', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/', packLoader: pendingPack });

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(screen.queryByText(/Les informations sur les produits/)).toBeNull();
  });

  it('opens nothing on a code the phone could not keep, and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    breakIndexedDB('SecurityError');
    const user = userEvent.setup();
    await renderApp();

    await user.click(await screen.findByRole('button', { name: /^Je suis enceinte/ }));
    await makeCode(user);

    // A code storage did not keep opens nothing: the welcome asks again, and says why.
    await waitFor(() => {
      expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(
        /Le code n'a pas pu être enregistré sur ce téléphone\. Essayez encore\.$/,
      );
    });
    expect(screen.queryByRole('heading', { level: 1, name: START })).toBeNull();
  });

  it('says nothing about settings when they are stored', async () => {
    await saveProfile(profileOf());
    await openStart();

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(screen.queryByText(/n'a pas pu garder vos réglages/)).toBeNull();
  });

  it('shows the offline badge when the phone is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await saveProfile(profileOf());
    await openStart();

    expect(within(await screen.findByRole('banner')).getByText('Hors ligne')).toBeVisible();
  });
});

/** Her check, open, with nothing listed. */
async function openCheck(settings: Settings = woman, options: { voice?: VoiceService } = {}) {
  await saveProfile(profileOf());
  const probe = probeCheck();
  await renderApp({
    settings,
    hash: '#/',
    packLoader: loaderOf(pack),
    children: probe.element,
    ...options,
  });
  await screen.findByRole('heading', { level: 1, name: START });
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
    expect(window.location.hash).toBe('#/');
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
    expect(window.location.hash).toBe('#/');
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
    // "Yes" is an answer among others, never a primary action of the check.
    const yes = within(asked).getByRole('button', { name: "Oui, c'est ce produit" });
    expect(yes).toHaveClass('button--secondary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(0);

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
    expect(window.location.hash).toBe('#/');
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

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
    expect(window.location.hash).toBe('#/');
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

    expect(await screen.findByRole('heading', { level: 1, name: START })).toBeVisible();
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
    const { user } = await openStart();
    await addThrough(user, 'kinkeliba');
    // The danger signs present now come first, on the check (SCRUM-56, S13).
    await user.click(screen.getByRole('button', { name: 'Non, aucun de ces signes' }));

    // On the check itself, under the answer (SCRUM-56, S15).
    expect(await screen.findByRole('heading', { level: 2, name: 'Résultat' })).toBeVisible();
    expect(window.location.hash).toBe('#/');
    // Kinkeliba has no rule and evidence 0: we do not know, never reassurance.
    expect(await screen.findByRole('article', { name: 'On ne sait pas. Kinkéliba' })).toHaveClass(
      'level--unknown',
    );
  });
});

describe('untilMidnight: her term read again at midnight (SCRUM-56, 8.3)', () => {
  it('waits until just after the next midnight of the phone', () => {
    expect(untilMidnight(new Date(2026, 10, 4, 23, 59, 30))).toBe(31_000);
    expect(untilMidnight(new Date(2026, 10, 4, 0, 0, 0))).toBe(24 * 3600 * 1000 + 1000);
    // The last day of a month too.
    expect(untilMidnight(new Date(2026, 10, 30, 12, 0, 0))).toBe(12 * 3600 * 1000 + 1000);
  });
});
