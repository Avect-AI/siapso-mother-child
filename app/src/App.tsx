// SPDX-License-Identifier: MIT
import type { EntryKind } from '@siapso/resolver';
import { Suspense, lazy, useEffect, useRef, type ReactNode } from 'react';
import { Redirect, Router, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { APP_NAME } from './config.js';
import type { Mode } from './domain/types.js';
import { I18nProvider, useT } from './i18n/index.js';
import { About } from './screens/About.js';
import { CHANGE_CODE_PATH, ChangeCode } from './screens/ChangeCode.js';
import { Check } from './screens/Check.js';
import { CodeSetup } from './screens/CodeSetup.js';
import { Confirm } from './screens/Confirm.js';
import { ContactEdit, Contacts, contactScreenKey, type ContactTarget } from './screens/Contacts.js';
import { Danger } from './screens/Danger.js';
import { CONTACT_EDIT_PATH, editedId, PROFILE_EDIT_PATH } from './screens/edit-route.js';
import { FORGOT_PATH, ForgotCode } from './screens/ForgotCode.js';
import { Home } from './screens/Home.js';
import { Neutral, UNLOCK_PATH } from './screens/Neutral.js';
import { ProfileEdit, profileScreenKey, type ProfileTarget } from './screens/ProfileEdit.js';
import { Profiles } from './screens/Profiles.js';
import { QUICK_PATH, QuickCheck } from './screens/QuickCheck.js';
import { CALL_PATH, Referral } from './screens/Referral.js';
import { Result } from './screens/Result.js';
import { Search } from './screens/Search.js';
import { Settings } from './screens/Settings.js';
import { SignsNow } from './screens/SignsNow.js';
import { Status } from './screens/Status.js';
import { Unlock } from './screens/Unlock.js';
import { VOICE_PATH, VoicePack } from './screens/VoicePack.js';
import { Welcome } from './screens/Welcome.js';
import { useApp } from './state/app-state.js';
import { useCheck } from './state/check-state.js';
import { intoThisEpoch } from './state/entry-state.js';
import { useLeaveWhenDeleted } from './state/profile-gone.js';
import { useSession, type SessionStatus } from './state/session.js';
import { Header } from './ui/Header.js';
import { LockWarning } from './ui/LockWarning.js';

/** The licences screen, with the full licence texts: its own chunk, out of the first load. */
const Licences = lazy(() =>
  import('./screens/Licences.js').then((module) => ({ default: module.Licences })),
);
const LICENCES_PATH = '/licences';

/**
 * The screens of a check: the list, the search in one list, the confirmation
 * of one entry, the danger signs present now, the result.
 */
type CheckRoute =
  | { screen: 'check' }
  | { screen: 'search'; kind: EntryKind }
  | { screen: 'confirm'; kind: EntryKind }
  | { screen: 'signs' }
  | { screen: 'result' };

type Screen =
  | 'loading'
  | 'welcome'
  | 'code'
  | 'unlock'
  | 'unlocked'
  | 'forgot'
  | 'neutral'
  | 'settings'
  | 'changeCode'
  | 'status'
  | 'about'
  | 'licences'
  | 'voice'
  | 'home'
  | 'profiles'
  | 'danger'
  | 'call'
  | 'contacts'
  | 'contact'
  | 'profile'
  | 'quick'
  | 'mode'
  | CheckRoute['screen'];

/**
 * /contacts (the list), /contacts/new and /contacts/edit (the contact in the
 * entry's state, never in the address); null for any other route, and for
 * /contacts/edit once the contact is not known (a reload). /contacts/<id> is
 * still read: an earlier version left such addresses in the history.
 */
function contactRoute(location: string): 'list' | ContactTarget | null {
  if (location === '/contacts') return 'list';
  if (location === '/contacts/new') return { kind: 'new' };
  if (location === CONTACT_EDIT_PATH) {
    const id = editedId();
    return id === null ? null : { kind: 'edit', id };
  }
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

/**
 * /check, /search/<kind>, /confirm/<kind>, /signs and /result; null for any
 * other route. The product confirmed is never in the address (it can say what
 * she is treated for): it is in the entry's state.
 */
function checkRoute(location: string): CheckRoute | null {
  if (location === '/check') return { screen: 'check' };
  if (location === '/signs') return { screen: 'signs' };
  if (location === '/result') return { screen: 'result' };
  const search = /^\/search\/(product|plant)$/.exec(location);
  if (search?.[1]) return { screen: 'search', kind: search[1] as EntryKind };
  const confirm = /^\/confirm\/(product|plant)$/.exec(location);
  if (confirm?.[1]) return { screen: 'confirm', kind: confirm[1] as EntryKind };
  return null;
}

/**
 * The profile a route opens. A woman has one profile: /profile and
 * /profile/new both open hers. In accompanied mode both open a new one (the
 * list of profiles is the start). /profile/edit opens the profile in the
 * entry's state (never in the address; none once it is not known, a reload).
 * /profile/<id> is still read: an earlier version left such addresses in the
 * history.
 */
function profileTarget(location: string, mode: Mode | null): ProfileTarget | null {
  if (location === '/profile' || location === '/profile/new') {
    return mode === 'accompanied' ? { kind: 'new' } : { kind: 'mine' };
  }
  if (location === PROFILE_EDIT_PATH) {
    const id = editedId();
    return id === null ? null : { kind: 'edit', id };
  }
  const match = /^\/profile\/([^/]+)$/.exec(location);
  return match?.[1] ? { kind: 'edit', id: decodeURIComponent(match[1]) } : null;
}

/**
 * The screen for a hash route. Danger signs and who to call open from
 * anywhere and at once, even before the stored settings are read, the
 * welcome questions answered or the code given; anything else waits for the
 * settings ('loading' shows nothing, a few milliseconds normally), then for
 * the welcome answers, then for the stored code. The settings show the
 * language at any time. Every other screen shows something about a profile
 * and opens only with the code: while locked, the code screen takes its
 * place (at start or after an auto-lock, so the code brings the same screen
 * back), or the neutral screen after a quick exit. In accompanied mode the
 * start is the list of profiles. The contacts open in both modes, behind the
 * code. Unknown routes get null and are sent home.
 */
function screenFor(
  location: string,
  settings: { ready: boolean; onboarded: boolean; mode: Mode | null },
  session: { status: SessionStatus; exited: boolean; codeUnavailable: boolean },
  profile: ProfileTarget | null,
  check: CheckRoute | null,
  contact: 'list' | ContactTarget | null,
): Screen | null {
  if (location === '/danger') return 'danger';
  if (location === CALL_PATH) return 'call';
  if (!settings.ready) return 'loading';
  // The welcome only while no code is known (none stored, or storage unreadable):
  // with a code stored (a welcome cut short), the code comes first, then the mode.
  if (
    !settings.onboarded &&
    (session.status === 'new' || session.status === 'loading' || session.codeUnavailable)
  ) {
    return 'welcome';
  }
  if (location === '/settings') return 'settings';
  // The voice pack holds no profile data either: installed or removed, locked or not.
  if (location === VOICE_PATH) return 'voice';
  // The knowledge base and the licences hold no profile data: open locked or not.
  if (location === '/status') return 'status';
  if (location === '/about') return 'about';
  if (location === LICENCES_PATH) return 'licences';
  if (session.status === 'loading') return 'loading';
  // Onboarded before codes existed: the code is made first.
  if (session.status === 'new') return 'code';
  // A forgotten code: only behind the lock (once open, there is nothing to forget).
  if (location === FORGOT_PATH) return session.status === 'locked' ? 'forgot' : null;
  if (session.status === 'locked') {
    if (location === UNLOCK_PATH) return 'unlock';
    return session.exited ? 'neutral' : 'unlock';
  }
  if (location === UNLOCK_PATH) return 'unlocked';
  // A new code, behind the current one.
  if (location === CHANGE_CODE_PATH) return 'changeCode';
  // Open, and no mode was kept (a welcome cut short): who uses the app, first.
  if (settings.mode === null) return 'mode';
  // A passer-by checked without a profile: accompanied mode only.
  if (location === QUICK_PATH) return settings.mode === 'accompanied' ? 'quick' : null;
  if (profile) return 'profile';
  if (check) return check.screen;
  if (contact !== null) return contact === 'list' ? 'contacts' : 'contact';
  if (location !== '/') return null;
  return settings.mode === 'accompanied' ? 'profiles' : 'home';
}

/** The screens that open without the code and say what the app is for: "Quitter" hides them. */
const OPEN_WITHOUT_CODE: readonly Screen[] = [
  'danger',
  'call',
  'settings',
  'about',
  'status',
  'licences',
  'voice',
];

/** The route in the address now (the hash), as wouter reads it. */
function addressNow(): string {
  return '/' + window.location.hash.replace(/^#?\/?/, '');
}

/**
 * The session locked on a screen: its route and state go to memory (the
 * session holds them), and the code screen takes the history entry's place
 * under a neutral address, so nothing in the address or the entry says what
 * was on screen, even after a reload.
 */
function LockAway({ location }: { location: string }) {
  const { holdScreen } = useSession();
  const [, navigate] = useLocation();
  useEffect(() => {
    // Once: after it, the address is the code screen's (effects may run twice).
    if (addressNow() !== location) return;
    holdScreen(location, window.history.state);
    navigate(UNLOCK_PATH, { replace: true });
  }, [holdScreen, location, navigate]);
  return null;
}

/**
 * The code has opened the session on the code screen: back to the screen
 * that asked for it (the neutral screen, who to call), or to the screen the
 * session locked on (held in memory, moved to this epoch), or to the start.
 */
function AfterUnlock() {
  const { takeHeldScreen } = useSession();
  const [, navigate] = useLocation();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const held = takeHeldScreen();
    const state: unknown = window.history.state;
    const back = typeof state === 'object' && state !== null && 'back' in state && state.back;
    if (back === true) window.history.back();
    else if (held) navigate(held.path, { replace: true, state: intoThisEpoch(held.state) });
    else navigate('/', { replace: true });
  }, [navigate, takeHeldScreen]);
  return null;
}

/**
 * The screens of a check (the list, the search, the confirmation, the signs,
 * the result) leave when her profile is deleted in another tab; a passer-by
 * has no profile to delete.
 */
function LeaveDeletedCheck() {
  const { profileId, quick } = useCheck();
  const passerBy = quick !== null && quick.id === profileId;
  useLeaveWhenDeleted(passerBy ? null : profileId);
  return null;
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
  if (screen === 'profile' && profile) return profileScreenKey(profile);
  if (screen === 'contact' && contact !== null && contact !== 'list') {
    return contactScreenKey(contact);
  }
  if (screen === 'search' && check?.screen === 'search') return `search:${check.kind}`;
  if (screen === 'confirm' && check?.screen === 'confirm') {
    return `confirm:${check.kind}`;
  }
  return screen;
}

function Screens() {
  const [location] = useLocation();
  const { settings, settingsReady, online, setSettings } = useApp();
  const session = useSession();
  // A welcome cut short (the app closed after the code was made): this tab
  // opened that code, so the welcome is over; a missing mode is asked next.
  useEffect(() => {
    if (session.unlocked && settingsReady && !settings.onboarded) {
      void setSettings({ onboarded: true });
    }
  }, [session.unlocked, settingsReady, settings.onboarded, setSettings]);
  const t = useT();
  const profile = profileTarget(location, settings.mode);
  const check = checkRoute(location);
  const contact = contactRoute(location);
  const screen = screenFor(
    location,
    { ready: settingsReady, onboarded: settings.onboarded, mode: settings.mode },
    session,
    profile,
    check,
    contact,
  );
  const key = screenKey(screen, profile, check, contact);
  const shown = useRef(key);
  // The screen on show has not had the focus yet (its heading is still to come).
  const focusOwed = useRef(false);

  // Answers kept for a form (state/draft.ts) stay while its screen shows, and
  // across a lock until the code brings it back; another screen drops them.
  const { unlocked, dropDraft } = session;
  useEffect(() => {
    if (unlocked && key !== null && key !== 'unlocked' && key !== 'loading') dropDraft(key);
  }, [unlocked, key, dropDraft]);

  // A new screen takes the focus to its heading, so a screen reader starts
  // reading it from the top, or to the field the screen exists for (the
  // search: its label says what the heading says); not on the first screen of
  // a load, which starts there anyway. A screen that shows its heading only
  // once it has read what it needs (the check, her profile) gets the focus
  // then, unless something already took it.
  useEffect(() => {
    const previous = shown.current;
    if (previous !== key) {
      shown.current = key;
      focusOwed.current = previous !== 'loading';
    }
    if (!focusOwed.current) return;
    const target = () =>
      document.querySelector<HTMLElement>('main [data-autofocus]') ??
      document.querySelector<HTMLElement>('main h1');
    const now = target();
    if (now !== null) {
      focusOwed.current = false;
      now.focus();
      return;
    }
    const observer = new MutationObserver(() => {
      const found = target();
      if (found === null) return;
      observer.disconnect();
      focusOwed.current = false;
      const active = document.activeElement;
      if (active === null || active === document.body) found.focus();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, [key]);

  if (screen === null) return <Redirect to="/" replace />;
  if (screen === 'loading') return null;
  if (screen === 'unlocked') return <AfterUnlock />;
  if (screen === 'unlock' && location !== UNLOCK_PATH) return <LockAway location={location} />;
  // After a quick exit, Back lands on entries of screens with profile data:
  // each is replaced by the neutral one as it is reached.
  if (screen === 'neutral' && location !== '/') return <Redirect to="/" replace />;
  // The quick exit, once the code is given; before it too on every screen that
  // opens without the code and says what the app is for (the danger signs and
  // who to call, where signs may be ticked, the settings, the about screen,
  // the knowledge base, the licences, the voice). Not on the code screen,
  // which says nothing of it.
  const exitShown =
    settings.onboarded &&
    (session.unlocked || (session.status === 'locked' && OPEN_WITHOUT_CODE.includes(screen)));
  return (
    <>
      {/* On every screen: the danger signs are one tap away even during the
          welcome. The welcome shows the app's mark and name itself. */}
      <Header
        appName={screen === 'welcome' ? null : APP_NAME}
        dangerLabel={t('header.danger')}
        offlineLabel={t('header.offline')}
        online={online}
        current={
          screen === 'home' || screen === 'profiles'
            ? 'home'
            : screen === 'danger'
              ? 'danger'
              : null
        }
        quickExit={exitShown ? { label: t('header.quickExit'), onExit: session.quickExit } : null}
      />
      {screen === 'welcome' ? <Welcome /> : null}
      {screen === 'mode' ? <Welcome modeOnly /> : null}
      {screen === 'code' ? <CodeSetup mode={session.mode} /> : null}
      {screen === 'unlock' ? <Unlock /> : null}
      {screen === 'forgot' ? <ForgotCode /> : null}
      {screen === 'neutral' ? <Neutral /> : null}
      {/* A lock starts a new epoch: a language or a mode chosen and not applied
          is forgotten with it, never left for whoever gives the code next. */}
      {screen === 'settings' ? <Settings key={session.epoch} /> : null}
      {screen === 'changeCode' ? <ChangeCode /> : null}
      {screen === 'status' ? <Status /> : null}
      {screen === 'about' ? <About /> : null}
      {screen === 'licences' ? (
        <Suspense fallback={null}>
          <Licences />
        </Suspense>
      ) : null}
      {screen === 'voice' ? <VoicePack /> : null}
      {screen === 'home' ? <Home /> : null}
      {screen === 'profiles' ? <Profiles /> : null}
      {/* A new epoch (a lock, two minutes idle while locked) starts them again:
          the signs ticked are forgotten. */}
      {screen === 'danger' ? <Danger key={session.epoch} /> : null}
      {screen === 'call' ? <Referral key={session.epoch} /> : null}
      {screen === 'contacts' ? <Contacts /> : null}
      {screen === 'contact' && contact !== null && contact !== 'list' ? (
        <ContactEdit key={key} target={contact} />
      ) : null}
      {screen === 'profile' && profile ? <ProfileEdit key={key} target={profile} /> : null}
      {screen === 'quick' ? <QuickCheck /> : null}
      {screen === 'check' ? <Check /> : null}
      {screen === 'search' && check?.screen === 'search' ? (
        <Search key={key} kind={check.kind} />
      ) : null}
      {screen === 'confirm' && check?.screen === 'confirm' ? (
        <Confirm key={key} kind={check.kind} />
      ) : null}
      {screen === 'signs' ? <SignsNow /> : null}
      {screen === 'result' ? <Result /> : null}
      {check !== null && screen === check.screen ? <LeaveDeletedCheck /> : null}
      <LockWarning
        open={session.unlocked && session.lockSoon}
        message={t('autoLock.soon')}
        action={t('autoLock.stay')}
        onStay={session.touch}
      />
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
