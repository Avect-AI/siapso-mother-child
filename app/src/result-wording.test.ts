// SPDX-License-Identifier: MIT
// The wording of the result screen over every reference case of eval/cases,
// in both modes and both languages: no forbidden word anywhere, no number in
// woman mode (the version and the dates aside), and the level always named in
// text. The view is what the screen renders, string for string.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluate,
  findForbiddenWording,
  itemMatches,
  type CheckedItem,
  type ConditionId,
  type EvaluationContext,
  type Finding,
  type Lang,
  type Level,
  type Pack,
  type Rule,
  type Subject,
} from '@siapso/engine';
import { contextOf, loadCases, type ReferenceCase } from '@siapso/pack-tools';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatDate } from './domain/dates.js';
import { buildResultView, cardGroups, type ResultView } from './domain/result-view.js';
import type { Mode } from './domain/types.js';
import { translate, type MessageKey, type Vars } from './i18n/translate.js';
import { knowledgePack } from './test/knowledge-pack.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANGS: Lang[] = ['fr', 'en'];
const MODES: Mode[] = ['woman', 'accompanied'];

let pack: Pack;
let cases: ReferenceCase[];

beforeAll(async () => {
  pack = await knowledgePack();
  const loaded = await loadCases(ROOT);
  expect(loaded.problems).toEqual([]);
  cases = loaded.cases;
});

/** Every string of a view with where it is, such as "findings[0].risk". */
function strings(value: unknown, at = ''): [string, string][] {
  if (typeof value === 'string') return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${at}[${String(i)}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => strings(v, at === '' ? k : `${at}.${k}`));
  }
  return [];
}

/**
 * Read by the screen: everything but the keys React uses, the links' targets
 * and where the headline comes from (a message id, never shown).
 */
function shown(view: ResultView): [string, string][] {
  return strings(view).filter(
    ([at]) => !/\.key$/.test(at) && !/\.url$/.test(at) && !at.startsWith('headlineSource'),
  );
}

function viewOf(reference: ReferenceCase, mode: Mode, lang: Lang): ResultView {
  const context = contextOf(reference);
  const t = (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
  return buildResultView(evaluate(pack, context), pack, context.items, mode, lang, t);
}

function eachView(run: (view: ResultView, label: string, mode: Mode, lang: Lang) => void) {
  expect(cases.length).toBeGreaterThanOrEqual(17);
  for (const reference of cases) {
    for (const mode of MODES) {
      for (const lang of LANGS) {
        run(viewOf(reference, mode, lang), `${reference.id} ${mode} ${lang}`, mode, lang);
      }
    }
  }
}

describe('result wording over the reference cases', () => {
  it('never uses a forbidden word, in any string, in any mode or language', () => {
    eachView((view, label, _mode, lang) => {
      for (const [at, text] of shown(view)) {
        expect(findForbiddenWording(text, lang), `${label} ${at}: ${text}`).toEqual([]);
      }
    });
  });

  it('never says "sans risque" or "risk-free", not even inside a negation', () => {
    // The checks allow it in a negation, but a listener may catch only the end.
    eachView((view, label) => {
      for (const [at, text] of shown(view)) {
        expect(text, `${label} ${at}`).not.toMatch(/sans risque|risk-free/i);
      }
    });
  });

  it('never says text she typed inside a sentence of its own: only as a name, quoted', () => {
    let typed = 0;
    eachView((view, label) => {
      const texts = view.findings.flatMap((f) => f.typed ?? []);
      typed += texts.length;
      for (const [at, text] of shown(view)) {
        if (/\.(title|names\[\d+\]|typed\[\d+\])$/.test(at)) continue;
        for (const typedText of texts) {
          expect(text.includes(typedText), `${label} ${at}: ${text}`).toBe(false);
        }
      }
    });
    // Not vacuous: a reference case adds a name that is not recognised.
    expect(typed).toBeGreaterThan(0);
  });

  it('gives no number in woman mode but the version and the dates', () => {
    let accompaniedNumbers = 0;
    eachView((view, label, mode, lang) => {
      if (mode !== 'woman') {
        // Not vacuous: the detailed risk of accompanied mode does hold numbers.
        accompaniedNumbers += shown(view).filter(
          ([at, text]) => /\.risks\[\d+\]\.detail$/.test(at) && /\d/.test(text),
        ).length;
        return;
      }
      const version = pack.version;
      const date = formatDate(pack.date, lang);
      for (const [at, text] of shown(view)) {
        // A product keeps the name she confirmed, strength included (spec section 10),
        // and text she typed stays as typed.
        if (/\.(title|names\[\d+\]|typed\[\d+\]|written\[\d+\])$/.test(at)) continue;
        const rest = text.replaceAll(version, '').replaceAll(date, '');
        expect(rest, `${label} ${at}: ${text}`).not.toMatch(/\d/);
      }
    });
    expect(accompaniedNumbers).toBeGreaterThan(0);
  });

  it('always names the level in text, for the result and for every card', () => {
    let products = 0;
    eachView((view, label, _mode, lang) => {
      // A danger card of a danger sign (check C11), or of a product rule, never called a sign.
      const fromSign = (key: string) => key.startsWith('C11|');
      const nameOf = (level: Level, sign: boolean) =>
        level === 'danger' && !sign
          ? translate(lang, 'result.dangerProductLevel')
          : translate(lang, `level.${level}`);
      const signShown = view.findings.some((f) => f.level === 'danger' && fromSign(f.key));
      expect(view.levelLabel, label).toBe(nameOf(view.level, signShown));
      expect(view.findings.length, label).toBeGreaterThan(0);
      for (const finding of view.findings) {
        if (finding.level === 'danger' && !fromSign(finding.key)) products += 1;
        expect(finding.levelLabel, label).toBe(nameOf(finding.level, fromSign(finding.key)));
        expect(finding.risks.length, label).toBeGreaterThan(0);
        for (const risk of finding.risks) expect(risk.text.trim(), label).not.toBe('');
      }
    });
    // Not vacuous: the cases hold danger cards of product rules (castor oil, misoprostol).
    expect(products).toBeGreaterThan(0);
  });

  it('never gives a danger card more time than now, nor a before-the-next-dose card days', () => {
    let checked = 0;
    eachView((view, label, _mode, lang) => {
      const later =
        lang === 'fr'
          ? { danger: /aujourd|prochain/, before: /prochains jours|prochaine visite/ }
          : {
              danger: /today|next (visit|dose|contact)|coming days/,
              before: /coming days|next visit/,
            };
      for (const finding of view.findings) {
        const said = typeof finding.orientation === 'string' ? finding.orientation : view.headline;
        if (finding.level === 'danger') {
          checked += 1;
          expect(said, `${label} ${finding.title}`).not.toMatch(later.danger);
        }
        if (finding.level === 'before-next-dose') {
          expect(said, `${label} ${finding.title}`).not.toMatch(later.before);
        }
      }
      if (view.danger) expect(view.headline, label).not.toMatch(later.danger);
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('always says who to show and when: on the card, or once in the danger banner above it', () => {
    let inBanner = 0;
    eachView((view, label) => {
      for (const finding of view.findings) {
        if (typeof finding.orientation === 'string') {
          expect(finding.orientation.trim(), label).not.toBe('');
          continue;
        }
        inBanner += 1;
        // Left out of the card only when the banner shows and says it.
        expect(view.danger, label).toBe(true);
        expect(finding.level, label).toBe('danger');
        expect(view.headline.trim(), label).not.toBe('');
      }
    });
    // Not vacuous: the danger cases leave their instruction to the banner.
    expect(inBanner).toBeGreaterThan(0);
  });

  it('shows in woman mode only what the woman reads', () => {
    eachView((view, label, mode) => {
      if (mode !== 'woman') return;
      expect(view.reminders, label).toEqual([]);
      for (const finding of view.findings) {
        for (const hidden of ['fact', 'sources', 'ruleIds']) {
          expect(finding, `${label} ${hidden}`).not.toHaveProperty(hidden);
        }
        // A risk is its sentence alone: no detail, evidence or capped note.
        for (const risk of finding.risks) expect(Object.keys(risk), label).toEqual(['text']);
      }
    });
  });

  it('never shows a source quote', () => {
    const quotes = pack.rules.flatMap((rule) =>
      rule.sources.flatMap((source) => (source.quote === undefined ? [] : [source.quote])),
    );
    expect(quotes.length).toBeGreaterThan(0);
    eachView((view, label) => {
      const texts = shown(view).map(([, text]) => text);
      for (const quote of quotes) {
        expect(
          texts.some((text) => text.includes(quote)),
          `${label}: ${quote}`,
        ).toBe(false);
      }
    });
  });
});

// These tests enumerate the whole registry; they take a few seconds, longer under coverage.
describe('result wording beyond the reference cases', { timeout: 60_000 }, () => {
  it('reads the fact of every danger sign with its own message in woman mode: no number, no forbidden word', () => {
    const own = pack.dangerSigns.filter((sign) => sign.message !== undefined);
    expect(own.length).toBeGreaterThan(0);
    for (const sign of own) {
      for (const lang of LANGS) {
        const context = { conditions: [], items: [], signs: [sign.id] };
        const t = (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
        const view = buildResultView(evaluate(pack, context), pack, [], 'woman', lang, t);
        const [finding] = view.findings;
        const label = `${sign.id} ${lang}`;
        expect(finding?.lead, label).toBe(pack.messages[lang][sign.message ?? '']?.fact);
        const risks = (finding?.risks ?? []).map((risk) => risk.text);
        for (const text of [finding?.lead ?? '', ...risks, view.headline]) {
          expect(text, label).not.toMatch(/\d/);
          expect(findForbiddenWording(text, lang), label).toEqual([]);
        }
      }
    }
  });

  it('never merges into one card two findings of one level that say different orientations', () => {
    expect(mergeClashes(pack)).toEqual([]);
    // Artotec holds misoprostol and an NSAID: one card per item set and check
    // would merge their two orientations; the result gives each its card.
    expect(mergeClashes(pack, false).some((clash) => clash.startsWith('product:artotec'))).toBe(
      true,
    );
    // Not vacuous: a rule on ibuprofen (another subject than the NSAID class of
    // its twin) with another orientation is caught, with the product and the rules.
    const rule = pack.rules.find((r) => r.id === 'nsaid-pregnancy-from-20-weeks');
    if (rule === undefined) throw new Error('rule missing');
    expect(rule.when.subject).toEqual({ class: 'nsaid' });
    const twin = {
      ...rule,
      id: 'nsaid-twin',
      message: 'nsaid-twin',
      when: { ...rule.when, subject: { substance: 'ibuprofen' } },
    };
    const other = { fact: 'Fait.', risk: 'Risque.', orientation: 'Parlez-en à la sage-femme.' };
    const clashing: Pack = {
      ...pack,
      rules: [...pack.rules, twin],
      messages: { ...pack.messages, fr: { ...pack.messages.fr, 'nsaid-twin': other } },
    };
    const clashes = mergeClashes(clashing, false).filter((clash) => clash.includes('nsaid-twin'));
    expect(clashes.length).toBeGreaterThan(0);
    for (const clash of clashes) {
      expect(clash).toMatch(
        /^product:\S+.*: C1 before-next-dose: nsaid-pregnancy-from-20-weeks, nsaid-twin$/,
      );
    }
    // The result splits them: no card merges them.
    expect(mergeClashes(clashing)).toEqual([]);
  });
});

// These tests enumerate the whole registry; they take a few seconds, longer under coverage.
describe('merge guard', { timeout: 60_000 }, () => {
  it('also tries each product with its strength unknown, as the confirm screen can add it', () => {
    // A substance whose every product has a known strength: a rule above any
    // of them matches only a box whose strength is not known.
    const substance = pack.substances.find((s) => {
      const holding = pack.products.filter((p) => p.components.some((c) => c.substance === s.id));
      return (
        holding.length > 0 &&
        holding.every((p) =>
          p.components.every((c) => c.substance !== s.id || c.strengthMg !== undefined),
        )
      );
    });
    if (substance === undefined) throw new Error('no substance with known strengths only');
    const base = pack.rules.find((r) => r.id === 'nsaid-pregnancy-from-20-weeks');
    if (base === undefined) throw new Error('rule missing');
    const twin = (id: string, strengthAboveMg?: number): Rule => ({
      ...base,
      id,
      kind: 'toxicity',
      level: 'next-contact',
      evidence: 'C',
      message: id,
      when: {
        subject: { substance: substance.id },
        ...(strengthAboveMg === undefined ? {} : { strengthAboveMg }),
      },
    });
    const clashing: Pack = {
      ...pack,
      rules: [...pack.rules, twin('plain-twin'), twin('strong-twin', 1_000_000)],
      messages: {
        ...pack.messages,
        fr: {
          ...pack.messages.fr,
          'plain-twin': { fact: 'Fait.', risk: 'Risque.', orientation: 'Dites-le au relais.' },
          'strong-twin': {
            fact: 'Fait.',
            risk: 'Risque.',
            orientation: 'Dites-le à la sage-femme.',
          },
        },
      },
    };
    // One card per item set and check would merge them (the result splits them).
    expect(mergeClashes(clashing, false)).toContainEqual(
      expect.stringMatching(/: C5 next-contact: plain-twin, strong-twin$/) as unknown,
    );
  });
});

/** Every subject a rule reads an item against: its subject, its partners, its exceptions. */
function subjectsOf(rule: Rule): Subject[] {
  const { subject, requires = [], unlessWith = [] } = rule.when;
  return [
    ...(subject === undefined ? [] : [subject]),
    ...requires.flatMap((requirement) => ('with' in requirement ? [requirement.with] : [])),
    ...unlessWith,
  ];
}

/**
 * How the rules see an item: for each rule, which of its subjects the item
 * matches (the subject with its strength threshold), and the components of
 * an item a daily maximum adds up. Two items the rules see alike give the
 * same findings, alone or beside any other item, so one stands for both.
 * Null when no rule sees the item at all.
 */
function seenBy(of: Pack, item: CheckedItem): string | null {
  const reads = of.rules.map((rule) =>
    subjectsOf(rule).map((s) => {
      // The strength threshold is the subject's only, never a partner's.
      const threshold = s === rule.when.subject ? rule.when.strengthAboveMg : undefined;
      return itemMatches(of, item, s, threshold);
    }),
  );
  if (!reads.some((matches) => matches.includes(true))) return null;
  const ref = item.ref;
  // A daily maximum adds up strengths: the components count only for an item it sees.
  const summed = of.rules.some((rule, index) => rule.kind === 'max-dose' && reads[index]?.[0]);
  const product = ref.kind === 'product' ? of.products.find((p) => p.id === ref.id) : undefined;
  // A box of unknown strength adds nothing to a daily total: another way of being seen.
  return JSON.stringify([
    ref.kind,
    item.strengthUnknown === true,
    reads,
    summed ? (product?.components ?? []) : [],
  ]);
}

/** Every subset of a few conditions, the empty one first. */
function subsets<T>(values: readonly T[]): T[][] {
  return values.reduce<T[][]>((all, value) => [...all, ...all.map((s) => [...s, value])], [[]]);
}

/**
 * Findings a card would merge while they say different orientations. A card
 * stands for the findings of one item set and check and shows the orientation
 * of the first (highest) one, so two findings with the same check, level and
 * items whose own orientations differ would hide one of them, whatever their
 * subjects. Every product and plant of the registry is evaluated against the
 * rules, alone and beside every other one (at 24 units a day, so a daily
 * maximum is passed), during a pregnancy of unknown term (every window) and
 * while breastfeeding a baby of unknown age, with every combination of the
 * conditions the rules name. Items the rules see alike are evaluated once
 * (seenBy). Each clash names the products or plants and the rule ids. The
 * cards are made as the result makes them (`split`, by the messages' own
 * orientations), or one per item set and check only (`split` false).
 */
function mergeClashes(of: Pack, split = true): string[] {
  // Each product as listed with its strength, and as a box whose strength is
  // not known (the confirm screen's "Je ne sais pas"): a strength threshold
  // matches the second even when it matches no known strength.
  const entries: CheckedItem[] = [
    ...of.products.flatMap((p): CheckedItem[] => [
      { ref: { kind: 'product', id: p.id }, unitsPerDay: 24 },
      { ref: { kind: 'product', id: p.id }, unitsPerDay: 24, strengthUnknown: true },
    ]),
    ...of.plants.map((p): CheckedItem => ({ ref: { kind: 'plant', id: p.id } })),
  ];
  // Up to two items per way of being seen: two of them make a pair of the same kind.
  const alike = new Map<string, CheckedItem[]>();
  for (const entry of entries) {
    const key = seenBy(of, entry);
    if (key === null) continue;
    const members = alike.get(key) ?? [];
    if (members.length < 2) alike.set(key, [...members, entry]);
  }
  const kinds = [...alike.values()];
  const itemSets: CheckedItem[][] = [];
  kinds.forEach((members, i) => {
    const [first, second] = members;
    if (first === undefined) return;
    itemSets.push([first]);
    if (second !== undefined) itemSets.push([first, second]);
    for (const others of kinds.slice(i + 1)) {
      if (others[0] !== undefined) itemSets.push([first, others[0]]);
    }
  });
  const named = new Set<ConditionId>(
    of.rules.flatMap((rule) => [
      ...(rule.when.requires ?? []).flatMap((r) => ('condition' in r ? [r.condition] : [])),
      ...(rule.when.unlessConditions ?? []),
    ]),
  );
  // Kept small on purpose: every combination is evaluated.
  expect(named.size).toBeLessThanOrEqual(6);
  const orientationOf = (finding: Finding) =>
    (['fr', 'en'] as const)
      .map((lang) => of.messages[lang][finding.message]?.orientation ?? `default ${finding.level}`)
      .join(' | ');

  const clashes = new Set<string>();
  for (const items of itemSets) {
    for (const conditions of subsets([...named])) {
      const context: EvaluationContext = {
        pregnancy: { weeksMin: 0, weeksMax: 42, precision: 'unknown' },
        breastfeeding: {},
        conditions,
        items,
        signs: [],
      };
      const own = (finding: Finding) => of.messages.fr[finding.message]?.orientation;
      for (const group of cardGroups(evaluate(of, context).findings, split ? own : undefined)) {
        for (const level of new Set(group.map((f) => f.level))) {
          const same = group.filter((f) => f.level === level);
          if (new Set(same.map(orientationOf)).size < 2) continue;
          const [first] = same;
          const names = items.map((item) =>
            'id' in item.ref
              ? `${item.ref.kind}:${item.ref.id}${item.strengthUnknown === true ? ' (strength unknown)' : ''}`
              : '',
          );
          const rules = same.map((f) => f.ruleId ?? f.message).sort();
          clashes.add(`${names.join(' + ')}: ${first?.check ?? ''} ${level}: ${rules.join(', ')}`);
        }
      }
    }
  }
  return [...clashes].sort();
}
