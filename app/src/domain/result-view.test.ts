// SPDX-License-Identifier: MIT
import {
  evaluate,
  rangeFromMonths,
  type CheckedItem,
  type Evaluation,
  type EvaluationContext,
  type Finding,
  type Lang,
  type Pack,
  type PregnancyContext,
} from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { translate, type MessageKey, type Vars } from '../i18n/translate.js';
import { knowledgePack } from '../test/knowledge-pack.js';
import { buildResultView, formatPackDate, shownFindings, type ResultView } from './result-view.js';
import type { Mode } from './types.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

const ADVIL: CheckedItem = { ref: { kind: 'product', id: 'advil-400-mg-63646874' } };
const DOLIPRANE: CheckedItem = {
  ref: { kind: 'product', id: 'doliprane-1000-mg-60234100' },
  unitsPerDay: 4,
};
const SACHET: CheckedItem = {
  ref: { kind: 'product', id: 'cold-sachet-paracetamol' },
  unitsPerDay: 3,
};
const KINKELIBA: CheckedItem = { ref: { kind: 'plant', id: 'kinkeliba' } };
const MARKET: CheckedItem = { ref: { kind: 'unrecognised', text: 'comprimés du marché' } };

function weeks(n: number): PregnancyContext {
  return { weeksMin: n, weeksMax: n, precision: 'exact' };
}

function contextOf(patch: Partial<EvaluationContext>): EvaluationContext {
  return { conditions: [], items: [], signs: [], ...patch };
}

function tOf(lang: Lang) {
  return (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
}

/** The view of an evaluation of `context` with the real pack. */
function viewOf(context: EvaluationContext, mode: Mode, lang: Lang = 'fr'): ResultView {
  return buildResultView(evaluate(pack, context), pack, context.items, mode, lang, tOf(lang));
}

function onlyFinding(view: ResultView) {
  expect(view.findings).toHaveLength(1);
  const [finding] = view.findings;
  if (finding === undefined) throw new Error('no finding');
  return finding;
}

describe('buildResultView: woman mode', () => {
  it('shows the level, the product, the risk and the orientation, nothing more', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman');
    expect(view.level).toBe('before-next-dose');
    expect(view.levelLabel).toBe('À montrer avant la prochaine prise');
    const finding = onlyFinding(view);
    expect(finding).toMatchObject({
      level: 'before-next-dose',
      levelLabel: 'À montrer avant la prochaine prise',
      title: 'ADVIL 400 mg, comprimé enrobé',
      risks: [pack.messages.fr['nsaid-pregnancy-from-20-weeks']?.risk],
      orientation:
        "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
      capped: false,
    });
    for (const hidden of ['fact', 'riskDetails', 'evidence', 'sources', 'ruleIds', 'cappedNote']) {
      expect(finding, hidden).not.toHaveProperty(hidden);
    }
  });

  it('keeps reminders and contraception notes for accompanied mode', () => {
    const items: CheckedItem[] = [{ ref: { kind: 'product', id: 'efavirenz-generic' } }];
    const context = contextOf({ pregnancy: weeks(16), items });
    const evaluation = evaluate(pack, context);
    expect(evaluation.reminders.length).toBeGreaterThan(0);
    expect(evaluation.notes.some((note) => note.kind === 'contraception')).toBe(true);
    const woman = buildResultView(evaluation, pack, items, 'woman', 'fr', tOf('fr'));
    expect(woman.reminders).toEqual([]);
    expect(woman.notes).toEqual([]);
    const accompanied = buildResultView(evaluation, pack, items, 'accompanied', 'fr', tOf('fr'));
    expect(accompanied.reminders).toEqual([
      {
        key: 'reminder:iptp-reminder',
        text: `${pack.messages.fr['iptp-reminder']?.fact ?? ''} ${pack.messages.fr['iptp-reminder']?.risk ?? ''}`,
      },
    ]);
    expect(accompanied.notes).toHaveLength(1);
    expect(accompanied.notes[0]?.orientation).toBe(
      pack.messages.fr['efavirenz-contraception']?.orientation,
    );
  });

  it('keys every note and reminder apart, even when two say the same words', () => {
    const items: CheckedItem[] = [
      { ref: { kind: 'product', id: 'efavirenz-generic' } },
      {
        ref: { kind: 'product', id: 'paracetamol-generic' },
        unitsPerDay: 3,
        strengthUnknown: true,
      },
    ];
    const evaluation = evaluate(pack, contextOf({ pregnancy: weeks(16), items }));
    const [note] = evaluation.notes;
    if (note === undefined) throw new Error('no note');
    // The same note twice, as two rules with one message would give.
    const twice: Evaluation = {
      ...evaluation,
      notes: [note, { ...note, ruleId: `${note.ruleId}-other` }],
    };
    const view = buildResultView(twice, pack, items, 'accompanied', 'fr', tOf('fr'));
    const keys = [...view.notes, ...view.reminders].map((n) => n.key);
    expect(view.notes[0]?.text).toBe(view.notes[1]?.text);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('shows the dose note in both modes: the woman is the one entering units', () => {
    const items: CheckedItem[] = [
      {
        ref: { kind: 'product', id: 'paracetamol-generic' },
        unitsPerDay: 3,
        strengthUnknown: true,
      },
    ];
    const context = contextOf({ pregnancy: weeks(16), items });
    const dose = pack.messages.fr['max-dose-not-computable'];
    for (const mode of ['woman', 'accompanied'] as const) {
      const view = viewOf(context, mode);
      expect(view.notes, mode).toEqual([
        {
          key: 'dose:paracetamol-max-daily',
          text: `${dose?.fact ?? ''} ${dose?.risk ?? ''}`,
          orientation: dose?.orientation,
        },
      ]);
    }
  });
});

describe('buildResultView: accompanied mode', () => {
  it('adds the fact, the risk detail, the evidence with its wording, the sources and the rule', () => {
    const finding = onlyFinding(
      viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'accompanied'),
    );
    const message = pack.messages.fr['nsaid-pregnancy-from-20-weeks'];
    expect(finding.fact).toBe(message?.fact);
    expect(finding.riskDetails).toEqual([message?.riskDetail]);
    expect(finding.evidence).toEqual([
      {
        level: 'A',
        wording: 'peut provoquer',
        text: 'Niveau de preuve A : « peut provoquer »',
      },
    ]);
    expect(finding.ruleIds).toEqual(['nsaid-pregnancy-from-20-weeks']);
    expect(finding.sources?.[0]).toEqual({
      name: 'Base de données publique des médicaments (BDPM)',
      locator: expect.stringContaining('ADVIL 200 mg') as unknown,
      url: expect.stringMatching(/^https:\/\//) as unknown,
    });
  });

  it('never shows a source quote, and lists a source once', () => {
    const context = contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] });
    const view = viewOf(context, 'accompanied');
    const quotes = evaluate(pack, context).findings.flatMap((f) =>
      f.sources.flatMap((s) => (s.quote === undefined ? [] : [s.quote])),
    );
    expect(quotes.length).toBeGreaterThan(0);
    const text = JSON.stringify(view);
    for (const quote of quotes) expect(text).not.toContain(quote);
    for (const finding of view.findings) {
      const keys = (finding.sources ?? []).map((s) => `${s.name}|${s.locator}|${s.url ?? ''}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const source of finding.sources ?? []) expect(source).not.toHaveProperty('quote');
    }
  });

  it('gives a source without a URL no link', () => {
    const evaluation = evaluate(pack, contextOf({ pregnancy: weeks(30), items: [ADVIL] }));
    const [first] = evaluation.findings;
    if (first === undefined) throw new Error('no finding');
    const source = first.sources[0];
    if (source === undefined) throw new Error('no source');
    const withoutUrl: Evaluation = {
      ...evaluation,
      findings: [
        {
          ...first,
          sources: [{ source: source.source, locator: 'Section 4.6', accessed: source.accessed }],
        },
      ],
    };
    const view = buildResultView(withoutUrl, pack, [ADVIL], 'accompanied', 'fr', tOf('fr'));
    expect(onlyFinding(view).sources).toEqual([
      { name: 'Base de données publique des médicaments (BDPM)', locator: 'Section 4.6' },
    ]);
  });

  it('cites the sources of a danger sign, which its finding does not carry', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), 'accompanied');
    const sign = pack.dangerSigns.find((d) => d.id === 'fever');
    expect(onlyFinding(view).sources?.length).toBe(sign?.sources.length);
  });
});

describe('buildResultView: orientation', () => {
  it('uses the message orientation when it has one', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), 'woman');
    expect(onlyFinding(view).orientation).toBe(pack.messages.fr['danger-sign-fever']?.orientation);
  });

  it('says the unknown default in full, without a sentence the message already said', () => {
    // Kinkeliba's risk already says it is not risk-free: only the missing sentence comes first.
    for (const mode of ['woman', 'accompanied'] as const) {
      const plant = onlyFinding(
        viewOf(contextOf({ pregnancy: weeks(14), items: [KINKELIBA] }), mode),
      );
      expect(plant.orientation, mode).toBe(
        "Nous n'avons pas d'information fiable. Montrez-le à votre sage-femme ou au pharmacien.",
      );
    }
    const english = onlyFinding(
      viewOf(contextOf({ pregnancy: weeks(14), items: [KINKELIBA] }), 'woman', 'en'),
    );
    expect(english.orientation).toBe(
      'We have no reliable information. Show it to your midwife or pharmacist.',
    );
    // A message that says neither: the whole default of spec section 10.
    const quiet = { fact: 'Ce remède est utilisé.', risk: 'Ce remède est peu étudié.' };
    const quietEn = { fact: 'This remedy is used.', risk: 'This remedy is little studied.' };
    const plain: Pack = {
      ...pack,
      messages: {
        fr: { ...pack.messages.fr, kinkeliba: quiet },
        en: { ...pack.messages.en, kinkeliba: quietEn },
      },
    };
    const context = contextOf({ pregnancy: weeks(14), items: [KINKELIBA] });
    const full = buildResultView(
      evaluate(plain, context),
      plain,
      [KINKELIBA],
      'woman',
      'fr',
      tOf('fr'),
    );
    expect(onlyFinding(full).orientation).toBe(
      "Nous n'avons pas d'information fiable. Cela ne veut pas dire que c'est sans risque. Montrez-le à votre sage-femme ou au pharmacien.",
    );
    const fullEn = buildResultView(
      evaluate(plain, context),
      plain,
      [KINKELIBA],
      'woman',
      'en',
      tOf('en'),
    );
    expect(onlyFinding(fullEn).orientation).toBe(
      'We have no reliable information. This does not mean it is risk-free. Show it to your midwife or pharmacist.',
    );
  });

  it('uses the level default otherwise, for one product or several', () => {
    const duplicate = viewOf(
      contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }),
      'woman',
    );
    expect(duplicate.findings[0]?.orientation).toBe(
      "Montrez ces produits à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
    );
    const english = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman', 'en');
    expect(onlyFinding(english).orientation).toBe(
      'Show this product to the midwife, the nurse or the pharmacist before the next dose.',
    );
  });
});

describe('buildResultView: titles', () => {
  it('names every product of a finding, a danger sign by its label, a text as typed', () => {
    const duplicate = viewOf(
      contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }),
      'woman',
    );
    expect(duplicate.findings[0]?.title).toBe(
      'DOLIPRANE 1000 mg, comprimé et Sachet contre le rhume (paracétamol, phéniramine, vitamine C)',
    );
    const english = viewOf(
      contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }),
      'woman',
      'en',
    );
    // A BDPM product keeps its French name in English (the name on the box).
    expect(english.findings[0]?.title).toBe(
      'DOLIPRANE 1000 mg, comprimé and Cold remedy sachet (paracetamol, pheniramine, vitamin C)',
    );
    const fever = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), 'woman');
    expect(onlyFinding(fever).title).toBe(pack.dangerSigns.find((d) => d.id === 'fever')?.label.fr);
    const market = viewOf(contextOf({ pregnancy: weeks(14), items: [MARKET] }), 'woman');
    expect(onlyFinding(market).title).toBe('comprimés du marché');
  });

  it('keeps the names one by one, so each product can take its own line', () => {
    const duplicate = viewOf(
      contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }),
      'woman',
    );
    expect(duplicate.findings[0]?.names).toEqual([
      'DOLIPRANE 1000 mg, comprimé',
      'Sachet contre le rhume (paracétamol, phéniramine, vitamine C)',
    ]);
    const fever = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), 'woman');
    expect(onlyFinding(fever).names).toEqual([onlyFinding(fever).title]);
  });

  it('reads the fact of a sign with its own message first, in both modes', () => {
    const fact = pack.messages.fr['danger-sign-fever']?.fact;
    for (const mode of ['woman', 'accompanied'] as const) {
      const fever = onlyFinding(
        viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), mode),
      );
      expect(fever.lead, mode).toBe(fact);
      expect(fever, mode).not.toHaveProperty('fact');
    }
    // The standard danger sign message: its fact is the level again, so neither a lead nor a fact.
    const other = pack.dangerSigns.find((d) => d.message === undefined);
    if (other === undefined) throw new Error('no sign with the standard message');
    for (const mode of ['woman', 'accompanied'] as const) {
      const plain = onlyFinding(
        viewOf(contextOf({ pregnancy: weeks(14), signs: [other.id] }), mode),
      );
      expect(plain, mode).not.toHaveProperty('lead');
      expect(plain, mode).not.toHaveProperty('fact');
    }
  });

  it('names a product whose strength is not known by its family, never one strength', () => {
    const items: CheckedItem[] = [
      { ref: { kind: 'product', id: 'paracetamol-generic' }, strengthUnknown: true },
    ];
    const view = viewOf(contextOf({ pregnancy: weeks(14), items }), 'woman');
    expect(onlyFinding(view).title).toBe('Paracétamol (générique)');
  });
});

describe('buildResultView: nothing found', () => {
  it('gives the knowledge base version and date in both modes, never a reassurance', () => {
    const context = contextOf({ items: [ADVIL], breastfeeding: { babyAgeWeeks: 30 } });
    for (const mode of ['woman', 'accompanied'] as const) {
      const finding = onlyFinding(viewOf(context, mode));
      expect(finding.level).toBe('unknown');
      expect(finding.risks, mode).toEqual([
        `Rien n'a été trouvé dans notre base (version ${pack.version} du ${formatPackDate(pack.date, 'fr')}). Cela ne veut pas dire que c'est sans risque.`,
      ]);
      expect(finding.orientation).toBe(
        'Montrez cet écran à votre sage-femme ou à votre pharmacien.',
      );
      expect(finding).not.toHaveProperty('fact');
    }
    const english = onlyFinding(viewOf(context, 'woman', 'en'));
    expect(english.risks).toEqual([
      `Nothing was found in our knowledge base (version ${pack.version} of ${formatPackDate(pack.date, 'en')}). This does not mean it is risk-free.`,
    ]);
  });
});

describe('buildResultView: term', () => {
  it('says when the term is estimated or unknown, and nothing for an exact term', () => {
    const estimated = viewOf(
      contextOf({ pregnancy: { ...rangeFromMonths(5), precision: 'estimated' }, items: [ADVIL] }),
      'woman',
    );
    expect(onlyFinding(estimated).termNote).toBe(
      'Terme estimé : ce résultat tient compte de toutes les semaines possibles.',
    );
    const unknown = viewOf(
      contextOf({ pregnancy: { weeksMin: 0, weeksMax: 42, precision: 'unknown' }, items: [ADVIL] }),
      'woman',
      'en',
    );
    expect(onlyFinding(unknown).termNote).toBe(
      'Unknown term: this result takes the whole pregnancy into account.',
    );
    const exact = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman');
    expect(onlyFinding(exact)).not.toHaveProperty('termNote');
  });
});

describe('buildResultView: merged findings', () => {
  it.each([
    ['5 months', { ...rangeFromMonths(5), precision: 'estimated' as const }],
    ['an unknown term', { weeksMin: 0, weeksMax: 42, precision: 'unknown' as const }],
  ])(
    'shows one card per item set and check at %s: the highest level, every risk said',
    (_label, pregnancy) => {
      const context = contextOf({ pregnancy, items: [ADVIL] });
      const evaluation = evaluate(pack, context);
      const ids = ['nsaid-pregnancy-from-20-weeks', 'nsaid-pregnancy-before-20-weeks'];
      expect(evaluation.findings.map((f) => f.ruleId)).toEqual(ids);
      const [from20, before20] = ids.map((id) => pack.messages.fr[id]);

      // Woman mode: the level and orientation of the highest, both risks.
      const woman = onlyFinding(
        buildResultView(evaluation, pack, context.items, 'woman', 'fr', tOf('fr')),
      );
      expect(woman.level).toBe('before-next-dose');
      expect(woman.orientation).toBe(
        "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
      );
      expect(woman.risks).toEqual([from20?.risk, before20?.risk]);
      expect(woman).not.toHaveProperty('ruleIds');

      // Accompanied mode: also both detailed risks, both evidence levels, both rules, all sources.
      const accompanied = onlyFinding(
        buildResultView(evaluation, pack, context.items, 'accompanied', 'fr', tOf('fr')),
      );
      expect(accompanied.riskDetails).toEqual([from20?.riskDetail, before20?.riskDetail]);
      expect(accompanied.evidence?.map((e) => e.level)).toEqual(['A', 'C']);
      expect(accompanied.ruleIds).toEqual(ids);
      const names = new Set(accompanied.sources?.map((s) => s.name));
      expect(names.has('FDA Drug Safety Communications')).toBe(true);
      expect(names.has('Base de données publique des médicaments (BDPM)')).toBe(true);
      // The engine output is unchanged.
      expect(evaluation.findings).toHaveLength(2);
    },
  );

  it('keeps findings of other checks or other items, in engine order', () => {
    const findings: Finding[] = [
      {
        level: 'before-next-dose',
        check: 'C6',
        items: [0, 1],
        message: 'a',
        capped: false,
        sources: [],
      },
      {
        level: 'before-next-dose',
        check: 'C7',
        items: [0, 1],
        message: 'b',
        capped: false,
        sources: [],
      },
      { level: 'next-contact', check: 'C1', items: [0], message: 'c', capped: false, sources: [] },
      { level: 'next-contact', check: 'C1', items: [0], message: 'd', capped: false, sources: [] },
      { level: 'next-contact', check: 'C1', items: [1], message: 'e', capped: false, sources: [] },
      {
        level: 'danger',
        check: 'C11',
        items: [],
        message: 'f',
        sign: 'fever',
        capped: false,
        sources: [],
      },
      {
        level: 'danger',
        check: 'C11',
        items: [],
        message: 'g',
        sign: 'bleeding',
        capped: false,
        sources: [],
      },
    ];
    expect(shownFindings(findings).map((f) => f.message)).toEqual(['a', 'b', 'c', 'e', 'f', 'g']);
  });
});

describe('buildResultView: capped findings', () => {
  it('keeps the capped flag and says why in accompanied mode', () => {
    const evaluation = evaluate(pack, contextOf({ pregnancy: weeks(30), items: [ADVIL] }));
    const capped: Evaluation = {
      ...evaluation,
      findings: evaluation.findings.map((f) => ({ ...f, level: 'next-contact', capped: true })),
    };
    const woman = onlyFinding(buildResultView(capped, pack, [ADVIL], 'woman', 'fr', tOf('fr')));
    expect(woman.capped).toBe(true);
    expect(woman).not.toHaveProperty('cappedNote');
    const accompanied = onlyFinding(
      buildResultView(capped, pack, [ADVIL], 'accompanied', 'en', tOf('en')),
    );
    expect(accompanied.capped).toBe(true);
    expect(accompanied.cappedNote).toBe('Level limited because the evidence is weak.');
  });
});

describe('buildResultView: danger', () => {
  const CASTOR: CheckedItem = { ref: { kind: 'plant', id: 'castor-oil' } };
  const scar = { pregnancy: weeks(39), conditions: ['uterine-scar' as const] };

  it('leads with the orientation of the danger findings when they all say the same', () => {
    // Case 10: fever (its own orientation) and kinkeliba (not a danger).
    const fever = viewOf(
      contextOf({ pregnancy: weeks(14), signs: ['fever'], items: [KINKELIBA] }),
      'woman',
    );
    expect(fever.danger).toBe(true);
    expect(fever.level).toBe('danger');
    expect(fever.headline).toBe(pack.messages.fr['danger-sign-fever']?.orientation);
    expect(fever.findings.map((f) => f.level)).toEqual(['danger', 'unknown']);
    // Case 9: castor oil at term with a scar, a rule with its own orientation.
    const castor = viewOf(contextOf({ ...scar, items: [CASTOR, MARKET] }), 'woman');
    expect(castor.headline).toBe(pack.messages.fr['castor-oil-term-uterine-scar']?.orientation);
    // Standard danger signs: the standard instruction, as before.
    const two = pack.dangerSigns
      .filter((d) => d.message === undefined)
      .slice(0, 2)
      .map((d) => d.id);
    const standard = viewOf(contextOf({ pregnancy: weeks(14), signs: two }), 'woman', 'en');
    expect(standard.headline).toBe('Go to the health post now.');
  });

  it('says "go to the health post now" when the danger findings say different things', () => {
    // Castor oil (see the midwife today) and bleeding, a standard sign (go now).
    expect(pack.dangerSigns.find((d) => d.id === 'vaginal-bleeding')?.message).toBeUndefined();
    const view = viewOf(
      contextOf({ ...scar, items: [CASTOR], signs: ['vaginal-bleeding'] }),
      'woman',
    );
    expect(view.findings.filter((f) => f.level === 'danger')).toHaveLength(2);
    expect(view.headline).toBe('Allez au poste de santé maintenant.');
  });

  it('has no danger lead otherwise; the headline is the level name', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman', 'en');
    expect(view.danger).toBe(false);
    expect(view.headline).toBe('Show before the next dose');
  });
});

describe('buildResultView: closing lines', () => {
  it('ends with the fixed sentence, the version, "not validated" and the closing sentence', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman');
    expect(view.fixedLines).toEqual([
      'Ne changez rien à votre traitement sans en parler à un professionnel.',
    ]);
    expect(view.versionLine).toBe(
      `Base de connaissances ${pack.version} du ${formatPackDate(pack.date, 'fr')}`,
    );
    expect(view.notValidated).toBe(!pack.clinicallyValidated);
    expect(view.notValidatedLine).toBe(
      "Contenu non validé cliniquement : ne l'utilisez pas seul pour décider.",
    );
    expect(view.closing).toBe('Cet outil ne remplace pas un soignant.');
    const english = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman', 'en');
    expect(english.closing).toBe('This tool does not take the place of a health worker.');
  });

  it('drops the "not validated" line only for a clinically validated pack', () => {
    const validated: Pack = { ...pack, clinicallyValidated: true };
    const view = buildResultView(
      evaluate(validated, contextOf({ pregnancy: weeks(30), items: [ADVIL] })),
      validated,
      [ADVIL],
      'woman',
      'fr',
      tOf('fr'),
    );
    expect(view.notValidated).toBe(false);
    expect(view).not.toHaveProperty('notValidatedLine');
  });
});

describe('buildResultView: failures', () => {
  it('refuses a finding whose message the pack does not have', () => {
    const evaluation = evaluate(pack, contextOf({ pregnancy: weeks(30), items: [ADVIL] }));
    const broken: Evaluation = {
      ...evaluation,
      findings: evaluation.findings.map((f) => ({ ...f, message: 'no-such-message' })),
    };
    expect(() => buildResultView(broken, pack, [ADVIL], 'woman', 'fr', tOf('fr'))).toThrow(
      /no-such-message/,
    );
  });
});

describe('formatPackDate', () => {
  it('writes the date as each language reads it, whatever the time zone', () => {
    expect(formatPackDate('2026-11-05', 'fr')).toBe('05/11/2026');
    expect(formatPackDate('2026-11-05', 'en')).toBe('5 November 2026');
    expect(formatPackDate('not a date', 'en')).toBe('not a date');
  });
});
