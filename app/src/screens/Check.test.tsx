// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAppDb } from '../data/db.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';

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

/** Adds an item through the search and confirm screens, as the user does. */
async function addThrough(
  user: ReturnType<typeof userEvent.setup>,
  list: 'Ajouter un médicament' | 'Ajouter un remède',
  query: string,
) {
  await user.click(await screen.findByRole('button', { name: list }));
  await user.type(await screen.findByRole('searchbox'), query);
  const candidates = await screen.findByRole('list');
  // Enter opens the confirm screen of the best candidate (a tap may add it at once, SCRUM-56).
  expect(within(candidates).getAllByRole('button').length).toBeGreaterThan(0);
  await user.keyboard('{Enter}');
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

  it('gives the check its heading and the focus once her profile is read', async () => {
    await saveProfile(profileOf());
    await openCheckFromHome();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    await waitFor(() => {
      expect(heading).toHaveFocus();
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
    const before = document.querySelector('.check__profile')?.textContent?.replace('Awa', '');
    await user.click(awa.getByRole('button', { name: 'Situations : touchez pour les afficher' }));
    expect(awa.getByText('Situations : aucune')).toBeVisible();

    const fatou = await open('Fatou');
    expect(document.querySelector('.check__profile')?.textContent?.replace('Fatou', '')).toBe(
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
    expect(screen.queryByRole('button', { name: 'Ajouter un médicament' })).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Ajouter un médicament' })).toBeVisible();
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
    await addThrough(user, 'Ajouter un médicament', 'paracetamol 500');
    await addThrough(user, 'Ajouter un remède', 'kinkeliba');

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
