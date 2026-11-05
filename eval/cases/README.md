# Reference cases

Each file in this folder is one blocking reference case: a situation and the exact output the engine must give for it. The cases come from the pharmacist's annex of the design dossier. The test `tools/knowledge/test/reference-cases.test.ts` builds the pack from the repository content, runs the engine on every case and compares the result with strict equality. Any change in the engine output for a case fails CI.

A case changes only by editing its file in a reviewed pull request, never to make a failing test pass without a clinical reason.

## Format

The file name is the case id plus `.yaml`. The first line is the licence line. The schema is `eval/schema/case.schema.json`.

```yaml
# SPDX-License-Identifier: CC-BY-4.0
id: case-01-ibuprofen-30-weeks
title: 'Awa, 30 weeks, ibuprofen for back pain'
context:
  pregnancy: { weeks: 30 } # or { months: 5 } or { unknown: true }
  breastfeeding: { baby-age-weeks: 1, premature: false }
  conditions: []
  items:
    - { product: advil-400-mg-63646874 } # or { plant: kinkeliba } or { unrecognised: 'market tablet' }
  signs: []
expect:
  level: before-next-dose
  findings:
    - {
        check: C1,
        rule: nsaid-pregnancy-from-20-weeks,
        message: nsaid-pregnancy-from-20-weeks,
        level: before-next-dose,
        evidence: A,
        items: [0],
      }
  reminders: [iptp-reminder]
  notes: []
```

- `weeks` gives an exact term, `months` an estimated range, `unknown: true` the whole pregnancy with precision unknown. Leave `pregnancy` out when the woman is not pregnant. A rule that gives a finding is looked up with the term extended by the engine's 14-day look-ahead (`TERM_LOOKAHEAD_DAYS`); reminders and notes use the term as given (cases 33 and 34).
- An item is a `product` or `plant` id of the registry, or an `unrecognised` text. `units-per-day` and `long-term` are optional.
- `signs` lists danger sign ids; a sign gives a finding with the sign set.
- `expect.findings` is the full ordered list the engine returns. Each finding has `check`, `message` (the message id the woman reads: the rule's message, or the built-in one of a danger sign, a name not recognised or a product without finding), `level` and `items`, plus `rule` for a finding from a rule. `evidence`, `sign` and `term` are listed when the engine sets them.
- `expect.reminders` and `expect.notes` are the rule ids of the reminders and notes, sorted.
- The test also checks that every message id of the output exists in French and English and that no message text contains forbidden wording.

## Cases

| Case                                          | Files                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| 1 Ibuprofen in pregnancy, term variants       | `case-01-ibuprofen-30-weeks`, `-10-weeks`, `-term-unknown`, `-5-months` |
| 2 Paracetamol twice, fever                    | `case-02-paracetamol-duplicate-fever`                                   |
| 3 Cotrimoxazole and SP                        | `case-03-cotrimoxazole-sp`                                              |
| 4 Codeine, newborn                            | `case-04-codeine-newborn`                                               |
| 5 ASAQ and moringa                            | `case-05-asaq-moringa`                                                  |
| 6 Quinine and bitter kola                     | `case-06-quinine-bitter-kola`                                           |
| 7 Iron and clay                               | `case-07-iron-clay`                                                     |
| 8 Lightening cream                            | `case-08-lightening-cream`                                              |
| 9 Castor oil, uterine scar, unrecognised      | `case-09-castor-oil-uterine-scar`                                       |
| 10 Kinkeliba, fever                           | `case-10-kinkeliba-fever`                                               |
| 11 Unrecognised product                       | `case-11-unrecognised-product`                                          |
| 12 Artemether-lumefantrine at 8 weeks         | `case-12-artemether-lumefantrine`                                       |
| 13 Aspirin 75 mg and 500 mg                   | `case-13-aspirin-75-mg`, `case-13-aspirin-500-mg`                       |
| 14 Not pregnant, not breastfeeding            | `case-14-ibuprofen-not-pregnant`                                        |
| 15 Cotrimoxazole item, no HIV condition       | `case-15-cotrimoxazole-no-condition`                                    |
| 16 Misoprostol, scar, 16 weeks                | `case-16-misoprostol-uterine-scar`                                      |
| 17 Misoprostol, 36 weeks                      | `case-17-misoprostol-36-weeks`                                          |
| 18 Misoprostol and castor oil, scar, 9 months | `case-18-misoprostol-castor-oil-9-months`                               |
| 19 Misoprostol, breastfeeding only            | `case-19-misoprostol-breastfeeding`                                     |
| 20 Misoprostol, 24 weeks, no scar             | `case-20-misoprostol-24-weeks`                                          |
| 21 Misoprostol, scar, 9 weeks                 | `case-21-misoprostol-uterine-scar-9-weeks`                              |
| 22 Doxycycline at 8 weeks                     | `case-22-doxycycline-8-weeks`                                           |
| 23 Doxycycline at 12 weeks                    | `case-23-doxycycline-12-weeks`                                          |
| 24 Aspirin 500 mg at 16 weeks                 | `case-24-aspirin-500-mg-16-weeks`                                       |
| 25 Kardegic 75 mg at 16 weeks                 | `case-25-kardegic-75-mg-16-weeks`                                       |
| 26 Carbamazepine at 16 weeks                  | `case-26-carbamazepine-16-weeks`                                        |
| 27 Paracetamol, liver failure                 | `case-27-paracetamol-hepatic-failure`                                   |
| 28 Ibuprofen, kidney failure                  | `case-28-ibuprofen-renal-failure`                                       |
| 29 Rifampicin at 20 weeks                     | `case-29-rifampicin-20-weeks`                                           |
| 30 Methotrexate at 10 weeks                   | `case-30-methotrexate-10-weeks`                                         |
| 31 Methotrexate, breastfeeding                | `case-31-methotrexate-breastfeeding`                                    |
| 32 Fluconazole at 8 weeks                     | `case-32-fluconazole-8-weeks`                                           |
| 33 Ibuprofen at 19 weeks, look-ahead          | `case-33-ibuprofen-19-weeks`                                            |
| 34 Castor oil at 29 weeks, look-ahead         | `case-34-castor-oil-29-weeks-uterine-scar`                              |

Cases 16 to 29 come from the live test round 1 (SCRUM-49), not from the pharmacist's annex: they pin the test rules added then, which the clinical committee must still review. Cases 20 and 21 pin two deliberate gaps of those rules (misoprostol is red from 30 weeks without a scar and from 12 weeks with one), case 23 the start of the second trimester, case 25 the low-dose threshold before 20 weeks, and case 29 a product that only a contraception note reads ("nothing found"). The other terms are kept away from the window boundaries (12, 20 and 30 weeks). Cases 33 and 34 (SCRUM-45) pin the 14-day look-ahead of the engine: 20 and 30 weeks are reached within it.
