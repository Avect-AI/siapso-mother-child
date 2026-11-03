# SIAPSO Mother-Child

Offline safety information on medicines and traditional remedies during pregnancy and breastfeeding, for the community health workers and women of rural Senegal.

> Private repository during development. It will be published as open source (MIT for code, CC BY 4.0 for content) once the first release is audited.

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
| `docs/`      | Architecture, roadmap, Digital Public Goods mapping                   | CC BY 4.0                |
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

## Disclaimer

This tool provides general health information. It does not diagnose, prescribe or set doses, and does not replace the advice of a health professional.
