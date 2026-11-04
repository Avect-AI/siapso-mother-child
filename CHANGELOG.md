# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository foundation: README, MIT licence, contributing guide, code of conduct, security policy, product context (`PRODUCT.md`).
- Text hygiene check (`tools/hygiene/hygiene.py`): no em dash, no emoji, no AI attribution, Conventional Commits subjects. Enforced by a Claude Code hook, git hooks and CI.
- Developer Certificate of Origin check on pull requests.
- Dependabot version updates for GitHub Actions; Dependabot alerts and security updates enabled.
- impeccable design plugin for interface work.
- `tools/github/merge-pr.sh`: squash-merges a pull request only once every check is green.
- pnpm workspace with engine, resolver, speech and app packages; CI for lint, types, tests, build and end-to-end tests.
- Deterministic evaluation engine (`@siapso/engine`): checks C1 to C12 with the evidence cap, term windows and helpers, pack validation (`parsePack`), forbidden wording check, and guarantee tests over generated contexts.
- Knowledge pack tooling (`@siapso/pack-tools`, `siapso-pack`): JSON Schemas, validation (ids, references, evidence cap, message wording), deterministic build with manifest and size budget; content skeleton with the builtin messages.
- Engine: `strengthAboveMg` rule condition and per-sign danger messages.

### Fixed

- `setup-repo.sh` now reads the auto-merge setting back instead of trusting the API response.
