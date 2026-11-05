<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Knowledge pack signing

The knowledge pack decides the alert levels the app shows to pregnant and breastfeeding women. A tampered pack, or an old pack replayed in place of a newer one, could lower an alert. The app therefore uses a pack only when its origin is proven by a signature, never goes back to an older version on its own, and keeps the previous pack for a rollback chosen by the user. The threats and their limits are in `docs/threat-model.md`.

## Format

`pnpm knowledge:build` writes the pack to `app/public/pack/`: one JSON file per fragment, `pack.json` (the whole pack, never read by the app) and `manifest.json`, which lists the version, the date and, for each fragment, its file name, sha256 and size. The build does not sign anything.

`siapso-pack sign` then:

1. checks that every fragment still matches the manifest (a manifest is never signed for files it does not describe);
2. adds `"keyId": "<id>"` to `manifest.json`, which names the key that signed it;
3. writes `manifest.sig`: the Ed25519 signature (RFC 8032) of the exact bytes of `manifest.json`, in base64, followed by a newline;
4. warns when `app/src/config/pack-keys.ts` does not list that key id with that public key (the app and a release build would refuse the pack).

The fragments are bound to the signature through their sha256 in the signed manifest. Ed25519 comes from `@noble/ed25519` 3.2.0 with SHA-512 from `@noble/hashes` 2.4.0, in the tools and in the app; the app verifies with the strict RFC 8032 checks.

When `knowledge/pack.yaml` sets `minimum-safe-version`, the manifest carries it as `minimumSafeVersion`, so it is signed with the rest (see "Withdrawing a pack").

## Versions: raise the version at every publication

The version in `knowledge/pack.yaml` must be raised for every published pack, whatever changed (a rule, a message, the date, the clinical validation, the minimum safe version). The app takes a pack only when its version is strictly above the active one: a pack with the same version and other content is refused, even validly signed. Only the very same pack (same version, date, validation, minimum safe version and fragments) is taken again, for example signed with a new key during a rotation, and then nothing is downloaded.

## Withdrawing a pack: the minimum safe version

`minimum-safe-version` in `knowledge/pack.yaml` (optional, at most `version`) names the lowest pack version that is still safe to use. Set it when an earlier pack must never be used again, for example one with a rule that lowered an alert by mistake: set it to the first fixed version.

- A rollback is allowed only to a version at or above the highest minimum safe version known on the phone: the one of the active pack and the one of the pack built with the app (`__MIN_SAFE_PACK_VERSION__`). The Status screen does not offer the button otherwise.
- At start, a pack the user rolled back to that is below the minimum safe version of the pack built with the app is set aside: the app pack replaces it and the rollback mark goes, even when the app pack is the very version the user left. The phone is never left without a pack because of a rollback.
- Without the field, everything works as before.
- **Once set, it never decreases and is never removed**: lowering or dropping it would let phones go back to a pack the team withdrew. `pnpm knowledge:check` compares it with its value on `origin/main` and fails otherwise (`--base <ref>` compares with another revision). CI fetches `origin/main` before the check; locally the comparison is skipped when `origin/main` or git is not available.

## What the app does

Each time it starts, `loadPack` (`app/src/data/pack-loader.ts`):

1. Downloads `manifest.json`. When it names a `keyId`, it downloads `manifest.sig` and checks it with the public key of that id in `app/src/config/pack-keys.ts`. A manifest without `keyId`, with an unknown `keyId`, without `manifest.sig` or with a signature that does not match is refused.
2. Checks the version (semantic version order, so `0.10.0` is above `0.9.0` and a pre-release is below its release):
   - never below the **floor**, the version of the pack built with the app (`__MIN_PACK_VERSION__`, read from `app/public/pack/manifest.json` at build time), whatever the state of the phone's storage: first install, cleared data, a storage that does not answer or cannot be read, a stored pack whose key was revoked;
   - strictly above the pack active on the phone, and above any version rolled back on it.
3. Downloads only the fragments whose sha256 differs from the active pack and reuses the others from the phone. Each downloaded fragment is checked against its size and sha256, then the whole pack against the engine's schema (`parsePack`). Nothing is activated before every check has passed: a partially updated pack is never used.
4. Hands the pack to the app and stores it in IndexedDB in the background. The pack it replaces is kept as the previous pack. The storage checks the versions again inside its transaction (another tab may have stored a newer pack meanwhile).
5. When the download fails or is refused, uses the pack stored on the phone, if this build still trusts it (signed by a key still listed, or a demo build) and it is not below the floor. A refused pack is logged in the console, by its reason only (never key material), and the Status screen says which case it is: the base could not be loaded, a new base was refused, or the previous version was put back. In accompanied mode it also shows the technical reason.

**Rollback.** In accompanied mode, once the code is given, the Status screen offers "Revenir à la version X" when a previous version is kept on the phone that this build trusts, that is valid, and that is not below the minimum safe version, and asks to confirm. `rollbackPack()` then makes the previous pack active at once (no reload) and drops the newer one; the version it left is not taken again, only a higher one. A pack the user rolled back to is kept even below the floor (going back is their choice), but not below the minimum safe version of the pack built with the app.

The service worker precaches `manifest.sig` with the manifest and the fragments, so a signed pack also works in airplane mode.

## Builds

| Build                   | Command (repository root)         | Vite mode     | Output          | `VITE_ALLOW_UNSIGNED_PACK`                 | `pack-keys.ts`  | Packs accepted                                                                                               |
| ----------------------- | --------------------------------- | ------------- | --------------- | ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------ |
| Release (MVP and later) | `pnpm release:build --key <file>` | `production`  | `app/dist`      | refused: the build fails if set            | the team key(s) | only a pack signed by a listed key                                                                           |
| Test or demo build      | `pnpm build`                      | `demo`        | `app/dist-demo` | `true`, from `app/.env.demo`               | any             | also an unsigned pack, or one signed by a key it does not know; a bad signature from a listed key is refused |
| Development server      | `pnpm --filter @siapso/app dev`   | `development` | none            | set by hand to use the local unsigned pack | any             | as above when set; the server only warns otherwise                                                           |

`pnpm build` is the demo build, so it works for everyone without a key. A demo build never goes to `app/dist`, where a release goes: the build stops if asked to. The preview of a demo build is `pnpm --filter @siapso/app preview:demo` (it serves `app/dist-demo`).

Every build that does not accept unsigned packs, whatever its Vite mode (production, or another mode without the flag), fails with a clear message when:

- `VITE_ALLOW_UNSIGNED_PACK=true` is set in production mode;
- `pack-keys.ts` lists no public key (the app would refuse every pack);
- the pack in `app/public/pack` is not signed, is signed with a key id that `pack-keys.ts` does not list, or its signature does not hold. The build checks it with the same code as the app (`checkOrigin`).

**Build marker.** Every build writes `build-info.json` next to the app: the Vite mode, whether the build accepts unsigned packs, and the version, minimum safe version and key id of the pack it ships. It holds no secret and is not precached. A release has `"mode": "production"`, `"acceptsUnsignedPack": false` and a `packKeyId`.

A demo build prints a warning in capitals at build time, and the Status and About screens show "Version de test : base de connaissances non signée." ("Test version: unsigned knowledge base.") in every build that accepts unsigned packs, whatever the pack in use, and for any unsigned pack. Only the exact value `true` of the variable counts, and only outside production mode.

CI makes demo builds only (the "Build and test" job and the Playwright web server of the "End-to-end" job), checks that a production build stops with the signing refusal, and never publishes or signs anything. The unit tests sign and verify with keys generated during the test run and never written outside temporary directories.

The v0.1.0 demo may be a demo build, as the dossier allowed ("signature if time allows"); its risk is described in `docs/threat-model.md`. The MVP release must be signed: `pnpm release:build` with the team key in `pack-keys.ts`.

## Key custody: team actions

Key custody belongs to the team. No key was generated for this repository, `pack-keys.ts` is committed empty, and no secret was set. A private key never goes into the repository, a pull request, an issue, a chat, an email or a shared document.

1. **Generate the release key offline**, on a trusted machine without network if possible, from a clone of the repository:

   ```sh
   pnpm install
   pnpm knowledge:keygen --out /media/offline-drive/siapso-pack-2026-11.json --key-id siapso-2026-11
   ```

   The command writes the private key to that file (it never prints it), refuses a path inside the repository or inside any git work tree (links and Windows junctions are resolved first), refuses a folder that does not exist, and never overwrites a file. On Linux and macOS the file is readable by its owner only; **on Windows that file mode is ignored**, so keep the file on an encrypted drive. Never put it in a synced folder (OneDrive, Google Drive, Dropbox, iCloud): a copy would leave the machine. The command prints the public entry to add to the app.

2. **Add the public key** to `PACK_PUBLIC_KEYS` in `app/src/config/pack-keys.ts`, exactly as printed, in a pull request:

   ```ts
   export const PACK_PUBLIC_KEYS: readonly PackPublicKey[] = [
     { keyId: 'siapso-2026-11', publicKey: '<base64 printed by keygen>' },
   ];
   ```

   A second person checks that `publicKey` is the `publicKey` field of the key file. The unit tests check that every listed key is 32 bytes of base64 with a unique, plain key id.

3. **Store the private key file offline**: an encrypted drive kept by a named maintainer, plus a second copy in another place (or the team's password manager). Never on a shared phone, never in cloud storage.

4. **No CI signing for now.** CI does not sign packs. A repository secret is readable by anyone who can push a workflow change, so signing will be added to the release workflow (task 22) with a protected GitHub environment that only the release job, after approval, can use. Until then, sign releases offline (step 5).

5. **Release build**, from the repository root, with the key file the maintainer keeps offline:

   ```sh
   pnpm release:build --key /media/offline-drive/siapso-pack-2026-11.json
   ```

   It runs `pnpm knowledge:build`, `pnpm knowledge:sign --key <file>` (which refuses a key file inside a repository, links resolved, and warns when `pack-keys.ts` does not list the key), then the production build of the app into `app/dist` (which refuses a pack not signed by a listed key). It then checks the build marker `app/dist/build-info.json` (`"mode": "production"`, `"acceptsUnsignedPack": false`, a `packKeyId`) and the app size budget, and stops on any problem. Before publishing, read `app/dist/build-info.json` once more, check that `app/dist/pack/manifest.sig` exists, and check on a phone that Status shows no "Version de test" line.

## Key rotation

- **Planned rotation:** generate a new key pair with a new `keyId`, add its public key next to the old one and release the app. Sign the next packs with the new key. Once the phones have taken the app update, remove the old key in a later release.
- **Compromised key:** remove its entry from `pack-keys.ts` at once and release the app with a pack signed by a new key and a higher version. An app without the key refuses every pack the key signed, the one stored on the phone included, and takes the new signed pack (never below the version built with it). Limit: a phone that has not yet taken the app update still trusts the old key.
