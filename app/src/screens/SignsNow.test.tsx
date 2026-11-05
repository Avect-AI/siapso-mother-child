// SPDX-License-Identifier: MIT
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

/**
 * The check of the stored profile with kinkeliba, then "Voir le résultat", as
 * from Home (or from the list of profiles, which starts the check for her).
 */
async function openSigns({
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
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
  return { probe, user };
}

describe('Danger signs now, before the result', () => {
  it('asks once, "Aucun de ces signes" first and explicit, then the signs of a pregnancy', async () => {
    await openSigns();

    const title = 'Avez-vous un de ces signes maintenant\u00a0?';
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeVisible();
    // The list comes once the pack and the profile are read.
    const question = await screen.findByRole('group', { name: title });
    // The new screen's heading took the focus, and kept it while the list arrived.
    expect(screen.getByRole('heading', { level: 1, name: title })).toHaveFocus();
    const boxes = within(question).getAllByRole('checkbox');
    expect(boxes[0]).toHaveAccessibleName('Aucun de ces signes');
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    // A pregnant woman: the pregnancy signs, the others one tap away.
    expect(within(question).getByRole('group', { name: 'Pendant la grossesse' })).toBeVisible();
    expect(within(question).queryByRole('group', { name: 'Chez le bébé' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: label('fever') })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Voir tous les signes' })).toHaveClass(
      'button--secondary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
  });

  it('needs an answer to go on to the result', async () => {
    const { user } = await openSigns();
    await screen.findByRole('checkbox', { name: 'Aucun de ces signes' });

    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));

    expect(
      screen.getByText('Répondez : Aucun de ces signes, ou les signes présents maintenant.'),
    ).toBeVisible();
    const none = screen.getByRole('checkbox', { name: 'Aucun de ces signes' });
    expect(none).toHaveFocus();
    expect(none).toHaveAttribute('aria-invalid', 'true');
    expect(window.location.hash).toBe('#/signs');
    expect(screen.queryByRole('heading', { level: 1, name: 'Résultat' })).toBeNull();
  });

  it('takes the signs into the evaluation: a fever now is a danger finding in the result', async () => {
    const { user, probe } = await openSigns();

    await user.click(await screen.findByRole('checkbox', { name: label('fever') }));
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    const goForTest = pack.messages.fr['danger-sign-fever']?.orientation ?? 'missing';
    expect(await screen.findByRole('heading', { level: 2, name: goForTest })).toBeVisible();
    expect(screen.getAllByRole('article')[0]).toHaveClass('level--danger');
    expect(probe.current().signs).toEqual(['fever']);
    await waitFor(async () => {
      expect((await listHistory('p1'))[0]?.signs).toEqual(['fever']);
    });

    // Back from the result asks again, nothing ticked ("now" may have changed); back again, the list.
    window.history.back();
    expect(await screen.findByRole('checkbox', { name: label('fever') })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aucun de ces signes' })).not.toBeChecked();
    window.history.back();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
  });

  it('never ticks an earlier answer: each check asks again, with nothing ticked', async () => {
    const { user } = await openSigns();
    await user.click(await screen.findByRole('checkbox', { name: 'Aucun de ces signes' }));
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    await user.click(await screen.findByRole('button', { name: 'Revenir à la liste' }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });

    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));

    const none = await screen.findByRole('checkbox', { name: 'Aucun de ces signes' });
    expect(none).not.toBeChecked();
    // One tap cannot reuse the earlier answer.
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    expect(screen.getByText(/^Répondez/)).toBeVisible();
    expect(window.location.hash).toBe('#/signs');
  });

  it('keeps a sign ticked after Back when the browser goes Forward to the result', async () => {
    const { user, probe } = await openSigns();
    await user.click(await screen.findByRole('checkbox', { name: 'Aucun de ces signes' }));
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    await screen.findByRole('heading', { level: 1, name: 'Résultat' });

    window.history.back();
    await user.click(await screen.findByRole('checkbox', { name: label('fever') }));
    window.history.forward();

    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    // The cards come once the profile is read.
    expect((await screen.findAllByRole('article'))[0]).toHaveClass('level--danger');
    expect(probe.current().signs).toEqual(['fever']);
  });

  it('asks again on Forward when nothing was answered after Back', async () => {
    const { user } = await openSigns();
    await user.click(await screen.findByRole('checkbox', { name: 'Aucun de ces signes' }));
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    await screen.findByRole('heading', { level: 1, name: 'Résultat' });

    window.history.back();
    await screen.findByRole('checkbox', { name: 'Aucun de ces signes' });
    // Forward arrives as an event; the result then sends back to the question.
    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: /^Avez-vous un de ces signes/ }),
    ).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Aucun de ces signes' })).not.toBeChecked();
  });

  it('goes to the result once, however fast "Voir le résultat" is pressed twice', async () => {
    const { user } = await openSigns();
    await user.click(await screen.findByRole('checkbox', { name: 'Aucun de ces signes' }));
    const length = window.history.length;
    const go = screen.getByRole('button', { name: 'Voir le résultat' });

    go.click();
    go.click();

    await screen.findByRole('heading', { level: 1, name: 'Résultat' });
    expect(window.history.length).toBe(length + 1);
  });

  it('gives "none" and a sign as answers that exclude each other', async () => {
    const { user, probe } = await openSigns();
    const fever = await screen.findByRole('checkbox', { name: label('fever') });
    const none = screen.getByRole('checkbox', { name: 'Aucun de ces signes' });

    await user.click(fever);
    await user.click(none);
    expect(none).toBeChecked();
    expect(fever).not.toBeChecked();
    await user.click(fever);
    expect(none).not.toBeChecked();
    await user.click(fever);
    // Nothing ticked is no answer, never "none".
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    expect(screen.getByText(/^Répondez/)).toBeVisible();

    await user.click(none);
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    expect(probe.current()).toMatchObject({ signs: [], signsGiven: true });
    expect(screen.queryByRole('alert')).toBeNull();
    // The result's way back goes to the list, past this step.
    await user.click(await screen.findByRole('button', { name: 'Revenir à la liste' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
  });

  it('asks about after the birth and the baby when she breastfeeds; every sign on request', async () => {
    const breastfeeding = profileOf({ pregnant: false, breastfeeding: true, babyAgeWeeks: 6 });
    const { user } = await openSigns({ settings: accompanied, profile: breastfeeding });

    const title = 'A-t-elle un de ces signes maintenant\u00a0?';
    const question = await screen.findByRole('group', { name: title });
    expect(within(question).getByRole('group', { name: "Après l'accouchement" })).toBeVisible();
    expect(within(question).getByRole('group', { name: 'Chez le bébé' })).toBeVisible();
    expect(within(question).queryByRole('group', { name: 'Pendant la grossesse' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Voir tous les signes' }));
    expect(within(question).getByRole('group', { name: 'Pendant la grossesse' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Voir tous les signes' })).toBeNull();
    expect(within(question).getAllByRole('checkbox')).toHaveLength(pack.dangerSigns.length + 1);
  });

  it('asks about after the birth and the baby up front when the baby may be born: a possibly past term', async () => {
    // "Je ne sais pas" to the term, 40 days ago: the check reads breastfeeding as possible.
    const unknown = profileOf({ term: { kind: 'unknown', givenOn: '2026-09-25' } });
    await openSigns({ settings: accompanied, profile: unknown });

    const question = await screen.findByRole('group', {
      name: 'A-t-elle un de ces signes maintenant ?',
    });
    expect(within(question).getByRole('group', { name: 'Pendant la grossesse' })).toBeVisible();
    expect(within(question).getByRole('group', { name: "Après l'accouchement" })).toBeVisible();
    expect(within(question).getByRole('group', { name: 'Chez le bébé' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Voir tous les signes' })).toBeNull();
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
    await openSigns({ profile: pregnant });

    const question = await screen.findByRole('group', {
      name: 'Avez-vous un de ces signes maintenant ?',
    });
    expect(within(question).getByRole('group', { name: 'Pendant la grossesse' })).toBeVisible();
    expect(within(question).getByRole('group', { name: "Après l'accouchement" })).toBeVisible();
    expect(within(question).getByRole('group', { name: 'Chez le bébé' })).toBeVisible();
  });

  it('comes before the result: a result opened without an answer goes to this step', async () => {
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

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Avez-vous un de ces signes maintenant ?',
      }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/signs');
    expect(await listHistory('p1')).toEqual([]);
  });

  it('goes to the check when there is no check in progress', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/signs', packLoader: loaderOf(pack) });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/check');
  });

  it('says the list is missing without a pack, and lets the result say what it cannot do', async () => {
    const { user } = await openSigns({ packLoader: noPack });

    expect(
      await screen.findByText("La liste des signes de danger n'est pas encore sur ce téléphone."),
    ).toBeVisible();
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
  });
});
