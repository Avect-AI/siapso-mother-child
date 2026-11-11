<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Android app

The Android app installs SIAPSO Mother-Child on a phone without a laptop, and opens it without Wi-Fi or Internet from its first launch. It is the same web app, packaged with [Capacitor](https://capacitorjs.com) 8 in an APK that holds the app, the knowledge pack and the prescription reading pack (SCRUM-63).

## Why Capacitor

- **Offline from the first launch.** `cap sync` copies the web build into the APK, and the app reads it from the phone through Capacitor's local server (`https://localhost`). A Trusted Web Activity (Bubblewrap, PWABuilder) loads the hosted site instead, and its first launch needs the network ([Chrome documentation](https://developer.chrome.com/docs/android/trusted-web-activity/offline-first)).
- **Same code.** No screen is rewritten: the React app, the rules engine, the resolver and the readers are the ones of the web app.
- **As other community health tools do.** The Community Health Toolkit, ODK Collect and CommCare ship a signed APK, through Google Play and by direct installation without the network ([CHT](https://docs.communityhealthtoolkit.org/building/branding/publishing/), [ODK](https://docs.getodk.org/collect-install/)).

## What the test APK holds

| Part                                      | In the test APK | Note                                                                                                              |
| ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| App, fonts, icons                         | Yes             | The demo build: "Version de test", unsigned knowledge pack accepted (`docs/pack-signing.md`)                      |
| Knowledge pack                            | Yes             | `pnpm knowledge:build`                                                                                            |
| Prescription reading pack (about 29 MB)   | Yes             | `pnpm ocr:install-local --download`: pinned models, checked by SHA-256 (`docs/ocr.md`)                            |
| Voice packs (137 MB French, 326 MB Wolof) | No              | Not published yet: a decision of the team, and the open licence question of the Wolof pack (`speech/LICENSES.md`) |

The service worker of the web app runs in the APK too: Capacitor sends its requests to the same local server (`android.resolveServiceWorkerRequests` in `app/capacitor.config.json`), so it keeps its role (offline cache, cross-origin isolation for the speech model).

Privacy: the app declares `android:allowBackup="false"` and data extraction rules that exclude everything, so no backup or device transfer copies its data off the phone. Permissions: the camera (the camera button of "Lire une ordonnance"), the microphone (voice input, on the phone) and the Internet (only to download an update or a voice when asked).

## Known limits

Measured by the smoke test on the Android 15 emulator (WebView 124), 2026-11-11:

- **One thread for the speech model.** Android WebView does not make a page cross-origin isolated, even with the headers of the service worker (`crossOriginIsolated` stays false), so the speech model would run on one thread in the APK, slower than in Chrome. It does not affect this APK, which holds no voice pack.
- **The first launch prepares for a few seconds.** The service worker installs from the APK's own files at the first launch; until it is active (a few seconds), Home may still ask to keep the Internet on. In the APK every file is already on the phone, so that message could say ready at once: to review with the screens.
- **The network.** A WebView does not follow the network by itself: `MainActivity` tells it, so `navigator.onLine` and the "Hors ligne" badge match the phone.

## Get the test APK

Every pull request that changes the app runs the workflow **Android** (`.github/workflows/android.yml`); it also runs on demand from the Actions tab ("Run workflow"). It builds the APK, then installs it on an Android 15 emulator with 2 GB of RAM in airplane mode and checks that the app opens offline at its first launch, with its knowledge pack, its prescription reading pack and the danger signs (`app/scripts/android-smoke.mjs`). The APK is the artifact `carnet-android-test-apk` of the run (30 days); the screenshots and the report of the check are the artifact `android-smoke-test`.

The test APK is signed with a debug key: it is for tests only, never for distribution.

## Install it on a phone

1. Download the artifact `carnet-android-test-apk` from the run, unzip it, and copy the `.apk` file to the phone (USB cable, Quick Share, Bluetooth, an SD card).
2. On the phone, open the file from the Files app. Android asks to allow this app to install unknown apps: allow it for the Files app only.
3. Install. Play Protect may warn about an app it does not know: it is the test APK, from this repository.
4. Open "Carnet". It works in airplane mode at once.

Once a phone has the `.apk` file, it can pass it to another phone without the network (Quick Share, Bluetooth, an SD card).

## Build it locally

Prerequisites: those of the web app (`README.md`), JDK 21 and the Android SDK (Android Studio installs both).

```sh
pnpm install
pnpm ocr:install-local --download
pnpm build
pnpm --filter @siapso/app android:sync
cd app/android
./gradlew assembleDebug
```

The APK is `app/android/app/build/outputs/apk/debug/app-debug.apk`. To open the project in Android Studio instead: `pnpm --filter @siapso/app exec cap open android`. With an emulator running or a phone plugged in with USB debugging, `node app/scripts/android-smoke.mjs <apk> <folder>` runs the same check as CI.

The launcher icons and the launch screens are rendered from the notebook drawing of `app/public/icons/`: `pnpm --filter @siapso/app icons:android`.

## Before a public release

Not done yet, each a decision or a step for the team:

- a release build signed with the team's key, kept safe and backed up (a lost key means no update can ever be installed), uploaded to Play App Signing so Google Play and the direct APK share it ([Android documentation](https://developer.android.com/studio/publish/app-signing));
- Android developer verification of AVECT AI SARL (a D-U-N-S number for an organisation): from 2027 a certified phone installs only apps of verified developers, whatever the source ([Android documentation](https://developer.android.com/developer-verification/guides));
- a Google Play listing (closed testing for the pilot, then production);
- the voice packs: a signed pack file imported from the phone's storage, and on-demand packs from Google Play;
- the `appId` (`com.avectai.siapso`) is final once the app is on Google Play.
