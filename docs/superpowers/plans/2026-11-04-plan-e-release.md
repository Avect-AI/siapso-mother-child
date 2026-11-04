# Plan E: compliance and the v0.1.0 demo release

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repository that can be made public without legal rework, an aggregated open data mechanism that cannot identify a woman, and a tagged, tested v0.1.0 demo.

**Architecture:** REUSE (SPDX) declares licences per folder through `REUSE.toml`; CI runs the REUSE lint. Open data is produced by a pure aggregation function in `tools/open-data/` from a pseudonymous event log format, with suppression of small cells. The release is a tag on a green `main`, a GitHub release note, and a documented hosting path that the team executes.

**Tech Stack:** `reuse` (Python tool, pinned in `tools/reuse/requirements.txt`, run in CI through `pipx` or a venv), TypeScript for open data.

## Global Constraints

- Same as Plan C (language, hygiene, commits with `Refs: SCRUM-<n>`, SPDX, dependencies at least 14 days old, local shell setup).
- Intended use wording identical in meaning in the app (About), `README.md` and `MEDICAL_DISCLAIMER.md`: general health information, education and referral for pregnant and breastfeeding women in Senegal and the people who accompany them; no diagnosis, no prescription, no dose; does not replace a health professional.
- Never fabricate a contact address, a partner, an endorsement or a validation. Placeholders that the team must fill are explicit (`<to be completed by the team>`), never invented.
- No secret, key, LEDIAM, DDInter, production IP or TerangaHealth material anywhere in the repository or its history.

---

### Task 20 (SCRUM-34): licences, NOTICE, disclaimer and governance

Branch `docs/SCRUM-34-licensing`.

**Files:** `REUSE.toml` (MIT default; CC-BY-4.0 for `knowledge/**`, `registry/**`, `eval/**`, `open-data/**`, `docs/**`, `DESIGN.md`, `PRODUCT.md`; OFL-1.1 for `app/public/fonts/**`; third-party `.claude/skills/impeccable/**` and `.claude/agents/impeccable-*.md` with their upstream licence identified from the impeccable repository), `LICENSES/` (MIT, CC-BY-4.0, OFL-1.1 and any third-party licence texts, from the SPDX licence list), `MEDICAL_DISCLAIMER.md`, `TRADEMARKS.md` (the names SIAPSO and SIAPSO Mère-Enfant belong to AVECT AI SARL; forks must rename), `GOVERNANCE.md` (maintainers, decision process, clinical double review by a pharmacist and a midwife before a rule is marked validated, rule withdrawal within 24 hours, public change log), `docs/dpg-mapping.md` (the nine Digital Public Goods Standard indicators with the evidence in this repository and what is pending), `.github/workflows/ci.yml` (REUSE lint step), `README.md` (licence and disclaimer sections aligned), `CHANGELOG.md`.

**Acceptance:** `reuse lint` passes locally and in CI; every file has an identifiable licence; the intended use is identical in meaning in About, README and MEDICAL_DISCLAIMER (a test in the app compares the key sentences of the About text with a shared source, or the three texts come from one documented source paragraph).

- [ ] Steps: branch; REUSE.toml and licence texts; `reuse lint` until clean; documents; CI step; PR `docs: declare licences and add the medical disclaimer and governance`, `Refs: SCRUM-34`.

---

### Task 21 (SCRUM-35): aggregated open data

Branch `feat/SCRUM-35-open-data`.

**Files:** `tools/open-data/` package (`@siapso/open-data`, private): `src/aggregate.ts`, `src/csv.ts`, `src/cli.ts`, tests; `open-data/README.md`, `open-data/fields.md` (field dictionary), `open-data/schema/event.schema.json`, `open-data/test-data/events.sample.jsonl` (synthetic events, labelled as test data), `open-data/published/2026-W45-test.csv` (first file, labelled test data), root script `open-data:build`, `CHANGELOG.md`.

**Event format (what a device could later send, never identifying):** `{ week: "2026-W45", region: "<one of the 14 regions of Senegal>", mode: "woman" | "accompanied", level: Level, checks: { C1...C12: count }, unknownItems: number, unrecognisedNames: number }`. No profile id, no product name, no free text, no date finer than the ISO week, no place finer than the region (validated by the schema with `additionalProperties: false`).

**Aggregation:** counts per week and region: number of checks, findings per level, share of grey results, number of unrecognised names. A cell (week, region) is published only when its number of checks is greater than 10; otherwise the whole row is suppressed (and counted in a footer line "suppressed rows: n"). Deterministic CSV (sorted by week then region, fixed column order, LF endings).

**Tests:** suppression at 10 and 11; no column outside the dictionary; region outside the list rejected; a field with free text rejected; deterministic output.

- [ ] Steps: branch; tests first; implement; generate the sample CSV; PR `feat(open-data): publish aggregated counts without identifying anyone`, `Refs: SCRUM-35`.

---

### Task 22 (SCRUM-36): v0.1.0 demo release

Branch `release/SCRUM-36-v0.1.0`.

**Files:** `README.md` (final: problem, intended use, disclaimer, launch in three commands, how to test offline, screenshots, licences, status "not clinically validated"), `docs/screenshots/*.png` (captured from the production build at 360 x 800 in French: welcome, profile, search, result orange, result grey plus danger, danger signs, status; no real personal data), `docs/release-checklist.md`, `docs/hosting.md` (how to host the static build: any static HTTPS host; options compared; steps the team executes; why the repository must stay private until the audit), `.github/workflows/release.yml` (on a `v*` tag: build, test, attach `siapso-app-<version>.zip` of `app/dist` to a draft GitHub release), `package.json` versions to `0.1.0`, `knowledge/pack.yaml` date, `CHANGELOG.md` (section `[0.1.0] - 2026-11-09`).

**Checks before tagging (scripted in `tools/release/check.sh`, run in the PR):** no file matching secrets patterns (`.pem`, `.env`, `accessKeys`, private keys, tokens), no forbidden source names (reuse the provenance scan over the whole repository, excluding `knowledge/sources.yaml`), no IP address literals outside documentation examples, no TerangaHealth mention outside the decision notes, no phone number pattern, CI green, reference cases and resolver evaluation green, app budget, pack budget.

**Tag and release:** after merge, the controller tags `v0.1.0` on `main` (annotated, signed off message) and pushes the tag; the workflow creates a draft release with the zip; the controller publishes the release in the private repository. Hosting the demo publicly and sharing the repository with `@unicefinnovation` are left to the team (outward-facing).

- [ ] Steps: branch; check script with tests on fixtures; screenshots; docs; release workflow; PR `chore(release): prepare v0.1.0`, `Refs: SCRUM-36`; merge; tag; draft release; live test round 3 on the release build.
