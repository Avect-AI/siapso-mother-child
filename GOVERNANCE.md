<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Governance

SIAPSO Mother-Child handles health information for pregnant and breastfeeding women. The rules below put safety and honesty before speed. They apply to code, clinical content and releases.

## Maintainers

AVECT AI SARL holds the repository. The maintainers act through the organisation's GitHub account; contact them through GitHub (issues, or private reporting for anything sensitive):

| Who                        | Role                      | Contact                                                |
| -------------------------- | ------------------------- | ------------------------------------------------------ |
| AVECT AI SARL (`@2sml001`) | Lead maintainer and code  | GitHub issues; private reporting for sensitive reports |
| To be appointed            | Clinical lead (see below) | Named here once they have agreed in writing            |

Maintainers review and merge pull requests, publish releases and answer security and safety reports.

## Decision process

1. **Everyday changes** (code, documentation, tests): one pull request per feature or fix, reviewed by at least one maintainer, merged by squash once every CI check is green (see [CONTRIBUTING.md](CONTRIBUTING.md)).
2. **Design decisions** (architecture, dependencies, licences, data collection): proposed in an issue or a pull request that explains the options. The maintainers decide by consensus; if there is none after a reasonable discussion, the lead maintainer decides and records the reason in the issue.
3. **Clinical decisions** (any rule, source, danger sign or message wording): taken only through the clinical review below, never by the maintainers alone.
4. **Disagreements** are settled in the open, on the issue or the pull request. A safety concern always wins over a schedule.

## Clinical double review

- A rule, a danger sign or a safety message is marked `validated` only when **two** reviewers have approved it: **a pharmacist and a midwife**, neither of them the author of the change.
- The reviewers check the cited source, the evidence level, the wording (no dose, no instruction to stop or start, never "safe") and the fit with the national referral circuit of Senegal.
- Their names and the date are recorded in the rule file (`review.reviewers`, `review.reviewed-on`). Anonymous or single-person validation does not exist.
- **Today no rule is validated.** The knowledge pack declares `clinically-validated: false`, and every rule is a draft. Nothing is presented as validated before the double review is done.
- A change to a validated rule (source, level, wording) puts it back to draft until it is reviewed again.
- The reviewers are not appointed yet. No reviewer, partner or institution is named in this repository until they have agreed in writing.

## Rule withdrawal within 24 hours

If a rule, a message or a registry entry is reported as wrong or harmful:

1. A maintainer acknowledges the report as soon as it is read.
2. **Within 24 hours** of the report the rule is withdrawn (removed from the knowledge pack or downgraded to the grey unknown state) and a new knowledge pack is published. The withdrawal does not wait for the investigation.
3. The cause is examined, the rule is corrected and goes through the clinical double review again before it returns.
4. The withdrawal and its reason are recorded in the change log.

Reports go to a public issue of this repository, or privately through GitHub's private vulnerability reporting (the Security tab, then "Report a vulnerability") when the report holds personal data: see [SECURITY.md](SECURITY.md).

## Public change log

[CHANGELOG.md](CHANGELOG.md) follows Keep a Changelog and Semantic Versioning. Every release lists:

- code changes;
- knowledge pack changes: rules added, changed or withdrawn, with their reasons;
- the clinical validation status of the pack.

The change log is public once the repository is public. Until then it is available to the team.

## Changing this document

A change to this document goes through a pull request and needs the approval of the lead maintainer. A change that weakens the clinical review or the 24-hour withdrawal also needs the approval of the clinical lead.
