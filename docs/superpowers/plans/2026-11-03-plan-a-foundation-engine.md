# Plan A: foundation, visual direction and engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm monorepo with blocking CI, the visual system of the app, and the deterministic evaluation engine.

**Architecture:** Workspace packages `engine`, `resolver`, `speech`, `app` (and later `tools/knowledge`, `server`). The engine is a pure TypeScript library with no runtime dependency. The app is a Vite React PWA. Design reference: `docs/superpowers/specs/2026-11-03-implementation-design.md` (the spec). Read it before starting.

**Tech Stack:** Node 24 (CI) or 26 (local), pnpm 12.14.0, TypeScript 6.0.3, Vite 8.3.4, React 19.3.1, Vitest 5.0.5, ESLint 10.13.0 with typescript-eslint 8.72.0, Prettier 3.9.10, Playwright 1.64.1.

## Global Constraints

- Code, comments, docs, commit messages, branch names and pull requests in English. Interface text in French and English through translation files only.
- Never write the em dash character (U+2014), never write emoji, never attribute work to an AI (no `Co-Authored-By` for an assistant, no "Generated with" line). The hygiene hooks and CI enforce this; fix the text when they reject it.
- Commits: Conventional Commits subject (at most 72 characters, no final period), `git commit -s`, body footer `Refs: SCRUM-<n>`. Branch: `<type>/SCRUM-<n>-<topic>`. Enable hooks once per clone: `git config core.hooksPath .githooks`.
- Never push to `main`, never force-push, never rewrite pushed history. To update a branch with `main`, merge `origin/main` into it (squash merge keeps history clean). Open the pull request with `gh pr create`; do not merge it (the controller merges with `tools/github/merge-pr.sh`).
- Every source file starts with an SPDX line: `// SPDX-License-Identifier: MIT` (TS, JS, CSS uses `/* ... */`), `# SPDX-License-Identifier: MIT` for shell and YAML tooling; content YAML under `knowledge/`, `registry/`, `eval/` uses `# SPDX-License-Identifier: CC-BY-4.0`.
- Dependencies: exact versions (no `^` or `~`), each published on or before 2026-10-20. Use the versions in "Tech Stack" and in each task. `pnpm-workspace.yaml` sets `minimumReleaseAge: 20160`.
- TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, ESM only (`"type": "module"`).
- Local shell on this machine: run `export PATH="/c/Users/djene/AppData/Local/Programs/nodejs:/c/Users/djene/AppData/Local/Programs/gh/bin:$PATH"` first in every Bash call. Python is `sh tools/hygiene/py.sh` (never `python` or `python3`).
- No phone number, secret, key, LEDIAM, DDInter, e-lactancia, CRAT or Theriaque content anywhere.
- The interface never says safe, harmless, verified, stop, replace, reduce, take instead, authorised, compatible; never uses green; never gives a dose or an alternative.

---

### Task 1 (SCRUM-15): pnpm monorepo and CI

Branch: `build/SCRUM-15-monorepo-ci`.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `.nvmrc` (`24`), `.mcp.json`
- Create: `engine/package.json`, `engine/tsconfig.json`, `engine/vitest.config.ts`, `engine/src/index.ts`, `engine/src/levels.ts`, `engine/test/levels.test.ts`
- Create: `resolver/package.json`, `resolver/tsconfig.json`, `resolver/vitest.config.ts`, `resolver/src/index.ts`, `resolver/src/normalize.ts`, `resolver/test/normalize.test.ts`
- Create: `speech/package.json`, `speech/tsconfig.json`, `speech/vitest.config.ts`, `speech/src/index.ts`, `speech/test/index.test.ts`
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/vitest.config.ts`, `app/index.html`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/App.test.tsx`, `app/src/test/setup.ts`, `app/playwright.config.ts`, `app/e2e/smoke.spec.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `.github/workflows/hygiene.yml` (pin actions by SHA), `.github/dependabot.yml` (add npm), `.gitignore`, `tools/github/setup-repo.sh` (protection contexts), `README.md` (Development section), `CONTRIBUTING.md` (Set up), `CLAUDE.md` (Commands section), `CHANGELOG.md`

**Interfaces:**
- Produces: `@siapso/engine` exporting `LEVELS` and `levelRank`; `@siapso/resolver` exporting `normalize`; `@siapso/speech` exporting `SPEECH_SAMPLE_RATE`; root scripts `lint`, `format:check`, `typecheck`, `test`, `test:coverage`, `build`, `e2e`.

```ts
// engine/src/levels.ts
export const LEVELS = ['unknown', 'next-contact', 'before-next-dose', 'danger'] as const;
export type Level = (typeof LEVELS)[number];
export function levelRank(level: Level): number; // index in LEVELS: unknown 0 ... danger 3

// resolver/src/normalize.ts
export function normalize(text: string): string;
// lowercase, NFD then remove combining marks, apostrophes and hyphens to spaces,
// non letters or digits to spaces, collapse spaces, trim.

// speech/src/index.ts
export const SPEECH_SAMPLE_RATE = 16000;
```

- [ ] **Step 1: Branch and hooks.** `git checkout main && git pull --ff-only && git checkout -b build/SCRUM-15-monorepo-ci && git config core.hooksPath .githooks`.
- [ ] **Step 2: Root workspace files.** `package.json`: `"private": true`, `"type": "module"`, `"packageManager": "pnpm@12.14.0"`, `"engines": {"node": ">=24"}`, scripts:
  - `"lint": "eslint ."`, `"format:check": "prettier --check ."`, `"format": "prettier --write ."`,
  - `"typecheck": "pnpm -r --if-present typecheck"`, `"test": "vitest run"`, `"test:coverage": "vitest run --coverage"`,
  - `"build": "pnpm -r --if-present build"`, `"e2e": "pnpm --filter @siapso/app e2e"`.
  devDependencies at the root: `typescript@6.0.3`, `eslint@10.13.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.72.0`, `eslint-plugin-react-hooks@7.1.1`, `globals@17.13.0`, `prettier@3.9.10`, `vitest@5.0.5`, `@vitest/coverage-v8@5.0.5`, `@types/node` (latest 24.x published on or before 2026-10-20).
  `pnpm-workspace.yaml`:
  ```yaml
  # SPDX-License-Identifier: MIT
  packages:
    - engine
    - resolver
    - speech
    - app
    - tools/*
  minimumReleaseAge: 20160
  ```
  Add the pnpm setting that allows only the build scripts actually needed (check `pnpm install` output; allow none unless a package truly needs one, and record why in a comment).
- [ ] **Step 3: TypeScript, lint, format.** `tsconfig.base.json` with the compiler options of the Global Constraints, `target` `ES2022`, `module` and `moduleResolution` `bundler` for app, `NodeNext` style is not needed: use `"module": "ESNext", "moduleResolution": "Bundler"` everywhere. Each package `tsconfig.json` extends it; `typecheck` script per package is `tsc --noEmit`. `eslint.config.js`: flat config, `@eslint/js` recommended, `typescript-eslint` `strictTypeChecked` with `parserOptions.projectService: true`, react-hooks rules for `app/`, ignores `**/dist`, `**/coverage`, `.claude/**`, `app/public/pack/**`, `**/playwright-report`, `**/test-results`. Prettier: `{"singleQuote": true, "printWidth": 100, "trailingComma": "all"}`; `.prettierignore` covers `.claude/`, `pnpm-lock.yaml`, generated folders.
- [ ] **Step 4: Root Vitest projects.** `vitest.config.ts` with `test.projects: ['engine', 'resolver', 'speech', 'app', 'tools/*']`. `engine/vitest.config.ts` sets coverage thresholds `{ lines: 90, branches: 90, functions: 90, statements: 90 }` for `engine/src/**` (enforced from Task 3 on; the scaffold already passes because `levels.ts` is fully tested).
- [ ] **Step 5: Write the failing tests.**
  ```ts
  // engine/test/levels.test.ts
  import { describe, expect, it } from 'vitest';
  import { LEVELS, levelRank } from '../src/index.js';
  describe('levels', () => {
    it('orders the four levels from unknown to danger', () => {
      expect(LEVELS).toEqual(['unknown', 'next-contact', 'before-next-dose', 'danger']);
      expect(levelRank('danger')).toBeGreaterThan(levelRank('before-next-dose'));
      expect(levelRank('before-next-dose')).toBeGreaterThan(levelRank('next-contact'));
      expect(levelRank('next-contact')).toBeGreaterThan(levelRank('unknown'));
    });
    it('has no safe level', () => {
      expect(LEVELS.join(' ')).not.toMatch(/safe|green|ok/i);
    });
  });
  ```
  ```ts
  // resolver/test/normalize.test.ts
  import { expect, it } from 'vitest';
  import { normalize } from '../src/index.js';
  it('removes accents, case, punctuation and extra spaces', () => {
    expect(normalize('  Kinkéliba ')).toBe('kinkeliba');
    expect(normalize("Néo-Codion")).toBe('neo codion');
    expect(normalize("l'huile  de RICIN")).toBe('l huile de ricin');
  });
  ```
  ```ts
  // speech/test/index.test.ts
  import { expect, it } from 'vitest';
  import { SPEECH_SAMPLE_RATE } from '../src/index.js';
  it('uses the 16 kHz sample rate expected by Whisper', () => {
    expect(SPEECH_SAMPLE_RATE).toBe(16000);
  });
  ```
  ```tsx
  // app/src/App.test.tsx
  import { render, screen } from '@testing-library/react';
  import { expect, it } from 'vitest';
  import { App } from './App.js';
  it('renders the application heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  });
  ```
- [ ] **Step 6: Run them to verify they fail.** `pnpm install && pnpm test`. Expected: FAIL (modules not found).
- [ ] **Step 7: Minimal implementation.** Write `levels.ts`, `normalize.ts`, `speech/src/index.ts`, and the app skeleton: `app/package.json` (deps `react@19.3.1`, `react-dom@19.3.1`; dev deps `vite@8.3.4`, `@vitejs/plugin-react@6.1.2`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@testing-library/react@16.3.3`, `@testing-library/jest-dom@7.0.1`, `@testing-library/user-event@14.6.8`, `jsdom@30.1.3`, `@playwright/test@1.64.1`, `@axe-core/playwright@4.14.0`; scripts `dev`, `build` (`tsc --noEmit && vite build`), `preview` (`vite preview --port 4173 --strictPort`), `typecheck`, `e2e` (`playwright test`)). `App.tsx` renders `<main><h1>SIAPSO</h1></main>` (real interface comes in Plan C). `app/vitest.config.ts`: environment `jsdom`, setup file importing `@testing-library/jest-dom/vitest`. Each library package has `"exports": {".": "./src/index.ts"}` (source exports, consumed by Vite and Vitest directly; no build step for libraries).
- [ ] **Step 8: Run tests to verify they pass.** `pnpm test`. Expected: all pass. Then `pnpm lint && pnpm format:check && pnpm typecheck && pnpm build`. Expected: all exit 0.
- [ ] **Step 9: End-to-end smoke test.** `app/playwright.config.ts`: `testDir: 'e2e'`, `webServer: { command: 'pnpm preview', port: 4173, reuseExistingServer: !process.env.CI }`, projects `mobile-chromium` (`viewport: {width: 360, height: 800}`, `isMobile: true`, `hasTouch: true`, Chromium) and `desktop-chromium`. `app/e2e/smoke.spec.ts`:
  ```ts
  import AxeBuilder from '@axe-core/playwright';
  import { expect, test } from '@playwright/test';
  test('the app loads and has no serious accessibility violation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious).toEqual([]);
  });
  ```
  Run `pnpm --filter @siapso/app exec playwright install chromium && pnpm build && pnpm e2e`. Expected: PASS on both projects.
- [ ] **Step 10: Prove CI blocks failures.** Locally make one engine assertion wrong, run `pnpm test`, confirm a non-zero exit, revert. Same for one lint error (`pnpm lint`) and one type error (`pnpm typecheck`). Do not commit these.
- [ ] **Step 11: CI workflow.** `.github/workflows/ci.yml` (`name: CI`, on `pull_request` and `push` to `main`, `permissions: contents: read`, `concurrency` cancelling in-progress runs per ref):
  - job `build` named `Build and test`: checkout, `pnpm/action-setup` (version from `packageManager`), `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`.
  - job `e2e` named `End-to-end`: same setup, `pnpm --filter @siapso/app exec playwright install --with-deps chromium`, `pnpm build`, `pnpm e2e`, upload `app/playwright-report` with `actions/upload-artifact` when the job fails (retention 7 days).
  Pin every action by full commit SHA with the version tag in a trailing comment. Resolve SHAs with `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` (dereference annotated tags with `gh api repos/<owner>/<repo>/git/tags/<sha> --jq .object.sha`). Use the newest major of each action released on or before 2026-10-20. Apply the same SHA pinning to `hygiene.yml`.
- [ ] **Step 12: Dependabot, MCP, repo settings.** `.github/dependabot.yml`: add an `npm` ecosystem entry (directory `/`, weekly on Monday, `open-pull-requests-limit: 5`, labels `dependencies`, commit prefix `chore` with `include: scope`, a `groups` entry `dev-dependencies` for `dependency-type: development`). `.mcp.json`:
  ```json
  { "mcpServers": { "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@0.0.83"] } } }
  ```
  `tools/github/setup-repo.sh`: required contexts become `["Text hygiene", "Developer Certificate of Origin", "Build and test", "End-to-end"]`. `.gitignore`: `node_modules/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `.vite/`, `*.tsbuildinfo`.
- [ ] **Step 13: Docs.** README: section "Development" with Node 24 and pnpm 12 prerequisites and the three commands `pnpm install`, `pnpm test`, `pnpm --filter @siapso/app dev`. CONTRIBUTING "Set up": add `pnpm install` and `pnpm --filter @siapso/app exec playwright install chromium`. CLAUDE.md: new section "Commands" listing the root scripts. CHANGELOG under Unreleased, Added: "pnpm workspace with engine, resolver, speech and app packages; CI for lint, types, tests, build and end-to-end tests."
- [ ] **Step 14: Commit and open the pull request.** Commit in logical steps (workspace, packages, CI, docs), each `git commit -s` with `Refs: SCRUM-15`. Push, then `gh pr create --base main --title "build: set up the pnpm workspace and CI" --body-file <file>` using the template sections (Summary, Testing with the commands run and their result, `Refs: SCRUM-15`). Report the PR number.

---

### Task 2 (SCRUM-16): visual direction with impeccable

Branch: `feat/SCRUM-16-design-system`. Depends on Task 1 being merged.

The impeccable skill is not loaded as a slash command in agent sessions: read `.claude/skills/impeccable/SKILL.md`, then `reference/shape.md`, `reference/craft-floor.md`, `reference/typeset.md`, `reference/colorize.md`, `reference/document.md` (DESIGN.md format), `reference/critique.md` and `reference/audit.md`, and follow them as written. Context: `PRODUCT.md` (users, sunlight, shared low-cost Android phones, low literacy, never green, meaning never by colour alone).

**Files:**
- Create: `DESIGN.md` (repository root, the format from `reference/document.md`)
- Create: `app/src/styles/tokens.css`, `app/src/styles/base.css`, `app/src/styles/contrast.ts`, `app/src/styles/tokens.test.ts`
- Create: `app/src/ui/Button.tsx`, `app/src/ui/TextField.tsx`, `app/src/ui/LevelIcon.tsx`, `app/src/ui/LevelBadge.tsx`, `app/src/ui/ResultCard.tsx`, `app/src/ui/DangerBanner.tsx`, `app/src/ui/ui.test.tsx`, `app/src/ui/index.ts`
- Create: `app/src/design/Gallery.tsx` (development-only page showing every component and level, used for critique screenshots)
- Create: `app/public/fonts/` (self-hosted font files and their licence file) if a web font is chosen
- Modify: `app/src/main.tsx` (import styles; render `Gallery` when `import.meta.env.DEV` and `location.hash === '#/design'`), `CHANGELOG.md`

**Interfaces:**
- Produces (used by Plan C screens):
  ```ts
  export type Level = 'danger' | 'before-next-dose' | 'next-contact' | 'unknown'; // import from @siapso/engine
  export function Button(props: { variant?: 'primary' | 'secondary' | 'quiet'; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element;
  export function TextField(props: { label: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element;
  export function LevelIcon(props: { level: Level; size?: number }): React.JSX.Element; // aria-hidden, distinct shape per level
  export function LevelBadge(props: { level: Level; label: string }): React.JSX.Element; // icon + visible text label
  export function ResultCard(props: { level: Level; levelLabel: string; title: string; children: React.ReactNode }): React.JSX.Element;
  export function DangerBanner(props: { title: string; action: string; onAction: () => void }): React.JSX.Element;
  ```
  CSS custom properties in `tokens.css`, at least: `--level-danger-bg`, `--level-danger-fg`, `--level-danger-border` and the same for `before-next-dose`, `next-contact`, `unknown`; `--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-focus`, `--color-primary`, `--color-primary-text`; type scale `--font-size-*`; spacing `--space-*`; `--touch-target: 48px`; `--radius-*`.
  `contrast.ts`: `export function contrastRatio(hexA: string, hexB: string): number` (WCAG 2.x relative luminance) and `export const CONTRAST_PAIRS: { fg: string; bg: string; min: number }[]` naming custom properties.

- [ ] **Step 1: Shape.** Follow `reference/shape.md` for the result screen (the most important screen: level, risk, who to show and when, source, version). Record the brief in DESIGN.md.
- [ ] **Step 2: Write the failing tests.**
  ```ts
  // app/src/styles/tokens.test.ts
  import { readFileSync } from 'node:fs';
  import { describe, expect, it } from 'vitest';
  import { CONTRAST_PAIRS, contrastRatio } from './contrast.js';
  const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
  const tokens = Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
  function hue(hex: string): { h: number; s: number } { /* HSL conversion */ }
  describe('design tokens', () => {
    it.each(CONTRAST_PAIRS)('$fg on $bg meets $min:1', ({ fg, bg, min }) => {
      expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(min);
    });
    it('never uses green', () => {
      for (const [name, hex] of Object.entries(tokens)) {
        const { h, s } = hue(hex);
        expect({ name, green: s > 0.2 && h >= 75 && h <= 165 }).toEqual({ name, green: false });
      }
    });
    it('defines all four levels', () => {
      for (const level of ['danger', 'before-next-dose', 'next-contact', 'unknown']) {
        for (const part of ['bg', 'fg', 'border']) expect(tokens[`--level-${level}-${part}`]).toBeDefined();
      }
    });
  });
  ```
  Write the `hue` helper fully (standard RGB to HSL). `CONTRAST_PAIRS` covers every text and background pair used: body text on background and surface (4.5), muted text (4.5), primary button text (4.5), each level foreground on its background (4.5), each level border on the page background (3), focus ring on background (3).
  ```tsx
  // app/src/ui/ui.test.tsx (excerpt; cover every component)
  it('LevelBadge always shows the level name as text', () => {
    render(<LevelBadge level="unknown" label="On ne sait pas" />);
    expect(screen.getByText('On ne sait pas')).toBeVisible();
  });
  it('each level has a different icon shape', () => {
    const shapes = (['danger', 'before-next-dose', 'next-contact', 'unknown'] as const).map((level) => {
      const { container, unmount } = render(<LevelIcon level={level} />);
      const html = container.querySelector('svg')!.innerHTML; unmount(); return html;
    });
    expect(new Set(shapes).size).toBe(4);
  });
  it('Button meets the 48 px touch target through its class', () => { /* asserts the class that sets min-height: var(--touch-target) */ });
  ```
- [ ] **Step 3: Run to verify failure.** `pnpm test`. Expected: FAIL (files missing).
- [ ] **Step 4: Implement tokens, base styles, components.** Choose typography for sunlight readability on small screens; if a web font is used, self-host it (OFL or similar open licence, licence file next to it, total font payload at most 150 KB, `font-display: swap`). Pictograms are inline SVG with distinct silhouettes (for example octagon for danger, hand or eye for before-next-dose, speech bubble for next-contact, question mark for unknown). Components use only tokens.
- [ ] **Step 5: Run tests.** `pnpm test`. Expected: PASS. `pnpm lint && pnpm typecheck && pnpm build`. Expected: exit 0.
- [ ] **Step 6: Critique and detect.** Run `pnpm --filter @siapso/app dev`, capture the Gallery (`#/design`) at 360 x 800 with Playwright screenshots (write them to the scratchpad, not to the repository), apply `reference/critique.md` and `reference/audit.md`, fix every major issue, then run `node .claude/skills/impeccable/scripts/impeccable detect app/src` (or the platform script in that folder) until it reports no finding. Record the critique summary and the detect output in the pull request description.
- [ ] **Step 7: DESIGN.md.** Complete it: principles, colours with contrast ratios, the four levels (name FR and EN, pictogram, colour, use), typography, spacing, components and their states, motion (minimal, respects `prefers-reduced-motion`), do and do not list (no green, no colour-only meaning, one primary action per screen).
- [ ] **Step 8: Commit, push, open PR.** Title `feat(app): add the visual system and base components`, `Refs: SCRUM-16`.

---

### Task 3 (SCRUM-18): evaluation engine

Branch: `feat/SCRUM-18-evaluation-engine`. Depends on Task 1 being merged. Can run in parallel with Task 2.

**Files:**
- Create: `engine/src/types.ts`, `engine/src/windows.ts`, `engine/src/pregnancy.ts`, `engine/src/match.ts`, `engine/src/rules.ts`, `engine/src/builtins.ts`, `engine/src/evaluate.ts`, `engine/src/pack.ts`, `engine/src/wording.ts`
- Modify: `engine/src/index.ts`, `engine/src/levels.ts`
- Test: `engine/test/fixtures/pack.ts`, `engine/test/windows.test.ts`, `engine/test/pregnancy.test.ts`, `engine/test/match.test.ts`, `engine/test/evaluate.test.ts`, `engine/test/guarantees.test.ts`, `engine/test/pack.test.ts`, `engine/test/wording.test.ts`
- Modify: `CHANGELOG.md`, `engine/README.md` (create: purpose, API, guarantees)

**Interfaces (exact; later plans depend on these names):**

```ts
// engine/src/types.ts
// SPDX-License-Identifier: MIT
import type { Level } from './levels.js';
export type { Level };
export type Evidence = 'A' | 'B' | 'C' | 'D' | 'E' | '0';
export type WindowId = 'lt12' | '12-19' | '20-29' | '30-plus';
export type TermPrecision = 'exact' | 'estimated' | 'unknown';
export type ConditionId =
  | 'hiv-cotrimoxazole' | 'tuberculosis-treatment' | 'epilepsy-treatment' | 'uterine-scar'
  | 'renal-failure' | 'hepatic-failure' | 'sickle-cell';
export type RuleKind =
  | 'pregnancy' | 'breastfeeding' | 'interaction' | 'herb-drug' | 'toxicity' | 'duplicate'
  | 'max-dose' | 'condition' | 'contraception-info' | 'reminder';
export type CheckId =
  | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9' | 'C10' | 'C11' | 'C12' | 'no-finding';
export type Lang = 'fr' | 'en';
export interface Localized { fr: string; en: string }
export interface LocalName { text: string; lang: 'fr' | 'wo' | 'en'; checked: boolean }
export interface SourceRef { source: string; locator: string; url?: string; accessed: string; quote?: string }
export interface Substance { id: string; names: Localized; classes: string[] }
export interface SubstanceClass { id: string; names: Localized; excludes: string[] }
export interface Component { substance: string; strengthMg?: number }
export interface Product {
  id: string; names: Localized; brands: string[]; localNames: LocalName[];
  components: Component[]; form: string; route: string; demo: boolean;
}
export interface Plant {
  id: string; latinName: string; names: Localized; localNames: LocalName[];
  evidence: Evidence; message: string; sources: SourceRef[];
}
export type Subject = { substance: string } | { class: string } | { plant: string };
export type Requirement = { with: Subject } | { condition: ConditionId };
export interface RuleWhen {
  subject?: Subject;                    // required for every kind except 'reminder'
  requires?: Requirement[];             // any-of; absent means no requirement
  unlessConditions?: ConditionId[];     // rule does not apply when one is present
  pregnancyWindows?: WindowId[];        // rule applies only to a pregnancy intersecting these windows
  breastfeeding?: { babyAgeWeeksMax?: number; premature?: boolean }; // rule applies only when breastfeeding
  maxMgPerDay?: number;                 // 'max-dose' only
}
export interface Reviewer { name: string; role: string }
export interface Rule {
  id: string; kind: RuleKind; when: RuleWhen; level: Level; evidence: Evidence;
  dangerRationale?: string; message: string; sources: SourceRef[];
  review: { status: 'draft' | 'validated'; reviewers: Reviewer[]; reviewedOn?: string };
}
export interface DangerSign { id: string; group: 'pregnancy' | 'postpartum' | 'baby'; label: Localized; sources: SourceRef[] }
export interface Source { id: string; name: string; licence: string; url: string; version?: string }
export interface Message { fact: string; risk: string; riskDetail?: string; orientation?: string }
export interface Pack {
  schema: 1; version: string; date: string; clinicallyValidated: boolean;
  substances: Substance[]; classes: SubstanceClass[]; products: Product[]; plants: Plant[];
  rules: Rule[]; dangerSigns: DangerSign[]; sources: Source[];
  messages: Record<Lang, Record<string, Message>>;
}
export interface PregnancyContext { weeksMin: number; weeksMax: number; precision: TermPrecision }
export interface BreastfeedingContext { babyAgeWeeks?: number; premature?: boolean }
export type ItemRef = { kind: 'product' | 'plant'; id: string } | { kind: 'unrecognised'; text: string };
export interface CheckedItem { ref: ItemRef; unitsPerDay?: number; longTerm?: boolean }
export interface EvaluationContext {
  pregnancy?: PregnancyContext; breastfeeding?: BreastfeedingContext;
  conditions: ConditionId[]; items: CheckedItem[]; signs: string[];
}
export interface Finding {
  level: Level; check: CheckId; ruleId?: string; evidence?: Evidence; items: number[];
  message: string; sign?: string; term?: TermPrecision; capped: boolean; sources: SourceRef[];
}
export interface Note { ruleId: string; message: string; sources: SourceRef[] }
export interface Evaluation {
  level: Level; findings: Finding[]; reminders: Note[]; notes: Note[];
  pack: { version: string; date: string; clinicallyValidated: boolean };
}
export const BUILTIN_MESSAGES = {
  nothingFound: 'nothing-found', notRecognised: 'not-recognised', dangerSign: 'danger-sign',
} as const;
```

```ts
// engine/src/windows.ts
export const WINDOWS: readonly { id: WindowId; from: number; to: number }[]; // to exclusive: [0,12) [12,20) [20,30) [30,Infinity)
export function windowsCovered(weeksMin: number, weeksMax: number): WindowId[]; // every window intersecting [min, max]
// engine/src/pregnancy.ts  (pure: today is a parameter)
export function weeksFromLmp(lmpIso: string, todayIso: string): number;   // whole weeks of amenorrhoea, floor; throws RangeError if lmp after today or more than 45 weeks
export function rangeFromMonths(month: number): { weeksMin: number; weeksMax: number }; // month 1..9: floor(4.33*(m-1)+2), ceil(4.33*m+2)
export const UNKNOWN_TERM: { weeksMin: 0; weeksMax: 42 };
// engine/src/match.ts
export function itemMatches(pack: Pack, item: CheckedItem, subject: Subject): boolean;
// substance: a product component has it; class: a product component substance is in the class and not in class.excludes; plant: plant item with that id
export function substancesOf(pack: Pack, item: CheckedItem): string[];
// engine/src/evaluate.ts
export function evaluate(pack: Pack, context: EvaluationContext): Evaluation;
// engine/src/pack.ts
export class PackError extends Error {}
export function parsePack(json: unknown): Pack; // structural validation: schema === 1, arrays, unique ids per collection, every rule message and plant message exists in both languages, builtin messages exist, every referenced substance/class/plant id exists; throws PackError with a precise message
// engine/src/wording.ts
export function findForbiddenWording(text: string, lang: Lang): string[]; // returns matched forbidden expressions (spec section 2, "Forbidden words test")
// engine/src/levels.ts (extend)
export function capForEvidence(level: Level, evidence: Evidence, kind: RuleKind): { level: Level; capped: boolean };
export function maxLevel(levels: Level[]): Level; // 'unknown' for an empty list
```

Semantics to implement (spec section 5): kind to check mapping `pregnancy C1, breastfeeding C2, interaction C3, herb-drug C4, toxicity C5, duplicate C6, max-dose C7, condition C8, contraception-info C9, reminder C10`; danger signs C11 (one finding per sign, message `danger-sign`, `sign` set, no sources); unrecognised items C12 (one finding each, message `not-recognised`); any recognised item with no finding gets `no-finding` (`nothing-found` for products, `plant.message` and `plant.evidence` for plants). Interactions and herb-drug need the subject and the `with` item to be different item indexes. Duplicate: at least two distinct items match the subject; finding items lists all of them. Max-dose: sum `strengthMg * unitsPerDay` over items with the substance; skip when any such item lacks `unitsPerDay` or `strengthMg`; trigger when sum is greater than `maxMgPerDay`. A rule with `pregnancyWindows` applies only when `context.pregnancy` exists and windows intersect; then `term` is set to `context.pregnancy.precision` if it is not `exact`. A rule with `breastfeeding` applies only when `context.breastfeeding` exists, `babyAgeWeeks` is unknown or at most the bound, and `premature` matches when required. Reminder and contraception-info produce `reminders` and `notes` (not findings). Apply `capForEvidence` to every finding. `level` is `maxLevel` of findings. Sort findings by level rank descending, then check order (C1..C12, no-finding), then rule id or message, then first item index. No `Date`, no `Math.random`, no I/O, no mutation of inputs (freeze inputs in tests).

- [ ] **Step 1: Fixture pack.** `engine/test/fixtures/pack.ts` exports `fixturePack(): Pack` with: substances `ibuprofen` (class `nsaid`), `paracetamol`, `codeine`, `amodiaquine`, `artesunate`, `quinine`, `sulfadoxine`, `pyrimethamine`, `sulfamethoxazole`, `trimethoprim`; products `ibuprofen-400` (400 mg), `paracetamol-1000` (1000 mg), `paracetamol-500` (500 mg), `sp` (sulfadoxine, pyrimethamine), `cotrimoxazole` (sulfamethoxazole, trimethoprim), `codeine-syrup`, `asaq` (artesunate, amodiaquine), `quinine-300`; plants `moringa` (evidence B), `kinkeliba` (evidence 0), `clay` (evidence C), `castor-oil` (evidence C); rules covering one example of each kind (including a D-evidence herb-drug rule declared `before-next-dose` to exercise the cap, and a `toxicity` rule with evidence D at `before-next-dose` that must not be capped); messages for all ids in both languages; two danger signs (`fever`, `bleeding`); one source.
- [ ] **Step 2: Write failing unit tests** for windows, pregnancy helpers, match, levels (cap, max). Examples that must exist verbatim:
  ```ts
  expect(windowsCovered(30, 30)).toEqual(['30-plus']);
  expect(windowsCovered(10, 10)).toEqual(['lt12']);
  expect(windowsCovered(0, 42)).toEqual(['lt12', '12-19', '20-29', '30-plus']);
  expect(windowsCovered(19, 24)).toEqual(['12-19', '20-29']);
  expect(weeksFromLmp('2026-05-01', '2026-11-03')).toBe(26);
  expect(rangeFromMonths(5)).toEqual({ weeksMin: 19, weeksMax: 24 });
  expect(capForEvidence('before-next-dose', 'D', 'herb-drug')).toEqual({ level: 'next-contact', capped: true });
  expect(capForEvidence('before-next-dose', 'D', 'toxicity')).toEqual({ level: 'before-next-dose', capped: false });
  expect(capForEvidence('before-next-dose', 'B', 'herb-drug')).toEqual({ level: 'before-next-dose', capped: false });
  ```
- [ ] **Step 3: Run to verify failure.** `pnpm vitest run --project engine`. Expected: FAIL.
- [ ] **Step 4: Implement windows, pregnancy, match, levels.** Run tests. Expected: PASS.
- [ ] **Step 5: Write failing evaluate tests** (`evaluate.test.ts`): one test per check C1 to C12 and `no-finding`, plus: NSAID at 30 weeks gives `before-next-dose`; NSAID at 10 weeks does not trigger the 20-plus rule; unknown term triggers it with `term: 'unknown'`; duplicate paracetamol with two products gives C6 listing both indexes; the same product twice does not trigger an interaction with itself; max-dose 1000 mg x 4 plus 500 mg x 3 triggers C7 for a 4000 mg threshold, and is skipped when one unit count is missing; SP with condition `hiv-cotrimoxazole` triggers C8; SP with a cotrimoxazole long-term item triggers the same rule once (not twice); reminder rule with `unlessConditions: ['hiv-cotrimoxazole']` is absent for that condition; fever sign gives a `danger` finding first in the list.
- [ ] **Step 6: Implement `evaluate`, `rules.ts`, `builtins.ts`.** Run tests. Expected: PASS.
- [ ] **Step 7: Write failing guarantee tests** (`guarantees.test.ts`), each over many generated contexts (deterministic generation: iterate over all combinations of 0 to 3 items from the fixture plus one unrecognised item, every window, with and without breastfeeding; no randomness):
  - any context containing an unrecognised item has a finding with level `unknown` and check `C12` for that item;
  - every `level` is one of `LEVELS`;
  - `evaluate` twice on deep-equal inputs gives deep-equal outputs, and inputs are not mutated (`Object.freeze` deeply before calling);
  - no finding with evidence D, E or 0 and a kind other than toxicity has a level above `next-contact`;
  - every message id in the output exists in `pack.messages.fr` and `pack.messages.en`.
- [ ] **Step 8: Implement fixes until green.**
- [ ] **Step 9: `parsePack` and wording.** Failing tests first: a valid fixture passes; a missing message, a duplicate id, an unknown substance reference, `schema: 2` each throw `PackError` with a message naming the faulty id. Wording tests: `findForbiddenWording('Ce produit est sûr.', 'fr')` returns `['sûr']`; `'Arrêtez ce médicament'` returns `['arrêtez']`; `"Cela ne veut pas dire que c'est sans risque."` returns `[]`; `'This is safe'` (en) returns `['safe']`; `'safety information'` returns `[]` (whole words only); `'Sûrement'` returns `[]`. Implement, run, pass.
- [ ] **Step 10: Coverage.** `pnpm vitest run --project engine --coverage`. Expected: thresholds of 90 met. Add tests for uncovered branches rather than lowering thresholds.
- [ ] **Step 11: Docs, commit, PR.** `engine/README.md` (purpose, contract, guarantees, how to run tests). CHANGELOG entry. Title `feat(engine): add the deterministic evaluation engine`, `Refs: SCRUM-18`. PR body includes the coverage summary.
