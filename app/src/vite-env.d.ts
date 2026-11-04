// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** The name on the phone's home screen and in the header; "Carnet" when unset. */
  readonly VITE_APP_NAME?: string;
}
