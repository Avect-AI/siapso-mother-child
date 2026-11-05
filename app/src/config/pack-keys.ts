// SPDX-License-Identifier: MIT
// The public keys that may sign the knowledge pack (docs/pack-signing.md).
//
// This list is EMPTY on purpose: key custody belongs to the team. The team
// generates the release key pair offline with
//   pnpm knowledge:keygen --out <a file outside the repository> --key-id <id>
// keeps the private key file offline (never in this repository, never sent),
// and adds here the entry that command prints, through a pull request. Only
// public keys ever go in this file.
//
// While the list is empty, the release build (`pnpm release:build`) fails;
// only a demo build (`pnpm build` at the repository root, Vite mode demo with
// VITE_ALLOW_UNSIGNED_PACK from app/.env.demo, into app/dist-demo) can be
// made, which accepts an unsigned pack and must never be published.
//
// Rotation: add the new key next to the old one, sign new packs with it, and
// remove the old key once it is no longer used. A compromised key is removed
// at once: the app then refuses every pack it signed, the one stored on the
// phone included.

export interface PackPublicKey {
  /** The manifest's keyId that selects this key. */
  readonly keyId: string;
  /** The 32-byte Ed25519 public key, in base64. */
  readonly publicKey: string;
}

export const PACK_PUBLIC_KEYS: readonly PackPublicKey[] = [];
