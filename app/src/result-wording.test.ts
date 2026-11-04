// SPDX-License-Identifier: MIT
// The wording of the result screen over every reference case of eval/cases,
// in both modes and both languages: no forbidden word anywhere, no number in
// woman mode (the version and the dates aside), and the level always named in
// text. The view is what the screen renders, string for string.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, findForbiddenWording, type Lang, type Pack } from '@siapso/engine';
import { contextOf, loadCases, type ReferenceCase } from '@siapso/pack-tools';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildResultView, formatPackDate, type ResultView } from './domain/result-view.js';
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

/** Read by the screen: everything but the keys React uses and the links' targets. */
function shown(view: ResultView): [string, string][] {
  return strings(view).filter(([at]) => !/\.key$/.test(at) && !/\.url$/.test(at));
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

  it('gives no number in woman mode but the version and the dates', () => {
    let accompaniedNumbers = 0;
    eachView((view, label, mode, lang) => {
      if (mode !== 'woman') {
        // Not vacuous: the detailed risk of accompanied mode does hold numbers.
        accompaniedNumbers += shown(view).filter(
          ([at, text]) => /\.riskDetails\[\d+\]$/.test(at) && /\d/.test(text),
        ).length;
        return;
      }
      const version = pack.version;
      const date = formatPackDate(pack.date, lang);
      for (const [at, text] of shown(view)) {
        // A product keeps the name she confirmed, strength included (spec section 10).
        if (/\.(title|names\[\d+\])$/.test(at)) continue;
        const rest = text.replaceAll(version, '').replaceAll(date, '');
        expect(rest, `${label} ${at}: ${text}`).not.toMatch(/\d/);
      }
    });
    expect(accompaniedNumbers).toBeGreaterThan(0);
  });

  it('always names the level in text, for the result and for every card', () => {
    eachView((view, label, _mode, lang) => {
      expect(view.levelLabel, label).toBe(translate(lang, `level.${view.level}`));
      expect(view.findings.length, label).toBeGreaterThan(0);
      for (const finding of view.findings) {
        expect(finding.levelLabel, label).toBe(translate(lang, `level.${finding.level}`));
        expect(finding.orientation.trim(), label).not.toBe('');
        expect(finding.risks.length, label).toBeGreaterThan(0);
        for (const risk of finding.risks) expect(risk.trim(), label).not.toBe('');
      }
    });
  });

  it('shows in woman mode only what the woman reads', () => {
    eachView((view, label, mode) => {
      if (mode !== 'woman') return;
      expect(view.reminders, label).toEqual([]);
      for (const finding of view.findings) {
        for (const hidden of ['fact', 'riskDetails', 'evidence', 'sources', 'ruleIds']) {
          expect(finding, `${label} ${hidden}`).not.toHaveProperty(hidden);
        }
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

describe('result wording beyond the reference cases', () => {
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
        for (const text of [finding?.lead ?? '', ...(finding?.risks ?? []), view.headline]) {
          expect(text, label).not.toMatch(/\d/);
          expect(findForbiddenWording(text, lang), label).toEqual([]);
        }
      }
    }
  });

  it('never has two rules a card would merge into one while they say different orientations', () => {
    expect(mergeClashes(pack)).toEqual([]);
    // Not vacuous: a copy of a rule with another orientation is caught, by rule id.
    const rule = pack.rules.find((r) => r.id === 'nsaid-pregnancy-from-20-weeks');
    if (rule === undefined) throw new Error('rule missing');
    const twin = { ...rule, id: 'nsaid-twin', message: 'nsaid-twin' };
    const other = { fact: 'Fait.', risk: 'Risque.', orientation: 'Parlez-en à la sage-femme.' };
    const clashing: Pack = {
      ...pack,
      rules: [...pack.rules, twin],
      messages: { ...pack.messages, fr: { ...pack.messages.fr, 'nsaid-twin': other } },
    };
    expect(mergeClashes(clashing)).toEqual([
      expect.stringContaining('nsaid-pregnancy-from-20-weeks, nsaid-twin') as unknown,
    ]);
  });
});

/**
 * Rules a card could merge while they orient differently: a card keeps the
 * highest level of one item set and check, then that finding's orientation, so
 * two rules of one kind (one check), one level and one subject with different
 * orientations would hide one of them. Each clash names its rule ids.
 */
function mergeClashes(of: Pack): string[] {
  const groups = new Map<string, Map<string, string[]>>();
  for (const rule of of.rules) {
    if (rule.kind === 'reminder' || rule.kind === 'contraception-info') continue;
    const key = `${rule.kind} ${rule.level} ${JSON.stringify(rule.when.subject)}`;
    const byOrientation = groups.get(key) ?? new Map<string, string[]>();
    const orientation = of.messages.fr[rule.message]?.orientation ?? `default ${rule.level}`;
    byOrientation.set(orientation, [...(byOrientation.get(orientation) ?? []), rule.id]);
    groups.set(key, byOrientation);
  }
  return [...groups.entries()]
    .filter(([, byOrientation]) => byOrientation.size > 1)
    .map(([key, byOrientation]) => `${key}: ${[...byOrientation.values()].flat().join(', ')}`);
}
