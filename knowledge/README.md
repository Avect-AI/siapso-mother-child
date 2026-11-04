# Knowledge pack: how to write a rule

Rules, messages and danger signs are YAML files read by `tools/knowledge` (`@siapso/pack-tools`). The tool refuses a malformed or unsafe rule, then builds the pack the app and the engine use. Medicines, classes and plants live in `registry/`.

Content files are licensed CC-BY-4.0: every YAML file starts with `# SPDX-License-Identifier: CC-BY-4.0`. Keys are kebab-case; the build maps them to the engine's camelCase.

## Layout

| Path                                  | Content                                                        |
| ------------------------------------- | -------------------------------------------------------------- |
| `knowledge/pack.yaml`                 | `version`, `date`, `clinically-validated`                      |
| `knowledge/sources.yaml`              | the sources policy: allowed, fact-only and forbidden sources   |
| `knowledge/rules/<id>.yaml`           | one rule per file, file name equals `id`                       |
| `knowledge/messages/<id>.yaml`        | one message per file (French and English), file name equals id |
| `knowledge/danger-signs.yaml`         | list of danger signs                                           |
| `registry/substances.yaml`            | list of substances                                             |
| `registry/classes.yaml`               | list of substance classes                                      |
| `registry/products/<id>.yaml`         | one medicine per file                                          |
| `registry/plants/<id>.yaml`           | one traditional remedy per file                                |
| `knowledge/schema`, `registry/schema` | JSON Schemas (editors can use them for completion)             |

## Add a rule

1. Create `knowledge/rules/<id>.yaml` with a kebab-case `id` equal to the file name.
2. Fill the fields:
   - `kind`: `pregnancy`, `breastfeeding`, `interaction`, `herb-drug`, `toxicity`, `duplicate`, `max-dose`, `condition`, `contraception-info` or `reminder`.
   - `when`: `subject` (`{ substance: x }`, `{ class: x }` or `{ plant: x }`, required except for `reminder`), and optionally `requires` (any-of list of `{ with: <subject> }` or `{ condition: <id> }`), `unless-conditions`, `pregnancy-windows` (`lt12`, `12-19`, `20-29`, `30-plus`), `breastfeeding` (`baby-age-weeks-max`, `premature`), `max-mg-per-day` (kind `max-dose` only), `strength-above-mg` (substance subject only, and not on `max-dose` or `duplicate` rules, where it would drop items from the sum or the count).
   - `level`: `unknown`, `next-contact`, `before-next-dose` or `danger`.
   - `evidence`: `A` to `E`, or `0` (quoted, see below).
   - `danger-rationale`: required when `level: danger`, forbidden otherwise.
   - `message`: the id of a file in `knowledge/messages/`.
   - `sources`: each with `source`, `locator`, `accessed` (and optionally `url`, `quote`).
   - `review`: `status` (`draft` or `validated`) and `reviewers`, and `reviewed-on` once validated.
3. Create the matching `knowledge/messages/<id>.yaml` with `fact` and `risk` in `fr` and `en` (optional `risk-detail`, `orientation`).

```yaml
# SPDX-License-Identifier: CC-BY-4.0
id: nsaid-pregnancy-from-20-weeks
kind: pregnancy
when:
  subject: { class: nsaid }
  pregnancy-windows: [20-29, 30-plus]
level: before-next-dose
evidence: A
message: nsaid-pregnancy-from-20-weeks
sources:
  - source: openfda
    locator: 'Ibuprofen tablets, drug label, section 8.1 Pregnancy'
    accessed: 2026-11-04
review:
  status: draft
  reviewers: []
```

## Evidence scale

The evidence level says what kind of proof backs the rule. It sets how the message is worded (the French wording is the model for the message text).

| Evidence | Meaning                                         | Message wording (French)                                                   |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| A        | Clinical effect demonstrated in humans          | "peut provoquer ..."                                                       |
| B        | Human pharmacokinetics, often outside pregnancy | "une étude chez des volontaires a montré ..."                              |
| C        | Case reports or observational study             | "des cas graves ont été rapportés ..."                                     |
| D        | Animal or laboratory study                      | "des tests en laboratoire suggèrent ... ce n'est pas prouvé chez la femme" |
| E        | Theoretical                                     | "c'est possible, mais cela n'a pas été étudié"                             |
| 0        | No data                                         | "pas d'information fiable"                                                 |

Evidence `D`, `E` and `0` cannot give a level above `next-contact`, except for rules of kind `toxicity`. The checks reject such a rule instead of capping it silently.

In YAML, quote the evidence level `0` (`evidence: '0'`): unquoted, it is a number and the check refuses it.

Set `review.reviewed-on` (a date such as `2026-11-04`) when a reviewer validates the rule.

## Authoring metadata

The product `source` (BDPM code or `demo-manual`) and the plant `parts` are validated, but they are authoring metadata and are not carried in the runtime pack.

## Message rules

- `fact` and `risk` are required in French and English; `risk` contains no digit (numbers go in `risk-detail`).
- Never write a word that implies safety, verification or an order to change a treatment (the check lists them), no em dash and no emoji.
- The messages `nothing-found`, `not-recognised`, `danger-sign` and `evidence-0` must exist.

## Levels policy

`danger` (red) is reserved for danger signs and for rules with a written `danger-rationale` explaining the immediate risk. There is no safe level: `unknown` means we have no reliable information.

## Sources policy and NOTICE

`knowledge/sources.yaml` lists the sources the content may rely on:

- `allowed`: may support a rule (LactMed, openFDA labels, FDA Drug Safety Communications, BDPM, the ANSM interactions thesaurus, peer-reviewed literature).
- `fact-only`: may support a fact or a danger sign, but their text is never copied, and a rule always also cites an allowed source (WHO documents).
- `forbidden`: never cited, copied, linked or named. Each entry has a `reason` and the `domains` that are refused.

Each allowed or fact-only entry has `id`, `name`, `publisher`, `licence`, `url`, a `version` or an `accessed` date, and the `notice` line printed in `NOTICE`.

The check refuses:

1. a rule that cites no allowed source;
2. a rule that cites only fact-only sources;
3. a reference to a forbidden source id, a URL under a forbidden domain (subdomains included, in any string of `knowledge/`, `registry/` or `eval/`), and a forbidden name in any content file or comment, whatever the case or accents (only `knowledge/sources.yaml` may name them, in its `forbidden` list);
4. a cited source id that `sources.yaml` does not declare.

Plants may cite allowed or fact-only sources. Every danger sign must cite at least one allowed or fact-only source.

Any file in `knowledge/`, `registry/` or `eval/` that the tool does not expect (a stray YAML file, a nested folder, a `.txt` file) is reported as a problem, so that nothing escapes the checks. Under `eval/`, YAML files are parsed; `.md` and `.json` files (and the `README.md` of `knowledge/` and `registry/`) are scanned as text for forbidden names and URLs; audio files (`.wav`, `.flac`, `.ogg`, `.opus`, `.webm`, `.mp3`) are accepted without a scan.

The root `NOTICE` file is generated by `pnpm knowledge:build` from the sources actually cited (no date of generation). `pnpm knowledge:check` fails when the committed `NOTICE` differs from the generated one: run the build and commit the result. The pack's `sources.json` lists the same sources.

## Run the checks

```sh
pnpm knowledge:check   # prints one problem per line as "file: path: message", exit code 1 if any
pnpm knowledge:build   # writes app/public/pack/ (fragments, pack.json, manifest.json) and NOTICE
```

The build empties `app/public/pack/` first (it only cleans a directory named `pack`). It is deterministic (arrays sorted by id, no timestamp) and fails if the gzipped fragments exceed 3 MB.
