# Plan B: knowledge pack, provenance, starter content, resolver and reference cases

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A validated, deterministic knowledge pack built from human-readable YAML, with traceable sources, the demo clinical content, the name resolver and blocking reference cases.

**Architecture:** Content lives in `knowledge/`, `registry/` and `eval/` (YAML, CC BY 4.0). A private workspace package `@siapso/pack-tools` in `tools/knowledge/` validates it (JSON Schema 2020-12 with Ajv, plus semantic checks), builds the runtime `Pack` typed by `@siapso/engine`, writes fragments to `app/public/pack/` and generates `NOTICE`. The resolver is a dependency-free library that indexes products and plants. Spec: `docs/superpowers/specs/2026-11-03-implementation-design.md` sections 2, 4, 5, 6, 10, 11.

**Tech Stack:** TypeScript 6.0.3, Node 24, `yaml@2.9.1`, `ajv@8.20.0`, `ajv-formats@3.0.1`, Vitest 5.0.5.

## Global Constraints

- Code, comments, docs, commit messages, branch names and pull requests in English. Clinical messages in French and English (correct French spelling with accents).
- Never write the em dash character (U+2014), never write emoji, never attribute work to an AI. Hooks and CI enforce this.
- Commits: Conventional Commits subject (at most 72 characters, no final period), `git commit -s`, body footer `Refs: SCRUM-<n>`. Branch `<type>/SCRUM-<n>-<topic>`. Never push to `main`, never force-push; update a branch by merging `origin/main`. Open the PR with `gh pr create`; do not merge it.
- SPDX first line: `// SPDX-License-Identifier: MIT` in code; `# SPDX-License-Identifier: CC-BY-4.0` in every YAML file under `knowledge/`, `registry/`, `eval/`; JSON Schema files are code (no comment possible; licensed through REUSE later).
- Dependencies: exact versions published on or before 2026-10-20.
- TypeScript strict flags as in the workspace; ESM.
- Local shell: `export PATH="/c/Users/djene/AppData/Local/Programs/nodejs:/c/Users/djene/AppData/Local/Programs/gh/bin:$PATH"` first in every Bash call. Python: `sh tools/hygiene/py.sh`.
- Forbidden sources, never cited, copied or named in data: DDInter, LEDIAM, e-lactancia, CRAT, Theriaque, Vidal, full DrugBank. WHO documents are fact-only: they may support a fact or a danger sign, their text is never copied, and a rule always also cites at least one allowed source.
- Messages never say safe, harmless, verified, stop, do not take, replace, reduce, take instead, authorised, compatible, no risk (and French equivalents); never give a dose, an alternative product, an abortive use, or say a plant cures. Allowed verbs: show, tell, talk, ask, go, call.
- Never invent a source, URL, quote, PMID or DOI. Every quote in a rule must come from a document actually read.

---

### Task 4 (SCRUM-17): authoring schema, validation and pack build

Branch `feat/SCRUM-17-pack-schema`. Depends on Plan A Task 3 (engine) merged.

**Files:**
- Create package `tools/knowledge/`: `package.json` (`@siapso/pack-tools`, private, bin `siapso-pack` pointing to `src/cli.ts` run with Node's `--experimental-strip-types` or `tsx` if strip-types is insufficient; pick one and document it), `tsconfig.json`, `src/load.ts`, `src/schemas.ts`, `src/validate.ts`, `src/checks.ts`, `src/build.ts`, `src/write.ts`, `src/cli.ts`, `src/index.ts`, `test/fixtures/**` (a small valid content tree and invalid variants), `test/*.test.ts`
- Create schemas: `knowledge/schema/rule.schema.json`, `message.schema.json`, `danger-sign.schema.json`, `pack-meta.schema.json`, `registry/schema/substance.schema.json`, `class.schema.json`, `product.schema.json`, `plant.schema.json`
- Create content skeleton: `knowledge/pack.yaml`, `knowledge/messages/nothing-found.yaml`, `not-recognised.yaml`, `danger-sign.yaml`, `evidence-0.yaml`, `knowledge/rules/.gitkeep`, `knowledge/danger-signs.yaml` (empty list for now), `registry/substances.yaml` (empty list), `registry/classes.yaml` (empty list), `registry/products/.gitkeep`, `registry/plants/.gitkeep`
- Modify engine: `engine/src/types.ts`, `engine/src/match.ts`, `engine/src/evaluate.ts` (or the file holding C11), `engine/src/pack.ts`, tests (two additions below)
- Modify: root `package.json` scripts, `.gitignore` (`app/public/pack/`), `.github/workflows/ci.yml` (no new job: `pnpm build` now runs the knowledge build), `CLAUDE.md` Commands, `CHANGELOG.md`, `knowledge/README.md` (create: how to write a rule)

**Interfaces:**
- Consumes: `Pack`, `Rule`, `Product`, `Plant`, `Substance`, `SubstanceClass`, `DangerSign`, `Message`, `parsePack`, `findForbiddenWording`, `capForEvidence` from `@siapso/engine`.
- Produces:
  ```ts
  export interface ContentTree { root: string } // repository root
  export interface Problem { file: string; path: string; message: string }
  export function loadContent(root: string): Promise<RawContent>; // parses every YAML file, keeps file paths
  export function validateContent(raw: RawContent): Problem[];    // schema + semantic checks; [] means valid
  export function buildPack(raw: RawContent): Pack;               // throws if validateContent is not empty
  export function writePack(pack: Pack, outDir: string): Promise<Manifest>; // fragments + manifest.json
  export interface Manifest { schema: 1; version: string; date: string; clinicallyValidated: boolean;
    counts: Record<'substances' | 'classes' | 'products' | 'plants' | 'rules' | 'dangerSigns' | 'sources', number>;
    fragments: { path: string; sha256: string; bytes: number }[]; }
  export const PACK_FRAGMENTS: readonly string[]; // the fragment file names, in a fixed order
  ```
  Fragment files: `substances.json`, `classes.json`, `products.json`, `plants.json`, `rules.json`, `danger-signs.json`, `sources.json`, `messages.fr.json`, `messages.en.json`. The app assembles them into `Pack` (Plan C); `writePack` also writes `pack.json` (the whole `Pack`, used by tests and the server).
- Root scripts: `"knowledge:check": "siapso-pack check"`, `"knowledge:build": "siapso-pack build"`, and `"build"` becomes `pnpm knowledge:build && pnpm -r --if-present build`. `siapso-pack build` writes to `app/public/pack/` and regenerates `NOTICE` (from Task 5 on; in this task NOTICE generation is not yet present).

**Engine additions (small, test first):**
- `RuleWhen.strengthAboveMg?: number`: the subject item matches only if its component for the subject substance has `strengthMg` greater than the value; when `strengthMg` is unknown the rule applies (cautious). Valid only with a `substance` subject.
- `DangerSign.message?: string`: when present, the C11 finding for that sign uses this message id instead of `danger-sign`. `parsePack` checks the id exists in both languages.

**Authoring format (kebab-case keys; the build maps them to the engine's camelCase):**

```yaml
# knowledge/pack.yaml
# SPDX-License-Identifier: CC-BY-4.0
version: 0.1.0
date: 2026-11-05
clinically-validated: false
```

```yaml
# knowledge/rules/nsaid-pregnancy-from-20-weeks.yaml
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
    locator: "Ibuprofen tablets, drug label, section 8.1 Pregnancy"
    url: "https://api.fda.gov/drug/label.json?search=..."
    accessed: 2026-11-04
    quote: "..."
review:
  status: draft
  reviewers: []
```

Other `when` keys: `requires` (list, each `{ with: <subject> }` or `{ condition: <id> }`, any-of), `unless-conditions`, `breastfeeding` (`baby-age-weeks-max`, `premature`), `max-mg-per-day`, `strength-above-mg`. Optional rule key `danger-rationale` (required when `level: danger`).

```yaml
# knowledge/messages/nsaid-pregnancy-from-20-weeks.yaml
# SPDX-License-Identifier: CC-BY-4.0
id: nsaid-pregnancy-from-20-weeks
fr:
  fact: "Ce médicament contient un anti-inflammatoire (AINS)."
  risk: "À partir du 5e mois, il peut abîmer les reins et le cœur du bébé."
  risk-detail: "..."        # optional, accompanied mode, may contain numbers
  orientation: "..."        # optional, overrides the level default
en:
  fact: "..."
  risk: "..."
```

```yaml
# registry/products/doliprane-1000.yaml
# SPDX-License-Identifier: CC-BY-4.0
id: doliprane-1000
names: { fr: "Doliprane 1000 mg, comprimé", en: "Doliprane 1000 mg tablet" }
brands: [Doliprane]
local-names: []
components: [{ substance: paracetamol, strength-mg: 1000 }]
form: tablet
route: oral
source: { bdpm: "60234100" }   # or { demo-manual: true }
demo: false
```

```yaml
# registry/plants/moringa.yaml
# SPDX-License-Identifier: CC-BY-4.0
id: moringa
latin-name: Moringa oleifera
names: { fr: "Moringa", en: "Moringa" }
local-names:
  - { text: nebeday, lang: wo, checked: false }
parts: [leaf]
evidence: B
message: evidence-0        # grey message when no rule applies
sources: []
```

`registry/substances.yaml`: list of `{ id, names: {fr, en}, classes: [] }`. `registry/classes.yaml`: list of `{ id, names, excludes: [] }`. `knowledge/danger-signs.yaml`: list of `{ id, group, label: {fr, en}, message?, sources }`.

**Checks performed by `validateContent` (each with a test that a violating fixture produces a Problem naming the file and field):**
1. Every file matches its JSON Schema (unknown keys rejected: `additionalProperties: false`).
2. Ids are kebab-case, unique per collection, and equal to the file name for one-file-per-entry folders.
3. Every reference resolves: substances, classes, plants, messages, conditions, window ids, sources (sources checked in Task 5).
4. `level: danger` requires `danger-rationale`; `danger-rationale` without `level: danger` is rejected.
5. Evidence cap: a rule with evidence D, E or 0, kind other than `toxicity`, and a level above `next-contact` is rejected (no silent capping).
6. `strength-above-mg` only with a `substance` subject; `max-mg-per-day` only with kind `max-dose`; `subject` required except for `reminder`.
7. Every message has `fact` and `risk` in both `fr` and `en`; `risk` contains no digit; no message text (any field, both languages) contains forbidden wording (`findForbiddenWording`), an em dash or an emoji.
8. Builtin messages exist: `nothing-found`, `not-recognised`, `danger-sign`, `evidence-0`.
9. The built pack passes `parsePack`.
10. Total gzip size of the fragments is under 3 MB (checked in `writePack`; error otherwise).

- [ ] **Step 1:** Branch from up-to-date `main`. Engine additions first (test first, then code), keeping engine coverage at least 90.
- [ ] **Step 2:** Write fixtures (valid tree plus one invalid variant per check) and failing tests for `loadContent`, `validateContent` (one test per check above), `buildPack` (YAML kebab-case to engine camelCase, arrays sorted by id), `writePack` (manifest hashes match file bytes; two builds give byte-identical files; size budget error on a synthetic oversized pack). Run, see them fail.
- [ ] **Step 3:** Write the schemas and the implementation. Run tests until green.
- [ ] **Step 4:** Wire the CLI and root scripts; `pnpm knowledge:check` and `pnpm knowledge:build` succeed on the skeleton content; `pnpm build` and `pnpm e2e` still pass; `app/public/pack/` is git-ignored.
- [ ] **Step 5:** `knowledge/README.md`: how to add a rule (file, fields, evidence scale A to 0 with the wording of spec section 10, sources, review), run the checks, and the levels policy (red only with a danger rationale).
- [ ] **Step 6:** Full verification, commit, push, PR `feat(knowledge): add the pack schema, validation and build`, `Refs: SCRUM-17`; wait for green CI.

---

### Task 5 (SCRUM-21): sources policy, provenance check and NOTICE

Branch `feat/SCRUM-21-provenance`. Depends on Task 4.

**Files:**
- Create: `knowledge/sources.yaml`, `knowledge/schema/sources.schema.json`, `tools/knowledge/src/provenance.ts`, `tools/knowledge/src/notice.ts`, tests and fixtures
- Modify: `tools/knowledge/src/validate.ts` (call provenance), `tools/knowledge/src/cli.ts` (`build` writes `NOTICE`; `check` fails when `NOTICE` is out of date), root `NOTICE` (generated), `CHANGELOG.md`, `knowledge/README.md`

**`knowledge/sources.yaml` content:**
- `allowed`: `lactmed` (LactMed, US National Library of Medicine, public domain, record date or bulk archive date), `openfda` (openFDA drug labels, US FDA, CC0 / public domain), `fda-dsc` (FDA Drug Safety Communications, public domain), `bdpm` (Base de données publique des médicaments, ANSM, Licence Ouverte 2.0, download date), `ansm-thesaurus` (Thésaurus des interactions médicamenteuses, ANSM, September 2023 version, reuse with citation), `literature` (peer-reviewed literature, cited by reference; summarised in our own words).
- `fact-only`: `who` (World Health Organization guidelines and lists, CC BY-NC-SA 3.0 IGO: facts only, no copied text).
- `forbidden`: `ddinter`, `lediam`, `e-lactancia`, `crat`, `theriaque`, `vidal`, `drugbank-full`, each with `reason` and `domains` (for example `ddinter.scbdd.com`, `lecrat.fr`, `e-lactancia.org`, `theriaque.org`, `vidal.fr`, `go.drugbank.com`).
- Each entry: `id`, `name`, `publisher`, `licence`, `url`, `version` or `accessed`, `notice` (the attribution line for NOTICE).

**Provenance rules (each with a failing-fixture test):**
1. Every rule cites at least one source whose id is in `allowed`.
2. A rule may also cite `fact-only` sources; a rule citing only `fact-only` sources fails.
3. Any reference to a `forbidden` id fails; any URL under a forbidden domain anywhere in `knowledge/`, `registry/` or `eval/` fails; the forbidden names (case-insensitive: DDInter, LEDIAM, e-lactancia, CRAT, Thériaque, Vidal, DrugBank) appearing in any content file outside `knowledge/sources.yaml` fails.
4. A source id not declared in `sources.yaml` fails.
5. Danger signs and plants may cite `allowed` or `fact-only` sources.

**NOTICE:** generated deterministically: project name and copyright line (`Copyright 2026 AVECT AI SARL`), licences (MIT code, CC BY 4.0 content), then one attribution block per `allowed` source actually cited (name, publisher, licence, version or date), then fact-only sources cited, in id order. `siapso-pack check` fails if the committed `NOTICE` differs from the generated one.

- [ ] Steps: branch; failing tests for each provenance rule and for NOTICE generation and drift; implement; generate `NOTICE`; full verification; PR `feat(knowledge): enforce source provenance and generate NOTICE`, `Refs: SCRUM-21`.

---

### Task 6 (SCRUM-20): starter clinical content

Branch `feat/SCRUM-20-starter-content`. Depends on Task 5.

**Input:** the verified research notes `C:\Users\djene\AppData\Local\Temp\claude\ff82dbb411fd0739\80df48ab-1299-4671-bb8b-5e8fe4fd1870\scratchpad\clinical-sources.md` (rules R01 to R22 with sources, URLs opened and verbatim quotes checked against downloaded copies; local copies of the sources are in the same scratchpad folder). Read it fully first. Do not copy WHO text. Quotes marked as needing a human check stay out of rule files unless you can verify them against a copy.

**Files:**
- Create: `knowledge/rules/*.yaml`, `knowledge/messages/*.yaml`, `knowledge/danger-signs.yaml` (filled), `registry/substances.yaml`, `registry/classes.yaml`, `registry/plants/*.yaml`, `registry/products/*.yaml` (manual entries), `registry/products/bdpm.yaml` (generated), `tools/knowledge/src/import-bdpm.ts` and its test, root script `knowledge:import-bdpm`
- Modify: `NOTICE` (regenerated), `knowledge/pack.yaml` (date), `CHANGELOG.md`

**Rules to write (id, kind, subject and conditions, level, evidence). Messages follow the 4-part template; risk sentences without numbers; orientation only where stated:**

| Rule id | Kind | When | Level | Evidence |
| --- | --- | --- | --- | --- |
| `nsaid-pregnancy-from-20-weeks` | pregnancy | class `nsaid`; windows 20-29, 30-plus | before-next-dose | A |
| `nsaid-pregnancy-before-20-weeks` | pregnancy | class `nsaid`; windows lt12, 12-19; only if the ibuprofen RCP read for R01 supports "not before 6th month unless necessary" with a verbatim quote, otherwise omit | next-contact | C |
| `paracetamol-duplicate-products` | duplicate | substance `paracetamol` | before-next-dose | A |
| `paracetamol-max-daily` | max-dose | substance `paracetamol`; `max-mg-per-day` from a BDPM paracetamol RCP quote that states the adult daily maximum (read it and quote it; if you cannot verify a threshold, omit the rule) | before-next-dose | A |
| `sp-with-cotrimoxazole` | condition | substance `sulfadoxine`; requires `{condition: hiv-cotrimoxazole}` or `{with: {substance: sulfamethoxazole}}` | before-next-dose | A |
| `codeine-breastfeeding` | breastfeeding | substance `codeine`; breastfeeding | before-next-dose | C |
| `tramadol-breastfeeding` | breastfeeding | substance `tramadol`; breastfeeding | next-contact | C |
| `metronidazole-breastfeeding` | breastfeeding | substance `metronidazole`; breastfeeding | next-contact | C |
| `moringa-with-amodiaquine` | herb-drug | plant `moringa`; requires with substance `amodiaquine` | next-contact | B |
| `bitter-kola-with-quinine` | herb-drug | plant `garcinia-kola`; requires with substance `quinine`; orientation "in the coming days; if the fever continues or comes back, go back to the health post" | before-next-dose | B |
| `clay-eating-toxicity` | toxicity | plant `clay`; pregnancy (all windows) | next-contact | C |
| `clay-with-iron` | herb-drug | plant `clay`; requires with substance `iron` | next-contact | evidence as the research supports for geophagy and iron (D or E: keep at next-contact) |
| `clobetasol-pregnancy` | pregnancy | substance `clobetasol`; all windows; message names the circumstances that carry the risk (large areas, long use, skin lightening); orientation "in the coming days"; never says to stop (abrupt stop is a risk) | before-next-dose | C |
| `clobetasol-breastfeeding` | breastfeeding | substance `clobetasol`; breastfeeding; message about the nipple area and large areas | next-contact | C |
| `castor-oil-term-uterine-scar` | toxicity | plant `castor-oil`; windows 30-plus; requires condition `uterine-scar`; `danger-rationale`: "Committee exception of reference case 9: risk of uterine rupture with a scarred uterus at term (immediate vital risk)."; orientation: show the products to the midwife today, and if bleeding or very strong pain, go to the health centre immediately | danger | C |
| `castor-oil-late-pregnancy` | toxicity | plant `castor-oil`; windows 30-plus; `unless-conditions: [uterine-scar]` | next-contact | C |
| `misoprostol-pregnancy` | pregnancy | substance `misoprostol`; all windows; message neutral (contractions, loss of the pregnancy), never mentions abortion as a use and no dose; orientation "show this product to the midwife today" | before-next-dose | A |
| `tetracyclines-pregnancy` | pregnancy | class `tetracycline`; windows 12-19, 20-29, 30-plus | before-next-dose | A |
| `valproate-pregnancy` | pregnancy | substance `valproic-acid`; all windows; message stresses not changing an epilepsy treatment alone | before-next-dose | A |
| `isotretinoin-pregnancy` | pregnancy | substance `isotretinoin`; all windows | before-next-dose | A |
| `raas-blockers-pregnancy` | pregnancy | class `raas-blocker`; all windows | before-next-dose | A |
| `warfarin-pregnancy` | pregnancy | substance `warfarin`; all windows | before-next-dose | A |
| `aspirin-analgesic-dose-pregnancy` | pregnancy | substance `aspirin`; `strength-above-mg: 100`; windows 20-29, 30-plus | before-next-dose | A |
| `amodiaquine-with-antiretrovirals` | interaction | substance `amodiaquine`; requires with `efavirenz`, with `zidovudine`, with `sulfamethoxazole`, or condition `hiv-cotrimoxazole`; message stresses that the malaria treatment matters and nothing changes without a professional | before-next-dose | C |

Not written as rules (record the decision in the PR description): moringa root and bark in pregnancy (animal data only, and the strongest animal signal concerned leaves, a common food: needs the clinical committee); neem oil given to infants (outside the scope of what the mother takes; needs the committee); artemether-lumefantrine in the first trimester (WHO recommends it since 2022: it must not be flagged, a reference case checks this in Task 8); dolutegravir (no current label support).

Reminders and notes (only with at least one `allowed` source verified by you; otherwise omit and say so in the PR): IPTp reminder (`reminder`, windows 12-19, 20-29, 30-plus, `unless-conditions: [hiv-cotrimoxazole]`, message in the "demandez si vous avez reçu..." form); contraception notes (`contraception-info`) for `rifampicin`, `efavirenz`, `carbamazepine` using openFDA label text you fetch from `api.fda.gov` and quote verbatim (formulation: "Certains médicaments, comme la rifampicine, peuvent réduire l'efficacité de certaines contraceptions. Demandez à la sage-femme ou au planning familial.").

Danger signs (`knowledge/danger-signs.yaml`), one fixed list, each with sources (WHO fact-only allowed): pregnancy: `fever`, `vaginal-bleeding`, `convulsions`, `severe-headache` (with blurred vision), `baby-not-moving` (reduced or absent movements), `severe-abdominal-pain`, `waters-breaking` (before labour), `breathing-difficulty`, `swelling-face-hands`; postpartum: `heavy-bleeding-after-birth`, `fever-after-birth`; baby: `baby-not-feeding`, `baby-very-sleepy` (sleeps much more than usual, hard to wake), `baby-breathing-difficulty`, `baby-convulsions`, `baby-fever-or-cold`. Fever (pregnancy) has its own message: "La fièvre pendant la grossesse peut être le paludisme : allez faire un test au poste de santé aujourd'hui." Labels are short and concrete, French and English. Mark the list as to be aligned with the national list by the committee (in `knowledge/README.md`).

Builtin and plant messages: `nothing-found` (spec section 2 wording, with the version and date filled by the app), `not-recognised`, `danger-sign` ("Ces signes sont des signes de danger. Allez au poste de santé maintenant."), `evidence-0` (dossier evidence-0 wording), `kinkeliba` (dossier case 10 wording without the fever part, which comes from the fever sign: "Nous n'avons pas d'information fiable sur le kinkéliba pendant la grossesse : cela ne veut pas dire qu'il est sans risque. Rien ne prouve qu'il guérit le paludisme.").

Registry:
- Substances (INN kebab-case) and classes: `nsaid` (ibuprofen, diclofenac, ketoprofen, naproxen; aspirin is NOT in this class), `tetracycline` (doxycycline, tetracycline, minocycline), `raas-blocker` (enalapril, captopril, lisinopril, ramipril, perindopril, losartan, valsartan, irbesartan), plus every substance used by a rule or a product (paracetamol, codeine, tramadol, metronidazole, amodiaquine, artesunate, artemether, lumefantrine, quinine, sulfadoxine, pyrimethamine, sulfamethoxazole, trimethoprim, iron (ferrous salts), folic-acid, clobetasol, hydroquinone, misoprostol, valproic-acid, isotretinoin, warfarin, aspirin, efavirenz, zidovudine, lamivudine, tenofovir, dolutegravir, rifampicin, carbamazepine, amoxicillin, pheniramine, ascorbic-acid).
- Plants (with local names marked `checked: false`): `moringa` (nebeday, B), `garcinia-kola` (kola amer, B), `cola-nut` (guro, 0), `kinkeliba` (kinkéliba, 0, message `kinkeliba`), `clay` (argile, kaolin, C), `castor-oil` (huile de ricin, C), `neem` (nim, 0), `bissap` (0), `tamarind` (dakhar, 0), `guiera` (nguer, 0), `nere` (néré, 0), `bitter-leaf` (feuille amère, 0), `ginger` (gingembre, 0), `garlic` (ail, 0). Plants with evidence 0 use `evidence-0` unless stated.
- Manual products (`source: { demo-manual: true }`, `demo: true`) for products common in Senegal that the BDPM import does not cover: `sp` (SP, sulfadoxine-pyrimethamine), `asaq` (ASAQ, artesunate-amodiaquine), `coartem` style artemether-lumefantrine generic, `cotrimoxazole-generic` (with brand Bactrim), `fer-acide-folique` (iron and folic acid), `quinine-generic`, `lightening-cream-clobetasol` (crème éclaircissante au clobétasol et hydroquinone), `misoprostol-generic`, `tle` (tenofovir, lamivudine, efavirenz), `tld` (tenofovir, lamivudine, dolutegravir), `cold-sachet-paracetamol` (sachet contre le rhume with paracetamol 500 mg, pheniramine, ascorbic acid), and one generic product per substance used by a rule (`<substance>-generic`, names "Paracétamol (générique)" etc.).
- BDPM import (`pnpm knowledge:import-bdpm <dir>`): reads the official BDPM files `CIS_bdpm.txt` and `CIS_COMPO_bdpm.txt` (download them from the official BDPM download page into the scratchpad, not the repository; record the download date), keeps marketed products ("Commercialisée") whose active substances all map to registry substances (mapping table in the script from BDPM substance labels to INN ids), for the substances above, keeps oral, cutaneous and rectal forms, parses strengths in mg, derives the brand from the first word(s) of the denomination, caps at 300 entries with a deterministic selection (sorted by substance then denomination; at most 15 per substance), and writes `registry/products/bdpm.yaml` with `source: { bdpm: <CIS> }`. Unit test on a small committed fixture of BDPM-format lines (synthetic lines written by you, clearly marked as test data). Add the BDPM download date to the `bdpm` entry of `sources.yaml`.

**Acceptance:** `pnpm knowledge:check` and `pnpm knowledge:build` pass; every rule cites at least one allowed source with a verbatim quote that you checked against the document; no LEDIAM or DDInter data; pack under 3 MB gzip; the PR lists each rule with its sources and states "not clinically validated".

- [ ] Steps: branch; registry (substances, classes, plants, manual products); BDPM import script test first, then run it; rules and messages, one rule at a time, running `pnpm knowledge:check` after each; danger signs; reminders and notes if sourced; regenerate NOTICE; full verification; PR `feat(knowledge): add the starter rules, remedies and registry`, `Refs: SCRUM-20`.

---

### Task 7 (SCRUM-29): local name resolver and evaluation set

Branch `feat/SCRUM-29-name-resolver`. Depends on Task 6 (uses the real registry for evaluation).

**Files:**
- Create: `resolver/src/types.ts`, `resolver/src/trigrams.ts`, `resolver/src/distance.ts`, `resolver/src/index-build.ts`, `resolver/src/search.ts`, `resolver/src/from-pack.ts`; tests `resolver/test/*.test.ts`
- Modify: `resolver/src/normalize.ts` (spelling variants), `resolver/src/index.ts`
- Create: `eval/resolver/queries.yaml`, `eval/resolver/baseline.json`, `tools/knowledge/src/eval-resolver.ts`, root script `eval:resolver`, `resolver/README.md`
- Modify: `.github/workflows/ci.yml` (step `pnpm eval:resolver` in Build and test), `CHANGELOG.md`

**Interfaces:**
```ts
export type EntryKind = 'product' | 'plant';
export type NameLang = 'fr' | 'en' | 'wo' | 'latin' | 'brand' | 'inn';
export interface IndexEntry {
  id: string; kind: EntryKind; display: { fr: string; en: string };
  names: { text: string; lang: NameLang }[];
  priority: number;            // higher first on ties: brand products 3, generic products 2, plants 2, INN-only matches 1
  detail: string;              // for display: substances and strengths, e.g. "paracétamol 1000 mg"
}
export interface Candidate {
  id: string; kind: EntryKind; display: { fr: string; en: string }; detail: string;
  matched: string; matchedLang: NameLang; score: number; // score in [0, 1]
}
export interface ResolverIndex { readonly size: number }
export function normalize(text: string): string;            // existing, extended with spelling variants
export function buildIndex(entries: IndexEntry[]): ResolverIndex;
export function search(index: ResolverIndex, query: string, options?: { limit?: number; minScore?: number; kinds?: EntryKind[] }): Candidate[];
// defaults: limit 3, minScore 0.45; results sorted by score desc, priority desc, id asc; at most one candidate per id
export function damerauLevenshtein(a: string, b: string): number; // optimal string alignment
export function trigrams(text: string): Set<string>;            // with boundary padding
export function entriesFromPack(pack: {
  products: { id: string; names: { fr: string; en: string }; brands: string[]; localNames: { text: string; lang: 'fr' | 'wo' | 'en' }[]; components: { substance: string; strengthMg?: number }[] }[];
  plants: { id: string; latinName: string; names: { fr: string; en: string }; localNames: { text: string; lang: 'fr' | 'wo' | 'en' }[] }[];
  substances: { id: string; names: { fr: string; en: string } }[];
}): IndexEntry[];
```
Scoring: exact normalised match of a whole name 1.0; query is a prefix of a name (at least 3 characters) 0.9; otherwise the maximum over names of `0.5 * jaccard(trigrams) + 0.5 * (1 - dl / max(len))` computed on normalised strings, and also against each word of multi-word names. Spelling variants applied by `normalize` to both sides: `kh` to `x` is NOT applied (it changes meaning); instead `normalize` maps `ph` to `f`, `y` to `i`, doubled consonants to single, and strips a trailing `e` in words of more than 4 letters; document each rule with a test. The resolver never returns a level.

**Evaluation:** `eval/resolver/queries.yaml` with at least 100 queries, each `{ query, expect: { kind, id }, type }` where `type` is one of `brand`, `inn`, `misspelling`, `local-fr`, `local-wo`, `voice-like` (lowercase, no accents, split or merged words as a speech model would output). It must include `nebeday` to `moringa`, `doliprane` to a Doliprane product, `doliprann`, `ibuprofene`, `kinkeliba`, `kinkéliba`, `huile de ricin`, `bactrim`, `asaq`, `neo codion`. `pnpm eval:resolver` builds the pack in memory, runs every query, prints top-1 and top-3 accuracy per type and overall, and the p95 latency over 20 repetitions; it exits 1 if top-3 accuracy is below `baseline.json.top3` or p95 is above `baseline.json.p95Ms` (set `p95Ms` to 12 for the CI runner). Record the measured figures in the PR description.

- [ ] Steps: branch; failing tests for distance, trigrams, normalisation variants, scoring order, determinism, limit and minScore, kinds filter, `entriesFromPack` (product brands, INN names at priority 1, local names with language); implement; write queries; run the evaluation; set the baseline at the measured top-3 rounded down to two decimals (it must be at least 0.90; if lower, improve matching first); full verification; PR `feat(resolver): add the local name resolver and its evaluation set`, `Refs: SCRUM-29`.

---

### Task 8 (SCRUM-19): reference cases

Branch `test/SCRUM-19-reference-cases`. Depends on Tasks 6 and 7.

**Files:**
- Create: `eval/cases/*.yaml` (one file per case), `eval/schema/case.schema.json`, `tools/knowledge/src/cases.ts` (load and convert a case to an `EvaluationContext`), `tools/knowledge/test/reference-cases.test.ts`, `eval/cases/README.md`
- Modify: `CHANGELOG.md`

**Case format:**
```yaml
# SPDX-License-Identifier: CC-BY-4.0
id: case-01-ibuprofen-30-weeks
title: "Awa, 30 weeks, ibuprofen for back pain"
context:
  pregnancy: { weeks: 30 }          # or { months: 5 } or { unknown: true }
  breastfeeding: { baby-age-weeks: 1, premature: false }
  conditions: []
  items:
    - { product: ibuprofen-400 }    # or { plant: kinkeliba } or { unrecognised: "comprimés du marché" }; optional units-per-day, long-term
  signs: []
expect:
  level: before-next-dose
  findings:
    - { check: C1, rule: nsaid-pregnancy-from-20-weeks, level: before-next-dose, items: [0] }
  reminders: []
  notes: []
```
The test compares the full ordered list of findings (check, rule or message, level, items, sign, term) and the reminder and note rule ids with strict equality. Product ids in cases must exist in the registry (pick them from Task 6 files).

**Cases (from the dossier annex A; expected levels are the dossier's woman-mode levels):**
1. Ibuprofen, 30 weeks: before-next-dose (C1). Variants: 10 weeks (not the 20-plus rule; level per `nsaid-pregnancy-before-20-weeks` if it exists, otherwise unknown with no-finding); term unknown (C1 with `term: unknown`); 5 months (range 19 to 24, C1 with `term: estimated`).
2. Paracetamol 1000 mg 4 per day plus cold sachet with paracetamol 500 mg 3 per day, 16 weeks, fever: danger (fever sign, with the fever message) plus C6 duplicate plus C7 max-dose (if the rule exists).
3. 18 weeks, condition `hiv-cotrimoxazole`, long-term cotrimoxazole item, SP: before-next-dose (C8, one finding); the IPTp reminder (if it exists) is absent.
4. Breastfeeding a 10-day-old baby (1 week), Néo-Codion style codeine product: before-next-dose (C2).
5. Breastfeeding a 3-month-old, ASAQ plus moringa: next-contact (C4), evidence B.
6. 10 weeks, quinine plus bitter kola: before-next-dose (C4), evidence B.
7. 24 weeks, iron and folic acid plus clay: next-contact (C5 toxicity and C4 interaction findings).
8. 28 weeks, lightening cream with clobetasol and hydroquinone: before-next-dose (C1).
9. 39 weeks, condition `uterine-scar`, castor oil plus an unrecognised market tablet: danger (C5 `castor-oil-term-uterine-scar`) plus unknown (C12).
10. 14 weeks, kinkeliba, fever: danger (fever) plus unknown (no-finding for kinkeliba with message `kinkeliba`).
11. An unrecognised product alone, any context: unknown (C12).
12. Artemether-lumefantrine at 8 weeks: no finding above unknown (guard against outdated first-trimester warnings).
13. Low-dose aspirin 75 mg at 30 weeks: not flagged by `aspirin-analgesic-dose-pregnancy`; aspirin 500 mg at 30 weeks: flagged.
14. A woman not pregnant and not breastfeeding with ibuprofen: no pregnancy finding.

- [ ] Steps: branch; schema and loader with tests; write the cases; run; when a case fails, decide whether the content or the case is wrong by going back to the dossier expectation above, fix the content in this PR if needed and say so; full verification; PR `test(knowledge): add the blocking reference cases`, `Refs: SCRUM-19`; the PR description lists every case with its result.
