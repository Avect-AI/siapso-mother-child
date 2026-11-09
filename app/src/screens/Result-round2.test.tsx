// SPDX-License-Identifier: MIT
// The result screen after the live test round 2 (SCRUM-52): the situations
// note in clear, the reminders button that says what it holds, the action
// line of a product danger card, who to call naming a product danger and
// what she takes, the window reached through the look-ahead, and a Latin
// name read in Latin.
import type { CheckedItem, Pack } from '@siapso/engine';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const CASTOR: CheckedItem = { ref: { kind: 'plant', id: 'castor-oil' } };
const ADVIL: CheckedItem = { ref: { kind: 'product', id: 'advil-400-mg-63646874' } };
const NBSP = ' ';
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openResult(items: CheckedItem[], settings: Settings, signs: string[] = []) {
  const probe = probeCheck();
  await renderApp({ settings, hash: '#/', packLoader: loaderOf(pack), children: probe.element });
  await screen.findByRole('heading', { level: 1 });
  act(() => {
    const check = probe.current();
    check.start('p1');
    for (const item of items) check.add(item);
    check.setSigns(signs);
  });
  // Woman mode: her check is her start, on show already (SCRUM-56, S4).
  if (settings.mode !== 'woman') {
    act(() => {
      window.location.hash = '#/check';
    });
  }
  await screen.findByRole('heading', { level: 2, name: /^Résultat/ });
  await screen.findAllByRole('article');
  return userEvent.setup();
}

describe('Result: a product danger', () => {
  it('says its instruction on the card, and who to call names it and what she takes', async () => {
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 34, givenOn: '2026-11-04' },
        conditions: ['uterine-scar'],
      }),
    );
    const user = await openResult([CASTOR], woman);
    const instruction = pack.messages.fr['castor-oil-term-uterine-scar']?.orientation ?? 'missing';
    const [card] = screen.getAllByRole('article');
    if (card === undefined) throw new Error('no card');
    expect(within(card).getByText(instruction)).toHaveClass('result-card__orientation');
    // Never "change nothing" beside a product danger.
    expect(document.querySelector('.result__closing')?.textContent).toContain(
      "N'en prenez pas plus avant d'en avoir parlé à un professionnel.",
    );

    await user.click(within(card).getByRole('button', { name: 'Voir qui appeler' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    // The same level name as the result: a product is never called a sign.
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/^Danger : à montrer maintenant/);
    expect(banner).not.toHaveTextContent('Signe de danger');
    expect(screen.getByText('Dites aussi ce que vous prenez :')).toBeVisible();
    expect(screen.getByText('Huile de ricin')).toBeVisible();
  });
});

describe('Result: the codeine card with a baby danger sign', () => {
  it('is a danger, and who to call says the sign and what she takes', async () => {
    await saveProfile(
      profileOf({
        pregnant: false,
        breastfeeding: true,
        babyAgeWeeks: 12,
        babyAgeGivenOn: '2026-11-04',
        premature: false,
      }),
    );
    const codeine: CheckedItem = {
      ref: { kind: 'product', id: 'codoliprane-500-mg-30-mg-60904643' },
    };
    const user = await openResult([codeine], accompanied, ['baby-very-sleepy']);
    const codeineCard = screen
      .getAllByRole('article')
      .find((card) => /CODOLIPRANE/.test(card.textContent));
    expect(codeineCard).toHaveClass('level--danger');

    await user.click(screen.getAllByRole('button', { name: 'Voir qui appeler' })[0] as HTMLElement);
    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    // A sign was ticked: the danger is called a sign, and the product is said too.
    expect(screen.getByRole('alert')).toHaveTextContent(/^Signe de danger/);
    expect(screen.getByText("Dites aussi ce qu'elle prend :")).toBeVisible();
    expect(screen.getByText(/^CODOLIPRANE/)).toBeVisible();
  });
});

describe('Result: accompanied mode', () => {
  it('shows the situations it leaves out in clear, and the reminders behind a button that says so', async () => {
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 24, givenOn: '2026-11-04' },
        conditions: ['sickle-cell'],
      }),
    );
    await openResult([ADVIL], accompanied);
    expect(screen.getByText(/^Drépanocytose/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Situations masquées/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: `Rappels${NBSP}: touchez pour les afficher` }),
    ).toBeVisible();
    // About her: her treatment, her next visit.
    expect(document.querySelector('.result__closing')?.textContent).toContain(
      'Elle ne doit rien changer à son traitement sans en parler à un professionnel.',
    );
  });
});

describe('Result: a window reached through the look-ahead', () => {
  it('says on the card when she reaches it', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 17, givenOn: '2026-11-04' } }));
    await openResult([ADVIL], woman);
    expect(
      screen.getByText(
        `Vous atteindrez 20 semaines dans 4 semaines au plus : ce produit demande alors plus de prudence.`,
      ),
    ).toBeVisible();
    expect(
      screen.getByText('Ce résultat tient compte aussi des 4 semaines à venir.'),
    ).toBeVisible();
  });
});

describe('Result: a Latin name', () => {
  it('is read in Latin in what a name typed looks like', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 20, givenOn: '2026-11-04' } }));
    await openResult([{ ref: { kind: 'unrecognised', text: 'huile de ricin bio' } }], woman);
    const latin = screen.getByText('Ricinus communis');
    expect(latin).toHaveAttribute('lang', 'la');
    expect(latin.closest('.result-card__possible')).not.toBeNull();
  });
});
