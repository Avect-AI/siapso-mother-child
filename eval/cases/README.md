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

- `weeks` gives an exact term, `months` an estimated range, `unknown: true` the whole pregnancy with precision unknown. Leave `pregnancy` out when the woman is not pregnant.
- An item is a `product` or `plant` id of the registry, or an `unrecognised` text. `units-per-day` and `long-term` are optional.
- `signs` lists danger sign ids; a sign gives a finding with the sign set.
- `expect.findings` is the full ordered list the engine returns. Each finding has `check`, `message` (the message id the woman reads: the rule's message, or the built-in one of a danger sign, a name not recognised or a product without finding), `level` and `items`, plus `rule` for a finding from a rule. `evidence`, `sign` and `term` are listed when the engine sets them.
- `expect.reminders` and `expect.notes` are the rule ids of the reminders and notes, sorted.
- The test also checks that every message id of the output exists in French and English and that no message text contains forbidden wording.

## Cases

| Case                                     | Files                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| 1 Ibuprofen in pregnancy, term variants  | `case-01-ibuprofen-30-weeks`, `-10-weeks`, `-term-unknown`, `-5-months` |
| 2 Paracetamol twice, fever               | `case-02-paracetamol-duplicate-fever`                                   |
| 3 Cotrimoxazole and SP                   | `case-03-cotrimoxazole-sp`                                              |
| 4 Codeine, newborn                       | `case-04-codeine-newborn`                                               |
| 5 ASAQ and moringa                       | `case-05-asaq-moringa`                                                  |
| 6 Quinine and bitter kola                | `case-06-quinine-bitter-kola`                                           |
| 7 Iron and clay                          | `case-07-iron-clay`                                                     |
| 8 Lightening cream                       | `case-08-lightening-cream`                                              |
| 9 Castor oil, uterine scar, unrecognised | `case-09-castor-oil-uterine-scar`                                       |
| 10 Kinkeliba, fever                      | `case-10-kinkeliba-fever`                                               |
| 11 Unrecognised product                  | `case-11-unrecognised-product`                                          |
| 12 Artemether-lumefantrine at 8 weeks    | `case-12-artemether-lumefantrine`                                       |
| 13 Aspirin 75 mg and 500 mg              | `case-13-aspirin-75-mg`, `case-13-aspirin-500-mg`                       |
| 14 Not pregnant, not breastfeeding       | `case-14-ibuprofen-not-pregnant`                                        |
| 15 Cotrimoxazole item, no HIV condition  | `case-15-cotrimoxazole-no-condition`                                    |
