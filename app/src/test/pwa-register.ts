// SPDX-License-Identifier: MIT
// Stands in for `virtual:pwa-register/react` in unit tests (see vitest.config.ts):
// the virtual module only exists in a Vite build with vite-plugin-pwa. Tests
// that exercise the update flow replace it with vi.mock. Types come from the
// real module declaration (vite-plugin-pwa/react), not from this file.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => undefined] as const,
    offlineReady: [false, () => undefined] as const,
    updateServiceWorker: () => Promise.resolve(),
  };
}
