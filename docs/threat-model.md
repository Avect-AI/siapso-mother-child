<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Threat model

This document lists what SIAPSO Mother-Child protects, against whom, how, and what it does not protect against. It covers the knowledge pack (SCRUM-38, details in `docs/pack-signing.md`). The threats on the phone itself (casual access on a shared phone, the code, the quick exit, a forensic attacker) are in `docs/privacy.md`; a lost phone is added with the encryption at rest (SCRUM-39).

## What is protected

- **The alert levels.** The deterministic engine sets every level from the knowledge pack (rules, products, plants, danger signs, messages). A wrong pack can lower an alert for a pregnant or breastfeeding woman: its integrity and freshness are a safety matter.
- **Personal data on the phone** (profiles, history, contacts): see `docs/privacy.md`.

## Knowledge pack

### Tampered pack

Someone changes the pack files, and only them: a CDN or a cache that serves altered or mixed files, a bad deploy that ships pack files that were not signed together, and, in the future, a copy passed from phone to phone.

- `manifest.json` is signed with Ed25519 (`manifest.sig`, over its exact bytes) and every fragment is bound to it by its sha256 and size. The app checks the signature with the public keys built into it before trusting anything in the manifest, checks every fragment it downloads, and validates the whole pack with `parsePack`.
- Nothing is activated before every check has passed, and a refused pack leaves the active one in use. A pack signed by an unknown key, or without a signature, is refused by a release build, and a release build refuses to be made with such a pack.
- Limit: the signature covers the pack, not the app. A host that serves a modified app can ship other keys or no check at all (see "Out of scope").
- Residual risk: none known for the pack content while the private key stays secret. A refused update leaves the phone on its current pack (see "Withheld updates").

### Replayed old pack

Someone serves an older pack, validly signed by the team at the time, to bring back content that was corrected.

- The version is inside the signed manifest. The app never takes a version below the version of the pack built with it (the floor), whatever the state of the phone's storage: first install, cleared data, a storage that does not answer or cannot be read, a stored pack whose key was revoked. Above the floor, it takes only a version strictly above the active pack, and above any version rolled back on the phone; a pack of the same version with other content is refused. The storage checks the versions again inside its transaction. A fragment cannot be swapped for an older one, since its sha256 is in the signed manifest.
- Residual risk: between the floor and the active version nothing older is taken, so a replay can only bring back a pack at or above the version the app was built with. A user who rolls back keeps the previous pack, even below the floor: that is their choice, made in accompanied mode after the code, within the limit below.

### Rollback to a withdrawn pack

Someone, or a hurried accompanying person, goes back to a pack the team has withdrawn because it lowered an alert.

- `minimum-safe-version` in `knowledge/pack.yaml` is written into the signed manifest, so it cannot be forged. A rollback is allowed only to a version at or above the highest minimum safe version known: the active pack's and the one of the pack built with the app; the Status screen hides the button otherwise.
- A pack the user rolled back to that is below the minimum safe version of the pack built with the app is set aside at start: the app pack replaces it and the rollback mark is cleared, even when that brings back the very version the user left. The withdrawal wins over the user's earlier choice, and the phone is never left without a pack.
- Without the field, rollbacks work as before: the team sets it when a pack must never come back.

### A stored pack below the floor is no longer a fallback

This is a deliberate trade-off. When the download fails, the app uses the pack stored on the phone only if it is not below the version built with the app (unless the user rolled back to it, within the minimum safe version). A phone that keeps an older pack and cannot read the pack built with the app (no service worker yet, storage trouble) therefore has no pack rather than an old one: the danger signs and who to call still work, and the Status screen says the base is not available. An old pack can give a lower alert than the current content; saying plainly that the base is missing, so that the woman is sent to a health worker, is the safer failure for a pregnant or breastfeeding woman than a confident answer from withdrawn content. In normal use the service worker serves the pack built with the app, so this case is rare.

### Withheld updates

Someone blocks the pack download, so that a phone keeps an old pack.

- The app keeps working with the pack it has, and every result shows the knowledge base version and date. There is no expiry date.
- Accepted risk: availability is not protected; a network attacker can always withhold traffic.

### Compromised signing key

The private key leaks.

- The private key never enters the repository: the release key is generated by `siapso-pack keygen`, which writes it to a file (never to the screen), refuses any path inside a repository (links and Windows junctions resolved), and is kept offline; the repository holds only public keys. CI does not sign: a repository secret is readable by anyone with push access, through a workflow change, so signing will come with the release workflow and a protected environment.
- Each key has a `keyId`. Removing a key from `app/src/config/pack-keys.ts` and releasing the app revokes it: the app then refuses every pack that key signed, the one stored on the phone included, and takes a new signed pack (never below the version built with it). Rotation steps are in `docs/pack-signing.md`.
- Residual risk: a phone keeps trusting a revoked key until it takes the app update (the app asks before it updates). On Windows the key file is not made private to its owner: it must live on an encrypted drive, never in a synced folder.

### Unsigned test and demo builds

A demo build (`pnpm build`, Vite mode `demo`, with `VITE_ALLOW_UNSIGNED_PACK=true` from `app/.env.demo`) accepts an unsigned pack, or one signed by a key it does not know, so the signature protects nothing in it (a bad signature from a listed key is still refused, and the version and hash checks still apply).

- Limits: the flag counts only outside production mode, and only with the exact value `true`. Every build that does not accept unsigned packs (`pnpm release:build`, or any mode without the flag) fails when no public key is listed or when its own pack is not signed by a listed key, and a production build fails when the flag is set, so a release that silently accepts unsigned packs, or that would refuse every pack, is never produced by mistake.
- A demo build cannot pass for a release: it goes to `app/dist-demo`, never to `app/dist` where a release goes; its `build-info.json` marker says `"mode": "demo"` and `"acceptsUnsignedPack": true`, and `pnpm release:build` checks the marker of the release before it reports success; it prints a warning at build time; and its Status and About screens say "Version de test : base de connaissances non signée." whatever the pack in use. CI makes demo builds only and never publishes them. A release build refuses a pack that a demo build stored on the same phone and downloads a signed one.
- Risk: a demo build given to real users would accept any pack served from its origin; the screens say it is a test version. The v0.1.0 demo may be a demo build (its content is not clinically validated); the MVP release must be signed.

## Out of scope

- A forensic attacker with the phone and unlimited time, including one who edits the app's storage on the phone.
- A compromised build machine or web host that serves a modified app: the signature protects the pack, not the app code, which can carry other keys. The deployment's host and access control protect the app.
- The evaluation API (`server/`), which reads `pack.json` from the team's own build; `pack.json` is not signed and the app never reads it.
- Denial of service against the download (see "Withheld updates").
