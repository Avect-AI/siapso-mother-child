// SPDX-License-Identifier: MIT
// The danger signs present now, asked on the check screen (SCRUM-56, S13;
// these were the tests of the screen it replaces, SignsNow).
import type { CheckedItem, Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listHistory, recordHistory } from '../data/history.js';
import type { LoadedPack } from '../data/pack-loader.js';
import { saveProfile } from '../data/profiles.js';
import type { Profile, Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, noPack, renderApp, storeTestCode } from '../test/render-app.js';

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
}: { settings?: Settings; profile?: Profile; packLoader?: () => Promise<LoadedPack> } = {}) {
  await saveProfile(profile);
  const probe = probeCheck();
  await renderApp({ settings, hash: '#/', packLoader, children: probe.element });
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

    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    expect(probe.current()).toMatchObject({ signs: [], signsGiven: true });
    expect(screen.queryByRole('alert')).toBeNull();
    // The result's way back goes to the check.
    await user.click(await screen.findByRole('button', { name: 'Revenir à la liste' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
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

  it('takes the signs into the evaluation: a fever now is a danger finding in the result', async () => {
    const { user, probe } = await openCheckWithItem();
    const asked = await question();
    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));
    await user.click(within(asked).getByRole('checkbox', { name: label('fever') }));
    await user.click(within(asked).getByRole('button', { name: 'Voir le résultat' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    const goForTest = pack.messages.fr['danger-sign-fever']?.orientation ?? 'missing';
    expect(await screen.findByRole('heading', { level: 2, name: goForTest })).toBeVisible();
    expect(screen.getAllByRole('article')[0]).toHaveClass('level--danger');
    expect(probe.current().signs).toEqual(['fever']);
    await waitFor(async () => {
      expect((await listHistory('p1'))[0]?.signs).toEqual(['fever']);
    });

    // Back from the result: the check asks again, nothing chosen ("now" may have changed).
    window.history.back();
    const again = await question();
    expect(within(again).queryByRole('checkbox')).toBeNull();
    expect(within(again).getByRole('button', { name: 'Oui, au moins un' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await waitFor(() => {
      expect(probe.current().signsGiven).toBe(false);
    });
  });

  it('never takes an earlier answer: each showing of the check asks again', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Revenir à la liste' }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });

    await question();
    expect(probe.current().signsGiven).toBe(false);
  });

  it('keeps a sign ticked after Back when the browser goes Forward to the result', async () => {
    const { user, probe } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Résultat' });

    window.history.back();
    const asked = await question();
    await user.click(within(asked).getByRole('button', { name: 'Oui, au moins un' }));
    await user.click(within(asked).getByRole('checkbox', { name: label('fever') }));
    window.history.forward();

    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    expect((await screen.findAllByRole('article'))[0]).toHaveClass('level--danger');
    expect(probe.current().signs).toEqual(['fever']);
  });

  it('asks again on Forward when nothing was answered after Back', async () => {
    const { user } = await openCheckWithItem();
    await user.click(
      within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Résultat' });

    window.history.back();
    await question();
    // Forward arrives as an event; the result then sends back to the check.
    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(await question()).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
    expect(window.location.hash).toBe('#/check');
  });

  it('goes to the result once, however fast "Non, aucun de ces signes" is pressed twice', async () => {
    const { probe } = await openCheckWithItem();
    const none = within(await question()).getByRole('button', { name: 'Non, aucun de ces signes' });
    const length = window.history.length;

    none.click();
    none.click();

    await screen.findByRole('heading', { level: 1, name: 'Résultat' });
    expect(window.history.length).toBe(length + 1);
    expect(probe.current().signsGiven).toBe(true);
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
  });
});
