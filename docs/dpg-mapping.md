<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Digital Public Goods Standard mapping

This page maps SIAPSO Mother-Child to the indicators of the [Digital Public Goods Standard](https://digitalpublicgoods.net/standard/), with the evidence that exists in this repository and what is still pending. It is a self-assessment prepared by the team, not a submission and not a certification. No application to the Digital Public Goods Alliance has been made.

Source of the indicator list: the official standard page (nine indicators; indicator 9 has three parts, 9a, 9b and 9c), read on 2026-11-05. The requirement wording below is taken from the standard text in the Digital Public Goods Alliance repository (https://github.com/DPGAlliance/DPG-Standard), whose `standard.md` header says version 1.1.4 while its README says 1.1.6 (4 September 2024): check the current version at submission time.

Overall status: **not ready to apply.** The repository is public since 2026-11-10, but the clinical content is not validated, and several statements need an authorised person from AVECT AI SARL.

| #   | Indicator (official name)         | Status  |
| --- | --------------------------------- | ------- |
| 1   | SDG Relevance                     | Partial |
| 2   | Open Licencing                    | Partial |
| 3   | Clear Ownership                   | Partial |
| 4   | Platform Independence             | Partial |
| 5   | Documentation                     | Partial |
| 6   | Mechanism for Extracting Data     | Partial |
| 7   | Privacy and Applicable Laws       | Pending |
| 8   | Standards and Best Practices      | Partial |
| 9   | Do No Harm by Design (9a, 9b, 9c) | Partial |

## 1. SDG Relevance

Requirement: show how the project advances the UN Sustainable Development Goals.

Evidence in this repository:

- `PRODUCT.md` states the purpose: safer use of medicines and traditional remedies during pregnancy and breastfeeding, and referral to a health worker, in rural Senegal.
- The relevant goal is SDG 3 (good health and well-being), in particular maternal and child health.

Pending:

- A short SDG statement with the target numbers chosen by the team (`<to be completed by the team>`), to be added to the README at publication.
- Indicators of use and of health outcome do not exist yet; none is claimed.

## 2. Open Licencing

Requirement: an approved open licence (OSI-approved for software, Creative Commons for content, Open Data Commons for data).

Evidence:

- `LICENSE` (MIT, AVECT AI SARL) for code and the JSON Schemas; CC BY 4.0 for content (`knowledge/`, `registry/`, `eval/`, `open-data/`, `docs/`).
- `REUSE.toml` declares the licence of every file (REUSE specification 3.3); `LICENSES/` holds the SPDX texts (MIT, CC-BY-4.0, OFL-1.1, Apache-2.0); `reuse lint` runs in CI.
- Third-party files are identified: the self-hosted font Atkinson Hyperlegible Next (OFL-1.1), the impeccable design plugin (Apache-2.0, with two MIT parts), one CC BY 4.0 audio fixture. See `THIRD_PARTY_NOTICES.md`.
- `NOTICE` is generated from `knowledge/sources.yaml` and lists the sources of the knowledge pack with their licences. Sources with restrictive licences (for example WHO documents under CC BY-NC-SA 3.0 IGO) are used for facts only, no text is copied.

Pending:

- The repository is still private. The standard needs the licence to be publicly visible.
- Open question on the speech model chain: the Wolof fine-tune declares MIT, but one of its training datasets (WAXAL Wolof) is CC BY-SA 4.0 (share-alike), and the ALFFA Wolof audio has no stated data licence (`speech/LICENSES.md`, `speech/MODEL_CARD.md`). Whether weights trained on share-alike data must be released under the same licence is a legal question not answered yet. A lawyer should answer it before publication.
- A review that the content licences are compatible with the cited sources (done in `knowledge/sources.yaml` for the pack; to be repeated before each release).

## 3. Clear Ownership

Requirement: document who owns the assets the project produces (copyright, trademark).

Evidence:

- Copyright holder AVECT AI SARL in `LICENSE`, `NOTICE` and `REUSE.toml`.
- `TRADEMARKS.md`: the names SIAPSO and SIAPSO Mère-Enfant belong to AVECT AI SARL; forks must rename.
- Every commit is signed off under the Developer Certificate of Origin (`CONTRIBUTING.md`, checked in CI).

Pending:

- Confirmation by the company that it owns the contributions of all authors (employment or contribution terms): `<to be completed by the team>`.
- A trademark registration, if the team wants one: none exists and none is claimed.

## 4. Platform Independence

Requirement: no mandatory closed dependency that adds restrictions beyond the project licence.

Evidence:

- The app is a web app (PWA) built on open source components; the rules engine is pure TypeScript with no service dependency; the app works offline.
- Dependencies are pinned and listed in `docs/dependencies.md`; the speech model runs in the browser from open files (`docs/voice.md`).
- No cloud service is needed to run the app. No TerangaHealth component is used.

Pending:

- Hosting for the demo is not chosen; it must be a static host, replaceable without code change.
- A licence audit of the full dependency tree (production dependencies only) before publication.

## 5. Documentation

Requirement: documentation that lets an unfamiliar technical person launch and run the project; for a dataset, field descriptions and method.

Evidence:

- `README.md` (layout, development), `CONTRIBUTING.md`, `CLAUDE.md` (commands and rules), `docs/testing.md`, `docs/voice.md`, `docs/dependencies.md`, `knowledge/README.md` (rule format, sources policy), `speech/MODEL_CARD.md`.
- Reference cases in `eval/cases` document the expected behaviour of the engine.

Pending:

- Field dictionary for `open-data/` in `open-data/fields.md`, method and rules in `open-data/README.md`.
- An architecture overview and a roadmap page (neither is written yet).
- Documentation in French for field users.

## 6. Mechanism for Extracting Data

Requirement: for non-personal data, export and import in a non-proprietary format.

Evidence:

- The knowledge base (rules, registry, messages, sources) is stored as YAML and JSON Schema files and built into a plain JSON pack with a manifest and checksums (`knowledge/README.md`, `siapso-pack`).
- The pack is public under CC BY 4.0 once the repository is.

Pending:

- Aggregated open data (`open-data/`): CSV and JSON Schema, with small cells suppressed. The mechanism and a synthetic test file exist; no real data is published because the app does not send events yet.
- No export of a user profile is offered; by design no personal data leaves the phone by default. Whether a user export is wanted is a product decision for the team.

## 7. Privacy and Applicable Laws

Requirement: design the project to comply with privacy and other applicable laws; a statement of compliance by a person authorised to speak for the project.

Evidence:

- By design no personal data leaves the phone by default; profiles are pseudonymous and protected by a code (`PRODUCT.md`, `CLAUDE.md`).
- Voice recordings for evaluation follow a consent protocol (`eval/speech/README.md`, consent forms in French and English) and wait for the opinion of the national ethics committee (CNERS).

Pending:

- The statement of compliance with the Senegalese personal data law (Loi 2008-12) and the data protection authority (CDP) formalities, signed by an authorised person: `<to be completed by the team>`. No such statement exists today.
- A written privacy notice in the app.
- The ethics opinion (CNERS) for any recording of people.

## 8. Standards and Best Practices

Requirement: documented alignment with relevant standards and best practices.

Evidence:

- Conventional Commits, Semantic Versioning, Keep a Changelog, REUSE/SPDX, Developer Certificate of Origin.
- Accessibility: WCAG-oriented design tokens with tested contrast and automated axe checks in the end-to-end tests (`DESIGN.md`, `docs/testing.md`).
- Open standards: PWA, JSON Schema, YAML.
- Provenance of every clinical rule to an allowed source, with evidence levels (`knowledge/sources.yaml`, `siapso-pack check`).

Pending:

- Alignment of the danger signs with the national list of Senegal (the clinical committee must do it).
- Any interoperability standard (for example HL7 FHIR, WHO SMART guidelines) is not implemented; none is claimed.

## 9. Do No Harm by Design

Requirement: anticipate, prevent and avoid harm; evidence provided by an authorised representative.

Evidence:

- `MEDICAL_DISCLAIMER.md` and `docs/intended-use.md`: general information only, no diagnosis, no prescription, no dose.
- Safety by construction: unknown never means safe (grey state), the app never says "safe", never tells anyone to stop, start or change a treatment, and the deterministic engine, not a model, sets the alert level (`CLAUDE.md`, `PRODUCT.md`).
- `GOVERNANCE.md`: clinical double review by a pharmacist and a midwife before any rule is marked validated, withdrawal of a harmful rule within 24 hours, public change log.

Pending:

- **Clinical validation is pending.** No rule is validated; the pack declares `clinically-validated: false`. No reviewer is named yet.
- A statement from an authorised representative of AVECT AI SARL.

### 9a. Data Privacy and Security

Requirement: if the project collects, stores or distributes personal data, show how privacy, security and integrity are protected.

Evidence: no personal data is collected by the project; data stays on the phone (IndexedDB), and the repository forbids secrets and personal data (`.gitignore`, `CLAUDE.md`, `SECURITY.md`). Dependabot alerts and security updates are enabled.

Pending: a threat model for the on-phone profile code; a public vulnerability reporting channel (`SECURITY.md` says it will be set up before publication).

### 9b. Inappropriate and Illegal Content

Requirement: if the project collects, stores or distributes user content, have policies and processes to identify and remove inappropriate or illegal content.

Evidence: the project hosts no user-generated content. Contributions are reviewed by maintainers before merge (`CONTRIBUTING.md`).

Pending: a short content policy for issues and pull requests once the repository is public.

### 9c. Protection from Harassment

Requirement: if the project enables interaction between users or contributors, provide processes that protect them.

Evidence: `CODE_OF_CONDUCT.md`. The app has no interaction between users.

Enforcement: reports go privately to the maintainers through GitHub's private vulnerability reporting, as the Code of Conduct says.

## Summary of what blocks an application

1. Clinical validation by a pharmacist and a midwife is pending; nobody is named yet.
2. The WAXAL Wolof share-alike question and the ALFFA data licence are open.
3. The privacy and compliance statements need an authorised signatory.
4. The clinical lead and the reviewers are not appointed yet.
