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
import { cappedEvaluation, withPossibleMatches } from './possible-matches.js';
import { formatDate } from './dates.js';
import { buildResultView, shownFindings, type ResultView } from './result-view.js';
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
/** French puts it before ":", and a strength keeps its unit with it ("400 mg"). */
const NO_BREAK = ' ';

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
      title: `ADVIL 400${NO_BREAK}mg, comprimé enrobé`,
      orientation:
        "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
      capped: false,
    });
    // The risk sentence alone: no detail, evidence or capped note beside it.
    expect(finding.risks).toEqual([
      { text: pack.messages.fr['nsaid-pregnancy-from-20-weeks']?.risk },
    ]);
    for (const hidden of ['fact', 'sources', 'ruleIds']) {
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
    // The risk with its own detail and evidence level, side by side.
    expect(finding.risks).toEqual([
      {
        text: message?.risk,
        detail: message?.riskDetail,
        evidence: {
          level: 'A',
          wording: 'peut provoquer',
          text: 'Niveau de preuve A : « peut provoquer »',
        },
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
    const aspirin: CheckedItem = { ref: { kind: 'product', id: 'aspirin-generic' } };
    expect(pack.products.some((p) => p.id === 'aspirin-generic')).toBe(true);
    const view = viewOf(contextOf({ pregnancy: weeks(30), items: [aspirin] }), 'woman');
    expect(onlyFinding(view).orientation).toBe(
      pack.messages.fr['aspirin-analgesic-dose-pregnancy']?.orientation,
    );
    // A danger sign's own orientation leads the banner.
    const fever = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), 'woman');
    expect(fever.headline).toBe(pack.messages.fr['danger-sign-fever']?.orientation);
  });

  it('says the unknown default in full, without a sentence the message already said', () => {
    // Kinkeliba's risk already says that nobody knows whether it can harm: only who and when.
    const plant = onlyFinding(
      viewOf(contextOf({ pregnancy: weeks(14), items: [KINKELIBA] }), 'woman'),
    );
    expect(plant.risks[0]?.text).toMatch(/^On ne sait pas si le kinkéliba peut faire du mal/);
    expect(plant.orientation).toBe(
      'Montrez-le à la sage-femme ou au pharmacien à la prochaine visite.',
    );
    const english = onlyFinding(
      viewOf(contextOf({ pregnancy: weeks(14), items: [KINKELIBA] }), 'woman', 'en'),
    );
    expect(english.orientation).toBe('Show it to the midwife or the pharmacist at the next visit.');
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
    // Said positively: never "sans risque", even inside a negation.
    expect(onlyFinding(full).orientation).toBe(
      "Nous n'avons pas d'information fiable. On ne sait pas si ce produit peut faire du mal. Montrez-le à la sage-femme ou au pharmacien à la prochaine visite.",
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
      'We have no reliable information. We do not know whether this product can cause harm. Show it to the midwife or the pharmacist at the next visit.',
    );
  });

  it('words the default before the next dose for the person helping in accompanied mode, at a sale too', () => {
    // Said to the person helping, in the voice of the app (show, tell): before she
    // takes it again, never read as an order to start a product not yet taken.
    const one = onlyFinding(
      viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'accompanied'),
    );
    expect(one.orientation).toBe(
      "Montrez ce produit à la sage-femme ou à l'infirmier avant qu'elle en reprenne.",
    );
    const several = viewOf(
      contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }),
      'accompanied',
    );
    expect(several.findings[0]?.orientation).toBe(
      "Montrez ces produits à la sage-femme ou à l'infirmier avant qu'elle en reprenne.",
    );
    const english = onlyFinding(
      viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'accompanied', 'en'),
    );
    expect(english.orientation).toBe(
      'Show this product to the midwife or the nurse before she takes any more.',
    );
    // A grey card without an orientation of its own says what the grey messages of
    // the pack say, so two grey cards of one result never name different people.
    const quiet = { fact: 'Ce remède est utilisé.', risk: 'Ce remède est peu étudié.' };
    const plain: Pack = {
      ...pack,
      messages: { ...pack.messages, fr: { ...pack.messages.fr, kinkeliba: quiet } },
    };
    const context = contextOf({ pregnancy: weeks(14), items: [KINKELIBA] });
    const grey = buildResultView(
      evaluate(plain, context),
      plain,
      [KINKELIBA],
      'accompanied',
      'fr',
      tOf('fr'),
    );
    expect(onlyFinding(grey).orientation).toBe(
      "Nous n'avons pas d'information fiable. On ne sait pas si ce produit peut faire du mal. Montrez-le à la sage-femme ou au pharmacien à la prochaine visite.",
    );
    expect(onlyFinding(grey).orientation).toMatch(
      new RegExp(`${pack.messages.fr['not-recognised']?.orientation ?? 'missing'}$`),
    );
  });

  it('says that a name was not recognised in the line both modes read, not behind "Pourquoi ?"', () => {
    for (const mode of ['woman', 'accompanied'] as const) {
      const card = onlyFinding(viewOf(contextOf({ pregnancy: weeks(14), items: [MARKET] }), mode));
      expect(card.risks[0]?.text, mode).toBe(
        "Ce produit n'a pas été reconnu. Nous n'avons pas d'information fiable sur ce produit. On ne sait pas s'il peut faire du mal.",
      );
      // Nothing left to open: no fact, no source, no rule.
      expect(card, mode).not.toHaveProperty('fact');
    }
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
    // A strength keeps its unit on its line: "1000" and "mg" never part.
    expect(duplicate.findings[0]?.title).toBe(
      `DOLIPRANE 1000${NO_BREAK}mg, comprimé et Sachet contre le rhume (paracétamol, phéniramine, vitamine C)`,
    );
    const english = viewOf(
      contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }),
      'woman',
      'en',
    );
    // A BDPM product keeps its French name in English (the name on the box).
    expect(english.findings[0]?.title).toBe(
      `DOLIPRANE 1000${NO_BREAK}mg, comprimé and Cold remedy sachet (paracetamol, pheniramine, vitamin C)`,
    );
    const fever = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), 'woman');
    expect(onlyFinding(fever).title).toBe(pack.dangerSigns.find((d) => d.id === 'fever')?.label.fr);
    const market = viewOf(contextOf({ pregnancy: weeks(14), items: [MARKET] }), 'woman');
    expect(onlyFinding(market).title).toBe('comprimés du marché');
  });

  it('marks the names typed as typed, so the screen quotes them and never says them as its own', () => {
    const typed: CheckedItem = { ref: { kind: 'unrecognised', text: 'Sirop X 2 cuillères' } };
    const view = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL, typed] }), 'woman');
    const grey = view.findings.find((f) => f.level === 'unknown');
    // Typed text is kept as typed, its spaces too.
    expect(grey?.names).toEqual(['Sirop X 2 cuillères']);
    expect(grey?.typed).toEqual(['Sirop X 2 cuillères']);
    expect(view.findings.find((f) => f.level === 'before-next-dose')).not.toHaveProperty('typed');
  });

  it('keeps the names one by one, so each product can take its own line', () => {
    const duplicate = viewOf(
      contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }),
      'woman',
    );
    expect(duplicate.findings[0]?.names).toEqual([
      `DOLIPRANE 1000${NO_BREAK}mg, comprimé`,
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
  // No rule of the pack reads artemether-lumefantrine (reference case 12).
  const COARTEM: CheckedItem = { ref: { kind: 'product', id: 'artemether-lumefantrine-generic' } };

  it('says what the base lacks in both modes, never a reassurance, and no version inside the sentence', () => {
    const context = contextOf({ items: [COARTEM], pregnancy: weeks(8) });
    for (const mode of ['woman', 'accompanied'] as const) {
      const finding = onlyFinding(viewOf(context, mode));
      expect(finding.level).toBe('unknown');
      // The version is said at the top and at the end of the result, not in her sentence.
      expect(finding.risks, mode).toEqual([
        {
          text: "Rien n'a été trouvé sur ce produit dans notre base. Notre base ne dit pas si ce produit peut faire du mal.",
        },
      ]);
      // Who to show it to, and when.
      expect(finding.orientation).toBe(
        'Montrez cet écran à la sage-femme ou au pharmacien à la prochaine visite.',
      );
      expect(finding).not.toHaveProperty('fact');
    }
    const english = onlyFinding(viewOf(context, 'woman', 'en'));
    expect(english.risks).toEqual([
      {
        text: 'Nothing was found on this product in our knowledge base. Our knowledge base does not say whether this product can cause harm.',
      },
    ]);
  });

  it('never says "nothing found" for a product the base has a rule on, nor an all-clear: a gap', () => {
    // Ibuprofen while breastfeeding: the NSAID rules are about pregnancy.
    const context = contextOf({ items: [ADVIL], breastfeeding: { babyAgeWeeks: 30 } });
    for (const mode of ['woman', 'accompanied'] as const) {
      const finding = onlyFinding(viewOf(context, mode));
      expect(finding.level).toBe('unknown');
      expect(finding.risks, mode).toEqual([
        {
          text: 'Notre base ne contient rien sur ce produit pour cette situation. Notre base ne dit pas si ce produit peut faire du mal dans cette situation.',
        },
      ]);
      expect(finding.orientation).toBe(
        'Montrez cet écran à la sage-femme ou au pharmacien à la prochaine visite.',
      );
      expect(finding).not.toHaveProperty('fact');
    }
    const english = onlyFinding(viewOf(context, 'woman', 'en'));
    expect(english.risks).toEqual([
      {
        text: 'Our knowledge base holds nothing on this product for this situation. Our knowledge base does not say whether this product can cause harm in this situation.',
      },
    ]);
  });

  it('gives every grey card a subject: never a risk that starts with "Cela"', () => {
    const plants = pack.plants.map((p): CheckedItem => ({ ref: { kind: 'plant', id: p.id } }));
    const items: CheckedItem[] = [COARTEM, ADVIL, MARKET, ...plants];
    for (const lang of ['fr', 'en'] as const) {
      const view = viewOf(contextOf({ items, breastfeeding: {} }), 'woman', lang);
      const grey = view.findings.filter((f) => f.level === 'unknown');
      expect(grey.length).toBeGreaterThan(plants.length);
      for (const finding of grey) {
        for (const risk of finding.risks) {
          expect(risk.text, `${lang} ${finding.title}`).not.toMatch(/^(Cela|This does)/);
        }
      }
    }
  });
});

describe('buildResultView: situations the base does not read', () => {
  it('says plainly, in both modes, that a ticked situation is not taken into account yet', () => {
    const context = contextOf({
      pregnancy: weeks(16),
      conditions: ['sickle-cell', 'tuberculosis-treatment', 'uterine-scar'],
      items: [ADVIL],
    });
    for (const mode of ['woman', 'accompanied'] as const) {
      const view = buildResultView(
        evaluate(pack, context),
        pack,
        context.items,
        mode,
        'fr',
        tOf('fr'),
        context.conditions,
      );
      // The uterine scar is read by rules: no note for it. Apart from the
      // notes, so the screen can say them before the cards.
      expect(view.notes, mode).toEqual([]);
      expect(
        view.situations.map((n) => n.key),
        mode,
      ).toEqual(['condition:sickle-cell', 'condition:tuberculosis-treatment']);
      expect(view.situations[0], mode).toEqual({
        key: 'condition:sickle-cell',
        text: 'Drépanocytose : notre base ne tient pas encore compte de cette situation, et ce résultat non plus. Ajoutez à la liste chaque médicament pris pour ce traitement ou cette maladie : il sera regardé comme les autres.',
        orientation: 'Parlez-en à la sage-femme ou au médecin à la prochaine visite.',
      });
    }
    const english = buildResultView(
      evaluate(pack, context),
      pack,
      context.items,
      'woman',
      'en',
      tOf('en'),
      context.conditions,
    );
    expect(english.situations[0]?.text).toBe(
      'Sickle cell disease: our knowledge base does not take this situation into account yet, and neither does this result. Add to the list each medicine taken for this treatment or this illness: it will be looked at like the others.',
    );
  });

  it('adds no note for a situation a rule reads, nor without situations', () => {
    const items = [{ ref: { kind: 'product', id: 'doliprane-1000-mg-60234100' } } as const];
    for (const conditions of [
      ['hepatic-failure', 'renal-failure', 'hiv-cotrimoxazole', 'uterine-scar'] as const,
      [] as const,
    ]) {
      const context = contextOf({ pregnancy: weeks(16), conditions: [...conditions], items });
      const view = buildResultView(
        evaluate(pack, context),
        pack,
        context.items,
        'woman',
        'fr',
        tOf('fr'),
        context.conditions,
      );
      expect(view.notes).toEqual([]);
      expect(view.situations).toEqual([]);
    }
  });
});

describe('buildResultView: what is shown only at an explicit tap', () => {
  it('hides the contraception notes, never the dose notes nor the reminders', () => {
    const items: CheckedItem[] = [
      { ref: { kind: 'product', id: 'efavirenz-generic' } },
      {
        ref: { kind: 'product', id: 'paracetamol-generic' },
        unitsPerDay: 3,
        strengthUnknown: true,
      },
    ];
    const context = contextOf({ pregnancy: weeks(16), items });
    const view = buildResultView(
      evaluate(pack, context),
      pack,
      items,
      'accompanied',
      'fr',
      tOf('fr'),
    );

    const notes = view.notes.map((note) => [note.key.split(':')[0], note.concealed === true]);
    expect(notes).toContainEqual(['contraception', true]);
    expect(notes).toContainEqual(['dose', false]);
    expect(view.reminders.every((reminder) => reminder.concealed === undefined)).toBe(true);
  });

  it('marks no situation note alone: the screen hides the section whole, HIV or not', () => {
    // A base that would not read HIV with cotrimoxazole yet.
    const unread: Pack = {
      ...pack,
      rules: pack.rules.filter(
        (rule) =>
          !(rule.when.unlessConditions ?? []).includes('hiv-cotrimoxazole') &&
          !(rule.when.requires ?? []).some(
            (r) => 'condition' in r && r.condition === 'hiv-cotrimoxazole',
          ),
      ),
    };
    const context = contextOf({
      pregnancy: weeks(16),
      conditions: ['hiv-cotrimoxazole', 'sickle-cell'],
      items: [ADVIL],
    });
    const view = buildResultView(
      evaluate(unread, context),
      unread,
      context.items,
      'woman',
      'fr',
      tOf('fr'),
      context.conditions,
    );

    // One note marked alone would say which situation it is.
    expect(view.situations.map((note) => [note.key, note.concealed === true])).toEqual([
      ['condition:hiv-cotrimoxazole', false],
      ['condition:sickle-cell', false],
    ]);
  });
});

describe('buildResultView: misoprostol', () => {
  const MISOPROSTOL: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
  const fallback = {
    fr: 'En cas de saignement, de contractions ou de très fortes douleurs au ventre, allez au poste de santé maintenant.',
    en: 'If there is bleeding, contractions or very strong pain in the belly, go to the health post now.',
  };

  it('says when to go now on a card without a danger rule, in both modes', () => {
    for (const mode of ['woman', 'accompanied'] as const) {
      for (const lang of ['fr', 'en'] as const) {
        const card = onlyFinding(
          viewOf(contextOf({ pregnancy: weeks(24), items: [MISOPROSTOL] }), mode, lang),
        );
        expect(card.level).toBe('before-next-dose');
        expect(card.orientation, `${mode} ${lang}`).toEqual(
          expect.stringContaining(fallback[lang]) as unknown,
        );
      }
    }
  });

  it('gives the danger orientation instead when a danger rule fires on the card', () => {
    const view = viewOf(
      contextOf({ pregnancy: weeks(16), conditions: ['uterine-scar'], items: [MISOPROSTOL] }),
      'woman',
    );
    const card = onlyFinding(view);
    expect(card.level).toBe('danger');
    expect(card.orientation).toEqual({ inBanner: true });
    expect(view.headline).toBe(pack.messages.fr['misoprostol-pregnancy-uterine-scar']?.orientation);
    expect(view.headline).not.toContain(fallback.fr);
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
      expect(woman.risks).toEqual([{ text: from20?.risk }, { text: before20?.risk }]);
      expect(woman).not.toHaveProperty('ruleIds');

      // Accompanied mode: each risk with its own detailed risk and evidence
      // level (never two lists to match by position), both rules, all sources.
      const accompanied = onlyFinding(
        buildResultView(evaluation, pack, context.items, 'accompanied', 'fr', tOf('fr')),
      );
      expect(
        accompanied.risks.map((risk) => [risk.text, risk.detail, risk.evidence?.level]),
      ).toEqual([
        [from20?.risk, from20?.riskDetail, 'A'],
        [before20?.risk, before20?.riskDetail, 'C'],
      ]);
      expect(accompanied.ruleIds).toEqual(ids);
      // Each source named in French; a document in English says so.
      const names = new Set(accompanied.sources?.map((s) => s.name));
      expect(names.has('Communications de sécurité de la FDA (États-Unis)')).toBe(true);
      expect(names.has('Base de données publique des médicaments (BDPM)')).toBe(true);
      const fda = accompanied.sources?.find((s) => s.name.includes('FDA'));
      expect(fda?.documents).toBe('documents en anglais');
      const bdpm = accompanied.sources?.find((s) => s.name.includes('BDPM'));
      expect(bdpm).not.toHaveProperty('documents');
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
    expect(woman.risks.every((risk) => !('cappedNote' in risk))).toBe(true);
    const accompanied = onlyFinding(
      buildResultView(capped, pack, [ADVIL], 'accompanied', 'en', tOf('en')),
    );
    expect(accompanied.capped).toBe(true);
    expect(accompanied.risks[0]?.cappedNote).toBe('Level limited because the evidence is weak.');
  });

  it('says it with the risk whose level was held down, not with another risk of the card', () => {
    const context = contextOf({
      pregnancy: { weeksMin: 0, weeksMax: 42, precision: 'unknown' },
      items: [ADVIL],
    });
    const evaluation = evaluate(pack, context);
    // The lower of the two findings was capped, the highest was not.
    const lowerCapped: Evaluation = {
      ...evaluation,
      findings: evaluation.findings.map((f, i) => (i === 1 ? { ...f, capped: true } : f)),
    };
    const view = onlyFinding(
      buildResultView(lowerCapped, pack, context.items, 'accompanied', 'fr', tOf('fr')),
    );
    expect(view.capped).toBe(false);
    expect(view.risks.map((risk) => risk.cappedNote)).toEqual([
      undefined,
      'Niveau limité parce que la preuve est faible.',
    ]);
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

  it('says where the danger instruction comes from, so who to call can word it again', () => {
    const fever = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), 'woman');
    expect(fever.headlineSource).toEqual({ message: 'danger-sign-fever' });
    const castor = viewOf(contextOf({ ...scar, items: [CASTOR] }), 'woman');
    expect(castor.headlineSource).toEqual({ message: 'castor-oil-term-uterine-scar' });
    // Different instructions, or the standard message's own words: the standard one.
    const mixed = viewOf(
      contextOf({ ...scar, items: [CASTOR], signs: ['vaginal-bleeding'] }),
      'woman',
    );
    expect(mixed.headlineSource).toEqual({ standard: true });
    expect(viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman')).not.toHaveProperty(
      'headlineSource',
    );
  });

  it('names a danger that comes from a product as such, never as a danger sign', () => {
    const castor = viewOf(contextOf({ ...scar, items: [CASTOR] }), 'woman');
    expect(castor.levelLabel).toBe('Danger : à montrer maintenant');
    expect(onlyFinding(castor).levelLabel).toBe('Danger : à montrer maintenant');
    const english = viewOf(contextOf({ ...scar, items: [CASTOR] }), 'woman', 'en');
    expect(english.levelLabel).toBe('Danger: show now');
    // With a danger sign, the banner names the sign; each card keeps its own name.
    const both = viewOf(
      contextOf({ ...scar, items: [CASTOR], signs: ['vaginal-bleeding'] }),
      'woman',
    );
    expect(both.levelLabel).toBe('Signe de danger');
    expect(both.findings.map((f) => f.levelLabel)).toEqual([
      'Danger : à montrer maintenant',
      'Signe de danger',
    ]);
  });

  it('says the evidence of a C-level message without overstating it', () => {
    const castor = onlyFinding(viewOf(contextOf({ ...scar, items: [CASTOR] }), 'accompanied'));
    expect(castor.risks[0]?.evidence?.text).toBe(
      'Niveau de preuve C : « des cas ont été rapportés ou observés »',
    );
    const english = onlyFinding(
      viewOf(contextOf({ ...scar, items: [CASTOR] }), 'accompanied', 'en'),
    );
    expect(english.risks[0]?.evidence?.wording).toBe('cases have been reported or observed');
  });

  it('gives the same urgency everywhere: a danger card never says today or later', () => {
    const MISOPROSTOL: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const view = viewOf(
      contextOf({ ...scar, items: [CASTOR, MISOPROSTOL], signs: ['fever'] }),
      'woman',
    );
    expect(view.headline).toBe('Allez au poste de santé maintenant.');
    const danger = view.findings.filter((f) => f.level === 'danger');
    expect(danger).toHaveLength(3);
    for (const finding of danger) {
      const said = typeof finding.orientation === 'string' ? finding.orientation : view.headline;
      expect(said, finding.title).toMatch(/maintenant/);
      expect(said, finding.title).not.toMatch(/aujourd|prochain/);
    }
  });

  it('has no danger lead otherwise; the headline is the level name', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman', 'en');
    expect(view.danger).toBe(false);
    expect(view.headline).toBe('Show before the next dose');
  });

  it('says the danger instruction once: a danger card leaves out the orientation the banner says', () => {
    for (const mode of ['woman', 'accompanied'] as const) {
      const fever = viewOf(contextOf({ pregnancy: weeks(14), signs: ['fever'] }), mode);
      expect(fever.headline, mode).toBe(pack.messages.fr['danger-sign-fever']?.orientation);
      expect(onlyFinding(fever).orientation, mode).toEqual({ inBanner: true });
    }
    // Castor oil (its own orientation) and bleeding (go now, the banner's): the
    // bleeding card leaves its orientation to the banner, castor oil keeps its own.
    const view = viewOf(
      contextOf({ ...scar, items: [CASTOR], signs: ['vaginal-bleeding'] }),
      'woman',
    );
    expect(view.headline).toBe('Allez au poste de santé maintenant.');
    expect(view.findings.map((f) => f.orientation)).toEqual([
      pack.messages.fr['castor-oil-term-uterine-scar']?.orientation,
      { inBanner: true },
    ]);
  });

  it('every card shows its orientation, or it is the instruction of the banner shown above', () => {
    const contexts: EvaluationContext[] = [
      contextOf({ pregnancy: weeks(14), signs: ['fever'], items: [KINKELIBA] }),
      contextOf({ ...scar, items: [CASTOR, MARKET], signs: ['vaginal-bleeding', 'fever'] }),
      contextOf({ pregnancy: weeks(30), items: [ADVIL, KINKELIBA] }),
      contextOf({ breastfeeding: {}, signs: ['baby-fever-or-cold', 'fever-after-birth'] }),
    ];
    for (const context of contexts) {
      for (const mode of ['woman', 'accompanied'] as const) {
        for (const lang of ['fr', 'en'] as const) {
          expect(orientationProblems(viewOf(context, mode, lang)), `${mode} ${lang}`).toEqual([]);
        }
      }
    }
    // Not vacuous: a card without its orientation and without a banner is caught.
    const view = viewOf(contexts[0] ?? contextOf({}), 'woman');
    expect(orientationProblems({ ...view, danger: false })).toHaveLength(1);
  });
});

/**
 * Cards that would leave someone without who to show and when: each card
 * says its orientation, or it is a danger card whose orientation is the
 * instruction of the banner, and the banner shows.
 */
function orientationProblems(view: ResultView): string[] {
  return view.findings.flatMap((finding) => {
    if (typeof finding.orientation === 'string') {
      return finding.orientation.trim() === '' ? [`${finding.key}: empty orientation`] : [];
    }
    const said = view.danger && finding.level === 'danger' && view.headline.trim() !== '';
    return said ? [] : [`${finding.key}: orientation left to a banner that is not shown`];
  });
}

describe('buildResultView: closing lines', () => {
  it('ends with the fixed sentence, the version, "not validated" and the closing sentence', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman');
    expect(view.fixedLines).toEqual([
      'Ne changez rien à votre traitement sans en parler à un professionnel.',
    ]);
    expect(view.versionLine).toBe(
      `Base de connaissances ${pack.version} du ${formatDate(pack.date, 'fr')}`,
    );
    expect(view.notValidated).toBe(!pack.clinicallyValidated);
    expect(view.notValidatedLine).toBe(
      "Contenu non validé cliniquement : ne l'utilisez pas seul pour décider.",
    );
    // Said short near the top too, where a reader in a hurry still sees it.
    expect(view.notValidatedShortLine).toBe('Contenu non validé cliniquement.');
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
    expect(view).not.toHaveProperty('notValidatedShortLine');
  });
});

describe('buildResultView: sources in the language of the screen', () => {
  it('names each source in the language of the screen, and says when its documents are in the other one', () => {
    const context = contextOf({ pregnancy: weeks(30), items: [ADVIL] });
    const french = onlyFinding(viewOf(context, 'accompanied')).sources ?? [];
    expect(french.find((s) => s.name.includes('openFDA'))).toMatchObject({
      name: 'Notices de médicaments des États-Unis (openFDA)',
      documents: 'documents en anglais',
    });
    const english = onlyFinding(viewOf(context, 'accompanied', 'en')).sources ?? [];
    expect(english.find((s) => s.name.includes('openFDA'))).toMatchObject({
      name: 'openFDA drug labels',
    });
    expect(english.find((s) => s.name.includes('openFDA'))).not.toHaveProperty('documents');
    expect(english.find((s) => s.name.includes('BDPM'))).toMatchObject({
      documents: 'documents in French',
    });
  });
});

describe('buildResultView: plain level names and calls', () => {
  const TRAMADOL: CheckedItem = { ref: { kind: 'product', id: 'tramadol-generic' } };

  it('names the next-contact level in plain words: the next visit', () => {
    const context = contextOf({ items: [TRAMADOL], breastfeeding: { babyAgeWeeks: 10 } });
    const level = (lang: Lang) => {
      const card = onlyFinding(viewOf(context, 'woman', lang));
      return [card.level, card.levelLabel, viewOf(context, 'woman', lang).levelLabel];
    };
    expect(level('fr')).toEqual([
      'next-contact',
      'À dire à la prochaine visite',
      'À dire à la prochaine visite',
    ]);
    expect(level('en')).toEqual([
      'next-contact',
      'Tell at the next visit',
      'Tell at the next visit',
    ]);
  });

  it('offers who to call on a card that says to go now under a condition, below the danger level', () => {
    // Tramadol while breastfeeding: tell the midwife, and if the baby is very sleepy, go now.
    const context = contextOf({ items: [TRAMADOL], breastfeeding: { babyAgeWeeks: 2 } });
    const card = onlyFinding(viewOf(context, 'woman'));
    expect(card.level).toBe('next-contact');
    expect(card.orientation).toMatch(/maintenant/);
    expect(card.callNow).toBe(true);
    expect(onlyFinding(viewOf(context, 'accompanied', 'en')).callNow).toBe(true);
    // A card that says no such thing offers nothing.
    const advil = onlyFinding(viewOf(contextOf({ pregnancy: weeks(30), items: [ADVIL] }), 'woman'));
    expect(advil).not.toHaveProperty('callNow');
  });

  it('says the castor oil instruction for a scar where both modes read it, with who to call', () => {
    // Late in pregnancy, a scar the profile does not say: the conditional "go now"
    // is in the orientation, never behind "Pourquoi ?".
    const castor: CheckedItem = { ref: { kind: 'plant', id: 'castor-oil' } };
    const context = contextOf({ pregnancy: weeks(34), items: [castor] });
    for (const [mode, lang, expected] of [
      [
        'woman',
        'fr',
        "Dites-le à la sage-femme à la prochaine visite. Après une césarienne ou une autre opération de l'utérus, allez au poste de santé maintenant.",
      ],
      [
        'accompanied',
        'en',
        'Tell the midwife at the next visit. After a caesarean section or other surgery on the womb, go to the health post now.',
      ],
    ] as const) {
      const card = onlyFinding(viewOf(context, mode, lang));
      expect(card.level).toBe('next-contact');
      expect(card.orientation).toBe(expected);
      expect(card.callNow).toBe(true);
      for (const risk of card.risks) expect(risk.detail ?? '').not.toMatch(/dites|tell the/i);
    }
  });

  it('says when liver damage shows in the risk both modes read, for a daily maximum and a duplicate', () => {
    const view = viewOf(contextOf({ pregnancy: weeks(16), items: [DOLIPRANE, SACHET] }), 'woman');
    const risks = view.findings.flatMap((f) => f.risks.map((r) => r.text));
    const late = risks.filter((text) =>
      text.includes(
        "Les signes d'une atteinte du foie n'apparaissent souvent qu'après un ou deux jours.",
      ),
    );
    // The daily maximum and the duplicate both say it.
    expect(late).toHaveLength(2);
  });

  it('leaves who to call to the danger banner when there is one: one way, with the signs said', () => {
    // The banner's action carries the danger and the signs to who to call; a
    // second link under a card would open it without them.
    const context = contextOf({
      items: [TRAMADOL],
      breastfeeding: { babyAgeWeeks: 2 },
      signs: ['baby-not-feeding'],
    });
    const view = viewOf(context, 'woman');
    expect(view.danger).toBe(true);
    expect(view.findings.some((f) => f.level === 'next-contact')).toBe(true);
    for (const finding of view.findings) expect(finding).not.toHaveProperty('callNow');
  });
});

describe('buildResultView: a name typed as unrecognised that looks like a known one', () => {
  const NBSP = ' ';
  const typed = (text: string): CheckedItem => ({ ref: { kind: 'unrecognised', text } });

  function netViewOf(text: string, patch: Partial<EvaluationContext>, mode: Mode, lang: Lang) {
    const net = withPossibleMatches(pack, [typed(text)]);
    const context = contextOf({ ...patch, items: net.items });
    return buildResultView(evaluate(pack, context), pack, net.items, mode, lang, tOf(lang), [], {
      possible: net.possible,
    });
  }

  it('shows the possible match under the name typed, at its own level, and says what it looks like', () => {
    const text = 'Advil 400 mg comprimé pelliculé';
    const view = netViewOf(text, { pregnancy: weeks(30) }, 'woman', 'fr');
    expect(view.level).toBe('before-next-dose');
    const possible = view.findings.find((f) => f.level === 'before-next-dose');
    expect(possible).toMatchObject({
      title: text,
      possible: `Ce nom ressemble à ADVIL 400${NBSP}mg, comprimé enrobé (Ibuprofène 400${NBSP}mg). Si c'est ce produit${NBSP}:`,
    });
    // The text typed is still not recognised: its grey card stays, for the other case.
    const own = view.findings.find((f) => f.level === 'unknown');
    expect(own?.title).toBe(text);
    expect(own?.possible).toBe(`Si ce n'est pas ce produit${NBSP}:`);
  });

  it('says nothing of the kind on the grey card of a name that looks like nothing', () => {
    const view = netViewOf('comprimés du marché', { pregnancy: weeks(30) }, 'woman', 'fr');
    expect(view.findings).toHaveLength(1);
    expect(view.findings[0]).not.toHaveProperty('possible');
  });

  it('says remedy for a remedy, and leads with the danger the base knows', () => {
    const view = netViewOf(
      'huile de ricin',
      { pregnancy: weeks(38), conditions: ['uterine-scar'] },
      'accompanied',
      'en',
    );
    expect(view.level).toBe('danger');
    expect(view.danger).toBe(true);
    expect(view.findings[0]).toMatchObject({
      level: 'danger',
      title: 'huile de ricin',
      possible: 'This name looks like Castor oil (Ricinus communis). If it is this remedy:',
    });
    expect(view.findings.find((f) => f.level === 'unknown')?.possible).toBe(
      'If it is not this remedy:',
    );
    // The name as she typed it, marked so the screen quotes it.
    expect(view.findings[0]?.typed).toEqual(['huile de ricin']);
    // The level said in the banner and the summary says it is a resemblance.
    expect(view.findings[0]?.resembles).toBe('looks like Castor oil');
    expect(view.levelNote).toBe('looks like Castor oil');
  });

  it('gives a card held below danger an instruction that branches on intake: go now if already taken', () => {
    // "cytotek" is a near spelling of Cytotec: strong, so its danger (misoprostol
    // with a scar at 36 weeks) is held at "before the next dose"
    // (possible-matches.ts, committee question N-3). Held down, the card must not
    // lower the urgency when the product may already have been taken.
    for (const [mode, lang, expected] of [
      [
        'woman',
        'fr',
        "S'il a déjà été pris, allez au poste de santé maintenant et montrez-le. Sinon, montrez-le à la sage-femme ou à l'infirmier avant d'en prendre, pour savoir si c'est bien ce produit.",
      ],
      [
        'woman',
        'en',
        'If it has already been taken, go to the health post now and show it. If not, show it to the midwife or the nurse before taking any, to find out whether it is this product.',
      ],
      [
        'accompanied',
        'fr',
        "Si elle en a déjà pris, elle doit aller au poste de santé maintenant et montrer ce produit. Sinon, montrez-le à la sage-femme ou à l'infirmier avant qu'elle en prenne, pour savoir si c'est bien ce produit.",
      ],
      [
        'accompanied',
        'en',
        'If she has already taken some, she must go to the health post now and show this product. If not, show it to the midwife or the nurse before she takes any, to find out whether it is this product.',
      ],
    ] as const) {
      const net = withPossibleMatches(pack, [typed('cytotek')]);
      expect([...net.possible.values()].map((p) => p.strength)).toEqual(['strong']);
      const context = contextOf({
        pregnancy: weeks(36),
        conditions: ['uterine-scar'],
        items: net.items,
      });
      const evaluation = cappedEvaluation(evaluate(pack, context), net.possible);
      const view = buildResultView(evaluation, pack, net.items, mode, lang, tOf(lang), [], {
        possible: net.possible,
      });
      const label = `${mode} ${lang}`;
      expect(view.danger, label).toBe(false);
      const held = view.findings.find((f) => f.level === 'before-next-dose');
      expect(held?.orientation, label).toBe(expected);
      // Who to call, one tap away under it.
      expect(held?.callNow, label).toBe(true);
    }
    // A danger kept as a danger (a very strong match) keeps the danger message's own words.
    const net = withPossibleMatches(pack, [typed('cytotec')]);
    const context = contextOf({ pregnancy: weeks(32), items: net.items });
    const evaluation = cappedEvaluation(evaluate(pack, context), net.possible);
    const view = buildResultView(evaluation, pack, net.items, 'woman', 'fr', tOf('fr'), [], {
      possible: net.possible,
    });
    expect(view.danger).toBe(true);
    expect(view.headline).toBe(pack.messages.fr['misoprostol-late-pregnancy']?.orientation);
  });

  it('says nothing of a resemblance in the banner when a danger sign is there too', () => {
    const net = withPossibleMatches(pack, [typed('huile de ricin')]);
    const context = contextOf({
      pregnancy: weeks(38),
      conditions: ['uterine-scar'],
      items: net.items,
      signs: ['fever'],
    });
    const view = buildResultView(
      evaluate(pack, context),
      pack,
      net.items,
      'woman',
      'fr',
      tOf('fr'),
      [],
      {
        possible: net.possible,
      },
    );
    expect(view.danger).toBe(true);
    expect(view).not.toHaveProperty('levelNote');
  });

  it('shows on a card the name typed for a product found under another name', () => {
    const cytotec: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const context = contextOf({ pregnancy: weeks(10), items: [cytotec] });
    const view = buildResultView(
      evaluate(pack, context),
      pack,
      context.items,
      'woman',
      'fr',
      tOf('fr'),
      [],
      {
        writtenOf: (item) =>
          item.ref.kind === 'product' && item.ref.id === 'misoprostol-generic'
            ? 'cytotec'
            : undefined,
      },
    );
    // The text alone: the screen quotes it under its own label, never inside a sentence.
    expect(onlyFinding(view).written).toEqual(['cytotec']);
    expect(onlyFinding(view)).not.toHaveProperty('said');
    const plain = viewOf(context, 'woman');
    expect(onlyFinding(plain)).not.toHaveProperty('written');
  });

  it('says which of her words the voice heard, so the screen says "Vous avez dit"', () => {
    const cytotec: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const syrup: CheckedItem = { ref: { kind: 'unrecognised', text: 'sirop du marché' } };
    const context = contextOf({ pregnancy: weeks(10), items: [cytotec, syrup] });
    const view = buildResultView(
      evaluate(pack, context),
      pack,
      context.items,
      'woman',
      'fr',
      tOf('fr'),
      [],
      {
        writtenOf: (item) => (item.ref.kind === 'product' ? 'sitotek' : undefined),
        saidOf: () => true,
      },
    );
    const misoprostol = view.findings.find((finding) => finding.written?.includes('sitotek'));
    expect(misoprostol?.said).toEqual(['sitotek']);
    const unrecognised = view.findings.find((finding) =>
      finding.typed?.includes('sirop du marché'),
    );
    expect(unrecognised?.said).toEqual(['sirop du marché']);
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
