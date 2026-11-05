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
import { recordHistory } from '../data/history.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import { loadSavedContacts, saveContacts } from '../data/referral.js';
import {
  AUTO_LOCK_MS,
  checkCode,
  PBKDF2_ITERATIONS,
  type CodeVerifier,
  type LockoutState,
} from '../domain/code.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { breakIndexedDB } from '../test/idb.js';
import { profileOf } from '../test/knowledge-pack.js';
import { loaderOf, shellPack } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';
import { verifierOf, weakVerifier } from '../test/verifier.js';
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
    expect(await listProfiles()).toEqual([]);
    expect(await loadSavedContacts()).toEqual([]);
    const db = await openAppDb();
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

  it('opens only once the stalled store shows its own code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = renderSlowTab();
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });
    const hold = await holdSettings();

    let made: Promise<string> = Promise.resolve('');
    act(() => {
      made = session.current().createCode(CODE);
    });
    // The store waits beyond the timeout: nothing is opened meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(session.current().unlocked).toBe(false);

    await hold.release();
    let result = '';
    await act(async () => {
      result = await made;
    });

    expect(result).toBe('made');
    expect(session.current().unlocked).toBe(true);
    const stored = await getStoredVerifier();
    expect(stored === undefined ? false : await checkCode(CODE, stored)).toBe(true);
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
