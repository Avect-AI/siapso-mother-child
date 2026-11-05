# Contributing to SIAPSO Mother-Child

Thank you for helping. This project handles health information for pregnant and breastfeeding women, so safety and honesty come before speed. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Set up

1. Clone the repository.
2. Enable the repository git hooks: `git config core.hooksPath .githooks`.
3. Make sure Python 3 is available: the hooks use it for the hygiene check.
4. Install Node 24 and pnpm 12, then run `pnpm install`.
5. Install the browser used by the end-to-end tests: `pnpm --filter @siapso/app exec playwright install chromium`.

## Making a change

1. **Pick a ticket.** Internal contributors take a Jira ticket from project `SCRUM`; external contributors open or comment on a GitHub issue first.
2. **Create a branch**: `<type>/SCRUM-<n>-<short-topic>`, for example `fix/SCRUM-25-result-contrast`.
3. **Commit** with [Conventional Commits](https://www.conventionalcommits.org) subjects in English: `type(scope): imperative summary`, at most 72 characters, no final period.
4. **Sign off every commit** (`git commit -s`). By signing off you certify the [Developer Certificate of Origin](https://developercertificate.org/): you wrote the change or have the right to submit it under the project licences.
5. **Reference the ticket** with a `Refs: SCRUM-<n>` footer (internal contributors).
6. **Open a pull request** whose title is a Conventional Commits subject, and fill in the template. One pull request delivers one feature or fix.
7. **Merge**: maintainers squash-merge once every check is green, with `sh tools/github/merge-pr.sh <number>`. The script waits until the four required checks (Text hygiene, Developer Certificate of Origin, Build and test, End-to-end) are reported and refuses to merge unless each of them passed: a skipped required check blocks the merge. The only exception is a Dependabot pull request, whose Developer Certificate of Origin check is skipped by design; the three other checks must still pass. The script also refuses a pull request whose branch is behind `main`, before reading the checks and again just before merging, since its checks did not run with the latest `main`. To update the branch, run `git fetch origin`, then `git merge --signoff origin/main` on the branch, then a plain `git push` (never a force-push). Wait until the checks of the new commit pass, then run the script again. Never push directly to `main`.

Example:

```
feat(engine): add pregnancy window rules

Rules now take the gestational age into account, with an unknown
term treated as the riskiest window.

Refs: SCRUM-18
Signed-off-by: Jane Doe <jane@example.org>
```

## Text rules

The hygiene check (`tools/hygiene/hygiene.py`) rejects:

- the em dash (U+2014): use a comma, a colon or parentheses;
- emoji and pictographs;
- any attribution of a commit or pull request to an AI assistant;
- commit subjects and pull request titles that are not Conventional Commits.

Run it by hand: `sh tools/hygiene/py.sh tools/hygiene/hygiene.py files`.

Only third-party files we do not author may be excluded, in `.hygieneignore`.

## Language

Code, comments, documentation, commits and pull requests are in English. The interface is in French and English, through translation files.

## Interface

Every screen follows `PRODUCT.md` and `DESIGN.md`, and goes through the impeccable plugin before the pull request (`critique`, `audit`, `detect`).

## Clinical content

A rule is published only with its source (listed in `knowledge/sources.yaml`), its evidence level and the names of its two reviewers. Nothing is presented as validated before it is signed off by a pharmacist and a midwife.

## Licences

By contributing, you agree that your code is released under the [MIT licence](LICENSE) and your content (rules, registries, documentation) under CC BY 4.0, as described in the README. Files you add need an identifiable licence: put an SPDX header in the file, or rely on the folder rule in [REUSE.toml](REUSE.toml). Check with `reuse lint` (version pinned in `tools/reuse/requirements.txt`; CI runs it). Clinical review rules are in [GOVERNANCE.md](GOVERNANCE.md).
