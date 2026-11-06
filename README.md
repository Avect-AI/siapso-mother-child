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

### Referral contacts of a deployment

No personal phone number is ever committed. "Qui appeler" (who to call) always shows a built-in fallback circuit, locked or not and in both modes: the public national emergency numbers of the country where the phone is used as call links (in Senegal "Appeler le SAMU (1515)", then "Pompiers : 18" under "Autres numéros (non médicaux)"), the country under them ("Pays : Sénégal", with a way to change it), and the line "Allez au poste de santé ou au centre de santé le plus proche." ("Go to the nearest health post or health centre.").

The numbers live in `app/src/config/emergency-numbers.json` (CC BY 4.0): 24 African countries and France (chosen by hand only). Each number has at least two sources of two publishers, each with its publisher, its kind and the dates it gives and was fetched; every medical number has at least one national source (the telecom regulator, a ministry, the service itself, or the state press reporting the government); a number whose sources disagree, or that has too few sources, is left out there with why. The country is found offline, with no network lookup and no location permission, in this order: the deployment file's `country`, the country chosen on the phone (Settings or who to call), the region of the phone's language (`fr-SN`), the phone's time zone (`Africa/Dakar`, never Africa/Abidjan or Africa/Lagos alone), else unknown; when the language and the time zone name two countries, who to call asks which. France is never found from the phone, only chosen. Only a medical number is ever the first call, and the medical numbers alone are the emergency numbers; the fire brigade and the police show under "Autres numéros (non médicaux)" ("Pompiers : 118"). When no medical number is sure to answer, who to call says where to go first; a known country with no number says so, with the way to change it; with no country, who to call says "Appelez le numéro d'urgence de votre pays." with the way to choose the country first. It never shows a guessed number. The team must confirm every number of a pilot country with the health authorities of the pilot district before a pilot (that it answers there, from every operator, free of charge).

A deployment that wants to give the phones the contacts of its referral circuit (community relay, Bajenu Gox, head nurse of the health post, midwife) copies `app/public/config/referral.example.json` to `app/public/config/referral.json` (git-ignored), fills it in, then builds:

- `country` (optional): the ISO code of the pilot country (`"SN"`), one of `app/src/config/emergency-numbers.json`; it comes before the country chosen or found on the phone, and who to call then offers no way to change it. A code the file does not have is left out with a warning;
- `contacts`: a role, a name and a number for each contact;
- `nationalCircuit`: the circuit text in French and English, shown under the built-in line, which always stays. It describes where to go and who refers to whom; it never says that someone will come or has been told;
- `emergencyNumbers` (optional): the emergency numbers in place of the built-in ones, each as `{ "name": { "fr": "le SAMU", "en": "the SAMU" }, "phone": "1515" }`, the service named as it reads after "Appeler" ("Call"). The built-in numbers of the country of use stay unless at least one entry can be dialled. A `country` with no number in the file and no `emergencyNumbers` makes the production build print a loud warning.

Numbers are digits, with spaces, "-" or "." between groups if you like, and a + only at the start. Entries left empty, as in the example, are ignored. Any other entry the phones cannot use (an unknown role, a number that cannot be dialled, a text in one language only, words the app never says) is left out: the production build names each one in a loud warning, and the app warns in the console.

The file must be in place before the build: the service worker precaches it, so it works offline. A production build without it, or with a file that is not valid JSON, prints a loud warning, since the phones would then list no contact of the circuit. Any content type works; an HTML answer, or a body that starts with `<` (a server that serves the app page for every path), is read as no file, and the service worker never answers a `/config/` request with the app page. A file added or changed after the build is not kept offline: build again. Contacts saved on a phone, behind the code, in either mode, are listed first; the app only opens the phone's dialler and never sends anything.

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
| Code, tooling, configuration, JSON Schemas (`*.schema.json`)          | [MIT](LICENSE)                        |
| Content: rules, registries, evaluation sets, open data, documentation | [CC BY 4.0](LICENSES/CC-BY-4.0.txt)   |
| Self-hosted font Atkinson Hyperlegible Next                           | [OFL 1.1](LICENSES/OFL-1.1.txt)       |
| impeccable design plugin (development tool, third party)              | [Apache 2.0](LICENSES/Apache-2.0.txt) |

Every file has an identifiable licence, declared in [REUSE.toml](REUSE.toml) (REUSE specification 3.3) and checked in CI with `reuse lint`. Third-party files and their notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The sources of the clinical knowledge are in [NOTICE](NOTICE). The licence chain of the speech model, with one open legal question, is in [speech/LICENSES.md](speech/LICENSES.md). The names SIAPSO and SIAPSO Mère-Enfant belong to AVECT AI SARL: see [TRADEMARKS.md](TRADEMARKS.md). How decisions and clinical reviews are made: [GOVERNANCE.md](GOVERNANCE.md). Digital Public Goods self-assessment: [docs/dpg-mapping.md](docs/dpg-mapping.md).

## Disclaimer

SIAPSO Mother-Child provides general health information, education and referral for pregnant and breastfeeding women in Senegal and the people who accompany them. It does not diagnose, prescribe or set a dose, and it does not take the place of a health professional.

No rule is clinically validated yet. Full text: [MEDICAL_DISCLAIMER.md](MEDICAL_DISCLAIMER.md). The shared wording is in [docs/intended-use.md](docs/intended-use.md).
