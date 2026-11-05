// SPDX-License-Identifier: MIT
// Whether the app runs as an installed app (added to the home screen): its
// window has no browser menu, so the microphone is allowed again from the
// phone's settings, not from Chrome's three dots (live test round 2).

/** Display modes of an installed app's window: no address bar, no browser menu. */
const APP_MODES = ['standalone', 'fullscreen'] as const;

/** True when the page runs in the window of an installed app. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const inAppWindow =
    typeof window.matchMedia === 'function' &&
    APP_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  // Safari on iOS says it with navigator.standalone.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return inAppWindow || iosStandalone;
}
