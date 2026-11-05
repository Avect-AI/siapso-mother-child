// SPDX-License-Identifier: MIT
import type { EntryKind } from '@siapso/resolver';
import { useEffect, useRef, type ReactNode } from 'react';
import { Redirect, Router, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { APP_NAME } from './config.js';
import type { Mode } from './domain/types.js';
import { I18nProvider, useT } from './i18n/index.js';
import { Check } from './screens/Check.js';
import { Confirm } from './screens/Confirm.js';
import { ContactEdit, Contacts, type ContactTarget } from './screens/Contacts.js';
import { Danger } from './screens/Danger.js';
import { Home } from './screens/Home.js';
import { ProfileEdit, type ProfileTarget } from './screens/ProfileEdit.js';
import { CALL_PATH, Referral } from './screens/Referral.js';
import { Result } from './screens/Result.js';
import { Search } from './screens/Search.js';
import { SignsNow } from './screens/SignsNow.js';
import { Welcome } from './screens/Welcome.js';
import { useApp } from './state/app-state.js';
import { Header } from './ui/Header.js';

/**
 * The screens of a check: the list, the search in one list, the confirmation
 * of one entry, the danger signs present now, the result.
 */
type CheckRoute =
  | { screen: 'check' }
  | { screen: 'search'; kind: EntryKind }
  | { screen: 'confirm'; kind: EntryKind; id: string }
  | { screen: 'signs' }
  | { screen: 'result' };

type Screen =
  | 'loading'
  | 'welcome'
  | 'home'
  | 'danger'
  | 'call'
  | 'contacts'
  | 'contact'
  | 'profile'
  | CheckRoute['screen'];

/** /contacts (the list), /contacts/new and /contacts/<id>; null for any other route. */
function contactRoute(location: string): 'list' | ContactTarget | null {
  if (location === '/contacts') return 'list';
  if (location === '/contacts/new') return { kind: 'new' };
  const match = /^\/contacts\/([^/]+)$/.exec(location);
  const id = match?.[1] === undefined ? null : decoded(match[1]);
  return id ? { kind: 'edit', id } : null;
}

function decoded(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** /check, /search/<kind>, /confirm/<kind>/<id>, /signs and /result; null for any other route. */
function checkRoute(location: string): CheckRoute | null {
  if (location === '/check') return { screen: 'check' };
  if (location === '/signs') return { screen: 'signs' };
  if (location === '/result') return { screen: 'result' };
  const search = /^\/search\/(product|plant)$/.exec(location);
  if (search?.[1]) return { screen: 'search', kind: search[1] as EntryKind };
  const confirm = /^\/confirm\/(product|plant)\/([^/]+)$/.exec(location);
  const id = confirm?.[2] === undefined ? null : decoded(confirm[2]);
  if (confirm?.[1] && id) return { screen: 'confirm', kind: confirm[1] as EntryKind, id };
  return null;
}

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
 * The screen for a hash route. Danger signs and who to call open from
 * anywhere and at once, even before the stored settings are read or the
 * welcome questions answered; anything else waits for the settings
 * ('loading' shows nothing, a few milliseconds normally), then for the
 * welcome answers. The contacts are for accompanied mode. Unknown routes get
 * null and are sent home.
 */
function screenFor(
  location: string,
  settings: { ready: boolean; onboarded: boolean; mode: Mode | null },
  profile: ProfileTarget | null,
  check: CheckRoute | null,
  contact: 'list' | ContactTarget | null,
): Screen | null {
  if (location === '/danger') return 'danger';
  if (location === CALL_PATH) return 'call';
  if (!settings.ready) return 'loading';
  if (!settings.onboarded) return 'welcome';
  if (profile) return 'profile';
  if (check) return check.screen;
  if (contact !== null) {
    if (settings.mode !== 'accompanied') return null;
    return contact === 'list' ? 'contacts' : 'contact';
  }
  return location === '/' ? 'home' : null;
}

/**
 * A name for what is on screen, so a change of profile, of list searched or
 * of product confirmed counts as a new screen.
 */
function screenKey(
  screen: Screen | null,
  profile: ProfileTarget | null,
  check: CheckRoute | null,
  contact: 'list' | ContactTarget | null,
): string | null {
  if (screen === 'profile' && profile) {
    return profile.kind === 'edit' ? `profile:${profile.id}` : `profile:${profile.kind}`;
  }
  if (screen === 'contact' && contact !== null && contact !== 'list') {
    return contact.kind === 'edit' ? `contact:${contact.id}` : 'contact:new';
  }
  if (screen === 'search' && check?.screen === 'search') return `search:${check.kind}`;
  if (screen === 'confirm' && check?.screen === 'confirm') {
    return `confirm:${check.kind}:${check.id}`;
  }
  return screen;
}

function Screens() {
  const [location] = useLocation();
  const { settings, settingsReady, online } = useApp();
  const t = useT();
  const profile = profileTarget(location, settings.mode);
  const check = checkRoute(location);
  const contact = contactRoute(location);
  const screen = screenFor(
    location,
    { ready: settingsReady, onboarded: settings.onboarded, mode: settings.mode },
    profile,
    check,
    contact,
  );
  const key = screenKey(screen, profile, check, contact);
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
      {screen === 'call' ? <Referral /> : null}
      {screen === 'contacts' ? <Contacts /> : null}
      {screen === 'contact' && contact !== null && contact !== 'list' ? (
        <ContactEdit key={key} target={contact} />
      ) : null}
      {screen === 'profile' && profile ? <ProfileEdit key={key} target={profile} /> : null}
      {screen === 'check' ? <Check /> : null}
      {screen === 'search' && check?.screen === 'search' ? (
        <Search key={key} kind={check.kind} />
      ) : null}
      {screen === 'confirm' && check?.screen === 'confirm' ? (
        <Confirm key={key} kind={check.kind} id={check.id} />
      ) : null}
      {screen === 'signs' ? <SignsNow /> : null}
      {screen === 'result' ? <Result /> : null}
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
