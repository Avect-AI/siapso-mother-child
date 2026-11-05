# Testing

## Automated checks

Run from the repository root (Node 24, pnpm 12):

| Command                                            | What it checks                                                                                                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | ESLint, Prettier and TypeScript over the workspace.                                                                                                                                                                                       |
| `pnpm test`                                        | Unit and component tests (Vitest, Testing Library, fake IndexedDB).                                                                                                                                                                       |
| `pnpm build`                                       | Builds the knowledge pack into `app/public/pack/`, then the app into `app/dist/`.                                                                                                                                                         |
| `pnpm budget:app`                                  | The app (`app/dist` without `pack/` and `voice/`) stays at or under 1.5 MB. Run after `pnpm build`.                                                                                                                                       |
| `pnpm e2e`                                         | Playwright on the production build (`pnpm preview`, port 4173), at 360 x 800 and on a desktop viewport: airplane mode after one load, the precache, the language choice across reloads, axe scans and large text. Run after `pnpm build`. |

The first time, install the browser: `pnpm --filter @siapso/app exec playwright install chromium`. On a machine with little free memory, run fewer browsers at once: `pnpm e2e --workers=2`.

The offline test loads the app once, waits for the service worker to control the page, switches the browser context offline and reloads. That is close to a phone in airplane mode, but not the same: test on a real phone before a release.

## Airplane mode on a real phone

The service worker only runs in a secure context: `https://` or `localhost`. A phone that opens the laptop by its network address (`http://192.168.x.x:4173`) gets no service worker, so the app cannot work offline that way. Use one of the two options below.

### Option 1: USB port forwarding (recommended)

The phone reaches the laptop's `localhost` through a USB cable, so nothing leaves the two devices.

1. On the laptop, build and serve the app:

   ```sh
   pnpm install
   pnpm build
   pnpm --filter @siapso/app preview
   ```

   The preview answers on `http://localhost:4173`.

2. On the Android phone, turn on the developer options and USB debugging (Settings, About phone, tap the build number seven times; then Settings, System, Developer options, USB debugging). Connect the phone with a USB cable and accept the debugging prompt.
3. On the laptop, open Chrome at `chrome://inspect/#devices`. Check "Discover USB devices", open "Port forwarding", add port `4173` to `localhost:4173`, check "Enable port forwarding" and press Done.
4. On the phone, open Chrome at `http://localhost:4173`. The phone now sees `localhost`, a secure context. Answer the welcome questions.
5. Let the first load finish: the service worker downloads the app and the knowledge pack in the background. In `chrome://inspect`, "inspect" the phone's tab and check Application, Service workers: the worker is "activated and is running". Reload the page once.
6. Add the app to the home screen: Chrome menu, "Add to Home screen" (or "Install app"). The icon is the notebook named "Carnet" (or `VITE_APP_NAME` when it was set at build time).
7. Close the app, unplug the cable and switch on airplane mode. Open the app from its home screen icon.

To start again from a fresh install, remove the home screen icon and clear the site data (Chrome, Settings, Site settings, All sites, localhost, Clear and reset).

### Option 2: a temporary HTTPS tunnel

When a cable is not possible (an iPhone, a phone without developer options, a tester elsewhere), a tunnel service such as Cloudflare Tunnel or ngrok gives the laptop's preview a temporary `https://` address.

Privacy trade-off: while the tunnel runs, anyone who learns the address can open the build, and every request passes through the tunnel provider's servers. Use test data only (never a real woman's profile or a real pseudonym), share the address only with the tester, and stop the tunnel as soon as the test ends.

1. Build and start the preview, allowing the tunnel's host name (Vite only answers `localhost` by default):

   ```sh
   pnpm build
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<tunnel host name> pnpm --filter @siapso/app preview
   ```

2. Start the tunnel to `http://localhost:4173` and open its `https://` address on the phone.
3. Follow steps 4 to 7 of option 1 (without the cable).

Each new tunnel address is a different origin: the phone treats it as a new app, with its own storage and its own home screen icon.

## What to check in airplane mode

- **Start:** the app opens from its home screen icon, with no browser error page and no "you are offline" page. The header shows "Hors ligne" ("Offline").
- **Language:** the language chosen at the welcome screen is still the one in use, and the page language follows it.
- **Looking up a product:** from Home, "Regarder un produit" ("Look up a product"): search, confirm a product and its units, add a remedy (from SCRUM-24).
- **A result:** the result screen shows the level, its name and pictogram, who to show and when, the knowledge base version and the fixed sentences (from SCRUM-25).
- **Danger signs:** the "Signes de danger" button in the header opens the danger signs from every screen, with "Allez au poste de santé maintenant.", the signs in three groups and "C'est grave maintenant". With or without a sign ticked, it opens "Qui appeler" with "Allez au poste de santé maintenant.", the signs ticked to say and the contacts (from SCRUM-26).
- **Signs in a check:** "Voir le résultat" first asks "Avez-vous un de ces signes maintenant ?" ("A-t-elle..." in accompanied mode), "Aucun de ces signes" first; a sign ticked there gives a danger card in the result (from SCRUM-26).
- **Who to call:** contacts saved on the phone and those of the deployment's `referral.json` are listed with their numbers; "Appeler" opens the phone's dialler with the number (the call itself needs the phone network, not the internet). Without any contact: "Aucun contact enregistré sur ce téléphone." The app never says a message was sent or that someone is coming.
- No screen offers an action that needs the network without saying so.
