// SPDX-License-Identifier: MIT
import { act, render, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeFingerprint, codeOpened, openedCode } from '../data/code-guard.js';
import {
  eraseProfilesAndCode,
  getStoredLockout,
  getStoredSettings,
  getStoredVerifier,
  openAppDb,
  storeNewVerifier,
  storePack,
  storeSettings,
  storeLockout,
  storeVerifier,
} from '../data/db.js';
import { listHistory, recordHistory } from '../data/history.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import { loadSavedContacts, saveContacts } from '../data/referral.js';
import { isVaultOpen, LockedError } from '../data/vault.js';
import {
  AUTO_LOCK_MS,
  checkCode,
  createCodeKeys,
  LOCK_WARNING_MS,
  PBKDF2_ITERATIONS,
  type CodeVerifier,
  type LockoutState,
} from '../domain/code.js';
import type { HistoryEntry, Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { breakIndexedDB, failWrites } from '../test/idb.js';
import { profileOf } from '../test/knowledge-pack.js';
import { loaderOf, shellPack } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';
import { legacyVerifier, openVaultOf, verifierOf, weakVerifier } from '../test/verifier.js';
import { AppProvider, useApp } from './app-state.js';
import { epochToken, inSession, inVisit, sessionState, visitState } from './entry-state.js';
import { EPOCH_KEY, SESSION_CHANNEL } from './tab-sync.js';

const CODE = '2468';

// Every unlock works out PBKDF2 at 600 000 iterations: slower under coverage.
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Reads the settings of one tab. */
function SettingsProbe({ onSettings }: { onSettings: (settings: Settings) => void }) {
  const { settings } = useApp();
  useEffect(() => {
    onSettings(settings);
  }, [settings, onSettings]);
  return null;
}

/**
 * A tab of the app. `deaf`: it misses every message from the other tabs, as a
 * frozen tab or one kept in the back-forward cache does.
 */
function renderTab({
  startUnlocked = false,
  deaf = false,
}: { startUnlocked?: boolean; deaf?: boolean } = {}) {
  const session = probeSession();
  const check = probeCheck();
  let settings: Settings | undefined;
  if (deaf) vi.stubGlobal('BroadcastChannel', undefined);
  const view = render(
    <AppProvider packLoader={loaderOf(shellPack())} session={{ startUnlocked }}>
      {session.element}
      {check.element}
      <SettingsProbe
        onSettings={(latest) => {
          settings = latest;
        }}
      />
    </AppProvider>,
  );
  vi.unstubAllGlobals();
  return { session, check, view, settings: () => settings };
}

async function renderSession({
  code = CODE,
  verifier,
  lockout,
  startUnlocked = false,
}: {
  code?: string | null;
  verifier?: CodeVerifier;
  lockout?: LockoutState;
  startUnlocked?: boolean;
} = {}) {
  if (verifier) await storeVerifier(verifier);
  else if (code !== null) await storeVerifier(await verifierOf(code));
  if (lockout) await storeLockout(lockout);
  const session = probeSession();
  const check = probeCheck();
  const view = render(
    <AppProvider packLoader={loaderOf(shellPack())} session={{ startUnlocked }}>
      {session.element}
      {check.element}
    </AppProvider>,
  );
  return { session, check, view };
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('session', () => {
  it('starts locked when a code was made on the phone, new when none was', async () => {
    const { session, view } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    expect(session.current().unlocked).toBe(false);
    expect(session.current().mode).toBe('woman');
    view.unmount();

    await openAppDb().then((db) => db.delete('settings', 'code'));
    const fresh = await renderSession({ code: null });
    await waitFor(() => {
      expect(fresh.session.current().status).toBe('new');
    });
  });

  it('opens with the right code only, and holds key material only while open', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });

    let result = '';
    await act(async () => {
      result = await session.current().unlock('1111');
    });
    expect(result).toBe('wrong');
    expect(session.current().unlocked).toBe(false);
    expect(session.current().keyMaterial()).toBeNull();

    await act(async () => {
      result = await session.current().unlock(CODE);
    });
    expect(result).toBe('ok');
    expect(session.current().unlocked).toBe(true);
    expect(session.current().keyMaterial()?.extractable).toBe(false);

    act(() => {
      session.current().lock();
    });
    expect(session.current().status).toBe('locked');
    expect(session.current().keyMaterial()).toBeNull();
  });

  it('waits 30 s after the fifth wrong code, then 60 s after the sixth, across a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    const { session, view } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    const results: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await act(async () => {
        results.push(await session.current().unlock('0000'));
      });
    }
    // Four go, the fifth starts the wait, the sixth is not even tried.
    expect(results).toEqual(['wrong', 'wrong', 'wrong', 'wrong', 'wrong', 'locked']);
    const start = Date.now();
    expect(session.current().lockout).toEqual({ failures: 5, lockedUntil: start + 30_000 });
    // Even the right code waits.
    await act(async () => {
      results.push(await session.current().unlock(CODE));
    });
    expect(results.at(-1)).toBe('locked');
    expect(await getStoredLockout()).toEqual({ failures: 5, lockedUntil: start + 30_000 });

    // A reload keeps the wait.
    view.unmount();
    const reloaded = probeSession();
    render(<AppProvider packLoader={loaderOf(shellPack())}>{reloaded.element}</AppProvider>);
    await waitFor(() => {
      expect(reloaded.current().lockout.failures).toBe(5);
    });
    await act(async () => {
      results.push(await reloaded.current().unlock(CODE));
    });
    expect(results.at(-1)).toBe('locked');

    // Once the wait is over, a sixth wrong code doubles it.
    vi.setSystemTime(start + 30_000);
    await act(async () => {
      results.push(await reloaded.current().unlock('0000'));
    });
    expect(reloaded.current().lockout).toEqual({
      failures: 6,
      lockedUntil: start + 30_000 + 60_000,
    });

    // The right code after the wait starts again from nothing.
    vi.setSystemTime(start + 30_000 + 60_000);
    await act(async () => {
      results.push(await reloaded.current().unlock(CODE));
    });
    expect(results.at(-1)).toBe('ok');
    expect(reloaded.current().lockout).toEqual({ failures: 0, lockedUntil: null });
    expect(await getStoredLockout()).toEqual({ failures: 0, lockedUntil: null });
  });

  it('locks after two minutes without a touch, a key or a pointer', async () => {
    const { session } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // The timer set before the clock was faked is replaced at the first interaction.
    act(() => {
      session.current().touch();
    });

    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1000);
    });
    expect(session.current().unlocked).toBe(true);
    // A touch starts the two minutes again.
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1000);
    });
    expect(session.current().unlocked).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1);
    });
    expect(session.current().unlocked).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(session.current().status).toBe('locked');
    expect(session.current().keyMaterial()).toBeNull();
  });

  it('locks when the page comes back after more than two minutes hidden, not after less', async () => {
    const { session } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    // Only the clock moves: a hidden page on a phone may run no timer at all.
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();

    act(() => {
      setVisibility('hidden');
    });
    vi.setSystemTime(start + 60_000);
    act(() => {
      setVisibility('visible');
    });
    expect(session.current().unlocked).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('touchstart'));
      setVisibility('hidden');
    });
    vi.setSystemTime(start + 60_000 + AUTO_LOCK_MS + 1);
    act(() => {
      setVisibility('visible');
    });
    expect(session.current().status).toBe('locked');
  });

  it('quick exit locks at once, empties the check, and leaves nothing on the history entry', async () => {
    const { session, check } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    act(() => {
      check.current().start('p1');
      check.current().add({ ref: { kind: 'plant', id: 'kinkeliba' } });
    });
    window.history.pushState(inVisit({ signs: ['fever'] }), '', '#/result');
    expect(visitState()).toMatchObject({ signs: ['fever'] });

    act(() => {
      session.current().quickExit();
    });

    expect(session.current().status).toBe('locked');
    expect(session.current().exited).toBe(true);
    expect(session.current().keyMaterial()).toBeNull();
    expect(check.current().profileId).toBeNull();
    expect(check.current().items).toEqual([]);
    expect(window.location.hash).toBe('#/');
    expect(window.history.state).toBeNull();
    // An entry left before the exit is read as empty: Back brings nothing back.
    window.history.replaceState({ signs: ['fever'], visit: 'before' }, '');
    expect(visitState()).toEqual({});
  });

  it('a lock forgets the lists waiting for the other women, and keeps the one held', async () => {
    const { session, check } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    act(() => {
      check.current().start('bineta');
      check.current().add({ ref: { kind: 'plant', id: 'kinkeliba' } });
      check.current().start('coumba');
      check.current().add({ ref: { kind: 'plant', id: 'moringa' } });
    });
    expect(check.current().pendingOf('bineta')).toBe(1);

    act(() => {
      session.current().lock();
    });

    expect(session.current().status).toBe('locked');
    expect(check.current().pendingOf('bineta')).toBe(0);
    // The screen held comes back after the code, with its list.
    expect(check.current()).toMatchObject({
      profileId: 'coumba',
      items: [{ ref: { kind: 'plant', id: 'moringa' } }],
    });
  });

  it('a lock lets a passer-by go, and the code then opens the start, not her screen', async () => {
    const { session, check } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    act(() => {
      check.current().startQuick(profileOf({ id: 'passer-by' }));
      check.current().add({ ref: { kind: 'plant', id: 'moringa' } });
    });

    act(() => {
      session.current().lock();
    });

    expect(check.current()).toMatchObject({ quick: null, profileId: null, items: [] });
    act(() => {
      session.current().holdScreen('/check', null);
    });
    expect(session.current().takeHeldScreen()).toBeNull();
  });

  it('makes a code: only its verifier is stored, and the session opens', async () => {
    const { session } = await renderSession({ code: null });
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });

    await act(async () => {
      await session.current().createCode('135790');
    });

    expect(session.current().unlocked).toBe(true);
    expect(session.current().keyMaterial()).not.toBeNull();
    const stored = await getStoredVerifier();
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain('135790');
    expect(stored === undefined ? false : await checkCode('135790', stored)).toBe(true);
  });

  it('opens nothing when the phone storage refuses the code: no code it could not keep', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session } = await renderSession({ code: null });
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });
    const db = await openAppDb();
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    let made = '';
    await act(async () => {
      made = await session.current().createCode('1357');
    });

    expect(made).toBe('unsaved');
    expect(session.current().unlocked).toBe(false);
    expect(session.current().keyMaterial()).toBeNull();
    expect(session.current().status).toBe('new');
  });
});

describe('session across tabs and failures', () => {
  it('shares the wrong codes between tabs: a second tab gets no free tries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0, 0));
    await storeVerifier(await verifierOf(CODE));
    // Two tabs of the app, open before any wrong code: each starts with no failure in memory.
    const a = renderTab();
    const b = renderTab();
    await waitFor(() => {
      expect(a.session.current().status).toBe('locked');
      expect(b.session.current().status).toBe('locked');
    });
    const tries = async (tab: typeof a, count: number) => {
      const results: string[] = [];
      for (let i = 0; i < count; i += 1) {
        await act(async () => {
          results.push(await tab.session.current().unlock('0000'));
        });
      }
      return results;
    };

    expect(await tries(a, 3)).toEqual(['wrong', 'wrong', 'wrong']);
    // Tab B knows of no failure, but reads them: its second try is the fifth.
    expect(await tries(b, 2)).toEqual(['wrong', 'wrong']);
    expect(b.session.current().lockout.failures).toBe(5);
    expect(await getStoredLockout()).toMatchObject({ failures: 5 });
    // Both tabs now wait, even with the right code.
    let result = '';
    await act(async () => {
      result = await a.session.current().unlock(CODE);
    });
    expect(result).toBe('locked');
    await act(async () => {
      result = await b.session.current().unlock(CODE);
    });
    expect(result).toBe('locked');

    // A reload of tab A keeps the wait.
    a.view.unmount();
    const reloaded = renderTab();
    await waitFor(() => {
      expect(reloaded.session.current().lockout.failures).toBe(5);
    });
    await act(async () => {
      result = await reloaded.session.current().unlock(CODE);
    });
    expect(result).toBe('locked');
  });

  it('never counts a try while the stored code cannot be read, and reads it again at the next try', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    breakIndexedDB('the storage does not answer');
    const { session } = renderTab();
    await waitFor(() => {
      expect(session.current().codeUnavailable).toBe(true);
    });
    expect(session.current().status).toBe('locked');

    let result = '';
    await act(async () => {
      result = await session.current().unlock('0000');
    });
    expect(result).toBe('unavailable');
    expect(session.current().lockout).toEqual({ failures: 0, lockedUntil: null });

    // The storage answers again: the next try reads the code.
    globalThis.indexedDB = new IDBFactory();
    await storeVerifier(await verifierOf(CODE));
    await act(async () => {
      result = await session.current().unlock(CODE);
    });
    expect(result).toBe('ok');
    expect(session.current().codeUnavailable).toBe(false);
  });

  it('rehashes a verifier made with fewer iterations after the right code', async () => {
    const { session } = await renderSession({ verifier: await weakVerifier(CODE, 1000) });
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });

    await act(async () => {
      await session.current().unlock(CODE);
    });

    await waitFor(async () => {
      expect((await getStoredVerifier())?.iterations).toBe(PBKDF2_ITERATIONS);
    });
    const stored = await getStoredVerifier();
    expect(stored === undefined ? false : await checkCode(CODE, stored)).toBe(true);
  });

  it('starts a new epoch at every lock, so what a result left behind is no longer trusted', async () => {
    const { session } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    const first = epochToken();

    act(() => {
      session.current().lock();
    });
    const second = epochToken();
    expect(second).not.toBe(first);
    await act(async () => {
      await session.current().unlock(CODE);
    });
    // Opening keeps the epoch; the quick exit starts another.
    expect(epochToken()).toBe(second);
    act(() => {
      session.current().quickExit();
    });
    expect(epochToken()).not.toBe(second);
  });

  it('holds the locked screen in memory only, gives it back once, and forgets it at a quick exit', async () => {
    const { session } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });

    act(() => {
      session.current().holdScreen('/confirm/product', { id: 'efavirenz-generic' });
    });
    expect(session.current().takeHeldScreen()).toEqual({
      path: '/confirm/product',
      state: { id: 'efavirenz-generic' },
    });
    expect(session.current().takeHeldScreen()).toBeNull();

    act(() => {
      session.current().holdScreen('/check', null);
      session.current().quickExit();
    });
    expect(session.current().takeHeldScreen()).toBeNull();
  });

  it('a forgotten code erases the profiles, contacts, history and code, keeps the language and the pack', async () => {
    await storeSettings({ lang: 'en', mode: 'accompanied', onboarded: true });
    await storeVerifier(await verifierOf(CODE));
    await openVaultOf(CODE);
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await saveContacts([{ id: 'c1', role: 'relay', name: 'Mariama', phone: '000 000 001' }]);
    await recordHistory({
      id: 'h1',
      profileId: 'a',
      at: '2026-11-04T10:00:00.000Z',
      packVersion: '0.1.0',
      level: 'unknown',
      ruleIds: [],
      items: [{ ref: { kind: 'plant', id: 'kinkeliba' } }],
      signs: [],
    });
    await storePack(shellPack(), 'fingerprint');
    const { session, check } = await renderSession({
      lockout: { failures: 9, lockedUntil: Date.now() + 60_000 },
    });
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    act(() => {
      check.current().start('a');
    });

    await act(async () => {
      await session.current().forgetCode();
    });

    expect(session.current().status).toBe('new');
    expect(session.current().lockout).toEqual({ failures: 0, lockedUntil: null });
    expect(check.current().profileId).toBeNull();
    const db = await openAppDb();
    expect(await db.getAll('profiles')).toEqual([]);
    expect(await db.getAll('contacts')).toEqual([]);
    expect(await db.getAll('history')).toEqual([]);
    expect(await getStoredVerifier()).toBeUndefined();
    expect(await getStoredLockout()).toBeUndefined();
    expect(await getStoredSettings()).toEqual({ lang: 'en', mode: null, onboarded: false });
    expect(await db.get('pack', 'current')).toBeDefined();
  });
});

describe('session across the tabs of one phone', () => {
  async function twoOpenTabs(options: { deaf?: boolean } = {}) {
    await storeVerifier(await verifierOf(CODE));
    const other = renderTab({ startUnlocked: true, ...options });
    const here = renderTab({ startUnlocked: true });
    await waitFor(() => {
      expect(other.session.current().unlocked).toBe(true);
      expect(here.session.current().unlocked).toBe(true);
    });
    return { other, here };
  }

  it('"Quitter" in one tab locks every other tab and forgets what each held', async () => {
    const { other, here } = await twoOpenTabs();
    act(() => {
      other.session.current().holdScreen('/confirm/product', null);
      other.check.current().start('p1');
    });

    act(() => {
      here.session.current().quickExit();
    });

    await waitFor(() => {
      expect(other.session.current().status).toBe('locked');
    });
    expect(other.session.current().exited).toBe(true);
    expect(other.session.current().keyMaterial()).toBeNull();
    expect(other.session.current().takeHeldScreen()).toBeNull();
    expect(other.check.current().profileId).toBeNull();
  });

  it('a lock asked in one tab locks the others, and they forget the screen they held', async () => {
    const { other, here } = await twoOpenTabs();

    act(() => {
      here.session.current().lock();
    });

    await waitFor(() => {
      expect(other.session.current().status).toBe('locked');
    });
    expect(other.session.current().exited).toBe(false);
    // The screen it locked on is not held: the code opens the start.
    act(() => {
      other.session.current().holdScreen('/confirm/product', null);
    });
    expect(other.session.current().takeHeldScreen()).toBeNull();
  });

  it('a lock from another tab forgets the lists waiting and the passer-by here', async () => {
    const { other, here } = await twoOpenTabs();
    act(() => {
      other.check.current().start('bineta');
      other.check.current().add({ ref: { kind: 'plant', id: 'kinkeliba' } });
      other.check.current().startQuick(profileOf({ id: 'passer-by' }));
      other.check.current().add({ ref: { kind: 'plant', id: 'moringa' } });
    });

    act(() => {
      here.session.current().lock();
    });

    await waitFor(() => {
      expect(other.session.current().status).toBe('locked');
    });
    expect(other.check.current().pendingOf('bineta')).toBe(0);
    expect(other.check.current()).toMatchObject({ quick: null, profileId: null, items: [] });
  });

  it('another code stored in another tab locks this one and forgets the lists waiting and the passer-by', async () => {
    const { other } = await twoOpenTabs();
    act(() => {
      other.check.current().start('bineta');
      other.check.current().add({ ref: { kind: 'plant', id: 'kinkeliba' } });
      other.check.current().startQuick(profileOf({ id: 'passer-by' }));
    });

    await storeVerifier(await verifierOf('7392'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(other.session.current().status).toBe('locked');
    });
    expect(other.check.current().pendingOf('bineta')).toBe(0);
    expect(other.check.current().quick).toBeNull();
  });

  it('an auto-lock stays in its own tab: each tab counts its own two minutes', async () => {
    const post = vi.spyOn(BroadcastChannel.prototype, 'postMessage');
    const { session } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => {
      session.current().touch();
    });

    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS);
    });

    expect(session.current().status).toBe('locked');
    expect(post).not.toHaveBeenCalled();
  });

  it('an erase in one tab sends every tab back to the welcome, and the old code opens nothing', async () => {
    await storeSettings({ lang: 'en', mode: 'woman', onboarded: true });
    await storeVerifier(await verifierOf(CODE));
    const locked = renderTab();
    const open = renderTab({ startUnlocked: true });
    await waitFor(() => {
      expect(locked.session.current().status).toBe('locked');
      expect(open.settings()?.onboarded).toBe(true);
    });
    act(() => {
      open.check.current().start('a');
    });

    await act(async () => {
      await locked.session.current().forgetCode();
    });

    await waitFor(() => {
      expect(open.session.current().status).toBe('new');
    });
    expect(open.session.current().keyMaterial()).toBeNull();
    expect(open.settings()).toEqual({ lang: 'en', mode: null, onboarded: false });
    expect(open.check.current().profileId).toBeNull();
    let result = '';
    await act(async () => {
      result = await open.session.current().unlock(CODE);
    });
    expect(result).toBe('unavailable');
  });

  it('a tab that missed the message (frozen, cached) applies it as soon as it comes back', async () => {
    const { other, here } = await twoOpenTabs({ deaf: true });

    act(() => {
      here.session.current().quickExit();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(other.session.current().unlocked).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(other.session.current().status).toBe('locked');
    expect(other.session.current().exited).toBe(true);
  });

  it('a code screen in another tab says the wrong codes counted since, not its own old count', async () => {
    await storeVerifier(await verifierOf(CODE));
    const first = renderTab();
    const second = renderTab();
    await waitFor(() => {
      expect(first.session.current().status).toBe('locked');
      expect(second.session.current().status).toBe('locked');
    });
    for (const tab of [first, first, second, second]) {
      await act(async () => {
        await tab.session.current().unlock('0000');
      });
    }

    await waitFor(() => {
      expect(first.session.current().lockout.failures).toBe(4);
    });
  });

  it('a code screen that missed the count reads it again when it comes back', async () => {
    await storeVerifier(await verifierOf(CODE));
    const asleep = renderTab({ deaf: true });
    const awake = renderTab();
    await waitFor(() => {
      expect(asleep.session.current().status).toBe('locked');
      expect(awake.session.current().status).toBe('locked');
    });
    await act(async () => {
      await asleep.session.current().unlock('0000');
    });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await awake.session.current().unlock('0000');
      });
    }
    expect(asleep.session.current().lockout.failures).toBe(1);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(asleep.session.current().lockout.failures).toBe(4);
    });
  });
});

describe('danger signs ticked without the code', () => {
  it('are forgotten after two minutes without interaction while locked', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => {
      session.current().touch();
    });
    window.history.replaceState(inSession({ dangerSigns: ['bleeding'] }), '');
    const before = session.current().epoch;

    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1);
    });
    expect(sessionState()).toMatchObject({ dangerSigns: ['bleeding'] });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(sessionState()).toEqual({});
    expect(session.current().epoch).not.toBe(before);
    expect(session.current().status).toBe('locked');
  });

  it('are forgotten when the page comes back after more than two minutes hidden', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    window.history.replaceState(inSession({ dangerSigns: ['bleeding'] }), '');

    act(() => {
      setVisibility('hidden');
    });
    vi.setSystemTime(start + 60_000);
    act(() => {
      setVisibility('visible');
    });
    expect(sessionState()).toMatchObject({ dangerSigns: ['bleeding'] });

    act(() => {
      setVisibility('hidden');
    });
    vi.setSystemTime(start + 60_000 + AUTO_LOCK_MS + 1);
    act(() => {
      setVisibility('visible');
    });
    expect(sessionState()).toEqual({});
  });

  it('are forgotten at every lock', async () => {
    const { session } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    window.history.replaceState(inSession({ dangerSigns: ['bleeding'] }), '');
    const before = session.current().epoch;

    act(() => {
      session.current().lock();
    });

    expect(sessionState()).toEqual({});
    expect(session.current().epoch).not.toBe(before);
  });
});

describe('one code on the phone, whatever the tabs', () => {
  /** The code another tab made: stored as the welcome stores it, with its settings. */
  async function codeMadeElsewhere(code = CODE) {
    const made = await verifierOf(code);
    await storeSettings({ lang: 'fr', mode: 'woman', onboarded: false });
    await storeNewVerifier(made);
    return made;
  }

  it('refuses a second code made on the welcome of another tab, and asks for hers', async () => {
    const welcome = renderTab();
    await waitFor(() => {
      expect(welcome.session.current().status).toBe('new');
    });
    const hers = await codeMadeElsewhere();

    let made = '';
    await act(async () => {
      made = await welcome.session.current().createCode('1111');
    });

    expect(made).toBe('exists');
    expect(welcome.session.current().status).toBe('locked');
    expect(welcome.session.current().keyMaterial()).toBeNull();
    expect(await getStoredVerifier()).toEqual(hers);
    let result = '';
    await act(async () => {
      result = await welcome.session.current().unlock('1111');
    });
    expect(result).toBe('wrong');
    await act(async () => {
      result = await welcome.session.current().unlock(CODE);
    });
    expect(result).toBe('ok');
  });

  it('sends a tab on the welcome to the code screen as soon as another tab makes the code', async () => {
    const first = renderTab();
    const second = renderTab();
    await waitFor(() => {
      expect(first.session.current().status).toBe('new');
      expect(second.session.current().status).toBe('new');
    });

    await act(async () => {
      await first.session.current().createCode(CODE);
    });

    await waitFor(() => {
      expect(second.session.current().status).toBe('locked');
    });
  });

  it('a tab that missed it reads the stored code when it comes back', async () => {
    const deaf = renderTab({ deaf: true });
    await waitFor(() => {
      expect(deaf.session.current().status).toBe('new');
    });
    await codeMadeElsewhere();

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(deaf.session.current().status).toBe('locked');
    });
  });

  it('an erase only said, never done, leaves every tab as it was', async () => {
    const { other } = await twoOpenTabsWithCode();
    // A forged message and a forged epoch mark: the code is still stored.
    localStorage.setItem(EPOCH_KEY, JSON.stringify({ erase: 'forged' }));
    const forger = new BroadcastChannel(SESSION_CHANNEL);
    forger.postMessage('erase');
    forger.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(other.session.current().status).toBe('unlocked');
    expect(other.settings()?.onboarded).toBe(true);
  });

  it('holds the code it opened, so its writes check that code (data/code-guard.ts)', async () => {
    const welcome = renderTab();
    await waitFor(() => {
      expect(welcome.session.current().status).toBe('new');
    });
    await act(async () => {
      await welcome.session.current().createCode(CODE);
    });
    const stored = await getStoredVerifier();
    expect(stored === undefined ? null : codeFingerprint(stored)).toBe(openedCode());

    act(() => {
      welcome.session.current().lock();
    });
    codeOpened(null);
    await act(async () => {
      await welcome.session.current().unlock(CODE);
    });
    expect(stored === undefined ? null : codeFingerprint(stored)).toBe(openedCode());
  });

  it('locks a tab whose code was erased and made again elsewhere, once it comes back', async () => {
    const deaf = renderTab({ startUnlocked: false, deaf: true });
    await storeVerifier(await verifierOf(CODE));
    await act(async () => {
      await deaf.session.current().unlock(CODE);
    });
    await waitFor(() => {
      expect(deaf.session.current().unlocked).toBe(true);
    });
    // Without any message: erased, then another code made.
    await eraseProfilesAndCode();
    const his = await verifierOf('1111');
    await storeNewVerifier(his);

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    await waitFor(() => {
      expect(deaf.session.current().status).toBe('locked');
    });
    let result = '';
    await act(async () => {
      result = await deaf.session.current().unlock(CODE);
    });
    expect(result).toBe('wrong');
  });

  async function twoOpenTabsWithCode() {
    await storeSettings({ lang: 'fr', mode: 'woman', onboarded: false });
    await storeVerifier(await verifierOf(CODE));
    codeOpened(await verifierOf(CODE));
    await storeSettings({ lang: 'fr', mode: 'woman', onboarded: true });
    codeOpened(null);
    const other = renderTab({ startUnlocked: true });
    const here = renderTab({ startUnlocked: true });
    await waitFor(() => {
      expect(other.settings()?.onboarded).toBe(true);
      expect(here.session.current().unlocked).toBe(true);
    });
    return { other, here };
  }
});

describe('a code made while storage is slow or the welcome was cut short', () => {
  /**
   * Holds a readwrite transaction on the settings, as another tab in the
   * middle of a write: the app's writes wait behind it. `release` ends it,
   * after writing `code` (another tab's code) when given.
   */
  async function holdSettings() {
    await openAppDb();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('siapso');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('cannot open the database'));
      };
    });
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    let held = true;
    let code: CodeVerifier | undefined;
    const spin = () => {
      if (held) {
        store.get('code').onsuccess = spin;
      } else if (code !== undefined) {
        store.put(code, 'code');
      }
    };
    spin();
    const done = new Promise<void>((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    });
    return {
      release(write?: CodeVerifier) {
        code = write;
        held = false;
        return done;
      },
    };
  }

  function renderSlowTab() {
    const session = probeSession();
    render(
      <AppProvider packLoader={loaderOf(shellPack())} storageTimeoutMs={200}>
        {session.element}
      </AppProvider>,
    );
    return session;
  }

  it('opens nothing, and writes nothing, when its store does not end in time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = renderSlowTab();
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });
    const hold = await holdSettings();

    // The storage stays held until the code is given up (however long the
    // derivation takes before the store starts): nothing is opened.
    let result = '';
    await act(async () => {
      result = await session.current().createCode(CODE);
    });
    expect(result).toBe('unsaved');
    expect(session.current().unlocked).toBe(false);

    // Given up truly: once the storage answers, it holds no code, and the welcome asks again.
    await hold.release();
    expect(await getStoredVerifier()).toBeUndefined();
  });

  it('makes the code of a phone that kept profiles in clear, however slow the encryption', async () => {
    const db = await openAppDb();
    await db.put('profiles', profileOf({ id: 'a', pseudonym: 'Aminata' }));
    await db.put('profiles', profileOf({ id: 'b', pseudonym: 'Ndeye' }));
    await db.put('profiles', profileOf({ id: 'c', pseudonym: 'Coumba' }));
    const session = probeSession();
    render(
      <AppProvider packLoader={loaderOf(shellPack())} storageTimeoutMs={100}>
        {session.element}
      </AppProvider>,
    );
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return encrypt(...args);
    });

    // Six encryptions of 80 ms: more than four storage timeouts of 100 ms.
    let made = '';
    await act(async () => {
      made = await session.current().createCode(CODE);
    });
    vi.restoreAllMocks();

    expect(made).toBe('made');
    expect((await listProfiles()).map((p) => p.pseudonym)).toEqual(['Aminata', 'Ndeye', 'Coumba']);
  });

  it('never opens when another code was stored while its store stalled: it asks for that one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = renderSlowTab();
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });
    const hold = await holdSettings();
    const his = await verifierOf('1111');

    let made: Promise<string> = Promise.resolve('');
    act(() => {
      made = session.current().createCode(CODE);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await hold.release(his);
    let result = '';
    await act(async () => {
      result = await made;
    });

    expect(result).toBe('exists');
    expect(session.current().unlocked).toBe(false);
    expect(session.current().keyMaterial()).toBeNull();
    expect(session.current().status).toBe('locked');
    expect(await getStoredVerifier()).toEqual(his);
  });

  it('a code refused while this tab knows the stored one still ends on the code screen', async () => {
    const { session, settings } = renderTab();
    await storeVerifier(await verifierOf(CODE));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });

    let made = '';
    await act(async () => {
      made = await session.current().createCode('1111');
    });

    expect(made).toBe('exists');
    expect(session.current().status).toBe('locked');
    expect(session.current().codeRefused).toBe(true);
    expect(settings()?.onboarded).toBe(true);
  });
});

describe('the keys of the open session (SCRUM-39)', () => {
  const aminata = profileOf({ id: 'a', pseudonym: 'Aminata', conditions: ['hiv-cotrimoxazole'] });
  const checked: HistoryEntry = {
    id: 'h1',
    profileId: 'a',
    at: '2026-11-04T10:00:00.000Z',
    packVersion: '0.1.0',
    level: 'danger',
    ruleIds: ['misoprostol-pregnancy'],
    items: [{ ref: { kind: 'unrecognised', text: 'pilule secrete zx' } }],
    signs: ['fever'],
  };
  const midwife = { id: 'c1', role: 'midwife', name: 'Awa Diop', phone: '000 000 001' } as const;

  /** What an older version left: everything in clear. */
  async function seedInClear(): Promise<void> {
    const db = await openAppDb();
    await db.put('profiles', aminata);
    await db.put('history', checked);
    await db.put('contacts', [midwife], 'saved');
  }

  /** Every record of the profile stores, as someone reading the storage would see them. */
  async function dump(): Promise<string> {
    const db = await openAppDb();
    return JSON.stringify([
      await db.getAll('profiles'),
      await db.getAll('history'),
      await db.getAll('contacts'),
    ]);
  }

  async function unlockWith(session: ReturnType<typeof probeSession>, code: string) {
    let result = '';
    await act(async () => {
      result = await session.current().unlock(code);
    });
    return result;
  }

  it('opens the keys with the right code only, and forgets them at the lock', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });

    expect(await unlockWith(session, '1111')).toBe('wrong');
    expect(isVaultOpen()).toBe(false);
    expect(await unlockWith(session, CODE)).toBe('ok');
    expect(isVaultOpen()).toBe(true);
    await saveProfile(aminata);
    expect(await listProfiles()).toEqual([aminata]);

    act(() => {
      session.current().lock();
    });

    expect(isVaultOpen()).toBe(false);
    await expect(listProfiles()).rejects.toBeInstanceOf(LockedError);
  });

  it('forgets them at the auto-lock and at the quick exit', async () => {
    await openVaultOf(CODE);
    const { session } = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(session.current().unlocked).toBe(true);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => {
      session.current().touch();
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS);
    });
    expect(session.current().status).toBe('locked');
    expect(isVaultOpen()).toBe(false);
    vi.useRealTimers();

    expect(await unlockWith(session, CODE)).toBe('ok');
    expect(isVaultOpen()).toBe(true);
    act(() => {
      session.current().quickExit();
    });
    expect(isVaultOpen()).toBe(false);
  });

  it('a lock in another tab makes every tab forget them, a tab that missed it once back', async () => {
    await storeVerifier(await verifierOf(CODE));
    const other = renderTab({ startUnlocked: true });
    const here = renderTab({ startUnlocked: true });
    const deaf = renderTab({ startUnlocked: true, deaf: true });
    await waitFor(() => {
      expect(other.session.current().unlocked).toBe(true);
      expect(here.session.current().unlocked).toBe(true);
      expect(deaf.session.current().unlocked).toBe(true);
    });

    act(() => {
      here.session.current().lock();
    });
    // The tabs of this test share one page: the keys the other tab holds come back.
    await openVaultOf(CODE);
    await waitFor(() => {
      expect(other.session.current().status).toBe('locked');
    });
    expect(isVaultOpen()).toBe(false);

    // The tab that missed the message forgets them as soon as it comes back.
    await openVaultOf(CODE);
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(deaf.session.current().status).toBe('locked');
    expect(isVaultOpen()).toBe(false);
  });

  it('the forgotten-code erase forgets them in every tab', async () => {
    await storeVerifier(await verifierOf(CODE));
    const locked = renderTab();
    // It misses the message, so the test knows when it hears of the erase.
    const open = renderTab({ startUnlocked: true, deaf: true });
    await waitFor(() => {
      expect(locked.session.current().status).toBe('locked');
      expect(open.session.current().unlocked).toBe(true);
    });

    await act(async () => {
      await locked.session.current().forgetCode();
    });
    expect(isVaultOpen()).toBe(false);
    // The tabs of this test share one page: the keys the open tab holds come back.
    await openVaultOf(CODE);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(open.session.current().status).toBe('new');
    });
    expect(isVaultOpen()).toBe(false);
  });

  it('a code made opens them, and the same code opens what was sealed after a lock', async () => {
    const { session } = await renderSession({ code: null });
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });
    await act(async () => {
      await session.current().createCode('135790');
    });
    expect(isVaultOpen()).toBe(true);
    await saveProfile(aminata);

    act(() => {
      session.current().lock();
    });
    expect(await unlockWith(session, '135790')).toBe('ok');

    expect(await listProfiles()).toEqual([aminata]);
  });

  it('seals what a phone onboarded before codes existed kept in clear, once the code is made', async () => {
    await seedInClear();
    const { session } = await renderSession({ code: null });
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });

    await act(async () => {
      await session.current().createCode(CODE);
    });

    expect(await dump()).not.toContain('Aminata');
    expect(await listProfiles()).toEqual([aminata]);
  });

  it('the first unlock after the update seals what was kept in clear and makes the code again', async () => {
    const old = await legacyVerifier(CODE);
    await seedInClear();
    const { session } = await renderSession({ verifier: old });
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });

    expect(await unlockWith(session, CODE)).toBe('ok');

    const stored = await getStoredVerifier();
    expect(stored?.version).toBe(2);
    expect(stored?.salt).not.toBe(old.salt);
    expect(stored === undefined ? null : codeFingerprint(stored)).toBe(openedCode());
    const text = await dump();
    for (const clear of ['Aminata', 'hiv', 'pilule', 'misoprostol', 'Awa Diop', '000 000 001']) {
      expect(text).not.toContain(clear);
    }
    expect(await listProfiles()).toEqual([aminata]);
    expect(await listHistory('a')).toEqual([checked]);
    expect(await loadSavedContacts()).toEqual([midwife]);
    // Locked, then the code again: the new verifier opens it all.
    act(() => {
      session.current().lock();
    });
    expect(await unlockWith(session, CODE)).toBe('ok');
    expect(await listProfiles()).toEqual([aminata]);
  });

  it('opens nothing, and leaves everything as it was, when that first unlock cannot seal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const old = await legacyVerifier(CODE);
    await seedInClear();
    const before = await dump();
    const { session } = await renderSession({ verifier: old });
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    const refused = failWrites((store) => store.name === 'profiles');

    expect(await unlockWith(session, CODE)).toBe('failed');

    expect(session.current().unlocked).toBe(false);
    expect(isVaultOpen()).toBe(false);
    expect(session.current().lockout).toEqual({ failures: 0, lockedUntil: null });
    expect(await getStoredVerifier()).toEqual(old);
    expect(await dump()).toBe(before);
    refused.restore();
    expect(await unlockWith(session, CODE)).toBe('ok');
    expect(await dump()).not.toContain('Aminata');
  });

  it('never opens after a quick exit made while the code was being worked out', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });

    let pending: Promise<string> = Promise.resolve('');
    act(() => {
      pending = session.current().unlock(CODE);
    });
    act(() => {
      session.current().quickExit();
    });
    let result = '';
    await act(async () => {
      result = await pending;
    });

    expect(result).toBe('cancelled');
    expect(session.current().status).toBe('locked');
    expect(session.current().exited).toBe(true);
    expect(session.current().keyMaterial()).toBeNull();
    expect(isVaultOpen()).toBe(false);
  });

  it('never opens after a lock from another tab made while the code was being worked out', async () => {
    await storeVerifier(await verifierOf(CODE));
    const here = renderTab();
    const other = renderTab({ startUnlocked: true });
    await waitFor(() => {
      expect(here.session.current().status).toBe('locked');
      expect(other.session.current().unlocked).toBe(true);
    });

    let pending: Promise<string> = Promise.resolve('');
    act(() => {
      pending = here.session.current().unlock(CODE);
      other.session.current().lock();
    });
    let result = '';
    await act(async () => {
      result = await pending;
    });

    expect(result).toBe('cancelled');
    expect(here.session.current().status).toBe('locked');
    expect(isVaultOpen()).toBe(false);
  });

  it('opens with the verifier stored when the same code was made again elsewhere meanwhile', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    // Erased and made again in another tab, with the same digits: another salt.
    const again = await createCodeKeys(CODE);
    await storeVerifier(again.verifier);

    expect(await unlockWith(session, CODE)).toBe('ok');

    expect(openedCode()).toBe(codeFingerprint(again.verifier));
    await saveProfile(aminata);
    expect(await listProfiles()).toEqual([aminata]);
  });

  it('opens nothing when another code was made elsewhere meanwhile, and counts the try', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    await storeVerifier(await verifierOf('1357'));

    expect(await unlockWith(session, CODE)).toBe('wrong');

    expect(session.current().unlocked).toBe(false);
    expect(isVaultOpen()).toBe(false);
    expect(session.current().lockout.failures).toBe(1);
  });

  it('never shows records written in clear after the update, and deletes them at the next unlock', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    expect(await unlockWith(session, CODE)).toBe('ok');
    await saveProfile(profileOf({ id: 'n', pseudonym: 'Ndeye' }));
    // Someone writes records in clear into the storage.
    const db = await openAppDb();
    await db.put('profiles', aminata);
    await db.put('history', checked);
    await db.put('contacts', [{ ...midwife, phone: '000 000 999' }], 'saved');

    expect((await listProfiles()).map((p) => p.pseudonym)).toEqual(['Ndeye']);
    expect(await listHistory('a')).toEqual([]);
    await expect(loadSavedContacts()).rejects.toThrow();
    act(() => {
      session.current().lock();
    });
    expect(await unlockWith(session, CODE)).toBe('ok');

    expect(await db.count('profiles')).toBe(1);
    expect(await db.count('history')).toBe(0);
    expect(await db.count('contacts')).toBe(0);
    expect(await dump()).not.toMatch(/Aminata|000 000 999|pilule/);
  });

  it('times the storage only: a slow encryption at the first unlock after the update still opens', async () => {
    const old = await legacyVerifier(CODE);
    await storeVerifier(old);
    await seedInClear();
    const session = probeSession();
    render(
      <AppProvider packLoader={loaderOf(shellPack())} storageTimeoutMs={100}>
        {session.element}
      </AppProvider>,
    );
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return encrypt(...args);
    });

    // Six encryptions of 80 ms, more than three storage timeouts of 100 ms.
    expect(await unlockWith(session, CODE)).toBe('ok');
    vi.restoreAllMocks();

    expect((await getStoredVerifier())?.version).toBe(2);
    expect(await listProfiles()).toEqual([aminata]);
  });

  it('never opens after a quick exit made while waiting for another tab trying a code', async () => {
    const { session } = await renderSession();
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });
    // Another tab holds the lock of the code tries for a while (Web Locks).
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, work: () => Promise<unknown>) =>
          new Promise((resolve) => setTimeout(resolve, 100)).then(work),
      },
    });

    let pending: Promise<string> = Promise.resolve('');
    act(() => {
      pending = session.current().unlock(CODE);
    });
    act(() => {
      session.current().quickExit();
    });
    let result = '';
    await act(async () => {
      result = await pending;
    });
    Reflect.deleteProperty(navigator, 'locks');

    expect(result).toBe('cancelled');
    expect(session.current().unlocked).toBe(false);
    expect(isVaultOpen()).toBe(false);
  });

  it('never opens a code made while the session was locked meanwhile', async () => {
    const { session } = await renderSession({ code: null });
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });

    let pending: Promise<string> = Promise.resolve('');
    act(() => {
      pending = session.current().createCode(CODE);
    });
    act(() => {
      session.current().quickExit();
    });
    let made = '';
    await act(async () => {
      made = await pending;
    });

    expect(made).toBe('cancelled');
    expect(session.current().unlocked).toBe(false);
    expect(session.current().status).toBe('locked');
    expect(isVaultOpen()).toBe(false);
    // The code is kept: it opens the phone.
    expect(await unlockWith(session, CODE)).toBe('ok');
  });

  it('opens nothing, and counts no try, with a verifier of a newer version of the app', async () => {
    const newer = { ...(await verifierOf(CODE)), version: 3 };
    const { session } = await renderSession({ verifier: newer });
    await waitFor(() => {
      expect(session.current().status).toBe('locked');
    });

    expect(await unlockWith(session, CODE)).toBe('unsupported');

    expect(session.current().unlocked).toBe(false);
    expect(session.current().lockout).toEqual({ failures: 0, lockedUntil: null });
    expect(await getStoredLockout()).toBeUndefined();
  });

  it('tells the other tabs once the verifier is made again: they lock and ask for the code', async () => {
    const old = await legacyVerifier(CODE);
    await storeVerifier(old);
    await seedInClear();
    const open = renderTab({ startUnlocked: true });
    const here = renderTab();
    await waitFor(() => {
      expect(open.session.current().unlocked).toBe(true);
      expect(here.session.current().status).toBe('locked');
    });

    expect(await unlockWith(here.session, CODE)).toBe('ok');

    await waitFor(() => {
      expect(open.session.current().status).toBe('locked');
    });
  });

  it('a second tab that read the older code opens with the one the first tab made', async () => {
    const old = await legacyVerifier(CODE);
    await storeVerifier(old);
    await seedInClear();
    const first = renderTab();
    const second = renderTab();
    await waitFor(() => {
      expect(first.session.current().status).toBe('locked');
      expect(second.session.current().status).toBe('locked');
    });

    expect(await unlockWith(first.session, CODE)).toBe('ok');
    const made = await getStoredVerifier();
    expect(await unlockWith(second.session, CODE)).toBe('ok');

    expect(await getStoredVerifier()).toEqual(made);
    expect(await listProfiles()).toEqual([aminata]);
  });
});

describe('answers not saved when the session locks', () => {
  async function openSession() {
    await openVaultOf(CODE);
    const tab = await renderSession({ startUnlocked: true });
    await waitFor(() => {
      expect(tab.session.current().unlocked).toBe(true);
    });
    return tab;
  }

  function autoLock(session: ReturnType<typeof probeSession>) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => {
      session.current().touch();
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS);
    });
    vi.useRealTimers();
    expect(session.current().status).toBe('locked');
  }

  it('are kept in memory across an auto-lock, never stored, and given back after the code', async () => {
    const { session } = await openSession();
    act(() => {
      session.current().keepDraft('profile:new', { pseudonym: 'Mariama' }, true);
    });

    autoLock(session);

    const db = await openAppDb();
    const entries = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, i) => {
        const key = storage.key(i) ?? '';
        return [key, storage.getItem(key)];
      });
    const stored = JSON.stringify([
      await db.getAll('settings'),
      await db.getAll('profiles'),
      entries(localStorage),
      entries(sessionStorage),
      window.history.state,
    ]);
    expect(stored).not.toContain('Mariama');
    await act(async () => {
      await session.current().unlock(CODE);
    });
    // To their own screen only.
    expect(session.current().draftFor('profile:mine')).toBeNull();
    expect(session.current().draftFor('profile:new')).toEqual({ value: { pseudonym: 'Mariama' } });
  });

  it('are dropped once another screen shows, and kept while their own screen does', async () => {
    const { session } = await openSession();
    act(() => {
      session.current().keepDraft('profile:new', { pseudonym: 'Mariama' }, true);
      session.current().dropDraft('profile:new');
    });
    expect(session.current().draftFor('profile:new')).not.toBeNull();

    act(() => {
      session.current().dropDraft('home');
    });
    expect(session.current().draftFor('profile:new')).toBeNull();
  });

  it('are forgotten at a lock from another tab and at the quick exit', async () => {
    await storeVerifier(await verifierOf(CODE));
    const other = renderTab({ startUnlocked: true });
    const here = renderTab({ startUnlocked: true });
    await waitFor(() => {
      expect(other.session.current().unlocked).toBe(true);
      expect(here.session.current().unlocked).toBe(true);
    });
    act(() => {
      other.session.current().keepDraft('profile:new', { pseudonym: 'Mariama' }, true);
      here.session.current().keepDraft('profile:new', { pseudonym: 'Coumba' }, true);
    });

    act(() => {
      here.session.current().lock();
    });
    await waitFor(() => {
      expect(other.session.current().status).toBe('locked');
    });
    expect(other.session.current().draftFor('profile:new')).toBeNull();

    act(() => {
      here.session.current().quickExit();
    });
    expect(here.session.current().draftFor('profile:new')).toBeNull();
  });

  it('are forgotten at the erase and when another code is on the phone', async () => {
    await storeVerifier(await verifierOf(CODE));
    const locked = renderTab();
    const open = renderTab({ startUnlocked: true });
    await waitFor(() => {
      expect(locked.session.current().status).toBe('locked');
      expect(open.session.current().unlocked).toBe(true);
    });
    act(() => {
      open.session.current().keepDraft('profile:new', { pseudonym: 'Mariama' }, true);
      locked.session.current().keepDraft('profile:new', { pseudonym: 'Coumba' }, true);
    });

    await act(async () => {
      await locked.session.current().forgetCode();
    });
    expect(locked.session.current().draftFor('profile:new')).toBeNull();
    await waitFor(() => {
      expect(open.session.current().status).toBe('new');
    });
    expect(open.session.current().draftFor('profile:new')).toBeNull();

    // Another code made elsewhere: a tab that held answers under the old one drops them.
    await storeVerifier(await verifierOf(CODE));
    const before = renderTab({ startUnlocked: true, deaf: true });
    await waitFor(() => {
      expect(before.session.current().unlocked).toBe(true);
    });
    act(() => {
      before.session.current().keepDraft('profile:new', { pseudonym: 'Mariama' }, true);
    });
    await eraseProfilesAndCode();
    await storeNewVerifier(await verifierOf('1111'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(before.session.current().status).toBe('locked');
    });
    expect(before.session.current().draftFor('profile:new')).toBeNull();
  });

  it('warn 30 s before the auto-lock, and a touch puts it off for two minutes', async () => {
    const { session } = await openSession();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => {
      session.current().keepDraft('profile:new', { pseudonym: 'Mariama' }, true);
      session.current().touch();
    });

    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS - LOCK_WARNING_MS - 1);
    });
    expect(session.current().lockSoon).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(session.current().lockSoon).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(session.current().lockSoon).toBe(false);
    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1);
    });
    expect(session.current().unlocked).toBe(true);
    expect(session.current().lockSoon).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(session.current().status).toBe('locked');
    expect(session.current().lockSoon).toBe(false);
  });

  it('never warn when every answer is saved', async () => {
    const { session } = await openSession();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act(() => {
      session.current().keepDraft('profile:new', { pseudonym: 'Femme 1' }, false);
      session.current().touch();
    });

    act(() => {
      vi.advanceTimersByTime(AUTO_LOCK_MS - 1);
    });

    expect(session.current().lockSoon).toBe(false);
  });
});
