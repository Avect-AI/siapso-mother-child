// SPDX-License-Identifier: MIT
// The result wording of the live test round 2 (SCRUM-52) on the real
// knowledge pack: the fixed line that never contradicts a daily maximum or a
// product danger, the accompanied voice (about her, "à sa prochaine visite"),
// the window reached through the look-ahead, the action line of a product
// danger card, the situations note shown in clear, and what who to call names.
import {
  evaluate,
  type CheckedItem,
  type ConditionId,
  type EvaluationContext,
  type Lang,
  type Pack,
  type PregnancyContext,
} from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { translate, type MessageKey, type Vars } from '../i18n/translate.js';
import { knowledgePack } from '../test/knowledge-pack.js';
import type { PossibleMatch } from './possible-matches.js';
import { buildResultView, type ResultView } from './result-view.js';
import type { Mode } from './types.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

function product(id: string, extra: Omit<CheckedItem, 'ref'> = {}): CheckedItem {
  return { ref: { kind: 'product', id }, ...extra };
}

function exact(weeks: number): PregnancyContext {
  return { weeksMin: weeks, weeksMax: weeks, precision: 'exact' };
}

function view(
  context: Partial<EvaluationContext>,
  mode: Mode = 'woman',
  lang: Lang = 'fr',
  extras: Parameters<typeof buildResultView>[7] = {},
): ResultView {
  const full: EvaluationContext = { conditions: [], items: [], signs: [], ...context };
  const t = (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
  return buildResultView(
    evaluate(pack, full),
    pack,
    full.items,
    mode,
    lang,
    t,
    full.conditions,
    extras,
  );
}

const ibuprofen = product('advil-400-mg-63646874');
const doliprane = (unitsPerDay: number) => product('doliprane-1000-mg-60234100', { unitsPerDay });
const castorOil: CheckedItem = { ref: { kind: 'plant', id: 'castor-oil' } };
const scar: ConditionId[] = ['uterine-scar'];

describe('the fixed line', () => {
  it('keeps the canonical line in woman mode, and speaks of her in accompanied mode', () => {
    expect(view({ pregnancy: exact(24), items: [ibuprofen] }).fixedLines).toEqual([
      'Ne changez rien à votre traitement sans en parler à un professionnel.',
    ]);
    expect(view({ pregnancy: exact(24), items: [ibuprofen] }, 'accompanied').fixedLines).toEqual([
      'Elle ne doit rien changer à son traitement sans en parler à un professionnel.',
    ]);
  });

  it('never says to change nothing beside a daily maximum or a product danger', () => {
    for (const context of [
      { pregnancy: exact(24), items: [doliprane(4)] },
      { pregnancy: exact(24), items: [doliprane(8)] },
      { pregnancy: exact(34), conditions: scar, items: [castorOil] },
    ]) {
      expect(view(context).fixedLines).toEqual([
        "N'en prenez pas plus avant d'en avoir parlé à un professionnel.",
      ]);
      expect(view(context, 'accompanied').fixedLines).toEqual([
        "Elle ne doit pas en prendre plus avant d'en avoir parlé à un professionnel.",
      ]);
      expect(view(context, 'woman', 'en').fixedLines).toEqual([
        'Take no more of it before talking to a professional.',
      ]);
    }
  });

  it('keeps the canonical line with a danger sign alone', () => {
    expect(view({ pregnancy: exact(24), items: [ibuprofen], signs: ['fever'] }).fixedLines).toEqual(
      ['Ne changez rien à votre traitement sans en parler à un professionnel.'],
    );
  });
});

describe('the accompanied voice', () => {
  it("reads a message's accompanied orientation in accompanied mode only", () => {
    const aspirin = { pregnancy: exact(28), items: [product('aspegic-500-mg-61162942')] };
    const message = pack.messages.fr['aspirin-analgesic-dose-pregnancy'];
    expect(view(aspirin).findings[0]?.orientation).toBe(message?.orientation);
    expect(view(aspirin, 'accompanied').findings[0]?.orientation).toBe(
      message?.orientationAccompanied,
    );
  });

  it('says her next visit, in the defaults and the level name', () => {
    // 6 weeks: only the NSAID rule before 20 weeks (next-contact, no orientation of its own).
    const early = { pregnancy: exact(6), items: [ibuprofen] };
    const woman = view(early).findings[0];
    expect(woman?.levelLabel).toBe('À dire à la prochaine visite');
    expect(woman?.orientation).toBe('Dites-le à la sage-femme à la prochaine visite.');
    const accompanied = view(early, 'accompanied').findings[0];
    expect(accompanied?.levelLabel).toBe('À dire à sa prochaine visite');
    expect(accompanied?.orientation).toBe('Dites-le à la sage-femme à sa prochaine visite.');
    expect(view(early, 'accompanied').levelLabel).toBe('À dire à sa prochaine visite');
    const kinkeliba = { items: [{ ref: { kind: 'plant', id: 'kinkeliba' } } as CheckedItem] };
    expect(view(kinkeliba, 'accompanied').findings[0]?.orientation).toMatch(
      /Montrez ce produit à la sage-femme ou à l'infirmier à sa prochaine visite\.$/,
    );
    expect(view(kinkeliba).findings[0]?.orientation).toMatch(
      /Montrez ce produit à la sage-femme ou au pharmacien à la prochaine visite\.$/,
    );
  });

  it('gives the situations note the accompanied orientation', () => {
    const note = view({ conditions: ['sickle-cell'], items: [ibuprofen] }, 'accompanied')
      .situations[0];
    expect(note?.orientation).toBe(
      'Parlez-en à la sage-femme ou au médecin à sa prochaine visite.',
    );
  });
});

describe('a window reached through the look-ahead', () => {
  it('says when she reaches it, in each mode', () => {
    const ahead = { pregnancy: exact(17), items: [ibuprofen] };
    // French typography: a no-break space before the colon.
    const plain = (text: string | undefined) => text?.split(String.fromCharCode(0xa0)).join(' ');
    expect(plain(view(ahead).findings[0]?.ahead)).toBe(
      'Vous atteindrez 20 semaines dans 4 semaines au plus : ce produit demande alors plus de prudence.',
    );
    expect(plain(view(ahead, 'accompanied').findings[0]?.ahead)).toBe(
      'Elle atteindra 20 semaines dans 4 semaines au plus : ce produit demande alors plus de prudence.',
    );
    expect(view(ahead, 'woman', 'en').findings[0]?.ahead).toBe(
      'You will reach 20 weeks within 4 weeks: this product then calls for more caution.',
    );
  });

  it('says nothing when the window applies today', () => {
    expect(view({ pregnancy: exact(22), items: [ibuprofen] }).findings[0]).not.toHaveProperty(
      'ahead',
    );
  });
});

describe('a product danger card', () => {
  it('says its own instruction and offers who to call; a danger sign card leaves it to the banner', () => {
    // The banner says the castor oil instruction: the card says it too.
    const result = view({ pregnancy: exact(34), conditions: scar, items: [castorOil] });
    expect(result.headline).toBe(pack.messages.fr['castor-oil-term-uterine-scar']?.orientation);
    const castor = result.findings.find((f) => f.title === 'Huile de ricin');
    expect(castor?.orientation).toBe(result.headline);
    expect(castor?.callNow).toBe(true);
    const sign = view({ pregnancy: exact(34), items: [], signs: ['vaginal-bleeding'] });
    expect(sign.findings[0]?.orientation).toEqual({ inBanner: true });
    expect(sign.findings[0]).not.toHaveProperty('callNow');
  });

  it('tells who to call the products of the danger and whether the danger is a product', () => {
    const codeine = product('codoliprane-500-mg-30-mg-60904643');
    const signs = view({
      breastfeeding: { babyAgeWeeks: 12 },
      items: [product('advil-400-mg-63646874'), codeine],
      signs: ['baby-very-sleepy'],
    });
    expect(signs.danger).toBe(true);
    expect(signs.dangerItems).toEqual([1]);
    expect(signs.productDanger).toBe(false);
    const castor = view({ pregnancy: exact(34), conditions: scar, items: [castorOil] });
    expect(castor.dangerItems).toEqual([0]);
    expect(castor.productDanger).toBe(true);
    const sign = view({ pregnancy: exact(20), items: [], signs: ['fever'] });
    expect(sign.dangerItems).toEqual([]);
    expect(sign.productDanger).toBe(false);
  });
});

describe('the situations the base does not read', () => {
  it('are shown in clear, never with HIV, and never tell to add a medicine', () => {
    const all: ConditionId[] = [
      'hiv-cotrimoxazole',
      'tuberculosis-treatment',
      'epilepsy-treatment',
      'uterine-scar',
      'renal-failure',
      'hepatic-failure',
      'sickle-cell',
    ];
    for (const lang of ['fr', 'en'] as const) {
      const result = view({ conditions: all, items: [ibuprofen] }, 'accompanied', lang);
      expect(result.situations.map((s) => s.key)).toEqual([
        'condition:tuberculosis-treatment',
        'condition:epilepsy-treatment',
        'condition:sickle-cell',
      ]);
      expect(result.situationsConcealed).toBe(false);
      for (const note of result.situations) expect(note.text).not.toMatch(/Ajoutez|Add /);
    }
  });

  it('are concealed again if a pack ever stops reading HIV', () => {
    const blind: Pack = {
      ...pack,
      rules: pack.rules.filter(
        (rule) =>
          !(rule.when.requires ?? []).some(
            (r) => 'condition' in r && r.condition === 'hiv-cotrimoxazole',
          ) && !(rule.when.unlessConditions ?? []).includes('hiv-cotrimoxazole'),
      ),
    };
    const t = (key: MessageKey, vars?: Vars) => translate('fr', key, vars);
    const context: EvaluationContext = {
      conditions: ['hiv-cotrimoxazole'],
      items: [ibuprofen],
      signs: [],
    };
    const result = buildResultView(
      evaluate(blind, context),
      blind,
      context.items,
      'accompanied',
      'fr',
      t,
      context.conditions,
    );
    expect(result.situations.map((s) => s.key)).toEqual(['condition:hiv-cotrimoxazole']);
    expect(result.situationsConcealed).toBe(true);
  });
});

describe('the dose notes', () => {
  it('say one note once, whatever the number of rules that give it', () => {
    const result = view({
      pregnancy: exact(24),
      items: [product('paracetamol-generic', { unitsPerDay: 8 })],
    });
    expect(result.notes.map((n) => n.text)).toEqual([
      'La quantité totale ne peut pas être calculée sans le dosage. Nous ne pouvons pas dire si la quantité maximale est dépassée.',
    ]);
    expect(result.notes[0]?.orientation).toBe(
      "Montrez les boîtes à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
    );
  });
});

describe('a Latin name in a resemblance', () => {
  it('is given apart, so the screen can read it in Latin', () => {
    const typed: CheckedItem = { ref: { kind: 'unrecognised', text: 'huile ricin bio' } };
    const possible = new Map<number, PossibleMatch>([
      [1, { forItem: 0, typed: 'huile ricin bio', strength: 'very-strong' }],
    ]);
    const result = view({ pregnancy: exact(20), items: [typed, castorOil] }, 'woman', 'fr', {
      possible,
    });
    const card = result.findings.find((f) => f.possible?.startsWith('Ce nom ressemble') === true);
    expect(card?.possible).toContain('Ricinus communis');
    expect(card?.possibleLatin).toBe('Ricinus communis');
  });
});

describe('fix round 1 of SCRUM-52', () => {
  const nbsp = (text: string | undefined) => text?.split(String.fromCharCode(0xa0)).join(' ');
  const unknownBox = (id: string, unitsPerDay: number) =>
    product(id, { unitsPerDay, strengthUnknown: true });

  it('leads a card with a possible toxic amount: today, even if all seems well, with who to call', () => {
    const message = pack.messages.fr['paracetamol-overdose-possible'];
    for (const item of [
      unknownBox('doliprane-1000-mg-60234100', 8),
      unknownBox('paracetamol-generic', 7),
      unknownBox('paracetamol-generic', 8),
    ]) {
      const woman = view({ pregnancy: exact(24), items: [item] });
      expect(woman.level).toBe('before-next-dose');
      const card = woman.findings.find((f) => f.key.startsWith('C7|'));
      expect(card?.orientation).toBe(message?.orientation);
      expect(card?.callNow).toBe(true);
      expect(card?.risks.map((r) => r.text)).toEqual([
        pack.messages.fr['paracetamol-max-daily']?.risk,
        message?.risk,
      ]);
      const accompanied = view({ pregnancy: exact(24), items: [item] }, 'accompanied');
      expect(accompanied.findings.find((f) => f.key.startsWith('C7|'))?.orientation).toBe(
        message?.orientationAccompanied,
      );
    }
  });

  it('never gives the instruction of a danger still ahead, and says when she reaches it', () => {
    const misoprostol = product('misoprostol-generic');
    const scar8 = view({ pregnancy: exact(8), conditions: scar, items: [misoprostol] });
    expect(scar8.danger).toBe(false);
    expect(scar8.findings[0]?.orientation).toBe(
      pack.messages.fr['misoprostol-pregnancy']?.orientation,
    );
    expect(nbsp(scar8.findings[0]?.ahead)).toMatch(
      /^Vous atteindrez 12 semaines dans 4 semaines au plus/,
    );
    const late26 = view({ pregnancy: exact(26), items: [misoprostol] });
    expect(late26.danger).toBe(false);
    expect(late26.findings[0]?.orientation).toBe(
      pack.messages.fr['misoprostol-pregnancy']?.orientation,
    );
    expect(nbsp(late26.findings[0]?.ahead)).toMatch(/^Vous atteindrez 30 semaines/);
    const castor26 = view({ pregnancy: exact(26), conditions: scar, items: [castorOil] });
    expect(castor26.danger).toBe(false);
    expect(castor26.findings[0]?.level).toBe('before-next-dose');
    expect(castor26.findings[0]?.orientation).toBe(
      "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
    );
    expect(nbsp(castor26.findings[0]?.ahead)).toMatch(/^Vous atteindrez 30 semaines/);
    // The fixed line: no product danger, no daily maximum.
    expect(castor26.fixedLines[0]).toMatch(/^Ne changez rien/);
  });

  it('says "peut-être" for a term that is only estimated', () => {
    const estimated = view({
      pregnancy: { weeksMin: 12, weeksMax: 16, precision: 'estimated' },
      items: [ibuprofen],
    });
    expect(nbsp(estimated.findings[0]?.ahead)).toBe(
      'Vous atteindrez peut-être 20 semaines dans les 4 semaines à venir : ce produit demande alors plus de prudence.',
    );
    const accompanied = view(
      { pregnancy: { weeksMin: 12, weeksMax: 16, precision: 'estimated' }, items: [ibuprofen] },
      'accompanied',
      'en',
    );
    expect(accompanied.findings[0]?.ahead).toBe(
      'She may reach 20 weeks within the next 4 weeks: this product then calls for more caution.',
    );
  });
});
