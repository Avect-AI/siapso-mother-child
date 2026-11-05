// SPDX-License-Identifier: MIT
import { act, render, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStoredLockout,
  getStoredSettings,
  getStoredVerifier,
  openAppDb,
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
import { probeCheck } from '../test/check-probe.js';
import { breakIndexedDB } from '../test/idb.js';
import { profileOf } from '../test/knowledge-pack.js';
import { loaderOf, shellPack } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';
import { verifierOf, weakVerifier } from '../test/verifier.js';
import { AppProvider } from './app-state.js';
import { epochToken, inVisit, visitState } from './entry-state.js';

const CODE = '2468';

// Every unlock works out PBKDF2 at 600 000 iterations: slower under coverage.
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderTab() {
  const session = probeSession();
  const check = probeCheck();
  const view = render(
    <AppProvider packLoader={loaderOf(shellPack())}>
      {session.element}
      {check.element}
    </AppProvider>,
  );
  return { session, check, view };
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

  it('opens new in memory when the phone storage refuses the code, and still locks', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session } = await renderSession({ code: null });
    await waitFor(() => {
      expect(session.current().status).toBe('new');
    });
    const db = await openAppDb();
    vi.spyOn(db, 'put').mockRejectedValue(new Error('QuotaExceededError'));

    await act(async () => {
      await session.current().createCode('1357');
    });
    expect(session.current().unlocked).toBe(true);

    act(() => {
      session.current().lock();
    });
    let result = '';
    await act(async () => {
      result = await session.current().unlock('1357');
    });
    expect(result).toBe('ok');
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
