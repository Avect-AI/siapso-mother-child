# SIAPSO Mother-Child: implementation design

Status: approved for implementation on 2026-11-03 (the team asked for autonomous delivery, choosing the most rigorous option at each decision).
Scope: Jira SCRUM-15 to SCRUM-44. Product context: `PRODUCT.md`. Agent rules: `CLAUDE.md`.

This document is the single technical reference for every ticket. When a ticket and this document disagree, this document wins and the ticket is updated.

French interface sentences are quoted here without accents for brevity. The interface and the knowledge pack always use correct French spelling, with accents (for example "Allez au poste de santé maintenant.").

## 1. Delivery phases

| Phase | Tickets | Outcome |
| --- | --- | --- |
| 1 Foundation | SCRUM-15 monorepo and CI, SCRUM-16 visual direction | Workspace, CI gates, `DESIGN.md`, design tokens |
| 2 Knowledge and engine | SCRUM-18 engine, SCRUM-29 resolver, SCRUM-17 schema and pack build, SCRUM-21 provenance, SCRUM-20 starter content, SCRUM-19 reference cases | Deterministic engine and a signed-off-ready demo pack |
| 3 App | SCRUM-22 shell, SCRUM-23 profile, SCRUM-24 search, SCRUM-25 result, SCRUM-26 danger signs, SCRUM-27 accompanied mode, SCRUM-28 status and about | Installable offline app, keyboard journey complete |
| 4 Voice | SCRUM-30 browser model, SCRUM-31 voice input, SCRUM-32 evaluation, SCRUM-33 model card | Optional offline French and Wolof voice input |
| 5 Release | SCRUM-34 licences, SCRUM-35 open data, SCRUM-36 v0.1.0 | Demo release candidate |
| 6 MVP | SCRUM-38 signed packs, SCRUM-39 encrypted profiles, SCRUM-40 QR transfer, SCRUM-41 adverse event reports, SCRUM-37 API, SCRUM-43 DHIS2 export, SCRUM-42 lighter voice model, SCRUM-44 audit | MVP feature set, audit report |

Each phase ends with a live test round (section 12). One ticket is one branch and one pull request.

Work that needs people or accounts we do not have is delivered as far as code allows and reported plainly:

- clinical sign-off of rules (pharmacist and midwife): rules ship as "not clinically validated";
- volunteer voice recordings with consent (SCRUM-32): harness and public-dataset baseline only;
- Hugging Face publication (SCRUM-33) and hosting (SCRUM-36): scripts and instructions, publication by the team;
- ARP report format (SCRUM-41) and DHIS2 district mapping (SCRUM-43): provisional formats, clearly labelled;
- GPU fine-tuning with consented data (SCRUM-42): scripts and plan;
- making the repository public (SCRUM-44): the audit is done, the visibility change waits for the team.

## 2. Decisions on gaps and contradictions in the dossier

| Topic | Decision | Reason |
| --- | --- | --- |
| Red for medicines | Red (`danger`) is reserved for danger signs. A product rule may use `danger` only with a written `danger-rationale` (immediate vital risk); the starter base uses it once: castor oil at term with a uterine scar (reference case 9). | Arbitration "red = danger signs only", with the explicit committee exception of case 9. |
| ANSM interaction levels | Contre-indication and association deconseillee map to `before-next-dose`; precaution d'emploi and a prendre en compte map to `next-contact`. | Red is reserved; orange is the highest product level. |
| Evidence cap | A finding with evidence D, E or 0 is capped at `next-contact` unless the rule kind is `toxicity`. The pack build fails when a rule declares a level above its cap, so nothing is capped silently; the engine caps again as a second barrier. | Dossier rule, made explicit. |
| Evidence B at orange | Allowed (reference case 6). The "B to D" wording of the level table is descriptive, not a rule. | Only D, E and 0 are capped. |
| Composite evidence ("C/D for toxicity, E for interaction") | One rule per risk, each with one evidence level. | Keeps the cap computable. |
| Woman mode content | Shows all four levels, the level name and pictogram, the risk sentence without numbers, the orientation, the fixed sentences, the knowledge base version and "not clinically validated". Hides the detailed fact, the evidence level and the sources. | Dossier arbitration D1; the woman still sees the version. |
| Accompanied mode content | Everything in woman mode, plus fact, detailed risk, evidence level with its wording, sources, rule identifier, reminders and contraception information. | Dossier. |
| Known product, no rule triggered | Grey level with the "nothing found" message: "Rien n'a ete trouve dans notre base (version X du D). Cela ne veut pas dire que c'est sans risque. Montrez cet ecran a votre sage-femme ou a votre pharmacien." | Never implies safety; keeps four levels. |
| Fixed sentences | Every result ends with: "Ne changez rien a votre traitement sans en parler a un professionnel." then the version line, then "Cet outil ne remplace pas un soignant." | One canonical variant (annex C). |
| Wording | Allowed verbs: montrez, dites, parlez-en, demandez, allez, appelez (show, tell, talk, ask, go, call). Not used: "N'arretez rien", "Verifiez", "autorise" (they contain forbidden words). | Consistency with the forbidden list. |
| Forbidden words test | French: sur (the adjective sûr), sans danger, verifie, verifiez, arretez, ne prenez pas, remplacez, diminuez, prenez plutot, autorise, compatible. English: safe, harmless, verified, verify, stop, do not take, replace, reduce, take instead, authorised, authorized, compatible, no risk. Whole-word, accent-aware, case-insensitive, over every pack message and every interface string. "sans risque" is allowed only inside "ne veut pas dire que c'est sans risque" / "does not mean it is risk-free". | Dossier lists, applied to both languages. |
| Orange timing | Default orientation is "avant la prochaine prise" (before the next dose); a rule may give its own orientation (for example "dans les prochains jours", cases 6 and 8). | Cases 6 and 8. |
| Weeks | Weeks of amenorrhoea (SA). Windows: `lt12` (0 to 11), `12-19`, `20-29`, `30-plus`. | Clinical convention in Senegal and France. |
| Term input | Last menstrual period date, weeks, months, or unknown. Months and unknown give a range of weeks; the engine triggers every rule whose windows intersect the range (riskiest window per rule) and flags the finding "terme estime" or "terme inconnu". Month m covers weeks from 4.33 x (m - 1) + 2 to 4.33 x m + 2. Unknown is the range 0 to 42. | Solves "riskiest window when it differs per substance". |
| Breastfeeding | Baby age in weeks and a prematurity flag; rules may bound the age or require prematurity. | Dossier silent on bands. |
| Danger signs | One fixed list for everyone: the dossier list (fever, bleeding, convulsions, severe headache, baby no longer moving), the case signs (very strong abdominal pain; baby sleeps much more than usual, feeds poorly, breathes with difficulty), completed with WHO danger signs cited as fact-only sources. Every item carries its source and stays "not clinically validated" until the committee aligns it with the national list. | Missing a danger sign is the worst failure. |
| Current danger signs in a check | The check flow asks once "Has she one of these signs now?" before the result. | Cases 2 and 10 need the fever. |
| Paracetamol maximum (C7) | Optional "units per day" for products that have a maximum-dose rule; the engine sums strength x units per day per substance and compares with the threshold stored in the rule with its source. The message never states a dose. The paracetamol generic has strength variants (`paracetamol-500-generic`, `paracetamol-1000-generic`) in its resolver family, so the confirm screen can offer the strength. When units per day are given for a product of unknown strength, the engine adds the note `max-dose-not-computable` ("La quantite totale ne peut pas etre calculee sans le dosage. Montrez les boites a la sage-femme ou au pharmacien."), shown in both modes, never a level. | MVP check without giving doses; the default path (typing "paracetamol") must not silently skip the check. |
| Preventive calendar (C10) | Reminders ("demandez si vous avez recu...") are separate from levels and shown in accompanied mode only; the IPTp reminder is never shown to a woman living with HIV on cotrimoxazole: neither when the condition `hiv-cotrimoxazole` is entered nor when a checked item contains sulfamethoxazole (rule key `unless-with`, reference case 15). | Dossier; a woman may enter her cotrimoxazole as a medicine without the condition. |
| Contraception (C9) | General information notes only (formulation 8), accompanied mode only, never a verdict. | Decree 2023-2419. |
| Codes | Every profile has a 4 to 6 digit code. Five wrong attempts lock for 30 seconds, doubling each time. Auto-lock after 2 minutes without interaction. Quick exit locks immediately and shows a neutral screen. | Shared phones; mobile money users know 4-digit codes. |
| App name on the home screen | Build-time setting, default "Carnet" (neutral) with a neutral icon. | Dossier asks for a neutral name. |
| Phone numbers | None in the repository. Referral contacts are entered on the phone in accompanied mode, or provided by a deployment file `referral.json` that is not committed (an example file is). | Ticket SCRUM-26. |
| Open data threshold | A cell is published only when its count is greater than 10. | Literal reading of "au-dela de 10", the stricter option. |
| Server stack | One Node.js service in TypeScript that imports the same engine package. No FastAPI layer. | Parity by construction, one runtime, fewer moving parts. The dossier's FastAPI gateway can be added in front later without changing the engine. |
| Signing | Ed25519 with `@noble/ed25519` (works on older Android browsers where WebCrypto Ed25519 is missing). | Dossier lists noble-ed25519. |
| Profile encryption | PBKDF2-SHA-256 (600 000 iterations) from the code, AES-GCM 256 data keys, envelope encryption so an accompanying person's code opens the profiles she holds. The threat model (casual access on a shared phone, not a forensic attacker) is documented. | Ticket SCRUM-39. |
| Interface languages | French and English. Wolof is supported in names and voice input, not as interface text. | Team decision; Wolof written interface undecided. |

## 3. Repository and packages

pnpm workspace, TypeScript strict everywhere, ES modules.

| Path | Package | Role | Depends on |
| --- | --- | --- | --- |
| `engine/` | `@siapso/engine` | Pure evaluation: types, `evaluate`, pack loading. No runtime dependency, no clock, no randomness, no I/O. | none |
| `resolver/` | `@siapso/resolver` | Name normalisation, trigram index, Damerau-Levenshtein, ranked candidates. No runtime dependency. | none |
| `tools/knowledge/` | `@siapso/pack-tools` (private) | Authoring schema, YAML loading, validation, provenance check, pack build, NOTICE generation, reference-case runner. | engine, resolver |
| `knowledge/` | content (CC BY 4.0) | `rules/*.yaml`, `messages/*.yaml`, `danger-signs.yaml`, `sources.yaml`, `pack.yaml`, `schema/*.schema.json` | none |
| `registry/` | content (CC BY 4.0) | `substances.yaml`, `classes.yaml`, `products/*.yaml`, `plants/*.yaml` | none |
| `eval/` | content (CC BY 4.0) | `cases/*.yaml` (reference cases), `resolver/` (name queries), `speech/` (voice evaluation) | none |
| `app/` | `@siapso/app` | React PWA | engine, resolver, speech |
| `speech/` | `@siapso/speech` | Browser speech worker, audio capture, model card, conversion scripts (`speech/convert/`, Python) | `@huggingface/transformers` |
| `server/` | `@siapso/server` | Reference HTTP API (phase 6) | engine |
| `open-data/` | content (CC BY 4.0) | Field dictionary and aggregated CSV | none |
| `docs/` | content (CC BY 4.0) | Architecture, testing guide, DPG mapping, threat model | none |

Toolchain (versions pinned exactly; every dependency at least 14 days old when added; pnpm `minimumReleaseAge` set to 20160 minutes): Node 24 LTS in CI (local Node 26 is accepted), pnpm 12.14, TypeScript 6.0, Vite 8, React 19, vite-plugin-pwa 2, Vitest 5 with V8 coverage, ESLint 10 with typescript-eslint, Prettier, Playwright for end-to-end tests, `@axe-core/playwright` for accessibility. GitHub Actions are pinned by commit SHA with a version comment.

## 4. Knowledge model

### 4.1 Authoring format (YAML, validated by JSON Schema 2020-12)

Registry:

- `substances.yaml`: `id` (INN, kebab-case), `names` (`fr`, `en`), `classes` (class ids).
- `classes.yaml`: `id`, `names`, `excludes` (required, possibly empty: substance ids left out of the class, for example low-dose aspirin rules later).
- `products/<id>.yaml`: `id`, `names` (`fr`, `en`), `brands` (list: the brand of a branded product, or the brands people use for a generic, such as Coartem for artemether-lumefantrine), `local-names` (list of `text`, `lang` in `fr|wo|en`, `checked` boolean: validated by a speaker), `components` (at least one; `substance`, `strength-mg` optional), `form`, `route`, `source` (`bdpm` with CIS code, or `demo-manual`), `demo` boolean. `registry/products/bdpm.yaml` is a generated list of products.
- `plants/<id>.yaml`: `id`, `latin-name`, `names`, `local-names`, `parts`, `evidence` (overall), `message` (default message id for the grey state), `sources`.

Knowledge:

- `rules/<id>.yaml`: `id`, `kind` (`pregnancy`, `breastfeeding`, `interaction`, `herb-drug`, `toxicity`, `duplicate`, `max-dose`, `condition`, `reminder`, `contraception-info`), `when` (match, below), `level`, `evidence`, optional `danger-rationale`, `message` (message id), `sources` (list of `source` id from `sources.yaml`, `locator` (record title), `url`, `accessed` date, optional `quote`), `review` (`status` `draft|validated`, `reviewers` list of name and role, `reviewed-on`). A rule has no `licence` field: every content file is CC BY 4.0 through its first line `# SPDX-License-Identifier: CC-BY-4.0`.
- `when` keys (kebab-case, mapped to the engine `RuleWhen` of section 5.1): `subject` (`{ substance }`, `{ class }` or `{ plant }`, exactly one key; required except for `reminder`), `requires` (non-empty any-of list of `{ with: <subject> }`, another item, or `{ condition: <id> }`; an `interaction` or `herb-drug` rule needs a `with`), `unless-conditions` (the rule does not apply when one of these conditions is present), `unless-with` (non-empty list of subjects: the rule does not apply when any item matches one), `strength-above-mg` (substance subject only, not on `max-dose` or `duplicate`), `max-mg-per-day` (required for `max-dose`, only there), `pregnancy-windows` (non-empty list of window ids), `breastfeeding` (`baby-age-weeks-max`, `premature`).
- `messages/<id>.yaml`: per language `fr` and `en`: `fact`, `risk` (no numbers), optional `risk-detail` (may hold numbers, accompanied mode), optional `orientation` (overrides the level default).
- `danger-signs.yaml`: `id`, `group` (`pregnancy`, `postpartum`, `baby`), `label` (`fr`, `en`), `sources`.
- `sources.yaml`: `allowed` (id, name, publisher, licence, version or download date, url, notice text), `fact-only` (WHO documents: may support a fact, never copied text), `forbidden` (DDInter, LEDIAM, e-lactancia, CRAT, Theriaque, Vidal, full DrugBank: with the reason).
- `pack.yaml`: `version` (semver), `date` (ISO date of the content freeze), `clinically-validated: false`.

Condition ids: `hiv-cotrimoxazole`, `tuberculosis-treatment`, `epilepsy-treatment`, `uterine-scar`, `renal-failure`, `hepatic-failure`, `sickle-cell`.

### 4.2 Build and runtime pack

`pnpm knowledge:build` validates every file, checks provenance (every rule cites at least one `allowed` source, no `forbidden` id or domain appears anywhere), checks the evidence cap and the danger rationale, checks message ids and forbidden words, then writes `app/public/pack/`:

- `manifest.json`: `schema` (integer), `version`, `date`, `clinicallyValidated`, `counts`, `fragments` (path, sha256, bytes);
- fragments, in this order (`PACK_FRAGMENTS` of `@siapso/pack-tools`; a test of the app checks that its loader asks for exactly these): `substances.json`, `classes.json`, `products.json`, `plants.json`, `rules.json`, `danger-signs.json`, `sources.json`, `messages.fr.json`, `messages.en.json`;
- `pack.json`: the whole pack in one file, for tools and tests (not listed in the manifest).

There is no resolver index file: the app builds the resolver index on the device from the products, plants and substances of the pack.

The runtime format is typed by `@siapso/engine` (`Pack`); the build script is typed against it, but only in part. Type-checked: the products and plants (each field is mapped explicitly), the metadata (`version`, `date`, `clinicallyValidated`), the sources, and the keys of a rule `when` (a test compares the keys of the rule schema with `RULE_WHEN_KEYS`, which the engine types by `RuleWhen`). Checked at runtime only, by `parsePack` on the built pack (the build fails, naming the file): the messages, the top level of a rule (these are cast to `Rule`, `Message` and `DangerSign` after the camelCase conversion), and the danger signs. So a change to one of those engine types needs the matching schema and tests to be updated by hand. The build is deterministic (no clock: version and date come from `pack.yaml`); building twice gives identical bytes. Budget: under 3 MB gzip. The build also generates `NOTICE` from `sources.yaml`.

## 5. Engine

### 5.1 Contract

```ts
type Level = 'danger' | 'before-next-dose' | 'next-contact' | 'unknown';
type Evidence = 'A' | 'B' | 'C' | 'D' | 'E' | '0';
type WindowId = 'lt12' | '12-19' | '20-29' | '30-plus';
type TermPrecision = 'exact' | 'estimated' | 'unknown';

interface EvaluationContext {
  pregnancy?: { weeksMin: number; weeksMax: number; precision: TermPrecision };
  breastfeeding?: { babyAgeWeeks?: number; premature?: boolean };
  conditions: ConditionId[];
  items: CheckedItem[];      // confirmed by the user; long-term treatments included with longTerm: true
  signs: DangerSignId[];     // danger signs present now
}
type CheckedItem =
  | { ref: { kind: 'product' | 'plant'; id: string }; unitsPerDay?: number; longTerm?: boolean }
  | { ref: { kind: 'unrecognised'; text: string } };

interface Finding {
  level: Level;
  check: CheckId;            // C1 to C12
  ruleId?: string;
  evidence?: Evidence;
  items: number[];           // indexes into context.items
  message: string;           // message id
  term?: TermPrecision;      // set when a pregnancy window matched on a range
  capped: boolean;
  sources: SourceRef[];
}
interface Evaluation {
  level: Level;              // highest finding level
  findings: Finding[];       // sorted: level (danger first), then check, then rule id
  reminders: Reminder[];     // C10, accompanied mode only
  notes: Note[];             // C9 (kind 'contraception', accompanied mode only) and max-dose-not-computable (kind 'dose', both modes)
  pack: { version: string; date: string; clinicallyValidated: boolean };
}
interface Reminder { ruleId: string; message: string; sources: SourceRef[] }
interface Note extends Reminder { kind: 'contraception' | 'dose' }  // the app filters on kind
function evaluate(pack: Pack, context: EvaluationContext): Evaluation;

type Subject = { substance: string } | { class: string } | { plant: string };
interface RuleWhen {
  subject?: Subject;                // required for every kind except reminder
  requires?: ({ with: Subject } | { condition: ConditionId })[]; // any-of
  unlessConditions?: ConditionId[]; // the rule does not apply when one is present
  unlessWith?: Subject[];           // reminder and contraception-info only: the rule does not apply when any item matches one
  pregnancyWindows?: WindowId[];
  breastfeeding?: { babyAgeWeeksMax?: number; premature?: boolean };
  maxMgPerDay?: number;             // max-dose only
  strengthAboveMg?: number;         // substance subject only
}
```

Level order: `danger` > `before-next-dose` > `next-contact` > `unknown`.

### 5.2 Checks

| Check | Behaviour |
| --- | --- |
| C1 pregnancy | Applies only to a pregnancy context; rule windows (all windows when none are listed) intersect the windows covered by the context range. |
| C2 breastfeeding | Applies only to a breastfeeding context, within its age bound and prematurity requirement. |
| C3 interaction | Subject and `with` both present among distinct items; a rule without a `with` partner is rejected. |
| C4 herb-drug | Same as C3 with a plant subject and a medicine partner. |
| C5 toxicity | Subject present, context conditions met; not capped by evidence. |
| C6 duplicate | Two or more distinct items share a substance (or a class) that has a duplicate rule. |
| C7 maximum dose | The known sum over items of strength-mg x units-per-day for the substance is greater than the rule threshold, even if some items lack a unit count or a strength (a known partial sum above the threshold is a certain excess); skipped only when the known sum is at or below the threshold. When the rule could apply and an item holding the substance has units per day but no strength, a note `max-dose-not-computable` (kind `dose`) is added (one per rule), never a level; it is not added when the same rule already triggered C7 (the finding is enough, and the note would contradict it). |
| C8 condition | Subject present and one of the conditions (or the `with` item) present. |
| C9 contraception | Produces a note (kind `contraception`), never a level. |
| C10 calendar | Produces a reminder, never a level. |
| C11 danger signs | Each present sign gives a `danger` finding with the standard danger message. |
| C12 not found | Each unrecognised item gives an `unknown` finding with the "not recognised" message. |

A product or plant with no finding gives an `unknown` finding: plants use their own grey message (evidence 0 wording); products use "nothing found". A plant with evidence 0 and no rule always gives grey.

### 5.3 Guarantees (tested)

- An unrecognised item always yields `unknown`, whatever else is present.
- No input yields a level outside the four levels; there is no "safe" output.
- Same inputs, same output (pure, deterministic order).
- Unknown term triggers every pregnancy rule for the substance.
- Invalid numbers in the context (non-finite or negative baby age, non-positive units per day) raise an error instead of silently lowering a level; the app validates input before calling the engine.
- Evidence D, E, 0 never exceeds `next-contact` except `toxicity`.
- Coverage of `engine/` at least 90 percent (lines, branches, functions, statements).

## 6. Resolver

- Normalisation: lowercase, NFD with diacritics removed, every character that is not a letter or a digit (apostrophes, hyphens) to a space, collapse spaces, then per word: `ph` to `f`, `y` to `i`, a doubled consonant to one, a trailing `e` dropped in words of more than 4 letters. `kh` is not mapped to `x`: it would change the meaning of Wolof names (dakhar stays dakhar).
- Stop-words: the words of pharmaceutical forms and packaging, and the generic words medicament and emplatre (comprime, pellicule, secable, effervescent, orodispersible, gelule, capsule, sirop, solution, suspension, buvable, poudre, sachet, granules, creme, pommade, gel, collyre, suppositoire, injectable, ampoule, flacon, medicament, medicaments, medicamenteux, emplatre, emplatres, and English tablet, capsule, syrup, cream and the like, accented or not) are removed from indexed names and from the query; a query made only of stop-words gets no candidate.
- Age words (adulte, enfant, nourrisson and their plurals, and English adult, child, infant) are not stop-words but carry no match weight: they are removed from the name before scoring, and a query made only of them gets no candidate. A query word that matches an age word of a product makes that product's variant the candidate of its family ("doliprane enfant" returns a children's Doliprane first when the registry has one); a typed strength comes first.
- Prefixes: a query is a prefix of a whole name from 3 characters, but a prefix of one word inside a multi-word name (and a fuzzy match on one word of it) only from 4, so that a short common word ("sel") does not reach a product through the start of a longer word.
- Index: every brand, INN, French and English name, local name (with language) of products, substances and plants. A strength in the query ("1 g", "500", "0,5 g") is read apart and not matched as a name.
- Families: one candidate per family (the brand of a branded product, the sorted substances of a generic, the plant), with the other products of the family as `variants`, strength ascending, for the confirm screen. A product whose name starts with its first brand is a branded product; the brands of a generic are other names of it, so an INN query still lists the generic first. In a family of generics, the product without strength stands for the family when the query gives none (`paracetamol-generic`, with variants `paracetamol-500-generic` and `paracetamol-1000-generic`); a typed strength selects the matching product.
- Scoring: exact normalised match, then whole word, then prefix, then trigram similarity (Jaccard) combined with Damerau-Levenshtein (optimal string alignment) distance normalised by length; ties broken by a matching strength, single-substance before combination, entry priority (product brands before substances) and then by id for determinism.
- Output: at most 3 candidates with kind, id, family, variants, display name, detail, matched name and its language, score. Candidates below 0.55, or below 0.8 times the best candidate's score, are dropped; with no candidate left the app offers "Produit introuvable".
- Never decides a level.
- Evaluation: `eval/resolver/queries.yaml` (query, expected ids, kind of query: brand, inn, misspelling, local-fr, local-wo, voice-like transcription, and noise, a form, a colour, a generic word or a short common word alone that must get no candidate); `pnpm eval:resolver` reports top-1 and top-3 accuracy and p95 latency; the CI fails below the recorded baseline, or on an empty query file, an invalid baseline or a measure that is not a number.
- Target: under 50 ms per query on an entry-level phone (measured in CI on the runner with a 4x CPU slowdown factor applied to the budget: 12 ms on the runner).

## 7. App

### 7.1 Screens

1. Welcome: language (Francais, English) then mode ("Je suis enceinte ou j'allaite" / "J'accompagne des femmes").
2. Code: create or enter the code (numeric keypad, large keys).
3. Profiles (accompanied mode): list of pseudonyms, add, quick exit.
4. Profile: pregnancy (LMP date, weeks, months, unknown; computed term shown and editable), breastfeeding (baby age, premature), long-term situations (HIV with cotrimoxazole, tuberculosis treatment, epilepsy treatment, uterine scar; renal failure, hepatic failure, sickle cell in accompanied mode).
5. Check: list of items being checked; "Ajouter un medicament" and "Ajouter un remede" (tabs), voice button in phase 4; primary action "Voir le resultat".
6. Search: input with live candidates (max 3, with substances and strength), "Produit introuvable".
7. Confirm: candidate details, "Oui, c'est ce produit" / "Non"; optional units per day for products with a maximum-dose rule.
8. Danger signs now: checklist with "Aucun de ces signes" as the first, explicit choice.
9. Result: headline level (name, pictogram, colour), one card per finding, reminders and notes (accompanied mode), fixed sentences, version line, "non valide cliniquement".
10. Danger signs (reachable in one tap from every screen through the header): the fixed list and the referral circuit with call buttons.
11. Knowledge base status and About: version, date, rule count, "base perimee" warning after 90 days, intended use, disclaimer, licences, sources, repository link.

Navigation: hash routes, browser back works everywhere, one primary action per screen, the danger signs button and quick exit always visible after unlock.

### 7.2 Storage, offline, i18n

- IndexedDB (`idb`): pack (current and previous), profiles, settings. `navigator.storage.persist()` requested after the first profile is created.
- Service worker (vite-plugin-pwa, generateSW): precache of the app shell, fonts and pack; update prompt instead of silent reload. Voice files are cached separately (Cache API) only when the user installs the voice pack.
- i18n: typed dictionaries `fr.json` and `en.json`; a test fails if keys differ or a string contains a forbidden word, an em dash or an emoji. The chosen language is stored.
- Budget: app (JS, CSS, fonts, icons) under 1.5 MB uncompressed, checked in CI; pack and voice excluded.

### 7.3 Design and accessibility

- `DESIGN.md` and `app/src/styles/tokens.css` from SCRUM-16 (impeccable `shape`, `critique`, `audit`, `detect`).
- Level colours: red, orange, yellow, grey; never green; each level has a distinct pictogram shape and its name in text.
- WCAG 2.2 AA contrast for every text and background pair (tested), 48 px touch targets, 360 px minimum width, readable in sunlight, no gesture-only action, focus visible, screen reader labels.

## 8. Voice (phase 4)

- Model: `M9and2M/whisper-small-wolof` (MIT), converted to ONNX for Transformers.js with a reproducible script (`speech/convert/`, Python virtual environment, optimum), 8-bit weights. French quality is measured; if the Wolof fine-tune degrades French below a usable level, the French option uses the multilingual Whisper base model (MIT) instead, and the card says so.
- Runtime: Transformers.js in a dedicated Web Worker, WebAssembly backend (WebGPU when available). Audio captured with `getUserMedia`, resampled to 16 kHz mono, kept in memory only, never stored or sent.
- Voice pack: optional download with progress, stored in the Cache API, from a configurable base URL (default: same origin `/voice/`). Keyboard search works without it.
- Flow: hold or tap the microphone, transcribe, pass the text to the resolver, show candidates for confirmation; if no candidate, ask to type or pick from the list. No level without confirmation.
- Evaluation: `eval/speech/` with a manifest format for consented recordings, a script for word error rate and name accuracy after resolution, and a baseline on the Wolof FLEURS test split (CC BY 4.0). Volunteer recordings are added by the team.

## 9. Phase 6 components

- Signed packs (SCRUM-38): the manifest is signed (Ed25519, detached signature `manifest.sig`); public keys embedded in the app; the private key is never in the repository (GitHub secret for CI builds, offline file for releases). The app verifies before activation, refuses a version lower than the active one, fetches only fragments whose hash changed, keeps the previous pack for rollback.
- Encrypted profiles (SCRUM-39): see section 2; contraception history hidden by default.
- QR transfer (SCRUM-40): profile encrypted with a one-time transfer code (AES-GCM, PBKDF2), payload prefixed `SIAPSO1:` and base64url encoded, size checked against QR capacity; scanning with `BarcodeDetector` when present, otherwise a JavaScript decoder.
- Adverse event reports (SCRUM-41): minimal form (product or remedy, pregnancy term or breastfeeding, event, date, seriousness), no causality assessment, explicit consent, stored locally, exported as JSON and CSV in a provisional format to be confirmed with ARP; never sent automatically and never presented as care.
- API (SCRUM-37): `POST /v1/evaluate` (body: `pack_version`, `context`), `GET /v1/pack`, `GET /v1/health`; API keys in `Authorization: Bearer`, hashed at rest, per-key quotas; OpenAPI 3.1 document; no identifying field accepted (the schema rejects unknown fields); parity test runs every reference case through the API and the library and compares outputs.
- DHIS2 export (SCRUM-43): monthly aggregates per district in `dataValueSets` JSON, with a mapping file for data element and org unit identifiers (no invented identifiers), same suppression rule as open data.
- Open data (SCRUM-35): weekly counts per region (checks, findings per level, share of grey, unrecognised names), field dictionary, suppression of cells of 10 or fewer, test data labelled as such.
- Lighter voice model (SCRUM-42): distillation and quantisation scripts and an evaluation protocol; training needs a GPU and consented data.
- Audit (SCRUM-44): full-history secret and licence scan, report in `docs/audit/`.

## 10. Messages

- Every rule message has a fact, a risk (no numbers) and optionally a detailed risk and an orientation, in French and English.
- Default orientation per level (French; English equivalents in the pack):
  - danger: "Allez au poste de sante maintenant."
  - before-next-dose: "Montrez ce produit a la sage-femme, a l'infirmier ou au pharmacien avant la prochaine prise."
  - next-contact: "Dites-le a la sage-femme a la prochaine visite."
  - unknown: "Nous n'avons pas d'information fiable. Cela ne veut pas dire que c'est sans risque." then "Montrez-le a votre sage-femme ou au pharmacien."
- Evidence wording (accompanied mode): A "peut provoquer", B "une etude chez des volontaires a montre", C "des cas graves ont ete rapportes", D "des tests en laboratoire suggerent, ce n'est pas prouve chez la femme", E "c'est possible, mais cela n'a pas ete etudie", 0 "pas d'information fiable".
- No message names misoprostol (its rule message speaks of "a substance that makes the womb contract"), and no message or interface string gives a dose, suggests an alternative product or says a plant cures. A product the user found and confirmed keeps its own name on the result screen, even when that name contains misoprostol or is one of its brands (Cytotec): the user must recognise what she entered.

## 11. Quality gates

- Unit tests (Vitest) for engine, resolver, pack tools, app logic; component tests with Testing Library.
- Reference cases (`eval/cases/`): the 10 annex cases plus the unknown-product case and term variants, each with the expected level, check ids, rule ids and message ids. Any change in output fails CI; expectations change only by editing the case file in a reviewed pull request.
- Content gates: schema, provenance, forbidden sources, evidence cap, danger rationale, message completeness in both languages, forbidden words.
- End-to-end (Playwright, Chromium, mobile viewport 360 x 800): woman journey, accompanied journey, danger signs from every screen, offline after first load (context offline and reload), language switch, axe accessibility scan with zero serious or critical violations.
- Budgets: app size, pack size, resolver latency.
- CI workflow `ci.yml`: install (frozen lockfile), lint, type check, unit tests with coverage, `pnpm knowledge:check`, resolver evaluation, build, then `git diff --exit-code` (the build must not change a committed file such as `NOTICE`), app budget, end-to-end. Existing `hygiene.yml` stays. All checks must pass before `tools/github/merge-pr.sh` merges: it waits until the four required checks "Text hygiene", "Developer Certificate of Origin", "Build and test" and "End-to-end" are reported, and merges only when each of them passed (a skipped or missing required check blocks the merge, except the Developer Certificate of Origin check of a Dependabot pull request, which `hygiene.yml` skips by design; other checks must pass or be skipped). `tools/github/merge-pr.test.sh` tests the script with a fake `gh` in CI, after `shellcheck`.

## 12. Delivery process

For each ticket: implementer agent on its own branch with test-driven development, signed-off Conventional Commits with `Refs: SCRUM-<n>`; pull request with the template; a specification review and a code quality review by separate agents; fixes; merge with `tools/github/merge-pr.sh` once CI is green; Jira ticket moved to Done with the pull request link.

At the end of each phase, a live test round: several agents each play a real user (Bajenu Gox in accompanied mode using Wolof names, a literate woman alone on a 360 px phone, a midwife creating profiles at an antenatal visit, a pharmacy depot keeper at a sale, a safety auditor who tries to obtain a "safe" or green answer, an accessibility auditor, an airplane-mode tester) and drive the production build with Playwright. Findings are triaged, fixed in follow-up pull requests, and the round is repeated until no blocking finding remains. The Playwright MCP server is configured for the team in `.mcp.json`.

Testing on a phone in airplane mode needs HTTPS or localhost: `docs/testing.md` describes USB port forwarding (Chrome remote debugging, private) and a temporary HTTPS tunnel, then airplane mode after the first load.
