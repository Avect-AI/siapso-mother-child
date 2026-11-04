// SPDX-License-Identifier: MIT
import { useEffect, useRef, type ReactNode } from 'react';
import { Redirect, Router, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { APP_NAME } from './config.js';
import type { Mode } from './domain/types.js';
import { I18nProvider, useT } from './i18n/index.js';
import { Danger } from './screens/Danger.js';
import { Home } from './screens/Home.js';
import { ProfileEdit, type ProfileTarget } from './screens/ProfileEdit.js';
import { Welcome } from './screens/Welcome.js';
import { useApp } from './state/app-state.js';
import { Header } from './ui/Header.js';

type Screen = 'loading' | 'welcome' | 'home' | 'danger' | 'profile';

/**
 * The profile a route opens. A woman has one profile: /profile and
 * /profile/new both open hers. In accompanied mode both open a new one (the
 * list of profiles comes with the codes). /profile/<id> opens that profile.
 */
function profileTarget(location: string, mode: Mode | null): ProfileTarget | null {
  if (location === '/profile' || location === '/profile/new') {
    return mode === 'accompanied' ? { kind: 'new' } : { kind: 'mine' };
  }
  const match = /^\/profile\/([^/]+)$/.exec(location);
  return match?.[1] ? { kind: 'edit', id: decodeURIComponent(match[1]) } : null;
}

/**
 * The screen for a hash route. Danger signs open from anywhere and at once,
 * even before the stored settings are read or the welcome questions answered;
 * anything else waits for the settings ('loading' shows nothing, a few
 * milliseconds normally), then for the welcome answers. Unknown routes get
 * null and are sent home.
 */
function screenFor(
  location: string,
  ready: boolean,
  onboarded: boolean,
  profile: ProfileTarget | null,
): Screen | null {
  if (location === '/danger') return 'danger';
  if (!ready) return 'loading';
  if (!onboarded) return 'welcome';
  if (profile) return 'profile';
  return location === '/' ? 'home' : null;
}

/** A name for what is on screen, so a change of profile counts as a new screen. */
function screenKey(screen: Screen | null, profile: ProfileTarget | null): string | null {
  if (screen !== 'profile' || !profile) return screen;
  return profile.kind === 'edit' ? `profile:${profile.id}` : `profile:${profile.kind}`;
}

function Screens() {
  const [location] = useLocation();
  const { settings, settingsReady, online } = useApp();
  const t = useT();
  const profile = profileTarget(location, settings.mode);
  const screen = screenFor(location, settingsReady, settings.onboarded, profile);
  const key = screenKey(screen, profile);
  const shown = useRef(key);

  // A new screen takes the focus to its heading, so a screen reader starts
  // reading it from the top; not on the first screen of a load, which starts
  // there anyway.
  useEffect(() => {
    const previous = shown.current;
    if (previous === key) return;
    shown.current = key;
    if (previous === 'loading') return;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [key]);

  if (screen === null) return <Redirect to="/" replace />;
  if (screen === 'loading') return null;
  return (
    <>
      {screen === 'welcome' ? null : (
        <Header
          appName={APP_NAME}
          dangerLabel={t('header.danger')}
          offlineLabel={t('header.offline')}
          online={online}
          current={screen === 'home' || screen === 'danger' ? screen : null}
        />
      )}
      {screen === 'welcome' ? <Welcome /> : null}
      {screen === 'home' ? <Home /> : null}
      {screen === 'danger' ? <Danger /> : null}
      {screen === 'profile' && profile ? <ProfileEdit key={key} target={profile} /> : null}
    </>
  );
}

/**
 * Routes and layout: hash routes (every route is the same index.html, online
 * or offline), the header on every screen after Welcome, then the screen.
 * `children` (the update prompt) render after the screens, outside the
 * router, so a redirect never unmounts them.
 */
export function App({ children }: { children?: ReactNode }) {
  const { settings } = useApp();
  return (
    <I18nProvider lang={settings.lang}>
      <div className="app">
        <Router hook={useHashLocation}>
          <Screens />
        </Router>
        {children}
      </div>
    </I18nProvider>
  );
}
