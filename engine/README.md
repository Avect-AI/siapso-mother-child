# @siapso/engine

The deterministic evaluation engine of SIAPSO Mother-Child: given a knowledge pack and what a woman is taking (medicines, traditional remedies, her term, breastfeeding, long-term situations, danger signs present now), it returns an alert level and the findings that explain it.

The engine alone sets the level. The name resolver and the speech model only propose items, which the user confirms before evaluation.

- Pure TypeScript, ES modules, no runtime dependency.
- No clock, no randomness, no I/O: the same inputs always give the same output, on the phone and on the server.
- The pack and the context are never modified.

Design reference: section 5 of `docs/superpowers/specs/2026-11-03-implementation-design.md`.

## Levels

Four levels, from highest to lowest: `danger`, `before-next-dose`, `next-contact`, `unknown`. There is no "safe" level: `unknown` means that we have no reliable information, never that a product is harmless. `danger` is reserved for danger signs and for rules with a written danger rationale. The engine enforces this: `parsePack` refuses a `danger` rule without a non-blank `dangerRationale`, and a `dangerRationale` on a rule whose level is not `danger`.

## API

```ts
import { evaluate, parsePack, UNKNOWN_TERM } from '@siapso/engine';

const pack = parsePack(JSON.parse(text)); // throws PackError on an invalid pack
const result = evaluate(pack, {
  pregnancy: { ...UNKNOWN_TERM, precision: 'unknown' },
  conditions: ['hiv-cotrimoxazole'],
  items: [{ ref: { kind: 'product', id: 'sp' } }],
  signs: [],
});
result.level; // highest finding level, 'unknown' when there is no finding
```

| Export                                              | Role                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate(pack, context)`                           | Runs every check and returns `{ level, findings, reminders, notes, pack }`. Throws `RangeError` for an invalid pregnancy range, baby age or unit count.                                                                                                                |
| `parsePack(json)`                                   | Validates a runtime pack (schema 1, field types and values, no unknown key in rule conditions, unique ids, references, rule partners, danger rationales, messages in French and English) and returns it typed. Throws `PackError` naming the faulty collection and id. |
| `weeksFromLmp(lmp, today)`                          | Whole weeks of amenorrhoea between two ISO dates (`YYYY-MM-DD`); today is a parameter. Accepts up to 45 whole weeks (45 weeks and 6 days pass, 46 weeks throws). Throws `RangeError` for an invalid date, a last period after today, or more than 45 whole weeks.      |
| `rangeFromMonths(month)`                            | Range of weeks for a month of pregnancy (1 to 9).                                                                                                                                                                                                                      |
| `UNKNOWN_TERM`                                      | Weeks 0 to 42, used when the term is unknown.                                                                                                                                                                                                                          |
| `WINDOWS`, `windowsCovered(min, max)`               | Pregnancy windows `lt12`, `12-19`, `20-29`, `30-plus` and the windows a range intersects.                                                                                                                                                                              |
| `itemMatches`, `substancesOf`                       | Subject matching for products (substance, class with exclusions) and plants.                                                                                                                                                                                           |
| `capForEvidence`, `maxLevel`, `LEVELS`, `levelRank` | Level helpers.                                                                                                                                                                                                                                                         |
| `findForbiddenWording(text, lang)`                  | Forbidden expressions in a text (whole-word, case-insensitive, accent-aware).                                                                                                                                                                                          |

All types (`Pack`, `EvaluationContext`, `Evaluation`, `Finding`, `Rule` and the others) are exported from `src/types.ts`.

## Checks

| Check      | Source                                                                                                   | Result                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| C1 to C8   | Rules of kind pregnancy, breastfeeding, interaction, herb-drug, toxicity, duplicate, max-dose, condition | One finding per triggered rule, listing every item involved                                    |
| C9         | Rules of kind contraception-info                                                                         | A note of kind `contraception` (accompanied mode), never a level                               |
| C7 note    | Max-dose rules whose total cannot be computed (unit count given, strength unknown)                       | A `max-dose-not-computable` note (both modes), never a level                                   |
| C10        | Rules of kind reminder                                                                                   | A reminder (accompanied mode), never a level                                                   |
| C11        | Danger signs present now                                                                                 | One `danger` finding per sign, with the sign's own `message` when the pack gives one           |
| C12        | Unrecognised items, and ids missing from the pack                                                        | One `unknown` finding per item                                                                 |
| no-finding | Known items without any finding                                                                          | `unknown` with "nothing found" for a product, the plant's own message and evidence for a plant |

Population gating, enforced by the engine whatever the rule conditions: a rule of kind `pregnancy` applies only when the context has a pregnancy (to every window when it lists no `pregnancyWindows`), and a rule of kind `breastfeeding` applies only when the context has breastfeeding (at any baby age when it sets no `when.breastfeeding` bound). A breastfeeding rule never fires for a pregnant woman who is not breastfeeding, and a pregnancy rule never fires outside a pregnancy.

Rule conditions (`when`):

- `pregnancyWindows`: the rule applies only during a pregnancy whose range of weeks intersects one of the windows. With an estimated or unknown term, every intersecting rule triggers and the finding carries `term`.
- `breastfeeding`: the rule applies only when breastfeeding; an unknown baby age or prematurity keeps the rule.
- `requires`: any-of conditions or `with` items. A `with` item must be another item, and another product or plant, than the subject item: an item never interacts with itself, even when entered twice. An interaction or herb-drug rule must have a `with` partner; a herb-drug rule is a plant subject with substance or class partners.
- `strengthAboveMg`: with a substance subject only, the subject item matches only when its component for that substance is stronger than the value; an unknown strength matches (cautious).
- Strength not known on the box: an item with `strengthUnknown: true` (the user confirmed the product but not the strength written on it) has every component strength read as unknown. A `strengthAboveMg` rule applies to it, the max-dose sum skips it (its known part is 0), and the `max-dose-not-computable` note can apply when it has a unit count. `evaluate` throws a `TypeError` naming the item when `strengthUnknown` is present and not a boolean.
- `unlessConditions`: the rule does not apply when one of these conditions is present.
- `unlessWith` (rules of kind `reminder` and `contraception-info` only): the rule does not apply when any item matches one of these subjects (substance, class or plant), the subject item included. `parsePack` refuses it on any other kind with a `PackError` naming the rule, and the authoring check refuses it too: a content mistake in an exception must not silently switch off a risk rule when an unrelated item is present. The IPTp reminder uses it so that a co-trimoxazole item cancels the reminder even when the condition was not entered.
- Duplicate: at least two items match the subject. Max-dose: the known sum of strength x units per day over the items holding the substance is greater than `maxMgPerDay`. An item without a unit count or a strength adds nothing to the sum but does not cancel it, and the finding lists every item holding the substance; the rule is skipped only when the known sum is at or below the threshold.
- Max-dose total not computable: when a max-dose rule could apply (its conditions and requirements are met) and an item holding its subject has a unit count but no strength for that substance (a generic of unknown strength), `notes` gets one note per rule, `{ kind: 'dose', ruleId: <the max-dose rule>, message: 'max-dose-not-computable' }` (`BUILTIN_MESSAGES.maxDoseNotComputable`), unless the same rule already triggered C7 in that evaluation (the finding is enough, and the note would contradict it). C7 is a level check: this is a note, never a level. Its message asks to show the boxes to the midwife or the pharmacist and gives no number; unlike the C9 notes, it is meant for both modes. `Note.kind` tells them apart: `contraception` (from `contraception-info` rules) is shown in accompanied mode only, `dose` in both modes. Reminders are a separate type (`Reminder`, no kind).

`parsePack` also refuses a product without components, a pack `date` that is not a calendar date written `YYYY-MM-DD`, and a source cited by a rule, a plant or a danger sign that `pack.sources` does not list. It refuses unknown keys in `when` (the accepted keys are exported as `RULE_WHEN_KEYS`), in each `requires` entry, in `when.breastfeeding` and in each subject (a misspelled `pregnancyWindow` fails instead of being ignored), and refuses an empty `requires`, `pregnancyWindows` or `unlessWith` list. `evaluate` throws a `RangeError` naming the field (and the item index) when `breastfeeding.babyAgeWeeks` is not a finite number of at least 0, or when an item `unitsPerDay` is not a finite number greater than 0.

Findings are sorted by level (danger first), then check (C1 to C12, then no-finding), then rule id or message id, then first item index, then sign. String comparisons use code unit order, never the device locale.

## Guarantees

Tested in `test/guarantees.test.ts` over 10584 contexts generated exhaustively from the fixture pack (no randomness):

- an unrecognised item always yields an `unknown` C12 finding, whatever else is present;
- no input yields a level outside the four levels;
- same inputs, same output, and inputs are never modified (they are deeply frozen in the tests);
- evidence D, E or 0 never exceeds `next-contact`, except for toxicity rules;
- every message id in the output exists in French and English;
- an unknown term triggers every rule that an exact term triggers.

The evidence cap is also applied when the pack is built; the engine applies it again as a second barrier. Coverage of `engine/src` is at least 90 percent (lines, branches, functions, statements), enforced by the root Vitest configuration.

## Tests

From the repository root:

```
pnpm vitest run --project engine
pnpm test:coverage
```

`test/fixtures/pack.ts` is test-only data. It is not clinical content: its rules, levels, thresholds and messages exist only to exercise the engine.
