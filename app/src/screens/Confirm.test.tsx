// SPDX-License-Identifier: MIT
import { evaluate, type CheckedItem, type Pack } from '@siapso/engine';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import { contextFromProfile } from '../domain/context.js';
import type { Settings } from '../domain/types.js';
import { inSession } from '../state/entry-state.js';
import { probeCheck } from '../test/check-probe.js';
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
const NBSP = ' ';
const PRODUCT_TITLE = `Est-ce bien ce produit${NBSP}?`;
const STRENGTH = `Quel dosage est écrit sur la boîte${NBSP}?`;
const UNITS = `Combien d'unités par jour${NBSP}?`;
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

/** From the check, searches `query` in a list and opens its first candidate. */
async function confirmFirst(list: 'Ajouter un médicament' | 'Ajouter un remède', query: string) {
  await saveProfile(profileOf());
  const probe = probeCheck();
  await renderApp({
    settings: woman,
    hash: '#/check',
    packLoader: loaderOf(pack),
    children: probe.element,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: list }));
  await user.type(await screen.findByRole('searchbox'), query);
  const candidates = await screen.findByRole('list');
  // Enter opens the confirm screen of the best candidate (a tap may add it at once, SCRUM-56).
  expect(within(candidates).getAllByRole('button').length).toBeGreaterThan(0);
  await user.keyboard('{Enter}');
  await screen.findByRole('button', { name: 'Non, chercher encore' });
  return { user, probe };
}

function product() {
  return document.querySelector('.confirm__product');
}

/** A daily count given with the "+" key, `n` times (the strength of paracetamol is then asked). */
async function giveCount(user: ReturnType<typeof userEvent.setup>, n: number) {
  for (let i = 0; i < n; i += 1) {
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
  }
}

async function backOnCheck() {
  return screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
}

describe('Confirm: a remedy', () => {
  it('shows its name, Latin name and the local name it was found by, and adds it only on yes', async () => {
    const { user, probe } = await confirmFirst('Ajouter un remède', 'nebeday');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Est-ce bien ce remède/);
    expect(product()).toHaveTextContent('Moringa');
    expect(product()).toHaveTextContent('Moringa oleifera');
    // toHaveTextContent reads the no-break space before the colon as a space.
    expect(product()).toHaveTextContent('Nom local : nebeday (wolof)');
    // Read with Wolof and Latin rules, not French ones (WCAG 3.1.2).
    expect(within(product() as HTMLElement).getByText('nebeday')).toHaveAttribute('lang', 'wo');
    expect(within(product() as HTMLElement).getByText('Moringa oleifera')).toHaveAttribute(
      'lang',
      'la',
    );
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('textbox', { name: UNITS })).toBeNull();
    expect(probe.current().items).toEqual([]);

    await user.click(screen.getByRole('button', { name: "Oui, c'est ce remède" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([{ ref: { kind: 'plant', id: 'moringa' } }]);
    expect(screen.getByText('Moringa')).toBeVisible();
    // Back to the check entry itself: no confirm or search entry stacked after it.
    expect(window.location.hash).toBe('#/check');
  });

  it('goes back to the check once, however fast "yes" is pressed twice', async () => {
    const { probe } = await confirmFirst('Ajouter un remède', 'nebeday');
    const yes = screen.getByRole('button', { name: "Oui, c'est ce remède" });

    // Two clicks in the same task, before any render.
    yes.click();
    yes.click();

    expect(await backOnCheck()).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Still on the check: a second way back would have gone past it.
    expect(window.location.hash).toBe('#/check');
    expect(screen.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
    expect(probe.current().items).toEqual([{ ref: { kind: 'plant', id: 'moringa' } }]);
  });

  it('adds nothing on no, and goes back to the search with the text typed', async () => {
    const { user, probe } = await confirmFirst('Ajouter un remède', 'kinkeliba');

    await user.click(screen.getByRole('button', { name: 'Non, chercher encore' }));

    expect(await screen.findByRole('searchbox')).toHaveValue('kinkeliba');
    expect(probe.current().items).toEqual([]);
  });
});

describe('Confirm: units per day', () => {
  it('asks for units for a product whose substance has a daily maximum, and keeps the count', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'paracetamol 500');

    const units = screen.getByRole('textbox', { name: UNITS });
    expect(units).toHaveValue('');
    expect(units).toHaveAccessibleDescription(
      'Par exemple, le nombre de comprimés, de sachets ou de suppositoires pris en un jour. Laissez vide si vous ne savez pas.',
    );
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    await user.click(screen.getByRole('button', { name: 'Une unité de moins' }));
    expect(units).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'paracetamol-500-generic' }, unitsPerDay: 2 },
    ]);
    expect(screen.getByText('2 unités par jour')).toBeVisible();
  });

  it('never asks for units for a product without a daily maximum', async () => {
    await confirmFirst('Ajouter un médicament', 'ibuprofene');

    expect(screen.getByRole('heading', { level: 1, name: PRODUCT_TITLE })).toBeVisible();
    expect(product()).toHaveTextContent('Ibuprofène (générique)');
    expect(screen.queryByRole('textbox', { name: UNITS })).toBeNull();
  });

  it('keeps a blank count as not known', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'paracetamol 1000');

    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'paracetamol-1000-generic' } },
    ]);
  });

  it('refuses a count outside 1 to 24 and says so, adding nothing', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'paracetamol 500');

    const units = screen.getByRole('textbox', { name: UNITS });
    await user.type(units, '30');
    expect(screen.getByText('Écrivez un nombre entier de 1 à 24, ou laissez vide.')).toBeVisible();
    expect(units).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(units).toHaveFocus();
    expect(probe.current().items).toEqual([]);

    // The step down starts again from the highest count accepted.
    await user.click(screen.getByRole('button', { name: 'Une unité de moins' }));
    expect(units).toHaveValue('24');
    expect(units).not.toHaveAttribute('aria-invalid');
  });

  it('steps down from 1 to blank, not to 0', async () => {
    const { user } = await confirmFirst('Ajouter un médicament', 'paracetamol 500');

    const units = screen.getByRole('textbox', { name: UNITS });
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    await user.click(screen.getByRole('button', { name: 'Une unité de moins' }));
    await user.click(screen.getByRole('button', { name: 'Une unité de moins' }));
    expect(units).toHaveValue('');
  });
});

describe('Confirm: the strength on the box', () => {
  it('adds a brand without asking its strength while no daily count is given (SCRUM-56, S10)', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'doliprane');

    // No rule reads the strength of paracetamol without a daily count.
    expect(screen.queryByRole('group', { name: STRENGTH })).toBeNull();
    // Never a silent strength: said not given.
    expect(product()).toHaveTextContent(/^DOLIPRANEParacétamolDosage non connu$/);
    // The daily count stays in sight, blank for "I do not know".
    const units = screen.getByRole('textbox', { name: UNITS });
    expect(units).toHaveValue('');
    expect(units).toHaveAccessibleDescription(/Laissez vide si vous ne savez pas\.$/);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-100-mg-66057393' }, strengthUnknown: true },
    ]);
  });

  it('asks the strength once a daily count is given, none chosen for her, and refuses yes without an answer', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'doliprane');
    await giveCount(user, 1);

    const question = screen.getByRole('group', { name: STRENGTH });
    expect(question).toHaveAccessibleDescription(
      // A strength may be written in g ("1 g") or with ml ("125 mg/5 ml").
      `Sur la boîte ou sur la plaquette${NBSP}: le nombre suivi de mg ou de g.`,
    );
    const answers = within(question).getAllByRole('radio');
    expect(answers.every((answer) => !(answer as HTMLInputElement).checked)).toBe(true);
    // The brand is said once, above: each answer starts with what the box shows.
    expect(within(question).getByRole('radio', { name: '1000 mg, comprimé' })).toBeVisible();
    expect(within(question).queryByRole('radio', { name: /DOLIPRANE/ })).toBeNull();
    expect(answers.at(-1)).toHaveAccessibleName('Je ne sais pas');
    expect(answers.at(-1)?.closest('label')).toHaveClass('option--none');
    // Until she answers, the brand and its substance, no strength; the count stays.
    expect(product()).toHaveTextContent(/^DOLIPRANEParacétamol$/);
    expect(screen.getByRole('textbox', { name: UNITS })).toHaveValue('1');
    expect(document.querySelector('.confirm__adding')).toBeNull();

    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    // Text matchers read each no-break space as a space.
    expect(
      within(question).getByText('Choisissez un dosage, ou « Je ne sais pas ».'),
    ).toBeVisible();
    expect(answers[0]).toHaveFocus();
    expect(probe.current().items).toEqual([]);

    await user.click(within(question).getByRole('radio', { name: '1000 mg, comprimé' }));
    expect(product()).toHaveTextContent('Paracétamol 1000 mg');
    // Said again where "yes" is.
    expect(document.querySelector('.confirm__adding')).toHaveTextContent(
      'Vous ajoutez : DOLIPRANE 1000 mg, comprimé',
    );
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    expect(
      within(document.querySelector('.units') as HTMLElement).getByRole('status'),
    ).toHaveTextContent('2 unités par jour');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-1000-mg-60234100' }, unitsPerDay: 2 },
    ]);
  });

  it('lets the question go again when the count is taken off, the strength then not given', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'doliprane');
    await giveCount(user, 1);
    await user.click(screen.getByRole('radio', { name: `1000${NBSP}mg, comprimé` }));

    await user.click(screen.getByRole('button', { name: 'Une unité de moins' }));

    expect(screen.queryByRole('group', { name: STRENGTH })).toBeNull();
    expect(product()).toHaveTextContent(/Dosage non connu$/);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-100-mg-66057393' }, strengthUnknown: true },
    ]);
  });

  it('asks the strength of aspirin without a count: a rule reads it (ASPEGIC, KARDEGIC)', async () => {
    await confirmFirst('Ajouter un médicament', 'kardegic');

    const question = screen.getByRole('group', { name: STRENGTH });
    expect(
      within(question)
        .getAllByRole('radio')
        .every((answer) => !(answer as HTMLInputElement).checked),
    ).toBe(true);
    expect(within(question).getAllByRole('radio').at(-1)).toHaveAccessibleName('Je ne sais pas');
  });

  it('keeps the brand with its strength unknown and the count when she does not know it', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'doliprane');
    await giveCount(user, 3);

    await user.click(screen.getByRole('radio', { name: 'Je ne sais pas' }));
    expect(product()).toHaveTextContent(/^DOLIPRANEParacétamolDosage non connu$/);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      {
        ref: { kind: 'product', id: 'doliprane-100-mg-66057393' },
        unitsPerDay: 3,
        strengthUnknown: true,
      },
    ]);
    const row = within(screen.getByRole('list', { name: 'Produits ajoutés' })).getByRole(
      'listitem',
    );
    expect(row).toHaveTextContent('DOLIPRANE');
    expect(row).toHaveTextContent('Dosage non connu');
    expect(row).not.toHaveTextContent(/\d+\s?mg/);
  });

  it('asks nothing of a brand whose strength no rule reads, its strength said not given (COVERSYL)', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'coversyl');

    expect(screen.queryByRole('group', { name: STRENGTH })).toBeNull();
    expect(screen.queryByRole('textbox', { name: UNITS })).toBeNull();
    expect(product()).toHaveTextContent(/Dosage non connu$/);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'coversyl-10-mg-68391071' }, strengthUnknown: true },
    ]);
  });

  it('asks nothing when the products of the family differ only by their form', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'dafalgan codeine');

    expect(screen.queryByRole('group', { name: STRENGTH })).toBeNull();
    const added = product()?.textContent ?? '';
    // The brand and its strengths: the form was not asked.
    expect(added).toMatch(/^DAFALGAN CODEINE 500\s?mg\/30\s?mg/);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toHaveLength(1);
    expect(probe.current().items[0]?.ref).toMatchObject({ kind: 'product' });
    expect(probe.current().items[0]).not.toHaveProperty('strengthUnknown');
  });

  it('says the product chosen once she has settled on it, not at every move', async () => {
    const { user } = await confirmFirst('Ajouter un médicament', 'doliprane');
    await giveCount(user, 1);

    expect(product()).not.toHaveAttribute('aria-live');
    const announcer = document.querySelector('.confirm__announce');
    expect(announcer).toHaveAttribute('role', 'status');
    expect(announcer).toHaveTextContent('');
    await user.click(screen.getByRole('radio', { name: '500 mg, comprimé' }));
    await user.click(screen.getByRole('radio', { name: '1000 mg, comprimé' }));
    await waitFor(() => {
      expect(announcer).toHaveTextContent('Vous ajoutez : DOLIPRANE 1000 mg, comprimé');
    });
  });

  it('preselects the strength typed in the query', async () => {
    await confirmFirst('Ajouter un médicament', 'doliprane 1000');

    const checked = screen
      .getAllByRole('radio')
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]?.getAttribute('value')).toMatch(/^doliprane-1000-mg-/);
  });

  it('asks the strength of a generic as of a brand, once a count is given: nothing chosen', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'paracetamol');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    await giveCount(user, 2);

    const answers = screen.getAllByRole('radio');
    expect(answers.every((answer) => !(answer as HTMLInputElement).checked)).toBe(true);
    expect(answers.map((radio) => radio.getAttribute('value'))).toEqual([
      'paracetamol-500-generic',
      'paracetamol-1000-generic',
      ':dont-know',
    ]);
    expect(screen.getByRole('radio', { name: '500 mg, comprimé' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    expect(screen.getByText('Choisissez un dosage, ou « Je ne sais pas ».')).toBeVisible();
    expect(probe.current().items).toEqual([]);

    await user.click(screen.getByRole('radio', { name: 'Je ne sais pas' }));
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      {
        ref: { kind: 'product', id: 'paracetamol-generic' },
        unitsPerDay: 2,
        strengthUnknown: true,
      },
    ]);
  });

  it('preselects the form typed when one product of the family has it (a syrup)', async () => {
    await confirmFirst('Ajouter un médicament', 'Neo-Codion sirop');

    const checked = screen
      .getAllByRole('radio')
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked.map((radio) => radio.getAttribute('value'))).toEqual(['neo-codion-syrup']);
  });

  it('asks no form when no rule reads it, the box said not given (Néo-Codion, SCRUM-56)', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'Neo-Codion');

    expect(screen.queryByRole('group', { name: STRENGTH })).toBeNull();
    expect(
      screen.queryByRole('group', { name: `Quelle forme est écrite sur la boîte${NBSP}?` }),
    ).toBeNull();
    expect(product()).toHaveTextContent(/Dosage non connu$/);
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      expect.objectContaining({ strengthUnknown: true }) as CheckedItem,
    ]);
  });

  it('never shows the database capitals in an answer', async () => {
    const { user } = await confirmFirst('Ajouter un médicament', 'doliprane');
    await giveCount(user, 1);

    const question = screen.getByRole('group', { name: STRENGTH });
    expect(
      within(question).getByRole('radio', { name: `adultes 1000${NBSP}mg, suppositoire` }),
    ).toBeVisible();
    expect(
      within(question).getByRole('radio', { name: `2,4${NBSP}%, suspension buvable` }),
    ).toBeVisible();
    expect(within(question).queryByRole('radio', { name: /POUR CENT|ADULTES/ })).toBeNull();
  });

  it('preselects a strength typed in words', async () => {
    await confirmFirst('Ajouter un médicament', 'doliprane mille');

    const checked = screen
      .getAllByRole('radio')
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked.map((radio) => radio.getAttribute('value'))).toEqual([
      expect.stringMatching(/^doliprane-1000-mg-/),
    ]);
  });
});

describe('Confirm: a long list of strengths (live test round 2)', () => {
  it('shows the strength typed first, then "Je ne sais pas", the others one tap away', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'Doliprane 1000 mg');

    const question = screen.getByRole('group', { name: STRENGTH });
    const answers = within(question).getAllByRole('radio');
    // Only the boxes of 1000 mg: no children's suppository before them.
    expect(answers.slice(0, -1).map((answer) => answer.getAttribute('value'))).not.toHaveLength(0);
    for (const answer of answers.slice(0, -1)) {
      expect(answer).toHaveAccessibleName(/(^|\s)1000\smg/);
    }
    expect(answers.at(-1)).toHaveAccessibleName('Je ne sais pas');
    expect(answers.filter((answer) => (answer as HTMLInputElement).checked)).toHaveLength(1);
    const more = screen.getByRole('button', { name: /^Voir tous les dosages \(\d+\)$/ });
    expect(more).toHaveClass('button--secondary');
    // Yes follows, held in reach while the question and the units scroll.
    const yes = screen.getByRole('button', { name: "Oui, c'est ce produit" });
    expect(more.compareDocumentPosition(yes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(yes.closest('.sticky-action')).not.toBeNull();
    // Only "yes" is held: what it adds is said in the flow, never over the list.
    const adding = document.querySelector('.confirm__adding');
    expect(adding).toHaveTextContent(/^Vous ajoutez/);
    expect(adding?.closest('.sticky-action')).toBeNull();
    await user.click(yes);

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: expect.stringMatching(/^doliprane-1000-mg-/) as string } },
    ]);
  });

  it('opens every strength on demand, the focus on the first one it shows', async () => {
    const { user } = await confirmFirst('Ajouter un médicament', 'Doliprane 1000 mg');
    const question = screen.getByRole('group', { name: STRENGTH });
    const before = within(question)
      .getAllByRole('radio')
      .map((answer) => answer.getAttribute('value'));

    await user.click(screen.getByRole('button', { name: /^Voir tous les dosages/ }));

    const after = within(question).getAllByRole('radio');
    expect(after.length).toBeGreaterThan(before.length);
    expect(screen.queryByRole('button', { name: /^Voir tous les dosages/ })).toBeNull();
    const first = after.find((answer) => !before.includes(answer.getAttribute('value')));
    expect(first).toHaveFocus();
    // The strength typed stays chosen.
    expect(
      after
        .filter((answer) => (answer as HTMLInputElement).checked)
        .map((a) => a.getAttribute('value')),
    ).toEqual([expect.stringMatching(/^doliprane-1000-mg-/)]);
  });

  it('holds "Oui, c\'est ce produit" in reach under a long list (no strength typed)', async () => {
    const { user } = await confirmFirst('Ajouter un médicament', 'doliprane');
    await giveCount(user, 1);

    expect(
      within(screen.getByRole('group', { name: STRENGTH })).getAllByRole('radio').length,
    ).toBeGreaterThan(6);
    const yes = screen.getByRole('button', { name: "Oui, c'est ce produit" });
    expect(yes.closest('.sticky-action')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Voir tous les dosages/ })).toBeNull();
  });

  it('leaves a short list as it is', async () => {
    await confirmFirst('Ajouter un médicament', 'paracetamol 1 g');

    expect(screen.queryByRole('button', { name: /^Voir tous les dosages/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: "Oui, c'est ce produit" }).closest('.sticky-action'),
    ).toBeNull();
  });
});

describe('Confirm: the name she typed', () => {
  it('says the name typed when the product is shown under another one, up to the result', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'cytotec');

    expect(product()).toHaveTextContent('Misoprostol (générique)');
    // Her words quoted under their label, as on the result.
    expect(product()).toHaveTextContent('Vous avez écrit : « cytotec »');
    expect(within(product() as HTMLElement).getByText('« cytotec »')).toHaveClass('typed');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'misoprostol-generic' } },
    ]);
    const row = within(screen.getByRole('list', { name: 'Produits ajoutés' })).getByRole(
      'listitem',
    );
    expect(row).toHaveTextContent('Misoprostol (générique)');
    expect(row).toHaveTextContent('Vous avez écrit : « cytotec »');
    expect(within(row).getByText('« cytotec »')).toHaveClass('typed');
  });

  it('says nothing more when the name shown is the one typed', async () => {
    await confirmFirst('Ajouter un médicament', 'doliprane 1000');

    expect(product()).not.toHaveTextContent('Vous avez écrit');
  });

  it('keeps the name on the box the candidate was found by', async () => {
    await confirmFirst('Ajouter un médicament', 'birufen');

    expect(product()).toHaveTextContent('Ibuprofène (générique)');
    expect(product()).toHaveTextContent('Vous avez écrit : « birufen »');
    expect(product()).toHaveTextContent('Nom sur la boîte : Brufen');
  });

  it('says the name on the box once when it is the name typed', async () => {
    await confirmFirst('Ajouter un médicament', 'cytotec');

    expect(product()).toHaveTextContent('Vous avez écrit : « cytotec »');
    expect(product()).not.toHaveTextContent('Nom sur la boîte');
  });

  it('says when the product lacks a substance the name typed names', async () => {
    await saveProfile(profileOf());
    await renderApp({
      settings: woman,
      hash: '#/confirm/product',
      entryState: inSession({ id: 'efferalgan-500-mg-67326925', query: 'efferalgan codeine' }),
      packLoader: loaderOf(pack),
    });

    expect(
      await screen.findByText(
        "Codéine : ce produit n'en contient pas. Comparez avec le nom sur la boîte.",
      ),
    ).toBeVisible();
  });
});

describe('Confirm: a product already listed', () => {
  it('says so and changes its units per day instead of listing it twice', async () => {
    const { user, probe } = await confirmFirst('Ajouter un médicament', 'paracetamol 500');
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    await backOnCheck();

    await user.click(screen.getByRole('button', { name: 'Ajouter un médicament' }));
    await user.type(await screen.findByRole('searchbox'), 'paracetamol 500');
    const candidates = await screen.findByRole('list', { name: 'Propositions' });
    expect(within(candidates).getAllByRole('button').length).toBeGreaterThan(0);
    await user.keyboard('{Enter}');

    expect(
      await screen.findByText('Paracétamol 500 mg (générique) est déjà dans la liste.'),
    ).toBeVisible();
    const units = screen.getByRole('textbox', { name: UNITS });
    expect(units).toHaveValue('2');
    expect(screen.queryByRole('button', { name: "Oui, c'est ce produit" })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    await user.click(screen.getByRole('button', { name: 'Changer les unités par jour' }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: 'paracetamol-500-generic' }, unitsPerDay: 3 },
    ]);
    await screen.findByText('Paracétamol 500 mg (générique) est mis à jour dans la liste.');
  });

  it('goes back to the list for a remedy already listed, adding nothing', async () => {
    const { user, probe } = await confirmFirst('Ajouter un remède', 'kinkeliba');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce remède" }));
    await backOnCheck();

    await user.click(screen.getByRole('button', { name: 'Ajouter un remède' }));
    await user.type(await screen.findByRole('searchbox'), 'kinkeliba');
    const candidates = await screen.findByRole('list', { name: 'Propositions' });
    expect(within(candidates).getAllByRole('button').length).toBeGreaterThan(0);
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Kinkéliba est déjà dans la liste.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Revenir à la liste' }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([{ ref: { kind: 'plant', id: 'kinkeliba' } }]);
    await screen.findByText('Kinkéliba est déjà dans la liste.');
  });

  it('leaves the focus on the heading of the check after an add', async () => {
    const { user } = await confirmFirst('Ajouter un remède', 'nebeday');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce remède" }));

    const heading = await backOnCheck();
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });
});

describe('Confirm: opened directly', () => {
  it('works from its address alone, and "no" opens the search of its list', async () => {
    await saveProfile(profileOf());
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/confirm/product',
      entryState: inSession({ id: 'paracetamol-generic' }),
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    const user = userEvent.setup();

    expect(await screen.findByRole('textbox', { name: UNITS })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Non, chercher encore' }));

    expect(await screen.findByRole('searchbox')).toHaveValue('');
    expect(window.location.hash).toBe('#/search/product');
    expect(probe.current().items).toEqual([]);
  });

  it('keeps the product out of the address, and goes to the check when the entry has none', async () => {
    await saveProfile(profileOf());
    // An old link, a reload after a lock: the product the entry held is no longer read.
    await renderApp({
      settings: woman,
      hash: '#/confirm/product',
      packLoader: loaderOf(pack),
      entryState: { id: 'efavirenz-generic', visit: 'a visit before', epoch: 'an epoch before' },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.href).not.toContain('efavirenz');
    expect(JSON.stringify(window.history.state)).not.toContain('efavirenz');
  });

  it('says so for a product this phone does not have', async () => {
    await renderApp({
      settings: woman,
      hash: '#/confirm/product',
      entryState: inSession({ id: 'not-in-the-pack' }),
      packLoader: loaderOf(pack),
    });

    expect(
      await screen.findByText("Ce produit n'est pas sur ce téléphone. Cherchez encore."),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: "Oui, c'est ce produit" })).toBeNull();
  });

  it('adds the product, then goes to the check, replacing itself', async () => {
    await saveProfile(profileOf());
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/confirm/plant',
      entryState: inSession({ id: 'kinkeliba' }),
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: "Oui, c'est ce remède" }));

    expect(await backOnCheck()).toBeVisible();
    await waitFor(() => {
      expect(probe.current()).toMatchObject({
        profileId: 'p1',
        items: [{ ref: { kind: 'plant', id: 'kinkeliba' } }],
      });
    });
  });
});

/** From the check, searches `query` among the medicines again and opens its first candidate. */
async function searchAgain(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.click(await screen.findByRole('button', { name: 'Ajouter un médicament' }));
  await user.type(await screen.findByRole('searchbox'), query);
  const candidates = await screen.findByRole('list', { name: 'Propositions' });
  // Enter opens the confirm screen of the best candidate (a tap may add it at once, SCRUM-56).
  expect(within(candidates).getAllByRole('button').length).toBeGreaterThan(0);
  await user.keyboard('{Enter}');
  await screen.findByRole('button', { name: 'Non, chercher encore' });
}

/** The rule ids the engine finds for the items in the check, for the profile of the test. */
function ruleIdsOf(items: CheckedItem[]): (string | undefined)[] {
  const context = contextFromProfile(profileOf(), { items, signs: [] }, '2026-11-04');
  return evaluate(pack, context).findings.map((finding) => finding.ruleId);
}

// The first of its strength by name: the forms of a brand are sorted the same way for every brand.
const EFFERALGAN_1000 = 'efferalgan-1000-mg-67058605';
const SAME_BOX = `Est-ce la même boîte qu'EFFERALGAN 1000${NBSP}mg, comprimé effervescent${NBSP}?`;

describe('Confirm: "I do not know" for a family already listed with a known strength', () => {
  async function listEfferalgan1000Times4() {
    const flow = await confirmFirst('Ajouter un médicament', 'efferalgan 1000');
    for (let i = 0; i < 4; i += 1) {
      await flow.user.click(screen.getByRole('button', { name: 'Une unité de plus' }));
    }
    await flow.user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    await backOnCheck();
    expect(flow.probe.current().items).toEqual([
      { ref: { kind: 'product', id: EFFERALGAN_1000 }, unitsPerDay: 4 },
    ]);
    // 4 x 1000 mg a day: above the daily maximum of paracetamol.
    expect(ruleIdsOf(flow.probe.current().items)).toContain('paracetamol-max-daily');
    return flow;
  }

  it('asks whether it is the same box; "the same" keeps the known strength and its finding', async () => {
    const { user, probe } = await listEfferalgan1000Times4();
    await searchAgain(user, 'efferalgan');

    const sameBox = screen.getByRole('group', { name: SAME_BOX });
    expect(
      within(sameBox)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent),
    ).toEqual(['Oui, la même', 'Non, une autre boîte']);
    await user.click(within(sameBox).getByRole('radio', { name: 'Oui, la même' }));
    expect(screen.getByRole('textbox', { name: UNITS })).toHaveValue('4');
    expect(
      screen.getByText('EFFERALGAN 1000 mg, comprimé effervescent est déjà dans la liste.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Changer les unités par jour' }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: EFFERALGAN_1000 }, unitsPerDay: 4 },
    ]);
    expect(ruleIdsOf(probe.current().items)).toContain('paracetamol-max-daily');
  });

  it('adds another box of unknown strength when it is not the same', async () => {
    const { user, probe } = await listEfferalgan1000Times4();
    await searchAgain(user, 'efferalgan');
    await user.click(
      within(screen.getByRole('group', { name: SAME_BOX })).getByRole('radio', {
        name: 'Non, une autre boîte',
      }),
    );
    expect(screen.getByRole('textbox', { name: UNITS })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'product', id: EFFERALGAN_1000 }, unitsPerDay: 4 },
      { ref: { kind: 'product', id: EFFERALGAN_1000 }, strengthUnknown: true },
    ]);
    expect(ruleIdsOf(probe.current().items)).toContain('paracetamol-max-daily');
  });

  it('refuses yes until she says whether it is the same box', async () => {
    const { user, probe } = await listEfferalgan1000Times4();
    await searchAgain(user, 'efferalgan');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    const sameBox = screen.getByRole('group', { name: SAME_BOX });
    expect(within(sameBox).getByText("Dites si c'est la même boîte.")).toBeVisible();
    expect(within(sameBox).getAllByRole('radio')[0]).toHaveFocus();
    expect(probe.current().items).toHaveLength(1);
  });
});

describe('Confirm: a known strength for a family listed with its strength unknown', () => {
  const SAME_AS_UNKNOWN = `Est-ce la même boîte qu'EFFERALGAN${NBSP}?`;

  async function listEfferalganUnknownTwice() {
    const flow = await confirmFirst('Ajouter un médicament', 'efferalgan');
    // The count first: the strength is then asked, and not known.
    await giveCount(flow.user, 2);
    await flow.user.click(screen.getByRole('radio', { name: 'Je ne sais pas' }));
    await flow.user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    await backOnCheck();
    await searchAgain(flow.user, 'efferalgan 500');
    return flow;
  }

  it('asks whether it is the same box before it takes the place of the one listed', async () => {
    const { user, probe } = await listEfferalganUnknownTwice();

    // Never in its place without asking: nothing is said until she answers.
    const sameBox = screen.getByRole('group', { name: SAME_AS_UNKNOWN });
    expect(screen.queryByText(/devient/)).toBeNull();
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));
    expect(within(sameBox).getByText("Dites si c'est la même boîte.")).toBeVisible();
    expect(probe.current().items).toHaveLength(1);

    await user.click(within(sameBox).getByRole('radio', { name: 'Oui, la même' }));
    expect(
      screen.getByText(
        /^EFFERALGAN, dosage non connu, devient EFFERALGAN 500 mg, .+ dans la liste\.$/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: UNITS })).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    const [only, ...rest] = probe.current().items;
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ unitsPerDay: 2 });
    expect(only).not.toHaveProperty('strengthUnknown');
    expect(only?.ref.kind === 'product' ? only.ref.id : '').toMatch(/^efferalgan-500-mg-/);
  });

  it('lists another box apart, the box of unknown strength kept', async () => {
    const { user, probe } = await listEfferalganUnknownTwice();
    await user.click(
      within(screen.getByRole('group', { name: SAME_AS_UNKNOWN })).getByRole('radio', {
        name: 'Non, une autre boîte',
      }),
    );
    expect(screen.getByText(/^Vous ajoutez : EFFERALGAN 500 mg/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: UNITS })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    expect(await backOnCheck()).toBeVisible();
    const items = probe.current().items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ strengthUnknown: true, unitsPerDay: 2 });
    expect(items[1]?.ref.kind === 'product' ? items[1].ref.id : '').toMatch(/^efferalgan-500-mg-/);
    expect(items[1]).not.toHaveProperty('strengthUnknown');
    // Two boxes of paracetamol: the engine reads a duplicate.
    expect(ruleIdsOf(items)).toContain('paracetamol-duplicate-products');
  });
});
