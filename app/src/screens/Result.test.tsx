// SPDX-License-Identifier: MIT
import { PackError, type CheckedItem, type Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listHistory } from '../data/history.js';
import type { LoadedPack } from '../data/pack-loader.js';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, noPack, pendingPack, renderApp, storeTestCode } from '../test/render-app.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

// What a test makes fail: the engine, or reading the profile.
const failure = vi.hoisted(() => ({
  evaluate: null as Error | null,
  getProfile: null as Error | null,
}));

vi.mock('@siapso/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@siapso/engine')>();
  return {
    ...engine,
    evaluate: (...args: Parameters<typeof engine.evaluate>) => {
      if (failure.evaluate !== null) throw failure.evaluate;
      return engine.evaluate(...args);
    },
  };
});

vi.mock('../data/profiles.js', async (importOriginal) => {
  const profiles = await importOriginal<typeof import('../data/profiles.js')>();
  return {
    ...profiles,
    getProfile: (id: string) =>
      failure.getProfile === null ? profiles.getProfile(id) : Promise.reject(failure.getProfile),
  };
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const KINKELIBA: CheckedItem = { ref: { kind: 'plant', id: 'kinkeliba' } };
const ADVIL: CheckedItem = { ref: { kind: 'product', id: 'advil-400-mg-63646874' } };
const CODEINE: CheckedItem = { ref: { kind: 'product', id: 'codeine-generic' } };
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  failure.evaluate = null;
  failure.getProfile = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * The result of a check for the stored profile `p1`, as the check screen
 * opens it: the items and signs are set from Home, then the result route.
 */
async function openResult({
  items,
  signs = [],
  settings = woman,
  packLoader = loaderOf(pack),
  heading = /^Résultat/,
}: {
  items: CheckedItem[];
  signs?: string[];
  settings?: Settings;
  packLoader?: () => Promise<LoadedPack>;
  /** The title the screen opens with. */
  heading?: RegExp;
}) {
  const probe = probeCheck();
  const view = await renderApp({ settings, hash: '#/', packLoader, children: probe.element });
  await screen.findByRole('heading', { level: 1 });
  act(() => {
    const check = probe.current();
    check.start('p1');
    for (const item of items) check.add(item);
    check.setSigns(signs);
  });
  act(() => {
    window.location.hash = '#/result';
  });
  // The hash change arrives as an event: wait for the result screen itself.
  await screen.findByRole('heading', { level: 1, name: heading });
  return { probe, view, user: userEvent.setup() };
}

describe('Result: a danger sign and a remedy we know nothing about', () => {
  it('leads with the danger, then every finding with its level, then the closing lines', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 14, givenOn: '2026-11-04' } }));
    const { user } = await openResult({ items: [KINKELIBA], signs: ['fever'] });

    // The danger: its level in text, then the instruction of the one danger
    // finding (the fever's own), announced from a region apart from the button.
    const goForTest = pack.messages.fr['danger-sign-fever']?.orientation ?? 'missing';
    const instruction = await screen.findByRole('heading', { level: 2, name: goForTest });
    expect(instruction).toBeVisible();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`Signe de danger ${goForTest}`);
    expect(within(alert).queryByRole('button')).toBeNull();
    const call = screen.getByRole('button', { name: 'Voir qui appeler' });
    expect(call.closest('[role="alert"]')).toBeNull();

    // A summary of both findings, most urgent first, then one card each.
    const rows = within(screen.getByRole('list', { name: 'Résumé' })).getAllByRole('listitem');
    const fever = pack.dangerSigns.find((d) => d.id === 'fever')?.label.fr ?? '';
    expect(rows.map((row) => row.textContent)).toEqual([
      `Signe de danger. ${fever}`,
      'On ne sait pas. Kinkéliba',
    ]);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveClass('level--danger');
    expect(cards[1]).toHaveAccessibleName('On ne sait pas. Kinkéliba');
    // Woman mode still reads the sign's own fact first: the fever can be malaria.
    expect(
      within(cards[0] as HTMLElement).getByText(
        pack.messages.fr['danger-sign-fever']?.fact ?? 'missing',
      ),
    ).toBeVisible();
    // The instruction is said once, in the banner: the danger card does not repeat it.
    expect(within(cards[0] as HTMLElement).queryByText(goForTest)).toBeNull();
    expect(cards[0]?.querySelector('.result-card__orientation')).toBeNull();
    expect(within(cards[1] as HTMLElement).getByText(/rien ne prouve qu'il guérit/)).toBeVisible();
    expect(
      within(cards[1] as HTMLElement).getByText(
        "Nous n'avons pas d'information fiable. Montrez-le à la sage-femme ou au pharmacien à la prochaine visite.",
      ),
    ).toHaveClass('result-card__orientation');
    // Woman mode: no source, no evidence, no rule, no reminder.
    expect(screen.queryByText(/^Niveau de preuve/)).toBeNull();
    expect(screen.queryByText(/^Règle/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Rappels' })).toBeNull();

    // The closing lines, the closing sentence last.
    const closing = document.querySelector('.result__closing');
    expect([...(closing?.children ?? [])].map((p) => p.textContent)).toEqual([
      'Ne changez rien à votre traitement sans en parler à un professionnel.',
      `Base de connaissances ${pack.version} du 04/11/2026`,
      "Contenu non validé cliniquement : ne l'utilisez pas seul pour décider.",
      'Cet outil ne remplace pas un soignant.',
    ]);

    // The banner's action is the one primary action; the way back is secondary.
    expect(screen.getByRole('button', { name: 'Revenir à la liste' })).toHaveClass(
      'button--secondary',
    );
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(0);

    // Kept in the history of the profile, every rule id with it.
    await waitFor(async () => {
      expect(await listHistory('p1')).toHaveLength(1);
    });
    const [kept] = await listHistory('p1');
    expect(kept).toMatchObject({ profileId: 'p1', level: 'danger', signs: ['fever'] });
    expect(kept?.items).toEqual([KINKELIBA]);

    // The banner's action: who to call, with the same instruction and the circuit.
    await user.click(call);
    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: goForTest })).toBeVisible();
    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();

    // Back to the same result: the same check is not recorded a second time.
    window.history.back();
    expect(await screen.findByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
    await screen.findAllByRole('article');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await listHistory('p1')).toHaveLength(1);
  });
});

describe('Result: a name typed as not recognised that looks like a known one', () => {
  it('evaluates what it looks like: the danger the base knows stays, the text stays unknown', async () => {
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 37, givenOn: '2026-11-04' },
        conditions: ['uterine-scar'],
      }),
    );
    const typed: CheckedItem = { ref: { kind: 'unrecognised', text: 'huile de ricin' } };
    await openResult({ items: [typed] });

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Danger : à montrer maintenant/);
    const possible = await screen.findByRole('article', {
      name: /^Danger\s: à montrer maintenant\. huile de ricin$/,
    });
    expect(possible).toHaveTextContent(
      "Ce nom ressemble à Huile de ricin (Ricinus communis). Si c'est ce remède :",
    );
    // The text typed keeps its own grey card.
    const own = screen.getByRole('article', { name: 'On ne sait pas. huile de ricin' });
    expect(own).not.toHaveTextContent('Ce nom ressemble');

    // The history keeps the items as they were checked, and the level shown.
    await waitFor(async () => {
      expect(await listHistory('p1')).toHaveLength(1);
    });
    const [kept] = await listHistory('p1');
    expect(kept).toMatchObject({ level: 'danger', items: [typed] });
  });

  it('says in the banner and the summary that the danger is a resemblance', async () => {
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 37, givenOn: '2026-11-04' },
        conditions: ['uterine-scar'],
      }),
    );
    await openResult({ items: [{ ref: { kind: 'unrecognised', text: 'huile de ricin' } }] });

    expect(await screen.findByRole('alert')).toHaveTextContent('(ressemble à Huile de ricin)');
    const rows = within(screen.getByRole('list', { name: 'Résumé' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/\(ressemble à Huile de ricin\)\. huile de ricin$/);
  });

  it('keeps no weak resemblance of a name she said was none of the products proposed', async () => {
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 37, givenOn: '2026-11-04' },
        conditions: ['uterine-scar'],
      }),
    );
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    await screen.findByRole('heading', { level: 1 });
    act(() => {
      const check = probe.current();
      check.start('p1');
      for (const text of ['huile de coco', 'Moussa', 'Anta', 'vitamines', 'clotrimazole']) {
        check.add({ ref: { kind: 'unrecognised', text } }, { list: 'product', declined: true });
      }
      check.setSigns([]);
    });
    act(() => {
      window.location.hash = '#/result';
    });

    await screen.findByRole('heading', { level: 1, name: 'Résultat' });
    expect(await screen.findAllByRole('article')).toHaveLength(5);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/ressemble à/)).toBeNull();
  });

  it('shows the name typed on the card of a product found under another name', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 10, givenOn: '2026-11-04' } }));
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    await screen.findByRole('heading', { level: 1 });
    act(() => {
      const check = probe.current();
      check.start('p1');
      check.add({ ref: { kind: 'product', id: 'misoprostol-generic' } }, { written: 'cytotec' });
      check.setSigns([]);
    });
    act(() => {
      window.location.hash = '#/result';
    });

    const card = await screen.findByRole('article', { name: /Misoprostol \(générique\)$/ });
    expect(card).toHaveTextContent('Vous avez écrit : cytotec');
  });
});

describe('Result: several products in one finding', () => {
  it('sets each product on its own line, and lists the same products at one level once', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 16, givenOn: '2026-11-04' } }));
    const doliprane: CheckedItem = {
      ref: { kind: 'product', id: 'doliprane-1000-mg-60234100' },
      unitsPerDay: 4,
    };
    const sachet: CheckedItem = {
      ref: { kind: 'product', id: 'cold-sachet-paracetamol' },
      unitsPerDay: 3,
    };
    await openResult({ items: [doliprane, sachet] });

    const name =
      'À montrer avant la prochaine prise. DOLIPRANE 1000 mg, comprimé et Sachet contre le rhume (paracétamol, phéniramine, vitamine C)';
    // A duplicate and a daily maximum: two cards about the same two products.
    const cards = await screen.findAllByRole('article', { name });
    expect(cards).toHaveLength(2);
    const lines = [...(cards[0]?.querySelectorAll('.result__name') ?? [])];
    expect(lines.map((line) => line.textContent)).toEqual([
      'DOLIPRANE 1000 mg, comprimé',
      'et Sachet contre le rhume (paracétamol, phéniramine, vitamine C)',
    ]);
    const rows = within(screen.getByRole('list', { name: 'Résumé' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
  });
});

describe('Result: woman mode', () => {
  const EFAVIRENZ: CheckedItem = { ref: { kind: 'product', id: 'efavirenz-generic' } };

  it('hides the fact, evidence, sources, rule, reminders and contraception notes', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-11-04' } }));
    const items = [ADVIL, EFAVIRENZ];
    const contraception = pack.messages.fr['efavirenz-contraception']?.orientation ?? 'missing';
    const hidden = (main: HTMLElement) => ({
      reminders: within(main).queryByRole('heading', { name: 'Rappels' }) !== null,
      notes: within(main).queryByRole('heading', { name: 'À noter aussi' }) !== null,
      contraception: within(main).queryByText(contraception) !== null,
      evidence: within(main).queryAllByText(/^Niveau de preuve/).length > 0,
      rule: within(main).queryAllByText(/^Règles?\s:/).length > 0,
      // Text matchers read the no-break space before the colon as a space.
      sources: within(main).queryAllByText('Sources :').length > 0,
      details: main.querySelector('.result-card__details') !== null,
    });

    const { view } = await openResult({ items, settings: accompanied });
    await screen.findAllByRole('article');
    // The same check in accompanied mode says every one of them.
    expect(hidden(screen.getByRole('main'))).toEqual({
      reminders: true,
      notes: true,
      contraception: true,
      evidence: true,
      rule: true,
      sources: true,
      details: true,
    });
    view.unmount();

    await openResult({ items, settings: woman });
    await screen.findAllByRole('article');
    expect(hidden(screen.getByRole('main'))).toEqual({
      reminders: false,
      notes: false,
      contraception: false,
      evidence: false,
      rule: false,
      sources: false,
      details: false,
    });
    // She still reads the level, the risk and who to show it to.
    expect(document.querySelector('.result-card__orientation')).not.toBeNull();
  });
});

describe('Result: a situation the base does not read', () => {
  it('says so before the cards, in woman mode too, and nothing for a situation a rule reads', async () => {
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 30, givenOn: '2026-11-04' },
        conditions: ['sickle-cell', 'uterine-scar'],
      }),
    );
    await openResult({ items: [ADVIL], settings: woman });
    const [card] = await screen.findAllByRole('article');
    const situations = screen.getByRole('region', { name: 'Situations non prises en compte' });
    expect(
      within(situations).getByText(/^Drépanocytose\s: notre base ne tient pas encore compte/),
    ).toBeVisible();
    expect(
      within(situations).getByText(
        'Parlez-en à la sage-femme ou au médecin à la prochaine visite.',
      ),
    ).toBeVisible();
    expect(within(situations).queryByText(/^Ancienne césarienne/)).toBeNull();
    // Read before the first card, not after the last one.
    expect(
      situations.compareDocumentPosition(card as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'À noter aussi' })).toBeNull();
  });
});

describe('Result: accompanied mode', () => {
  it('names the profile and adds evidence, sources, rule and reminders', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-11-04' } }));
    await openResult({ items: [ADVIL], settings: accompanied });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Résultat pour Awa' }),
    ).toBeVisible();
    const card = await screen.findByRole('article');
    expect(within(card).getByText('Niveau de preuve A : « peut provoquer »')).toBeVisible();
    // Who to show and when before the fact and the detailed risk, as in woman mode.
    const orientation = card.querySelector('.result-card__orientation');
    const fact = within(card).getByText(/anti-inflammatoire non stéroïdien/);
    expect(fact.closest('.result-card__details')).not.toBeNull();
    expect(orientation === null ? 0 : orientation.compareDocumentPosition(fact) & 4).toBeTruthy();
    expect(within(card).getByText('Règle : nsaid-pregnancy-from-20-weeks')).toBeVisible();
    const link = within(card).getAllByRole('link')[0];
    expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\//) as unknown);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName(/\(s'ouvre dans une autre fenêtre\)$/);
    // Each source named once, its records under it (BDPM is cited for two sections).
    expect(
      within(card).getAllByText('Base de données publique des médicaments (BDPM)'),
    ).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Rappels' })).toBeVisible();
    // One finding: no summary, the card says it all.
    expect(screen.queryByRole('list', { name: 'Résumé' })).toBeNull();
  });

  it('says that the links of the sources open with the Internet', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-11-04' } }));
    await openResult({ items: [ADVIL], settings: accompanied });

    const card = await screen.findByRole('article');
    const sources = within(card).getByText('Sources :').closest('.result-card__sources');
    expect(sources).not.toBeNull();
    expect(
      within(sources as HTMLElement).getByText("Ces liens s'ouvrent avec Internet."),
    ).toBeVisible();
  });

  it('pairs each risk of a merged card with its own detailed risk and evidence level', async () => {
    await saveProfile(profileOf({ term: { kind: 'unknown' } }));
    await openResult({ items: [ADVIL], settings: accompanied });

    const card = await screen.findByRole('article');
    const from20 = pack.messages.fr['nsaid-pregnancy-from-20-weeks'];
    const before20 = pack.messages.fr['nsaid-pregnancy-before-20-weeks'];
    const blocks = [...card.querySelectorAll('.result-card__details .result-card__risk')];
    // Each block: its risk, its detailed risk, then its own evidence level.
    expect(blocks.map((block) => [...block.children].map((p) => p.textContent))).toEqual([
      [from20?.risk, from20?.riskDetail, 'Niveau de preuve A : « peut provoquer »'],
      [
        before20?.risk,
        before20?.riskDetail,
        'Niveau de preuve C : « des cas ont été rapportés ou observés »',
      ],
    ]);
    // The sources and rules close the card; no evidence line apart from its risk.
    expect(card.querySelector('.result-card__meta')).not.toHaveTextContent(/Niveau de preuve/);
  });
});

describe('Result: one finding, the way back', () => {
  it('shows the orientation as the clearest line, and goes back to the list with the items', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-11-04' } }));
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Regarder un produit' }));
    await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' });
    act(() => {
      probe.current().add(ADVIL);
    });
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Aucun de ces signes' }));
    await user.click(screen.getByRole('button', { name: 'Voir le résultat' }));

    const card = await screen.findByRole('article', {
      name: 'À montrer avant la prochaine prise. ADVIL 400 mg, comprimé enrobé',
    });
    expect(
      within(card).getByText(
        "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
      ),
    ).toHaveClass('result-card__orientation');
    expect(screen.queryByRole('alert')).toBeNull();
    const back = screen.getByRole('button', { name: 'Revenir à la liste' });
    expect(back).toHaveClass('button--primary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);

    await user.click(back);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([ADVIL]);
    // Back went back to the check entry: neither the result nor the signs are stacked on top.
    window.history.back();
    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  });

  it('goes to the check when there is no item to evaluate', async () => {
    await saveProfile(profileOf());
    await renderApp({ settings: woman, hash: '#/result', packLoader: loaderOf(pack) });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/check');
  });
});

describe('Result: the term it was worked out on', () => {
  it('says the term used and that the coming two weeks are taken into account', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 19, givenOn: '2026-11-04' } }));
    await openResult({ items: [ADVIL], settings: accompanied });

    await screen.findByRole('article');
    // Inside the sentence the term starts in lower case.
    expect(screen.getByText(/^Terme retenu\s: environ 19 semaines$/)).toBeVisible();
    expect(screen.getByText(/2 semaines à venir/)).toBeVisible();
    // 20 weeks are reached within the look-ahead: the rule from 20 weeks gives the level.
    expect(
      screen.getByRole('article', { name: /^À montrer avant la prochaine prise\./ }),
    ).toBeVisible();
  });

  it('keeps the danger banner first: the term comes after it', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 14, givenOn: '2026-11-04' } }));
    await openResult({ items: [KINKELIBA], signs: ['fever'] });

    const banner = await screen.findByRole('button', { name: 'Voir qui appeler' });
    const term = screen.getByText(/^Terme retenu/);
    expect(banner.compareDocumentPosition(term) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says the baby age used for a breastfeeding profile', async () => {
    await saveProfile(
      profileOf({
        pregnant: false,
        breastfeeding: true,
        babyAgeWeeks: 13,
        babyAgeMonths: 3,
        babyAgeGivenOn: '2026-11-04',
        premature: false,
      }),
    );
    await openResult({ items: [KINKELIBA] });

    await screen.findByRole('article');
    expect(screen.getByText('Allaite, bébé de 3 mois')).toBeVisible();
    expect(screen.queryByText(/semaines à venir/)).toBeNull();
  });

  it('says why the term is unknown when the phone clock is before the day it was given', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' } }));
    await openResult({ items: [ADVIL] });

    const card = await screen.findByRole('article');
    expect(
      screen.getByText(/la date du téléphone est avant un jour où l'application a déjà servi/),
    ).toBeVisible();
    expect(
      within(card).getByText(/^Terme inconnu\s: ce résultat tient compte de toute la grossesse/),
    ).toBeVisible();
  });

  it('reads breastfeeding as possible too when the phone clock is set back, and says so', async () => {
    // A known older baby: its age is not what the result used, so it is not shown.
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' },
        breastfeeding: true,
        babyAgeWeeks: 60,
        babyAgeGivenOn: '2026-11-01',
        premature: false,
      }),
    );
    await openResult({ items: [CODEINE], settings: accompanied });

    const card = await screen.findByRole('article');
    expect(
      screen.getByText(
        /la date du téléphone est avant un jour où l'application a déjà servi\. Le bébé est peut-être né\s: ce résultat tient compte de toute la grossesse et de l'allaitement\./,
      ),
    ).toBeVisible();
    // The breastfeeding rule on codeine applies (baby of unknown age).
    expect(within(card).getByText('Règle : codeine-breastfeeding')).toBeVisible();
    expect(screen.queryByText(/^Allaite, bébé de/)).toBeNull();
  });

  it('says "votre bébé" in the clock notice in woman mode', async () => {
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' } }));
    await openResult({ items: [ADVIL] });

    await screen.findByRole('article');
    expect(
      screen.getByText(/\. Votre bébé est peut-être né\s: ce résultat tient compte/),
    ).toBeVisible();
  });

  it('says the term is unknown when she does not know whether she is pregnant', async () => {
    await saveProfile(profileOf({ pregnancyUnsure: true }));
    await openResult({ items: [ADVIL] });

    await screen.findByRole('article');
    expect(screen.getByText('Grossesse possible, terme inconnu')).toBeVisible();
  });

  it('reads a term that may be past the birth with breastfeeding too, and says so', async () => {
    // Month 9 given 8 days ago: 37 to 42 weeks, perhaps already born.
    await saveProfile(profileOf({ term: { kind: 'months', months: 9, givenOn: '2026-10-27' } }));
    await openResult({ items: [CODEINE], settings: accompanied });

    const card = await screen.findByRole('article');
    expect(
      screen.getByText(/^Nous ne savons pas si le bébé est né\s: ce résultat tient compte/),
    ).toBeVisible();
    // The breastfeeding rule on codeine applies (baby of unknown age).
    expect(within(card).getByText('Règle : codeine-breastfeeding')).toBeVisible();
  });

  it('says "votre bébé" in woman mode when the baby may be born', async () => {
    await saveProfile(profileOf({ term: { kind: 'unknown', givenOn: '2026-09-20' } }));
    await openResult({ items: [CODEINE] });

    await screen.findByRole('article');
    expect(screen.getByText(/^Nous ne savons pas si votre bébé est né/)).toBeVisible();
  });

  it('reads a last period as unknown when the phone date is before the last save, and says why', async () => {
    await saveProfile(
      profileOf({
        term: { kind: 'lmp', date: '2026-05-06' },
        updatedAt: '2026-11-20T08:00:00.000Z',
      }),
    );
    await openResult({ items: [ADVIL] });

    const card = await screen.findByRole('article');
    expect(
      screen.getByText(/la date du téléphone est avant un jour où l'application/),
    ).toBeVisible();
    expect(within(card).getByText(/^Terme inconnu\s: ce résultat tient compte/)).toBeVisible();
  });

  it('reads the profile and the date again when the app comes back to the front', async () => {
    // Just before midnight, six days after 19 weeks were given.
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 30));
    await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 19, givenOn: '2026-11-04' } }));
    await openResult({ items: [ADVIL] });
    expect(await screen.findByText(/^Terme retenu\s: environ 19 semaines$/)).toBeVisible();

    // A minute later the day has changed: the phone taken out of a pocket.
    vi.setSystemTime(new Date(2026, 10, 11, 0, 0, 30));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText(/^Terme retenu\s: environ 20 semaines$/)).toBeVisible();
  });

  it('works nothing out on an outdated term: it asks whether the baby is born instead', async () => {
    await saveProfile(profileOf({ term: { kind: 'months', months: 7, givenOn: '2026-07-01' } }));
    await openResult({
      items: [ADVIL],
      settings: accompanied,
      heading: /^Le terme noté a passé 42 semaines/,
    });

    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByRole('button', { name: 'Oui, le bébé est né' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Non, toujours enceinte' })).toBeVisible();
    expect(await listHistory('p1')).toEqual([]);
  });
});

describe('Result: waiting and failures, never a blank screen', () => {
  it('says the result is being prepared while the pack loads', async () => {
    await saveProfile(profileOf());
    await openResult({ items: [KINKELIBA], packLoader: pendingPack });

    expect(await screen.findByText('Le résultat se prépare.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('says so when no pack could be loaded, with the way back', async () => {
    await saveProfile(profileOf());
    await openResult({ items: [KINKELIBA], packLoader: noPack });

    expect(await screen.findByText(/pas encore sur ce téléphone/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revenir à la liste' })).toBeVisible();
  });

  it.each([
    ['a RangeError', new RangeError('units per day must be greater than 0')],
    ['a PackError', new PackError('the pack is not valid')],
  ])('says the result could not be given when the engine throws %s', async (_name, error) => {
    failure.evaluate = error;
    await saveProfile(profileOf());
    const { user } = await openResult({ items: [KINKELIBA] });

    expect(
      await screen.findByText("Le résultat n'a pas pu être donné. Revenez à la liste."),
    ).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
    expect(await listHistory('p1')).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Revenir à la liste' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
  });

  it('says the result could not be given when the profile cannot be turned into a context', async () => {
    // A long-term unit count the engine would refuse: contextFromProfile throws a RangeError.
    await saveProfile(profileOf({ longTermItems: [{ ...ADVIL, unitsPerDay: 0 }] }));
    await openResult({ items: [KINKELIBA] });

    expect(
      await screen.findByText("Le résultat n'a pas pu être donné. Revenez à la liste."),
    ).toBeVisible();
  });

  it('says so when the profile cannot be read, and when it is no longer there', async () => {
    failure.getProfile = new Error('storage refused');
    await saveProfile(profileOf());
    await openResult({ items: [KINKELIBA] });
    expect(await screen.findByText(/Les profils n'ont pas pu être lus/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revenir à la liste' })).toBeVisible();
  });

  it('says so when the profile of the check is no longer on the phone', async () => {
    await openResult({ items: [KINKELIBA] });
    expect(await screen.findByText(/Ce profil n'est plus sur ce téléphone/)).toBeVisible();
  });
});
