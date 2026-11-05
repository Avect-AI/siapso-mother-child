// SPDX-License-Identifier: MIT
import type { DangerSign, Pack } from '@siapso/engine';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hangIndexedDB } from '../test/idb.js';
import { knowledgePack } from '../test/knowledge-pack.js';
import { loaderOf, noPack, pendingPack, renderApp, shellPack } from '../test/render-app.js';

const signs: DangerSign[] = [
  { id: 'bleeding', group: 'pregnancy', label: { fr: 'Saignement', en: 'Bleeding' }, sources: [] },
  { id: 'fever', group: 'baby', label: { fr: 'Fièvre du bébé', en: 'Baby fever' }, sources: [] },
];

const missingFr = "La liste des signes de danger n'est pas encore sur ce téléphone.";
const missingEn = 'The list of danger signs is not on this phone yet.';
const emptyEn = 'The list of danger signs has not been added yet.';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

beforeEach(() => {
  // The shell pack has no rules or messages: the instruction falls back to the standard one.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Danger signs', () => {
  it('says when to go to the health post, who to call, then the pack danger signs in their groups', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'accompanied', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(shellPack(signs)),
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Danger signs' })).toBeVisible();
    expect(screen.getByText('If you see a danger sign:')).toBeVisible();
    expect(screen.getByText('Go to the health post now.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'See who to call' })).toHaveAttribute(
      'href',
      '#/danger/call',
    );
    const question = await screen.findByRole('group', { name: 'Which signs do you see now?' });
    const pregnancy = within(question).getByRole('group', { name: 'During pregnancy' });
    expect(within(pregnancy).getByRole('checkbox', { name: 'Bleeding' })).not.toBeChecked();
    const baby = within(question).getByRole('group', { name: 'In the baby' });
    expect(within(baby).getByRole('checkbox', { name: 'Baby fever' })).toBeVisible();
    // Large answers: the whole label is the target.
    expect(screen.getByText('Bleeding').closest('label')).toHaveClass('option');
    expect(screen.getByRole('button', { name: 'It is serious now' })).toHaveClass(
      'button--primary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    expect(screen.queryByText(missingEn)).toBeNull();
    expect(screen.queryByText(emptyEn)).toBeNull();
    expect(screen.getByRole('link', { name: 'Danger signs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('never refuses "It is serious now": with no sign, the danger instruction and who to call', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(shellPack(signs)),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'It is serious now' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Who to call' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Danger sign Go to the health post now.');
    expect(screen.queryByText(/^Tick/)).toBeNull();
    // No sign ticked: no signs to say.
    expect(screen.queryByText('Say these signs on the phone or at the health post:')).toBeNull();
    expect(await screen.findByText('No contact saved on this phone.')).toBeVisible();
  });

  it('keeps the signs ticked for the call, and back finds them ticked', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(shellPack(signs)),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('checkbox', { name: 'Bleeding' }));
    await user.click(screen.getByRole('button', { name: 'It is serious now' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Who to call' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Danger sign Go to the health post now.');
    expect(screen.getByText('Say these signs on the phone or at the health post:')).toBeVisible();
    expect(screen.getByRole('listitem')).toHaveTextContent('Bleeding');
    // The circuit is always there: the contacts, or that there are none.
    expect(await screen.findByText('No contact saved on this phone.')).toBeVisible();

    window.history.back();
    expect(await screen.findByRole('checkbox', { name: 'Bleeding' })).toBeChecked();
  });

  it('says "go to the health post now" whatever the signs: she said it is serious now', async () => {
    await renderApp({
      settings: { lang: 'fr', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(pack),
    });
    const user = userEvent.setup();
    const fever = pack.dangerSigns.find((d) => d.id === 'fever');
    await user.click(await screen.findByRole('checkbox', { name: fever?.label.fr ?? 'missing' }));
    await user.click(screen.getByRole('button', { name: "C'est grave maintenant" }));

    // A fever alone: still the danger orientation, not the result's "test today".
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Allez au poste de santé maintenant.' }),
    ).toBeVisible();
    const ownInstruction = pack.messages.fr['danger-sign-fever']?.orientation ?? 'missing';
    expect(screen.queryByText(ownInstruction)).toBeNull();
    // All 21 signs were offered, in three groups.
    window.history.back();
    expect(await screen.findAllByRole('checkbox')).toHaveLength(pack.dangerSigns.length);
    for (const group of ['Pendant la grossesse', "Après l'accouchement", 'Chez le bébé']) {
      expect(screen.getByRole('group', { name: group })).toBeVisible();
    }
    // In the order the content gives them (fever, then bleeding...), never sorted by id.
    const pregnancy = within(screen.getByRole('group', { name: 'Pendant la grossesse' }));
    const written = pack.dangerSigns.filter((d) => d.group === 'pregnancy').map((d) => d.label.fr);
    expect(
      pregnancy.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent),
    ).toEqual(written);
    expect(written.slice(0, 2)).toEqual(['Fièvre', 'Saignement par le vagin']);
  });

  it('goes straight to who to call, claiming no danger', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(shellPack(signs)),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'See who to call' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Who to call' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('If you see a danger sign:')).toBeVisible();
    expect(screen.getByText('Go to the health post now.')).toBeVisible();
    expect(await screen.findByText('No contact saved on this phone.')).toBeVisible();
  });

  it('while the pack is loading, shows the orientation and claims nothing about the list', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: pendingPack,
    });

    expect(await screen.findByText('Go to the health post now.')).toBeVisible();
    expect(screen.getByText('If you see a danger sign:')).toBeVisible();
    expect(screen.getByRole('link', { name: 'See who to call' })).toBeVisible();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(missingEn)).toBeNull();
    expect(screen.queryByText(emptyEn)).toBeNull();
  });

  it('says the list is not on the phone when no pack could be loaded', async () => {
    await renderApp({
      settings: { lang: 'fr', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: noPack,
    });

    expect(await screen.findByText(missingFr)).toBeVisible();
    // Testing Library turns the no-break space before ":" into a plain space when it reads the page.
    expect(screen.getByText('Si vous voyez un signe de danger :')).toBeVisible();
    expect(screen.getByText('Allez au poste de santé maintenant.')).toBeVisible();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Voir qui appeler' })).toBeVisible();
  });

  it('says the list has not been added yet when the loaded pack has no danger sign', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger',
      packLoader: loaderOf(shellPack([])),
    });

    expect(await screen.findByText(emptyEn)).toBeVisible();
    expect(screen.queryByText(missingEn)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('opens before the welcome questions are answered', async () => {
    await renderApp({ hash: '#/danger' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Signes de danger' }),
    ).toBeVisible();
    expect(screen.getByRole('banner')).toBeVisible();
  });

  it('opens at once, without waiting for storage that does not answer', async () => {
    hangIndexedDB();
    await renderApp({ hash: '#/danger', storageTimeoutMs: 60_000 });

    expect(screen.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
    expect(screen.getByText('Allez au poste de santé maintenant.')).toBeVisible();
  });
});
