// SPDX-License-Identifier: MIT
// The deterministic evaluation: pure, no clock, no randomness, no I/O, and
// the pack and the context are never modified.
import { copySources, dangerSignFindings, noFinding, unrecognisedFinding } from './builtins.js';
import { capForEvidence, levelRank, maxLevel } from './levels.js';
import { entryKey } from './match.js';
import { applyRule, CHECK_OF_KIND } from './rules.js';
import type { RuleMatch, RuleScope } from './rules.js';
import type { CheckId, Evaluation, EvaluationContext, Finding, Note, Pack, Rule } from './types.js';
import { windowsCovered } from './windows.js';

const CHECK_ORDER: readonly CheckId[] = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
  'C12',
  'no-finding',
];

/** Code unit order: the same on every device, whatever its locale. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Level (danger first), check, rule id or message, first item, sign: a total order. */
function compareFindings(a: Finding, b: Finding): number {
  return (
    levelRank(b.level) - levelRank(a.level) ||
    CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check) ||
    compareStrings(a.ruleId ?? a.message, b.ruleId ?? b.message) ||
    (a.items[0] ?? -1) - (b.items[0] ?? -1) ||
    compareStrings(a.sign ?? '', b.sign ?? '')
  );
}

function ruleFinding(rule: Rule, match: RuleMatch): Finding {
  const { level, capped } = capForEvidence(rule.level, rule.evidence, rule.kind);
  const finding: Finding = {
    level,
    check: CHECK_OF_KIND[rule.kind],
    ruleId: rule.id,
    evidence: rule.evidence,
    items: match.items,
    message: rule.message,
    capped,
    sources: copySources(rule.sources),
  };
  if (match.term) finding.term = match.term;
  return finding;
}

function noteOf(rule: Rule): Note {
  return { ruleId: rule.id, message: rule.message, sources: copySources(rule.sources) };
}

function byRuleId(a: Note, b: Note): number {
  return compareStrings(a.ruleId, b.ruleId);
}

/**
 * Refuses numbers that would silently change a result: a baby age that is not
 * a finite number of at least 0, or a unit count that is not a finite number
 * greater than 0 (NaN would make every comparison false).
 */
function checkContextNumbers(context: EvaluationContext): void {
  const babyAgeWeeks = context.breastfeeding?.babyAgeWeeks;
  if (babyAgeWeeks !== undefined && !(Number.isFinite(babyAgeWeeks) && babyAgeWeeks >= 0)) {
    throw new RangeError(
      `breastfeeding.babyAgeWeeks must be a finite number of at least 0: ${String(babyAgeWeeks)}`,
    );
  }
  context.items.forEach((item, index) => {
    const units = item.unitsPerDay;
    if (units !== undefined && !(Number.isFinite(units) && units > 0)) {
      throw new RangeError(
        `items[${String(index)}].unitsPerDay must be a finite number greater than 0: ${String(units)}`,
      );
    }
  });
}

/** Evaluates the checked items of a context against a pack. */
export function evaluate(pack: Pack, context: EvaluationContext): Evaluation {
  checkContextNumbers(context);
  const pregnancy = context.pregnancy;
  const scope: RuleScope = {
    pack,
    context,
    covered: pregnancy ? windowsCovered(pregnancy.weeksMin, pregnancy.weeksMax) : [],
    keys: context.items.map((item) => entryKey(pack, item)),
  };

  const findings: Finding[] = [];
  const reminders: Note[] = [];
  const notes: Note[] = [];
  for (const rule of pack.rules) {
    const match = applyRule(rule, scope);
    if (!match) continue;
    if (rule.kind === 'reminder') reminders.push(noteOf(rule));
    else if (rule.kind === 'contraception-info') notes.push(noteOf(rule));
    else findings.push(ruleFinding(rule, match));
  }

  const withFinding = new Set(findings.flatMap((f) => f.items));
  context.items.forEach((item, index) => {
    if (scope.keys[index] === undefined) findings.push(unrecognisedFinding(index));
    else if (!withFinding.has(index)) findings.push(noFinding(pack, item, index));
  });
  findings.push(...dangerSignFindings(pack, context.signs));
  findings.sort(compareFindings);

  return {
    level: maxLevel(findings.map((f) => f.level)),
    findings,
    reminders: reminders.sort(byRuleId),
    notes: notes.sort(byRuleId),
    pack: { version: pack.version, date: pack.date, clinicallyValidated: pack.clinicallyValidated },
  };
}
