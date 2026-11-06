// SPDX-License-Identifier: MIT
// The danger signs present now, asked on the check screen (SCRUM-56, S13;
// these were the tests of the screen it replaces, SignsNow).
import type { CheckedItem, Pack } from '@siapso/engine';
import type { ReactNode } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listHistory, recordHistory } from '../data/history.js';
import type { LoadedPack } from '../data/pack-loader.js';
import { saveProfile } from '../data/profiles.js';
import type { Profile, Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { enterCode } from '../test/code-steps.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, noPack, renderApp, storeTestCode } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const KINKELIBA: CheckedItem = { ref: { kind: 'plant', id: 'kinkeliba' } };
const WOMAN_TITLE = 'Avez-vous un de ces signes maintenant ?';
const ACCOMPANIED_TITLE = 'A-t-elle un de ces signes maintenant ?';
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function label(id: string): string {
  const sign = pack.dangerSigns.find((d) => d.id === id);
  if (sign === undefined) throw new Error(`no sign ${id}`);
  return sign.label.fr;
}

/** The question of the check, by its heading. */
async function question(title: string = WOMAN_TITLE): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  const section = heading.closest('section');
  if (section === null) throw new Error('no question');
  return section;
}

/** The check of the stored profile with kinkeliba listed, as from Home or the list of profiles. */
async function openCheckWithItem({
  settings = woman,
  profile = profileOf(),
  packLoader = loaderOf(pack),
  children,
}: {
  settings?: Settings;
  profile?: Profile;
  packLoader?: () => Promise<LoadedPack>;
  /** Another probe rendered in the app (the session). */
  children?: ReactNode;
} = {}) {
  await saveProfile(profile);
  const probe = probeCheck();
  await renderApp({
    settings,
    hash: '#/',
    packLoader,
    children: (
      <>
        {probe.element}
        {children}
      </>
    ),
  });
  await screen.findByRole('heading', { level: 1 });
  act(() => {
    probe.current().start(profile.id);
  });
  act(() => {
    window.location.hash = '#/check';
  });
  await screen.findByRole('heading', { level: 1, name: /^Ce qu/ });
  await waitFor(() => {
    expect(probe.current().profileId).toBe(profile.id);
  });
  act(() => {
    probe.current().add(KINKELIBA);
  });
  return { probe, user: userEvent.setup() };
}

describe('Danger signs now, on the check before the result (S13)', () => {
  it('is asked once a product is listed, never before, the signs of a pregnancy in words', async () => {
    await saveProfile(profileOf());
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/check',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    // Nothing listed: no question, no result.
    expect(screen.queryByRole('heading', { level: 2, name: WOMAN_TITLE })).toBeNull();
    act(() => {
      probe.current().add(KINKELIBA);
    });

    const asked = await question();
    // The signs of her groups written right above the answer.
    expect(asked).toHaveTextContent(
      /^Avez-vous un de ces signes maintenant\s\?Fièvre, saignement par le vagin, /,
    );
    expect(asked).toHaveTextContent(label('baby-not-moving').toLocaleLowerCase());
    expect(asked).not.toHaveTextContent(/après l'accouchement/i);
    // Two answers, neither chosen, neither the primary action.
    const none = within(asked).getByRole('button', { name: 'Non, aucun de ces signes' });
    const some = within(asked).getByRole('button', { name: 'Oui, au moins un' });
    expect(none).toHaveClass('button--secondary');
    expect(some).toHaveClass('button--secondary');
    expect(some).toHaveAttribute('aria-expanded', 'false');
    expect(within(asked).queryByRole('checkbox')).toBeNull();
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(0);
    expect(within(asked).getByRole('button', { name: 'Voir tous les signes' })).toHaveClass(
      'button--quiet',
    );
    expect(probe.current().signsGiven).toBe(false);
  });

  it('opens the result on "Non, aucun de ces signes", with no sign', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );

    // The result under the answer, on the check itself (SCRUM-56, S15).
    const result = await screen.findByRole('heading', { level: 2, name: 'Résultat' });
    expect(result).toBeVisible();
    expect(window.location.hash).toBe('#/check');
    expect(probe.current()).toMatchObject({ signs: [], signsGiven: true });
    expect(screen.queryByRole('alert')).toBeNull();
    // The answer said in a line in place of the question, with "Changer" (S14).
    expect(screen.getByText(/^Signes de danger maintenant\s: aucun$/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Changer la réponse sur les signes de danger' }),
    ).toHaveTextContent('Changer');
    expect(screen.queryByRole('heading', { level: 2, name: WOMAN_TITLE })).toBeNull();
    await waitFor(() => {
      expect(result).toHaveFocus();
    });
  });

  it('asks again on "Changer": the result hidden until a new answer, nothing chosen', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    await user.click(
      screen.getByRole('button', { name: 'Changer la réponse sur les signes de danger' }),
    );

    expect(screen.queryByRole('heading', { level: 2, name: 'Résultat' })).toBeNull();
    expect(probe.current().signsGiven).toBe(false);
    const heading = screen.getByRole('heading', { level: 2, name: WOMAN_TITLE });
    expect(heading).toHaveFocus();
    const asked = await question();
    expect(within(asked).getByRole('button', { name: 'Oui, au moins un' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(asked).queryByRole('checkbox')).toBeNull();
  });

  it('keeps the answer when a product is added or taken off (S14), the result worked out again', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });
    expect(screen.getAllByRole('article')).toHaveLength(1);

    act(() => {
      probe.current().add({ ref: { kind: 'product', id: 'advil-400-mg-63646874' } });
    });

    // Not asked again: the result follows the list at once.
    expect(probe.current().signsGiven).toBe(true);
    expect(screen.queryByRole('heading', { level: 2, name: WOMAN_TITLE })).toBeNull();
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });
    act(() => {
      probe.current().remove(1);
    });
    expect(probe.current().signsGiven).toBe(true);
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(1);
    });
  });

  it('shows every group in words on "Voir tous les signes", the focus on them', async () => {
    const { user } = await openCheckWithItem();
    const asked = await question();
    await user.click(within(asked).getByRole('button', { name: 'Voir tous les signes' }));

    expect(asked).toHaveTextContent(/Pendant la grossesse\s: Fièvre/);
    expect(asked).toHaveTextContent(
      /Après l'accouchement\s: Saignement abondant après l'accouchement/,
    );
    expect(asked).toHaveTextContent(/Chez le bébé\s: Le bébé ne tète pas/);
    expect(document.querySelector('.check__sign-words')).toHaveFocus();
    expect(within(asked).queryByRole('button', { name: 'Voir tous les signes' })).toBeNull();
  });

  it('opens the list on "Oui, au moins un", nothing ticked, the focus on its first sign', async () => {
    const { user, probe } = await openCheckWithItem();
    const asked = await question();
    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));

    const list = within(asked).getByRole('group', { name: WOMAN_TITLE });
    expect(within(asked).getByRole('button', { name: 'Oui, au moins un' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const boxes = within(list).getAllByRole('checkbox');
    // No "none" box in the list: "Non" is its own answer.
    expect(within(list).queryByRole('checkbox', { name: /^Aucun/ })).toBeNull();
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(boxes[0]).toHaveFocus();
    expect(within(list).getByRole('group', { name: 'Pendant la grossesse' })).toBeVisible();
    expect(within(list).queryByRole('group', { name: 'Chez le bébé' })).toBeNull();
    // Its one action is the primary one of the screen.
    expect(within(asked).getByRole('button', { name: 'Voir le résultat' })).toHaveClass(
      'button--primary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    expect(probe.current().signsGiven).toBe(false);
  });

  it('needs at least one sign ticked to go on from the list', async () => {
    const { user, probe } = await openCheckWithItem();
    const asked = await question();
    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));
    await user.click(within(asked).getByRole('button', { name: 'Voir le résultat' }));

    expect(
      within(asked).getByText(
        /^Cochez au moins un signe présent maintenant, ou répondez\s: Non, aucun de ces signes\.$/,
      ),
    ).toBeVisible();
    const fever = within(asked).getByRole('checkbox', { name: label('fever') });
    expect(fever).toHaveAttribute('aria-invalid', 'true');
    expect(within(asked).getAllByRole('checkbox')[0]).toHaveFocus();
    expect(window.location.hash).toBe('#/check');
    expect(probe.current().signsGiven).toBe(false);
  });

  it('takes the signs into the evaluation: a fever now is a danger finding, the banner focused', async () => {
    const { user, probe } = await openCheckWithItem();
    const asked = await question();
    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));
    await user.click(within(asked).getByRole('checkbox', { name: label('fever') }));
    await user.click(within(asked).getByRole('button', { name: 'Voir le résultat' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Résultat' })).toBeVisible();
    const goForTest = pack.messages.fr['danger-sign-fever']?.orientation ?? 'missing';
    expect(await screen.findByRole('heading', { level: 3, name: goForTest })).toBeVisible();
    expect(screen.getAllByRole('article')[0]).toHaveClass('level--danger');
    expect(probe.current().signs).toEqual(['fever']);
    // A danger when it first shows: the banner takes the focus (S15).
    await waitFor(() => {
      expect(document.querySelector('.check__danger')).toHaveFocus();
    });
    expect(screen.getByText(/^Signes de danger maintenant\s: fièvre$/)).toBeVisible();
    await waitFor(async () => {
      expect((await listHistory('p1'))[0]?.signs).toEqual(['fever']);
    });
  });

  it('forgets the answer when the check is left by Back: asked again, nothing chosen (S14)', async () => {
    // The check opened from Home: Back goes Home, Forward to the check again.
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });
    expect(probe.current().signsGiven).toBe(true);

    window.history.back();
    await screen.findByRole('button', { name: 'Regarder un produit' });
    await waitFor(() => {
      expect(probe.current().signsGiven).toBe(false);
    });
    window.history.forward();
    const again = await question();
    expect(within(again).queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Résultat' })).toBeNull();
  });

  it("forgets the answer when the band's danger signs are opened (S14)", async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    await user.click(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Signes de danger' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Signes de danger' });
    expect(probe.current().signsGiven).toBe(false);
    window.history.back();
    expect(await question()).toBeVisible();
    expect(screen.queryByRole('heading', { level: 2, name: 'Résultat' })).toBeNull();
  });

  it('forgets the answer when her profile is opened and saved (S14)', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    act(() => {
      window.location.hash = '#/profile';
    });
    await screen.findByRole('heading', { level: 1, name: 'Mon profil' });
    await waitFor(() => {
      expect(probe.current().signsGiven).toBe(false);
    });
    window.history.back();
    expect(await question()).toBeVisible();
  });

  it('forgets the answer at a lock, and never gives it back after the code (S14)', async () => {
    const session = probeSession();
    const { user, probe } = await openCheckWithItem({ children: session.element });
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    act(() => {
      session.current().lock();
    });
    await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' });
    expect(probe.current().signsGiven).toBe(false);
    await enterCode(user);

    // The same check given back, its list kept, the answer asked again.
    expect(await question()).toBeVisible();
    expect(probe.current().items).toEqual([KINKELIBA]);
    expect(screen.queryByRole('heading', { level: 2, name: 'Résultat' })).toBeNull();
  });

  it('forgets the answer at the quick exit (S14)', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Quitter' }));
    await screen.findByRole('heading', { level: 1, name: 'Carnet' });
    expect(probe.current()).toMatchObject({ signsGiven: false, items: [] });
  });

  it('forgets the answer when her answers change while the check is open (saved elsewhere)', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    // Her profile saved again meanwhile (another tab), then the page shows again.
    await saveProfile(
      profileOf({ breastfeeding: true, babyAgeWeeks: 1, updatedAt: '2026-11-04T09:30:00.000Z' }),
    );
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(probe.current().signsGiven).toBe(false);
    });
    expect(await question()).toBeVisible();
  });

  it('brings a danger into view when a product added makes one, and keeps it in the history once taken off (S15)', async () => {
    // Misoprostol with a scarred womb at 30 weeks: a danger.
    const scar = profileOf({
      conditions: ['uterine-scar'],
      term: { kind: 'weeks', weeks: 30, givenOn: '2026-11-04' },
    });
    const { user, probe } = await openCheckWithItem({ profile: scar });
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    const heading = await screen.findByRole('heading', { level: 2, name: 'Résultat' });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => {
      probe.current().add({ ref: { kind: 'product', id: 'misoprostol-generic' } });
    });
    // The level became a danger: the banner speaks and takes the focus.
    expect(await screen.findByRole('alert')).toBeVisible();
    await waitFor(() => {
      expect(document.querySelector('.check__danger')).toHaveFocus();
    });
    await waitFor(async () => {
      expect((await listHistory('p1'))[0]?.level).toBe('danger');
    });

    act(() => {
      probe.current().remove(1);
    });
    // Lower again: said once by the live line; the history keeps the danger shown.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(
      within(screen.getByRole('region', { name: 'Résultat' })).getByText(
        /^Résultat mis à jour\s: On ne sait pas$/,
      ),
    ).toHaveAttribute('role', 'status');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const kept = await listHistory('p1');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ level: 'danger', items: [KINKELIBA] });
  });

  it('keeps nothing in the history for a passer-by, whatever is shown', async () => {
    const passerBy = profileOf({ id: 'quick-1', pseudonym: '' });
    await saveProfile(profileOf());
    const probe = probeCheck();
    await renderApp({
      settings: accompanied,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    await screen.findByRole('heading', { level: 1 });
    act(() => {
      probe.current().startQuick(passerBy);
      probe.current().add(KINKELIBA);
    });
    act(() => {
      window.location.hash = '#/check';
    });
    const user = userEvent.setup();
    await user.click(
      within(await question(ACCOMPANIED_TITLE)).getByRole('button', {
        name: 'Non, aucun de ces signes',
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Résultat, sans enregistrer' }),
    ).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await listHistory('quick-1')).toEqual([]);
  });

  it('asks whether the baby is born in the middle of a check once her term passes 42 weeks (8.3)', async () => {
    // Just before midnight, 42 weeks given today: the check and its result as usual.
    vi.setSystemTime(new Date(2026, 10, 4, 23, 59, 30));
    const late = profileOf({ term: { kind: 'weeks', weeks: 42, givenOn: '2026-11-04' } });
    const { user, probe } = await openCheckWithItem({ profile: late });
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    // A minute later the day has changed: the page shown again reads her term again.
    vi.setSystemTime(new Date(2026, 10, 5, 0, 0, 30));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Votre terme noté a passé 42 semaines/,
      }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { level: 2, name: 'Résultat' })).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    // The list waits in memory for her updated term.
    expect(probe.current().items).toEqual([KINKELIBA]);
  });

  it('reads her term again when the code opens the app after a long time away (8.3)', async () => {
    const session = probeSession();
    const late = profileOf({ term: { kind: 'weeks', weeks: 41, givenOn: '2026-11-04' } });
    const { user } = await openCheckWithItem({ profile: late, children: session.element });
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Résultat' });

    // Five weeks later: the app locked meanwhile; the code gives the check back.
    vi.setSystemTime(new Date(2026, 11, 9, 10, 0));
    act(() => {
      session.current().lock();
    });
    await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' });
    await enterCode(user);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Votre terme noté a passé 42 semaines/,
      }),
    ).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('gives one answer and keeps one history entry, however fast "Non" is pressed twice', async () => {
    const { probe } = await openCheckWithItem();
    const none = within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' });
    const length = window.history.length;

    none.click();
    none.click();

    await screen.findByRole('heading', { level: 2, name: 'Résultat' });
    // No screen and no history entry of the browser for it.
    expect(window.history.length).toBe(length);
    expect(probe.current().signsGiven).toBe(true);
    await waitFor(async () => {
      expect(await listHistory('p1')).toHaveLength(1);
    });
  });

  it('asks about after the birth and the baby when she breastfeeds; every sign on request', async () => {
    const breastfeeding = profileOf({ pregnant: false, breastfeeding: true, babyAgeWeeks: 6 });
    const { user } = await openCheckWithItem({ settings: accompanied, profile: breastfeeding });

    const asked = await question(ACCOMPANIED_TITLE);
    expect(asked).toHaveTextContent(/Après l'accouchement\s: /);
    expect(asked).toHaveTextContent(/Chez le bébé\s: /);
    expect(asked).not.toHaveTextContent(/Pendant la grossesse/);

    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));
    const list = within(asked).getByRole('group', { name: ACCOMPANIED_TITLE });
    expect(within(list).getByRole('group', { name: "Après l'accouchement" })).toBeVisible();
    expect(within(list).queryByRole('group', { name: 'Pendant la grossesse' })).toBeNull();
    await user.click(within(asked).getByRole('button', { name: 'Voir tous les signes' }));
    expect(within(list).getByRole('group', { name: 'Pendant la grossesse' })).toBeVisible();
    expect(within(asked).queryByRole('button', { name: 'Voir tous les signes' })).toBeNull();
    expect(within(list).getAllByRole('checkbox')).toHaveLength(pack.dangerSigns.length);
  });

  it('puts the focus on the first sign shown by "Voir tous les signes" in the list, wherever its section is', async () => {
    // A pregnancy: the new sections come after the shown one.
    const { user } = await openCheckWithItem();
    const asked = await question();
    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));
    await user.click(within(asked).getByRole('button', { name: 'Voir tous les signes' }));
    const postpartum = within(asked).getByRole('group', { name: "Après l'accouchement" });
    expect(within(postpartum).getAllByRole('checkbox')[0]).toHaveFocus();
    expect(within(postpartum).getAllByRole('checkbox')[0]).not.toBeChecked();
  });

  it('puts the focus on the first sign of a section shown before the others', async () => {
    const breastfeeding = profileOf({ pregnant: false, breastfeeding: true, babyAgeWeeks: 6 });
    const { user } = await openCheckWithItem({ settings: accompanied, profile: breastfeeding });
    const asked = await question(ACCOMPANIED_TITLE);
    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));
    within(asked).getByRole('button', { name: 'Voir tous les signes' }).focus();
    await user.keyboard('{Enter}');
    const pregnancy = within(asked).getByRole('group', { name: 'Pendant la grossesse' });
    expect(within(pregnancy).getAllByRole('checkbox')[0]).toHaveFocus();
  });

  it('asks about after the birth and the baby up front when the baby may be born: a possibly past term', async () => {
    // "Je ne sais pas" to the term, 40 days ago: the check reads breastfeeding as possible.
    const unknown = profileOf({ term: { kind: 'unknown', givenOn: '2026-09-25' } });
    await openCheckWithItem({ settings: accompanied, profile: unknown });

    const asked = await question(ACCOMPANIED_TITLE);
    expect(asked).toHaveTextContent(/Pendant la grossesse\s: /);
    expect(asked).toHaveTextContent(/Après l'accouchement\s: /);
    expect(asked).toHaveTextContent(/Chez le bébé\s: /);
    expect(within(asked).queryByRole('button', { name: 'Voir tous les signes' })).toBeNull();
  });

  it('asks about every group when the phone date is before a result already kept, as the check reads it', async () => {
    const pregnant = profileOf();
    await saveProfile(pregnant);
    await recordHistory({
      id: 'h1',
      profileId: pregnant.id,
      at: '2026-11-20T10:00:00.000Z',
      packVersion: '0.1.0',
      level: 'unknown',
      ruleIds: [],
      items: [KINKELIBA],
      signs: [],
    });
    await openCheckWithItem({ profile: pregnant });

    const asked = await question();
    expect(asked).toHaveTextContent(/Pendant la grossesse\s: /);
    expect(asked).toHaveTextContent(/Après l'accouchement\s: /);
    expect(asked).toHaveTextContent(/Chez le bébé\s: /);
  });

  it('comes before the result: a result opened without an answer goes to the check', async () => {
    await saveProfile(profileOf());
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    await screen.findByRole('heading', { level: 1 });
    act(() => {
      probe.current().start('p1');
      probe.current().add(KINKELIBA);
    });
    // A typed address or an old history entry: no answer about the signs yet.
    act(() => {
      window.location.hash = '#/result';
    });

    expect(await question()).toBeVisible();
    expect(window.location.hash).toBe('#/check');
    expect(await listHistory('p1')).toEqual([]);
  });

  it('sends the old address of the signs screen to the check', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/signs', packLoader: loaderOf(pack) });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/check');
  });

  it('says the list is missing without a pack, and lets the result say what it cannot do', async () => {
    const { user } = await openCheckWithItem({ packLoader: noPack });

    const asked = await question();
    expect(
      within(asked).getByText("La liste des signes de danger n'est pas encore sur ce téléphone."),
    ).toBeVisible();
    expect(within(asked).queryByRole('checkbox')).toBeNull();
    await user.click(within(asked).getByRole('button', { name: 'Voir le résultat' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Résultat' })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Résultat' })).getByText(
        /pas encore sur ce téléphone/,
      ),
    ).toBeVisible();
  });
});
