// SPDX-License-Identifier: MIT
import type { CheckedItem, Pack } from '@siapso/engine';
import { act, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listHistory, recordHistoryOnce } from '../data/history.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { enterCode } from '../test/code-steps.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { probeSession } from '../test/session-probe.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';

// Every result that would be kept goes through recordHistoryOnce, called as
// the result shows: watched, so a check that keeps nothing can be told apart.
vi.mock('../data/history.js', async (importOriginal) => {
  const history = await importOriginal<typeof import('../data/history.js')>();
  return { ...history, recordHistoryOnce: vi.fn(history.recordHistoryOnce) };
});

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
  vi.mocked(recordHistoryOnce).mockClear();
});

vi.setConfig({ testTimeout: 30_000 });

const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const ADVIL: CheckedItem = { ref: { kind: 'product', id: 'advil-400-mg-63646874' } };
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function option(groupName: string | RegExp, name: string | RegExp) {
  return within(screen.getByRole('group', { name: groupName })).getByRole('radio', { name });
}

/** The list of profiles, then "Regarder sans enregistrer". */
async function openQuick(settings = accompanied) {
  await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
  const probe = probeCheck();
  const session = probeSession();
  const user = userEvent.setup();
  await renderApp({
    settings,
    hash: '#/',
    packLoader: loaderOf(pack),
    children: (
      <>
        {probe.element}
        {session.element}
      </>
    ),
  });
  await user.click(await screen.findByRole('button', { name: 'Regarder sans enregistrer' }));
  await screen.findByRole('heading', { level: 1, name: 'Regarder sans enregistrer' });
  return { user, probe, session };
}

/** Pregnant at `weeks` weeks known today, not breastfeeding, no situation; then the check. */
async function answer(user: UserEvent, weeks: string) {
  await user.click(option(/^Enceinte/, 'Oui'));
  await user.click(option('Terme de la grossesse', 'En semaines'));
  await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), weeks);
  await user.click(option(/^Ce terme date de quand/, "Aujourd'hui"));
  await user.click(option(/^Allaite/, 'Non'));
  await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
  await user.click(screen.getByRole('button', { name: 'Regarder ses produits' }));
  await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" });
}

describe('Regarder sans enregistrer', () => {
  it('asks the pregnancy, the term, breastfeeding and the situations, never a pseudonym', async () => {
    await openQuick();

    expect(
      screen.getByText(/aucun profil et aucun historique ne restent sur ce téléphone/),
    ).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Surnom' })).toBeNull();
    // "Je ne sais pas" is an answer: an unknown pregnancy takes every window.
    expect(option(/^Enceinte/, 'Je ne sais pas')).toBeVisible();
    expect(screen.getByRole('group', { name: /^Allaite/ })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Aucune de ces situations' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Regarder ses produits' })).toHaveClass(
      'button--primary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
  });

  it('takes her weeks as given today, an answer shown and one tap from "Un autre jour" (SCRUM-56, S7)', async () => {
    const { user } = await openQuick();

    await user.click(option(/^Enceinte/, 'Oui'));
    // The term in weeks by default, the field ready to type in (S5).
    expect(option('Terme de la grossesse', 'En semaines')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveFocus();
    await user.keyboard('24');

    expect(option(/^Ce terme date de quand/, "Aujourd'hui")).toBeChecked();
    expect(option(/^Ce terme date de quand/, 'Un autre jour')).not.toBeChecked();
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Regarder ses produits' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" }),
    ).toBeVisible();
  });

  it('checks a passer-by with the term rules of a profile, and keeps no profile and no history', async () => {
    const { user, probe } = await openQuick();
    await answer(user, '24');

    // Who it is for: no pseudonym, and where she stands.
    const who = document.querySelector('.check__profile');
    expect(who).toHaveTextContent(/^Femme de passage/);
    expect(who).toHaveTextContent('Environ 24 semaines');
    expect((await listProfiles()).map((p) => p.pseudonym)).toEqual(['Awa']);

    act(() => {
      probe.current().add(ADVIL);
    });
    // The danger signs present now, on the check (SCRUM-56, S13).
    await user.click(await screen.findByRole('button', { name: 'Non, aucun de ces signes' }));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Résultat, sans enregistrer',
      }),
    ).toBeVisible();
    // An NSAID from 20 weeks, as for a profile at 24 weeks.
    expect(
      await screen.findByRole('heading', { level: 2, name: /^À montrer avant la prochaine prise/ }),
    ).toBeVisible();
    expect(
      screen.getByText(/^Terme utilisé pour ce résultat\s: environ 24 semaines/),
    ).toBeVisible();
    // Every effect of the result has run: nothing was sent to the history.
    await act(async () => {
      await Promise.resolve();
    });
    expect(recordHistoryOnce).not.toHaveBeenCalled();
    const id = probe.current().profileId ?? '';
    expect(await listHistory(id)).toEqual([]);
    expect(await listProfiles()).toHaveLength(1);
  });

  it('still keeps the result of a woman with a profile (the same steps, from her row)', async () => {
    const { user, probe } = await openQuick();
    act(() => {
      window.history.back();
    });
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    await user.click(within(list).getByRole('button', { name: /^Awa/ }));
    await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" });
    act(() => {
      probe.current().add(ADVIL);
    });
    // The danger signs present now, on the check (SCRUM-56, S13).
    await user.click(await screen.findByRole('button', { name: 'Non, aucun de ces signes' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Résultat pour Awa' }),
    ).toBeVisible();
    await screen.findByRole('heading', { level: 2, name: /^À montrer avant la prochaine prise/ });
    await act(async () => {
      await Promise.resolve();
    });
    expect(recordHistoryOnce).toHaveBeenCalledTimes(1);
  });

  it('reads "Je ne sais pas" as a possible pregnancy of unknown term', async () => {
    const { user } = await openQuick();
    await user.click(option(/^Enceinte/, 'Je ne sais pas'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Regarder ses produits' }));

    await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" });
    expect(document.querySelector('.check__profile')).toHaveTextContent(
      'Grossesse possible, terme inconnu',
    );
  });

  it('goes back to the list of profiles from the check, and the next passer-by starts again', async () => {
    const { user, probe } = await openQuick();
    await answer(user, '24');
    act(() => {
      probe.current().add(ADVIL);
    });
    act(() => {
      window.history.back();
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Regarder sans enregistrer' }));
    await screen.findByRole('heading', { level: 1, name: 'Regarder sans enregistrer' });
    // Nothing of the earlier passer-by: the answers and the list start empty.
    expect(option(/^Enceinte/, 'Oui')).not.toBeChecked();
    await answer(user, '10');
    expect(screen.getByText(/^Rien n'est encore ajouté\./)).toBeVisible();
  });

  it('forgets the passer-by at the quick exit', async () => {
    const { user, probe, session } = await openQuick();
    await answer(user, '24');
    act(() => {
      probe.current().add(ADVIL);
    });

    act(() => {
      session.current().quickExit();
    });

    expect(probe.current()).toMatchObject({ profileId: null, items: [], quick: null });
  });

  it('lets the passer-by go when the mode changes: woman mode never shows her', async () => {
    const { user, probe } = await openQuick();
    await answer(user, '24');
    act(() => {
      probe.current().add(ADVIL);
    });

    act(() => {
      window.location.hash = '#/settings';
    });
    await screen.findByRole('heading', { level: 1, name: 'Réglages' });
    await user.click(screen.getByRole('radio', { name: /^Je suis enceinte/ }));
    // A choice of mode applies with its button only.
    expect(probe.current().quick).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Changer de mode' }));

    expect(probe.current()).toMatchObject({ quick: null, items: [] });
    act(() => {
      window.location.hash = '#/check';
    });
    // Her own profile, never the passer-by's answers.
    expect(
      await screen.findByRole('heading', { level: 1, name: /^(Ce que vous prenez|Mon profil)$/ }),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Femme de passage|Environ 24 semaines/);
  });

  it('lets the passer-by go at a lock: the code opens the list of profiles', async () => {
    const { user, probe, session } = await openQuick();
    await answer(user, '24');
    act(() => {
      probe.current().add(ADVIL);
    });

    act(() => {
      session.current().lock();
    });
    expect(probe.current()).toMatchObject({ quick: null, items: [] });
    await enterCode(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
  });

  it('asks the term again, keeping her list, when her term is past 42 weeks', async () => {
    const { user, probe } = await openQuick();
    // Weeks given long ago (a phone clock set forward meanwhile): past 42 weeks.
    act(() => {
      probe.current().startQuick(
        profileOf({
          id: 'passer-by',
          self: false,
          term: { kind: 'weeks', weeks: 30, givenOn: '2026-01-05' },
        }),
      );
      probe.current().add(ADVIL);
    });
    act(() => {
      window.location.hash = '#/check';
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: /^Le terme noté a passé 42 semaines/ }),
    ).toBeVisible();
    // She has no profile: never one named, never one opened, never one to update.
    expect(screen.getByText(/^Femme de passage/)).toBeVisible();
    expect(screen.getByText('Reprenez ses réponses avant de regarder un produit.')).toBeVisible();
    expect(document.body.textContent).not.toContain('profil à jour');
    await user.click(screen.getByRole('button', { name: 'Non, toujours enceinte' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Regarder sans enregistrer' }),
    ).toBeVisible();
    expect(screen.getByText("Donnez le terme d'aujourd'hui.")).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '30');
    await user.click(option(/^Ce terme date de quand/, "Aujourd'hui"));
    await user.click(screen.getByRole('button', { name: 'Regarder ses produits' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([ADVIL]);
    expect(probe.current().quick?.term).toMatchObject({ kind: 'weeks', weeks: 30 });
    expect(await listProfiles()).toHaveLength(1);
  });

  it('is for accompanied mode only: in woman mode the address goes home', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/quick', packLoader: loaderOf(pack) });

    expect(
      await screen.findByRole('heading', { level: 1, name: /^Un médicament ou un remède/ }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/');
  });
});
