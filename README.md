# SIAPSO Mother-Child

Offline safety information on medicines and traditional remedies during pregnancy and breastfeeding, for the community health workers and women of rural Senegal.

> Private repository during development. It will be published as open source (MIT for code, CC BY 4.0 for content) once the first release is audited. The clinical content is not clinically validated: see [MEDICAL_DISCLAIMER.md](MEDICAL_DISCLAIMER.md).

## What it does

- Flags medicines and remedies that should be shown to a health worker, based on the stage of pregnancy or breastfeeding.
- Shows an honest grey state when there is no reliable data: unknown never means safe.
- Works offline on low-cost Android phones, in French and English, with voice input in French and Wolof.
- Never tells anyone to start, stop or change a treatment. It informs and refers.

## Repository layout

| Path         | Content                                                               | Licence (at publication) |
| ------------ | --------------------------------------------------------------------- | ------------------------ |
| `engine/`    | Portable rules engine and reference tests                             | MIT                      |
| `app/`       | Installable offline web app                                           | MIT                      |
| `speech/`    | Open French and Wolof speech model: card, scripts, browser conversion | MIT                      |
| `resolver/`  | Local name resolver (French, Wolof)                                   | MIT                      |
| `knowledge/` | Rules, one file per rule, with its source; `sources.yaml`             | CC BY 4.0                |
| `registry/`  | Products and plants with evidence levels                              | CC BY 4.0                |
| `eval/`      | Synthetic cases and evaluation sets                                   | CC BY 4.0                |
| `open-data/` | Aggregated public data and field dictionary                           | CC BY 4.0                |
| `docs/`      | Guides, intended use, Digital Public Goods mapping                    | CC BY 4.0                |
| `tools/`     | Hygiene checks and repository tooling                                 | MIT                      |

## Development

Prerequisites: Node 24 (see `.nvmrc`) and pnpm 12.

```
pnpm install
pnpm test
pnpm --filter @siapso/app dev
```

## Contributing

Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md):

- one pull request per feature or fix, squash-merged once CI is green;
- [Conventional Commits](https://www.conventionalcommits.org) subjects in English;
- every commit signed off under the [Developer Certificate of Origin](https://developercertificate.org/);
- the hygiene check must pass (no em dash, no emoji, no AI attribution).

Security issues: see [SECURITY.md](SECURITY.md). Release notes: [CHANGELOG.md](CHANGELOG.md).

## Licences

| Part                                                                  | Licence                               |
| --------------------------------------------------------------------- | ------------------------------------- |
| Code, tooling, configuration                                          | [MIT](LICENSE)                        |
| Content: rules, registries, evaluation sets, open data, documentation | [CC BY 4.0](LICENSES/CC-BY-4.0.txt)   |
| Self-hosted font Atkinson Hyperlegible Next                           | [OFL 1.1](LICENSES/OFL-1.1.txt)       |
| impeccable design plugin (development tool, third party)              | [Apache 2.0](LICENSES/Apache-2.0.txt) |

Every file has an identifiable licence, declared in [REUSE.toml](REUSE.toml) (REUSE specification 3.3) and checked in CI with `reuse lint`. Third-party files and their notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The sources of the clinical knowledge are in [NOTICE](NOTICE). The licence chain of the speech model, with one open legal question, is in [speech/LICENSES.md](speech/LICENSES.md). The names SIAPSO and SIAPSO Mère-Enfant belong to AVECT AI SARL: see [TRADEMARKS.md](TRADEMARKS.md). How decisions and clinical reviews are made: [GOVERNANCE.md](GOVERNANCE.md). Digital Public Goods self-assessment: [docs/dpg-mapping.md](docs/dpg-mapping.md).

## Disclaimer

SIAPSO Mother-Child provides general health information, education and referral for pregnant and breastfeeding women in Senegal and the people who accompany them. It does not diagnose, prescribe or set a dose, and it does not replace a health professional.

No rule is clinically validated yet. Full text: [MEDICAL_DISCLAIMER.md](MEDICAL_DISCLAIMER.md). The shared wording is in [docs/intended-use.md](docs/intended-use.md).
