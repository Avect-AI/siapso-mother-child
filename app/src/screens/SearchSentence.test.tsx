// SPDX-License-Identifier: MIT
// The products named inside a sentence (SCRUM-61, team feedback of
// 2026-11-05), with a fake speech package (test/voice.ts): what the voice
// heard is read as a sentence, each product found is offered ticked, and the
// ones ticked are confirmed one after the other on their confirm screens.
// Nothing is added without its confirmation.
import type { Pack } from '@siapso/engine';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';
import { fakeSpeech, type FakeSpeechOptions } from '../test/voice.js';
import { createVoiceService } from '../voice/voice-service.js';

beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
/** The French no-break space before ":" and in "1000 mg", as a pattern. */
const NBSP = '\\s';
const TITLE = /^Produits trouvés dans la phrase\s:$/;
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

/** Opens the check, then the search of one list, with a fake voice. */
async function openSearch(
  list: 'Ajouter un médicament' | 'Ajouter un remède',
  options: FakeSpeechOptions = {},
) {
  await saveProfile(profileOf());
  const speech = fakeSpeech(options);
  const probe = probeCheck();
  await renderApp({
    settings: woman,
    hash: '#/check',
    packLoader: loaderOf(pack),
    voice: createVoiceService(speech.port),
    children: probe.element,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: list }));
  const field = await screen.findByRole('searchbox');
  return { user, field, probe };
}

/** Says a sentence into the microphone of the medicines' search. */
async function say(
  transcript: string,
  list: Parameters<typeof openSearch>[0] = 'Ajouter un médicament',
) {
  const opened = await openSearch(list, { installed: ['wo'], transcript });
  const mic = () =>
    screen.getByRole('button', { name: /^(Dire le nom|Terminer l'enregistrement)$/ });
  await opened.user.click(mic());
  await screen.findByText("J'écoute en wolof.");
  await opened.user.click(mic());
  // Testing Library reads a no-break space of the page as a space.
  await screen.findByText(`J'ai entendu : ${transcript}`);
  const group = await screen.findByRole('group', { name: TITLE });
  return { ...opened, group };
}

const add = () => screen.getByRole('button', { name: 'Ajouter les produits cochés' });

describe('Search: products said in a sentence', () => {
  it('lists the products a sentence names, each ticked, and adds nothing yet', async () => {
    const { group, probe } = await say('dama naan nivaquine ak coartem');
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box).toBeChecked();
    expect(boxes[0]?.closest('label')).toHaveTextContent(/Chloroquine/);
    expect(boxes[1]?.closest('label')).toHaveTextContent(/luméfantrine/i);
    // The sentence is not a name: no candidate of the whole text, never added as typed.
    expect(screen.queryByRole('list', { name: 'Propositions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Je ne trouve pas ce produit' })).toBeNull();
    expect(probe.current().items).toEqual([]);
  });

  it('confirms each product ticked in turn, then goes back to the check with them', async () => {
    const { user, probe } = await say('dama naan nivaquine ak coartem');
    await user.click(add());
    expect(window.location.hash).toBe('#/confirm/product');
    expect(await screen.findByText('Produit 1 sur 2 trouvés dans la phrase')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(probe.current().items).toEqual([]);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    expect(await screen.findByText('Produit 2 sur 2 trouvés dans la phrase')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items.map((item) => item.ref)).toEqual([
      { kind: 'product', id: 'chloroquine-generic' },
      { kind: 'product', id: 'artemether-lumefantrine-generic' },
    ]);
  });

  it('passes over a product she says is not the one, and adds the next', async () => {
    const { user, probe } = await say('dama naan nivaquine ak coartem');
    await user.click(add());
    await screen.findByText('Produit 1 sur 2 trouvés dans la phrase');
    await user.click(screen.getByRole('button', { name: 'Non, passer au suivant' }));
    await screen.findByText('Produit 2 sur 2 trouvés dans la phrase');
    // The last one: no next, and nothing was added yet, so "no" searches again.
    expect(screen.getByRole('button', { name: 'Non, chercher encore' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    expect(probe.current().items.map((item) => item.ref)).toEqual([
      { kind: 'product', id: 'artemether-lumefantrine-generic' },
    ]);
  });

  it('goes back to the list when the last product is not the one, after one was added', async () => {
    const { user, probe } = await say('dama naan nivaquine ak coartem');
    await user.click(add());
    await screen.findByText('Produit 1 sur 2 trouvés dans la phrase');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    await screen.findByText('Produit 2 sur 2 trouvés dans la phrase');
    await user.click(screen.getByRole('button', { name: 'Non, revenir à la liste' }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    expect(probe.current().items.map((item) => item.ref)).toEqual([
      { kind: 'product', id: 'chloroquine-generic' },
    ]);
  });

  it('confirms only the products left ticked', async () => {
    const { user, group, probe } = await say('dama naan nivaquine ak coartem');
    await user.click(within(group).getAllByRole('checkbox')[1] as HTMLElement);
    await user.click(add());
    // One product: no count of the products to confirm.
    await screen.findByRole('button', { name: "Oui, c'est ce produit" });
    expect(screen.queryByText(/trouvés dans la phrase$/)).toBeNull();
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    expect(probe.current().items.map((item) => item.ref)).toEqual([
      { kind: 'product', id: 'chloroquine-generic' },
    ]);
  });

  it('asks to tick a product when none is ticked', async () => {
    const { user, group } = await say('dama naan nivaquine ak coartem');
    for (const box of within(group).getAllByRole('checkbox')) await user.click(box);
    await user.click(add());
    expect(screen.getByText('Cochez au moins un produit, ou écrivez le nom.')).toBeVisible();
    expect(window.location.hash).toBe('#/search/product');
  });

  it('opens a remedy said with a medicine on its own confirm screen', async () => {
    const { user, group, probe } = await say('dama naan nivaquine ak kinkéliba');
    expect(within(group).getAllByRole('checkbox')[1]?.closest('label')).toHaveTextContent('Remède');
    await user.click(add());
    await screen.findByText('Produit 1 sur 2 trouvés dans la phrase');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    expect(
      await screen.findByRole('heading', { level: 1, name: /^Est-ce bien ce remède\s\?$/ }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/confirm/plant');
    expect(screen.getByText('Produit 2 sur 2 trouvés dans la phrase')).toBeVisible();
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce remède" }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    expect(probe.current().items.map((item) => item.ref)).toEqual([
      { kind: 'product', id: 'chloroquine-generic' },
      { kind: 'plant', id: 'kinkeliba' },
    ]);
  });

  it('says the strength said with a product', async () => {
    const { group } = await say('dama naan doliprane 1000 ak nivaquine');
    expect(within(group).getAllByRole('checkbox')[0]?.closest('label')).toHaveTextContent(
      new RegExp(`Dosage dit${NBSP}: 1000${NBSP}mg`),
    );
  });

  it('offers unticked a name that is also a common word', async () => {
    const { group } = await say('sama goro moo ma jox nivaquine');
    const [first, second] = within(group).getAllByRole('checkbox');
    expect(first?.closest('label')).toHaveTextContent(/cola/i);
    expect(first?.closest('label')).toHaveTextContent(
      new RegExp(`goro${NBSP}» a aussi un autre sens`),
    );
    expect(first).not.toBeChecked();
    expect(second).toBeChecked();
  });
});

describe('Search: a name the voice split into words', () => {
  it('offers it unticked, saying what was heard, and adds it only once ticked and confirmed', async () => {
    const { user, group, probe } = await say(
      'je bois une tisanne de King Kyliba',
      'Ajouter un remède',
    );
    const box = within(group).getByRole('checkbox');
    expect(box).not.toBeChecked();
    expect(box.closest('label')).toHaveTextContent(/Kinkéliba/);
    expect(box.closest('label')).toHaveTextContent(
      new RegExp(`À confirmer${NBSP}: j'ai entendu «${NBSP}King Kyliba${NBSP}»`),
    );
    await user.click(add());
    expect(screen.getByText('Cochez au moins un produit, ou écrivez le nom.')).toBeVisible();
    await user.click(box);
    await user.click(add());
    await user.click(await screen.findByRole('button', { name: "Oui, c'est ce remède" }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    expect(probe.current().items.map((item) => item.ref)).toEqual([
      { kind: 'plant', id: 'kinkeliba' },
    ]);
  });
});

describe('Search: products typed in a sentence', () => {
  it('reads a typed sentence of three words or more that has no candidate', async () => {
    const { user, field } = await openSearch('Ajouter un médicament', { supported: false });
    await user.type(field, "j'ai pris doliparan hier");
    const group = await screen.findByRole('group', { name: TITLE });
    expect(within(group).getByRole('checkbox')).toBeChecked();
    expect(within(group).getByRole('checkbox').closest('label')).toHaveTextContent(/DOLIPRANE/i);
    // Typed, not heard: the text may still be added as written.
    expect(screen.getByRole('button', { name: 'Je ne trouve pas ce produit' })).toBeVisible();
  });
});
