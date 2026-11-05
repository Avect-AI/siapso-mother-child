// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** The name on the phone's home screen and in the header; "Carnet" when unset. */
  readonly VITE_APP_NAME?: string;
  /**
   * "true" makes a test or demo build that accepts an unsigned knowledge
   * pack (docs/pack-signing.md); a release build never sets it.
   */
  readonly VITE_ALLOW_UNSIGNED_PACK?: string;
}

/**
 * The version of the pack built with the app (app/public/pack/manifest.json,
 * read by vite.config.ts): the loader never accepts a lower one. Null when
 * no pack was built (the development server, the unit tests).
 */
declare const __MIN_PACK_VERSION__: string | null;

/**
 * The minimum safe version of the pack built with the app, when its manifest
 * names one (read by vite.config.ts): no rollback below it, and a pack rolled
 * back to below it is replaced. Null otherwise.
 */
declare const __MIN_SAFE_PACK_VERSION__: string | null;
