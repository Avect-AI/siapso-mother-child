// SPDX-License-Identifier: MIT
// The deterministic evaluation: pure, no clock, no randomness, no I/O, and
// the pack and the context are never modified.
import { copySources, dangerSignFindings, noFinding, unrecognisedFinding } from './builtins.js';
import { capForEvidence, levelRank, maxLevel } from './levels.js';
import { entryKey } from './match.js';
import { applyRule, CHECK_OF_KIND, uncomputableDoseItems } from './rules.js';
import type { RuleMatch, RuleScope } from './rules.js';
import { BUILTIN_MESSAGES } from './types.js';
import type {
  CheckId,
  Evaluation,
  EvaluationContext,
  Finding,
  Note,
  NoteKind,
  Pack,
  Reminder,
  Rule,
} from './types.js';
import { TERM_LOOKAHEAD_DAYS, windowsCovered } from './windows.js';

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

/**
 * The level a finding is held at when its danger is not certain now: a daily
 * maximum exceeded only by a possible total (it depends on the box), or a
 * window reached only through the term look-ahead (still ahead).
 */
const HELD_LEVEL = 'before-next-dose';

/** A finding of a rule, and whether it is a possible excess the rule's level was held from. */
interface RuledFinding {
  finding: Finding;
  /** Reached only with the highest strength of a family. */
  possible: boolean;
  /** Its rule's level was above the held level (a possible overdose). */
  held: boolean;
}

function ruleFinding(rule: Rule, match: RuleMatch): RuledFinding {
  const capped = capForEvidence(rule.level, rule.evidence, rule.kind);
  const possible = match.possible === true;
  // An excess that depends on the box, and a window still ahead, are never
  // more than before the next dose: never a danger "go now" for what is not
  // certain now. A possible excess says so with its own message.
  const held =
    (possible || match.windowStart !== undefined) &&
    levelRank(capped.level) > levelRank(HELD_LEVEL);
  const finding: Finding = {
    level: held ? HELD_LEVEL : capped.level,
    check: CHECK_OF_KIND[rule.kind],
    ruleId: rule.id,
    evidence: rule.evidence,
    items: match.items,
    message: possible ? (rule.possibleMessage ?? BUILTIN_MESSAGES.maxDoseMayExceed) : rule.message,
    capped: capped.capped,
    sources: copySources(rule.sources),
  };
  if (match.term) finding.term = match.term;
  if (match.windowStart !== undefined) finding.windowStart = match.windowStart;
  return { finding, possible, held: possible && held };
}

/** Every value of `part` is in `whole`. */
function within(part: readonly number[], whole: readonly number[]): boolean {
  return part.every((index) => whole.includes(index));
}

/**
 * A possible excess is left out when a certain excess of at least its level
 * already lists its items: the card already says the amount is too high,
 * whatever the box. Never a possible overdose (a danger rule held at before
 * the next dose): it says more than the certain card.
 */
function withoutSaidExcess(ruled: readonly RuledFinding[]): Finding[] {
  const certain = ruled.filter((r) => r.finding.check === 'C7' && !r.possible);
  return ruled
    .filter(
      ({ finding: f, possible, held }) =>
        !possible ||
        held ||
        !certain.some(
          ({ finding: c }) => levelRank(c.level) >= levelRank(f.level) && within(f.items, c.items),
        ),
    )
    .map((r) => r.finding);
}

function reminderOf(rule: Rule): Reminder {
  return { ruleId: rule.id, message: rule.message, sources: copySources(rule.sources) };
}

function noteOf(rule: Rule, kind: NoteKind, message: string = rule.message): Note {
  return { kind, ...reminderOf(rule), message };
}

function byRuleId(a: Reminder, b: Reminder): number {
  return compareStrings(a.ruleId, b.ruleId);
}

/**
 * Refuses values that would silently change a result: a baby age that is not
 * a finite number of at least 0, a unit count that is not a finite number
 * greater than 0 (NaN would make every comparison false), or a strengthUnknown
 * that is not a boolean.
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
    // A truthy string read as "known" would silently drop a cautious match.
    const unknown: unknown = item.strengthUnknown;
    if (unknown !== undefined && typeof unknown !== 'boolean') {
      throw new TypeError(
        `items[${String(index)}].strengthUnknown must be a boolean, not ${typeof unknown}`,
      );
    }
  });
}

/** Evaluates the checked items of a context against a pack. */
export function evaluate(pack: Pack, context: EvaluationContext): Evaluation {
  checkContextNumbers(context);
  const pregnancy = context.pregnancy;
  const lookahead = TERM_LOOKAHEAD_DAYS / 7;
  const scope: RuleScope = {
    pack,
    context,
    covered: pregnancy ? windowsCovered(pregnancy.weeksMin, pregnancy.weeksMax + lookahead) : [],
    coveredToday: pregnancy ? windowsCovered(pregnancy.weeksMin, pregnancy.weeksMax) : [],
    keys: context.items.map((item) => entryKey(pack, item)),
  };

  const ruled: RuledFinding[] = [];
  const reminders: Reminder[] = [];
  const notes: Note[] = [];
  // The dose notes, each with the items whose total cannot be computed.
  const doseNotes: { note: Note; items: number[] }[] = [];
  for (const rule of pack.rules) {
    const match = applyRule(rule, scope);
    // C7 is a level check: a total it cannot compute gives a note, never a
    // level. When the rule already triggered C7 the finding is enough, and the
    // note would contradict it.
    const uncomputable = match ? [] : uncomputableDoseItems(rule, scope);
    if (uncomputable.length > 0) {
      doseNotes.push({
        note: noteOf(rule, 'dose', BUILTIN_MESSAGES.maxDoseNotComputable),
        items: uncomputable,
      });
    }
    if (!match) continue;
    if (rule.kind === 'reminder') reminders.push(reminderOf(rule));
    else if (rule.kind === 'contraception-info') notes.push(noteOf(rule, 'contraception'));
    else ruled.push(ruleFinding(rule, match));
  }
  const findings = withoutSaidExcess(ruled);
  // Nor when another rule's dose finding already lists those items (a card
  // saying the maximum is exceeded, beside a note saying it cannot tell).
  const doseItems = findings.filter((f) => f.check === 'C7').map((f) => f.items);
  for (const { note, items } of doseNotes) {
    if (!doseItems.some((listed) => within(items, listed))) notes.push(note);
  }

  const withFinding = new Set(findings.flatMap((f) => f.items));
  context.items.forEach((item, index) => {
    if (scope.keys[index] === undefined) findings.push(unrecognisedFinding(index));
    else if (!withFinding.has(index)) findings.push(noFinding(pack, item, index));
  });
  findings.push(...dangerSignFindings(pack, context.signs));
  findings.sort(compareFindings);
  notes.sort(byRuleId);

  return {
    level: maxLevel(findings.map((f) => f.level)),
    findings,
    reminders: reminders.sort(byRuleId),
    notes,
    pack: { version: pack.version, date: pack.date, clinicallyValidated: pack.clinicallyValidated },
  };
}
