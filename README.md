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

## Run the app locally

### Prerequisites

- [Node.js](https://nodejs.org) 24 or later (see `.nvmrc`) and [pnpm](https://pnpm.io/installation) 12 (the version in `packageManager` of `package.json`).
- Git, with access to this repository while it is private.
- A clone outside a synchronised folder (OneDrive, Dropbox, iCloud Drive): syncing `node_modules` slows the install and can lock files. On Windows, for example, clone into `C:\Users\<you>\dev\`.

```sh
git clone https://github.com/Avect-AI/siapso-mother-child.git
cd siapso-mother-child
```

Every command below runs from the repository root, the same way in PowerShell, the Command Prompt or a Unix shell.

### 1. Install

```sh
pnpm install
pnpm knowledge:build
```

`pnpm knowledge:build` writes the knowledge pack (rules, products, plants) to `app/public/pack/`. Run it again after a change in `knowledge/` or `registry/`.

### 2. Development server, to change the code

```sh
pnpm --filter @siapso/app dev --mode demo
```

Open the `Local` address it prints, `http://localhost:5173` (Vite takes the next free port, 5174 and so on, when 5173 is busy). The page reloads at each saved change. `--mode demo` reads `app/.env.demo`, which accepts the local unsigned knowledge pack (`docs/pack-signing.md`); without it, the server warns that the pack is not signed. Offline use and installation are tested on the test build below, not on this server.

### 3. Test build, what the team tests

```sh
pnpm build
pnpm --filter @siapso/app preview:demo
```

`pnpm build` makes the demo build in `app/dist-demo/` (about 20 seconds on a laptop). Its screens say "Version de test" and it is never published. The preview serves it at `http://localhost:4173`: after the first load it works offline (Home says "Prêt sans Internet"), and the browser menu can install it. Build again after every change or `git pull`.

### 4. Open it on a phone

On the same Wi-Fi network, expose the preview:

```sh
pnpm --filter @siapso/app preview:demo --host
```

Open on the phone the `Network` address it prints, such as `http://192.168.x.x:4173`. On Windows, allow Node.js on private networks if the firewall asks. Such an address is not a secure context: the screens work, but the phone gets no offline use, no installation and no voice input. For those, the phone opens the laptop's `localhost` through USB port forwarding, or a temporary HTTPS tunnel: see "Airplane mode on a real phone" in [docs/testing.md](docs/testing.md).

### Voice input (optional)

The French and Wolof voice packs are not in git. [docs/voice.md](docs/voice.md) explains how to convert them (`pnpm voice:convert`) and install them into `app/public/voice/` (`pnpm voice:install-local`) before `pnpm build`. The voice only works on `localhost` or over HTTPS.

### Stop and troubleshoot

- Stop a server with `Ctrl+C` in its terminal.
- To run a second preview at the same time, give it another port: `pnpm --filter @siapso/app preview:demo --port 4174`.
- `app/public/pack/manifest.json is missing`: run `pnpm knowledge:build`, then `pnpm build` again.
- After a new build, a browser that opened the app before keeps its installed version until "Mettre à jour" is tapped on the band "Une nouvelle version est prête.". To start again from a fresh install, clear the site data (see the end of "Option 1" in [docs/testing.md](docs/testing.md)).

## Development

Before a pull request, run the checks of the CI:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm knowledge:check
pnpm e2e
```

`pnpm e2e` runs Playwright on a demo build; the first time, install its browser with `pnpm --filter @siapso/app exec playwright install chromium`. What each check covers: [docs/testing.md](docs/testing.md).

### Referral contacts of a deployment

No personal phone number is ever committed. "Qui appeler" (who to call) always shows a built-in fallback circuit, locked or not and in both modes: the public national emergency numbers of Senegal as call links, "Appeler le SAMU (1515)" and "Appeler les pompiers (18)", with the line "Allez au poste de santé ou au centre de santé le plus proche." ("Go to the nearest health post or health centre."). They live in one module, `app/src/config/emergency.ts`; the team must confirm them with the health authorities of the pilot district before a pilot.

A deployment that wants to give the phones the contacts of its referral circuit (community relay, Bajenu Gox, head nurse of the health post, midwife) copies `app/public/config/referral.example.json` to `app/public/config/referral.json` (git-ignored), fills it in, then builds:

- `contacts`: a role, a name and a number for each contact;
- `nationalCircuit`: the circuit text in French and English, shown under the built-in line, which always stays. It describes where to go and who refers to whom; it never says that someone will come or has been told;
- `emergencyNumbers` (optional): the emergency numbers in place of the built-in ones, each as `{ "name": { "fr": "le SAMU", "en": "the SAMU" }, "phone": "1515" }`, the service named as it reads after "Appeler" ("Call"). The built-in numbers stay unless at least one entry can be dialled.

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
