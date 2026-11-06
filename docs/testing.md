# Testing

## Automated checks

Run from the repository root (Node 24, pnpm 12):

| Command                                            | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | ESLint, Prettier and TypeScript over the workspace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm test`                                        | Unit and component tests (Vitest, Testing Library, fake IndexedDB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm build`                                       | The demo build: the knowledge pack into `app/public/pack/`, then the app into `app/dist-demo/` (Vite mode `demo`, with a loud warning). It accepts the unsigned local pack, says "Version de test" on Status and About, and is never published (`docs/pack-signing.md`).                                                                                                                                                                                                                                                                                           |
| `pnpm release:build --key <file>`                  | The release build, for maintainers with the offline key: builds and signs the pack, makes the production build into `app/dist` (refused unless the pack is signed by a key of `app/src/config/pack-keys.ts`), then checks `app/dist/build-info.json` and the size.                                                                                                                                                                                                                                                                                                 |
| `pnpm budget:app`                                  | The demo build (`app/dist-demo` without `pack/` and `voice/`) stays at or under 1.5 MB. Run after `pnpm build`; `pnpm release:build` checks `app/dist` itself.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm e2e`                                         | Playwright on a demo build (the test server runs `pnpm build:demo`, then `pnpm preview:demo`, which serves `app/dist-demo` on port 4173), at 360 x 800 and on a desktop viewport: airplane mode after one load, the precache, the language choice across reloads, the rollback of the pack, the demo build marker, two tabs of the app, cross-origin isolation by the service worker, voice input with a mocked speech worker, Chromium's fake microphone and a small fake voice pack (no model runs), axe scans and large text. Run after `pnpm knowledge:build`. |

The first time, install the browser: `pnpm --filter @siapso/app exec playwright install chromium`. On a machine with little free memory, run fewer browsers at once: `pnpm e2e --workers=2`.

In CI, the End-to-end job runs in the official Playwright image (`mcr.microsoft.com/playwright`, the version `app/package.json` pins, pinned by digest), which holds Chromium and its system libraries, so no apt mirror is on the way and the 20-minute limit measures the tests. `tools/ci/check-playwright-image.mjs` fails the unit tests and the job when the image is not the pinned version or not pinned by digest, and, once the workspace is installed in the image (`--browsers`), when the Chromium builds named by Playwright's `browsers.json` are not the ones the image holds in `/ms-playwright` (a tag moved without its digest pulls the old image): a Playwright update changes the tag and its digest in `.github/workflows/ci.yml` too (the digest of a tag: `docker buildx imagetools inspect mcr.microsoft.com/playwright:v<version>-noble`).

The offline test loads the app once, waits until Home says "Prêt sans Internet" (the service worker controls the page: its first install claims it), switches the browser context offline and reloads. That is close to a phone in airplane mode, but not the same: test on a real phone before a release. The tabs test opens two pages in one browser context, as two tabs of one phone: "Quitter" in one locks the other, and the forgotten-code erase in one sends the other to the welcome.

## While GitHub Actions is unavailable

GitHub Actions refuses to start jobs on this account for now ("recent account payments have failed or your spending limit needs to be increased"), and the team does not pay for it at the moment. Until it can start jobs again, or until the repository becomes public (a team decision), a maintainer runs the four required checks on their own machine, then merges with `merge-pr.sh` as usual (`CONTRIBUTING.md`, step 7):

```sh
sh tools/ci/local-ci.sh <number>                 # every step, the server image included
sh tools/ci/local-ci.sh <number> --skip-docker   # without Docker: the server image is not built
sh tools/ci/local-ci.sh <number> --workers 1     # fewer browsers at once (default 2)
sh tools/ci/local-ci.sh <number> --test-timeout 60000   # longer time limits on a slow or loaded machine
sh tools/ci/local-ci.sh <number> --only end-to-end   # one job again, once the cause of its failure is known
sh tools/github/merge-pr.sh <number>
```

`--only` takes job names separated by commas: `text-hygiene`, `developer-certificate-of-origin`, `build-and-test`, `end-to-end`. The other jobs neither run nor get a status, so their statuses of an earlier run on the same commit stay.

What `tools/ci/local-ci.sh` does:

- It refuses, posting nothing, a pull request that is not open, that is behind `main` (the rule of `merge-pr.sh`), whose head moves while it is read, or whose workflows have a step it does not know (read the change of that pull request to the script, then run its version). It also refuses to start while something answers on `http://localhost:4173`, where the end-to-end tests serve the app (with `CI` set, Playwright never reuses a server already there): stop that server, or leave the job out with `--only`. A server that takes the port while the other jobs run leaves the End-to-end job not run, without a status.
- It runs the jobs one after the other (Text hygiene, Developer Certificate of Origin, Build and test, End-to-end), each in a fresh detached worktree at the exact head commit, in a temporary folder outside OneDrive (`$TMPDIR`, or `LOCAL_CI_TMPDIR`), removed at the end, also on failure. The steps are the steps of `ci.yml` and `hygiene.yml`, in the same order, with `CI=true`; a job stops at its first failed step, as on GitHub. `sh tools/ci/local-ci.sh --check-workflows` and the test of the script (`tools/ci/local-ci.test.sh`, run by the Build and test job) fail when either workflow gains, loses or renames a step.
- After each job, and only then, it posts a commit status on the head commit, named like the job: success when every step passed, failure naming the first failed step. The description says where and when it ran: "Local run on <machine>, <UTC time> (GitHub Actions unavailable)". With `--skip-docker`, the server image step is the only one not run, the description adds "server image build skipped (--skip-docker)", and the status is success only if every other step passed. For a Dependabot pull request, the Developer Certificate of Origin job is skipped as in `hygiene.yml` and no status is posted for it (`merge-pr.sh` then reports it missing).
- It prints the end of the output of a failed step, a summary (result and duration of each job), the failed checks GitHub Actions left on the commit, if any (see below), and the folder of the logs, one per job (by default `$TMPDIR/siapso-local-ci-logs/pr-<n>-<commit>-<time>/`), with the Playwright report when the end-to-end tests fail.

It needs `gh` signed in with the right to write commit statuses, git, Python 3, `shellcheck`, curl, the pnpm version `package.json` pins, any Node (when it is not the version `.nvmrc` names, that version is downloaded from nodejs.org into the cache, `$TMPDIR/siapso-local-ci-cache`, and checked against the SHA-256 list of the release), the Playwright Chromium (`pnpm --filter @siapso/app exec playwright install chromium`), and Docker unless `--skip-docker`. Run one at a time: the end-to-end tests use port 4173. The script that runs is the maintainer's copy, not the one of the pull request.

The first run installs the pinned `reuse` with pip into the cache. Behind an antivirus or a proxy that inspects TLS, pip may fail with `CERTIFICATE_VERIFY_FAILED`: give it the root certificates the system trusts with `PIP_CERT`, a PEM file. On Windows, PowerShell writes them with:

```powershell
@(Get-ChildItem Cert:\LocalMachine\Root) + @(Get-ChildItem Cert:\CurrentUser\Root) | ForEach-Object { "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks') + "`n-----END CERTIFICATE-----" } | Set-Content -Encoding ascii "$env:LOCALAPPDATA\system-roots.pem"
```

then, in Git Bash, `export PIP_CERT="$LOCALAPPDATA\\system-roots.pem"` before the script. Once `reuse` is in the cache, pip is not needed again until `tools/reuse/requirements.txt` changes.

Differences with GitHub Actions: no Ubuntu runner and no Playwright image, so the tests run on the maintainer's system, with the browsers Playwright installed there (the image check reads that folder instead); the fetch of `origin/main` is not shallow, since the worktree shares the maintainer's clone; on Windows, REUSE lint runs on a `git archive` export of the commit, away from long `node_modules` paths; Vitest runs at most 2 workers (one per core, its default, made the 5 and 10 second limits of the unit tests fail on a machine short of memory; `VITEST_MAX_WORKERS` changes it); the Playwright report of a failed run is kept with the logs instead of being uploaded.

Longer time limits, a local accommodation for a slow or loaded machine: `pnpm test:coverage` gets `--testTimeout=30000 --hookTimeout=60000` (Vitest's own limits are 5 and 10 seconds) and `pnpm e2e` gets `--timeout=60000` (Playwright's own is 30 seconds). A limit only measures speed: a test that passes with it asserts exactly what it asserts on GitHub Actions. `--test-timeout <ms>` changes the unit test limit, and the hooks and the end-to-end tests get twice it. It is at least 30000: a limit on the command line replaces the one a configuration sets, and `server/vitest.config.ts` sets 30 seconds for a test and 60 for a hook (the test of the script fails if a configuration sets a longer one). A test that sets its own limit in its code keeps it, as the merge guard tests of `app/src/result-wording.test.ts` keep their 60 seconds.

GitHub still records each job it refuses to start as a failed check of the commit, under the same name as the local status (its annotation says "The job was not started because recent account payments have failed..."), and `merge-pr.sh` refuses a pull request with a failed check. While Actions is unavailable, a maintainer therefore disables the two workflows, so that new commits only get the local statuses:

```sh
gh workflow disable CI
gh workflow disable hygiene
```

A commit pushed before that keeps its refused checks: push a new commit to the pull request (merging `main` makes one when the branch is behind), then run `local-ci.sh` on it. `local-ci.sh` names the failed checks of GitHub Actions it finds on the commit at the end of its run.

Going back to GitHub Actions: enable the workflows again (`gh workflow enable CI`, `gh workflow enable hygiene`), push a commit or re-run the checks of the open pull requests, and stop using `local-ci.sh`. Its statuses stay on the commits it checked, each saying it was a local run.

## Airplane mode on a real phone

The service worker only runs in a secure context: `https://` or `localhost`. A phone that opens the laptop by its network address (`http://192.168.x.x:4173`) gets no service worker, so the app cannot work offline that way. Use one of the two options below.

### Option 1: USB port forwarding (recommended)

The phone reaches the laptop's `localhost` through a USB cable, so nothing leaves the two devices.

1. On the laptop, build and serve the app (a demo build: it accepts the unsigned local pack and the screens say "Version de test", see `docs/pack-signing.md`; a release build is signed instead):

   ```sh
   pnpm install
   pnpm build
   pnpm --filter @siapso/app preview:demo
   ```

   The preview answers on `http://localhost:4173`.

2. On the Android phone, turn on the developer options and USB debugging (Settings, About phone, tap the build number seven times; then Settings, System, Developer options, USB debugging). Connect the phone with a USB cable and accept the debugging prompt.
3. On the laptop, open Chrome at `chrome://inspect/#devices`. Check "Discover USB devices", open "Port forwarding", add port `4173` to `localhost:4173`, check "Enable port forwarding" and press Done.
4. On the phone, open Chrome at `http://localhost:4173`. The phone now sees `localhost`, a secure context. Answer the welcome questions.
5. Let the first load finish: the service worker downloads the app and the knowledge pack in the background. Home says "Gardez Internet encore un moment : l'application se prépare pour fonctionner sans réseau." until it is done, then "Prêt sans Internet" (the status screen says the same under "Sur ce téléphone"). In `chrome://inspect`, "inspect" the phone's tab and check Application, Service workers: the worker is "activated and is running".
6. Add the app to the home screen: Chrome menu, "Add to Home screen" (or "Install app"). The icon is the notebook named "Carnet" (or `VITE_APP_NAME` when it was set at build time).
7. Close the app, unplug the cable and switch on airplane mode. Open the app from its home screen icon.

To start again from a fresh install, remove the home screen icon and clear the site data (Chrome, Settings, Site settings, All sites, localhost, Clear and reset).

### Option 2: a temporary HTTPS tunnel

When a cable is not possible (an iPhone, a phone without developer options, a tester elsewhere), a tunnel service such as Cloudflare Tunnel or ngrok gives the laptop's preview a temporary `https://` address.

Privacy trade-off: while the tunnel runs, anyone who learns the address can open the build, and every request passes through the tunnel provider's servers. Use test data only (never a real woman's profile or a real pseudonym), share the address only with the tester, and stop the tunnel as soon as the test ends.

1. Build and start the preview, allowing the tunnel's host name (Vite only answers `localhost` by default):

   ```sh
   pnpm build
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<tunnel host name> pnpm --filter @siapso/app preview:demo
   ```

2. Start the tunnel to `http://localhost:4173` and open its `https://` address on the phone.
3. Follow steps 4 to 7 of option 1 (without the cable).

Each new tunnel address is a different origin: the phone treats it as a new app, with its own storage and its own home screen icon.

## The first visit

**It needs the Internet.** A phone that opens the app for the very first time without the Internet gets the browser's own error page, even for the danger signs: a web app is not on the phone before its first load, and nothing in the app can change that. Wherever the app is handed out (a leaflet, a QR code at the health post, a relais showing it), say: open it once with the Internet, and keep the Internet on until Home says "Prêt sans Internet". Until then Home asks to keep the Internet on, so nobody goes home believing the phone is ready.

**What it downloads.** The page downloads the app, its font and the knowledge pack it needs; the service worker, registered before the first render, then downloads its precache (the app, both font files, the icons and the pack fragments). Hashed files (`assets/`) can be answered from the browser's cache, but Workbox fetches every other file again with `cache: 'reload'` to be sure the precache holds the exact version it lists, and the pack fragments keep the same names from one version to the next: the live test measured about 120 KB more on a first visit (339 KB in all instead of 217 KB). No simple change removes it without the risk of a stale precache: content-hashed pack file names, which would let the precache use the browser's cache, belong to the signed packs work (SCRUM-38). Workbox also fetches the precache one file after another, so the precache, not the page, sets how long a slow connection must stay on.

**Data kept for good.** After the welcome, and again at each start until the browser grants it (and when the app is installed), the app asks the browser to keep its data even when the phone runs short of space (`navigator.storage.persist()`). The status screen says what the browser answered: "Ce téléphone garde les données de l'application." or "Les données peuvent être effacées si le téléphone manque de place." Chrome grants it more easily once the app is installed on the home screen.

## What to check in airplane mode

- **Start:** the app opens from its home screen icon, with no browser error page and no "you are offline" page. The header shows "Hors ligne" ("Offline"), and Home says "Prêt sans Internet".
- **Status:** under "Sur ce téléphone", "Prêt sans Internet", and whether the phone keeps the app's data for good.
- **Sources:** on the About screen and in an accompanied-mode result, the source links say they open with the Internet; offline, a tap opens the browser's error page in another tab and the app keeps its screen.
- **Language:** the language chosen at the welcome screen is still the one in use, and the page language follows it.
- **Looking up a product:** from Home, "Regarder un produit" ("Look up a product"): search, confirm a product and its units, add a remedy (from SCRUM-24).
- **A result:** the result screen shows the level, its name and pictogram, who to show and when, the knowledge base version and the fixed sentences (from SCRUM-25).
- **Danger signs:** the "Signes de danger" button in the header opens the danger signs from every screen, with "Allez au poste de santé maintenant.", the signs in three groups and "C'est grave maintenant". With or without a sign ticked, it opens "Qui appeler" with "Allez au poste de santé maintenant.", the signs ticked to say and the contacts (from SCRUM-26).
- **Signs in a check:** "Voir le résultat" first asks "Avez-vous un de ces signes maintenant ?" ("A-t-elle..." in accompanied mode), "Aucun de ces signes" first; a sign ticked there gives a danger card in the result (from SCRUM-26).
- **Who to call:** contacts saved on the phone and those of the deployment's `referral.json` are listed with their numbers; "Appeler" opens the phone's dialler with the number (the call itself needs the phone network, not the internet). Always, locked or not and in both modes, right under the title after the contacts: the links "Appeler le SAMU (1515)" and "Appeler les pompiers (18)" (or the deployment's numbers); then the danger instruction, the signs to say, and "Allez au poste de santé ou au centre de santé le plus proche." (the deployment's circuit text under it). On a small phone the first call link is in the first screen, whatever the instruction. Without any contact: "Aucun contact enregistré sur ce téléphone." and, once the code is given, "Ajouter un contact", in woman mode too; saving the contact comes back to "Qui appeler" with its "Appeler". The contacts screen ("Contacts à appeler") has an "Appeler" link on every number. The app never says a message was sent or that someone is coming.
- No screen offers an action that needs the network without saying so.
