# SIAPSO Mother-Child: rules for coding agents

Installable offline web app that flags risky medicines and traditional remedies during pregnancy and breastfeeding, and refers to a health worker. Product context: `PRODUCT.md`. Visual system: `DESIGN.md` (once it exists). Design dossier (French): https://claude.ai/artifact/771WvpJtMCZYdN6YMEHAHu.

## Language

- Code, identifiers, comments, documentation, commit messages, branch names and pull requests are written in **English**.
- The user interface ships in **French and English**; French strings live in translation files, never hard-coded in components.
- Jira tickets (project `SCRUM`) may stay in French.

## Hard rules

- **No em dash** (U+2014) and **no emoji** in code, interface text, docs, data or commit messages. Use a comma, a colon or parentheses.
- **No attribution to Claude or Anthropic** in commits or pull requests: no `Co-Authored-By` line, no "Generated with" footer.
- These rules are enforced by `tools/hygiene/hygiene.py`: Claude Code hook before every write, git `pre-commit` and `commit-msg` hooks, and CI on every pull request. Never work around a rejection: fix the text.
- No TerangaHealth component. No audio output and no voice synthesis: answers stay as text.
- Models propose, rules decide: the speech model and the name resolver suggest a product, the user confirms it, the deterministic engine alone sets the alert level.
- The app never says "safe", "no risk" or "verified", never uses green, never tells anyone to stop, start or change a treatment, and gives no dose and no alternative.
- No personal data leaves the phone by default. No secret in the repository.
- No LEDIAM or DDInter data, and no source outside `knowledge/sources.yaml`.

## Workflow

1. One Jira ticket is one feature, one branch and one pull request.
2. Branch: `<type>/SCRUM-<n>-<short-topic>`, for example `feat/SCRUM-18-evaluation-engine`.
3. Commits follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): imperative summary`, at most 72 characters, no final period. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.
4. Every commit is signed off (`git commit -s`, Developer Certificate of Origin) and ends with a `Refs: SCRUM-<n>` footer.
5. The pull request title is a Conventional Commits subject; the description fills `.github/pull_request_template.md`.
6. Merge with squash as soon as the whole CI is green (team decision of 2026-11-03), using `sh tools/github/merge-pr.sh <number>`, then move the Jira ticket to Done. The script waits for CI, refuses to merge if any check is not green, and gives the squash commit the GitHub noreply address of the merging account. Never push directly to `main`, and never rewrite pushed history.
7. The repository is **public** since 2026-11-10. A ruleset protects `main`: pull request, squash only, the four required checks with the branch up to date, linear history, no force push, no deletion. Commits use a GitHub noreply address (`git config user.email`), never a personal one.

## Commands

Run from the repository root (Node 24, pnpm 12):

- `pnpm install`: install the workspace.
- `pnpm lint`: ESLint (strict, type-aware).
- `pnpm format:check` / `pnpm format`: Prettier check / write.
- `pnpm typecheck`: `tsc --noEmit` in every package.
- `pnpm test` / `pnpm test:coverage`: Vitest (coverage floor of 90 percent on `engine/src`).
- `pnpm knowledge:check`: validate `knowledge/` and `registry/` (see `knowledge/README.md`).
- `pnpm knowledge:build`: write the pack to `app/public/pack/` (git-ignored).
- `pnpm build`: build the knowledge pack, then every package that has a build script.
- `pnpm e2e`: Playwright smoke tests with axe (build the app first).

Dependencies are pinned to exact versions, each published at least 14 days before use.

## Interface and design

- Every interface goes through the impeccable plugin (`.claude/skills/impeccable`).
- Before a new screen: `/impeccable shape <screen>`. Before the pull request: `/impeccable critique <screen>`, then `/impeccable audit <screen>`, and `.claude/skills/impeccable/scripts/impeccable detect app/src` must be clean.
- Never use impeccable `live` mode (it runs an agent without approvals).
- Simplicity first: one primary action per screen, touch targets of at least 48 px, readable in direct sunlight, meaning never carried by colour alone.

## Stack

React, Vite and TypeScript; installable web app (PWA); pure TypeScript rules engine, identical on the phone and on the server; French and English interface; French and Wolof voice input with an open model running in the browser.
