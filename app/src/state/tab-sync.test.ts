// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_DELAY_MS,
  EPOCH_KEY,
  joinTabs,
  type MarkStore,
  type TabEvent,
  type TabLink,
} from './tab-sync.js';

const links: TabLink[] = [];

/** The copy of the epoch token in IndexedDB, shared by the tabs of a test. */
function markStore() {
  let stored: unknown = undefined;
  return {
    read: () => Promise.resolve(stored),
    write: (token: string) => {
      stored = token;
      return Promise.resolve();
    },
    get stored() {
      return stored;
    },
  };
}

/** A tab of the app; `deaf` has no channel, as an old browser, or a frozen tab that missed it. */
function tab({ deaf = false, marks }: { deaf?: boolean; marks?: MarkStore } = {}) {
  const events: TabEvent[] = [];
  const ids: (string | undefined)[] = [];
  const onRecheck = vi.fn();
  const onMissed = vi.fn();
  if (deaf) vi.stubGlobal('BroadcastChannel', undefined);
  const link = joinTabs({
    onEvent: (event, id) => {
      events.push(event);
      ids.push(id);
    },
    onMissed,
    onRecheck,
    ...(marks === undefined ? {} : { marks }),
  });
  vi.unstubAllGlobals();
  links.push(link);
  return { link, events, ids, onRecheck, onMissed };
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Lets the check after a storage event or a return run (it waits for the channel first). */
function afterTheCheck() {
  return new Promise((resolve) => setTimeout(resolve, CHECK_DELAY_MS + 30));
}

afterEach(() => {
  for (const link of links.splice(0)) link.close();
  vi.unstubAllGlobals();
  localStorage.clear();
  setVisibility('visible');
});

describe('tabs of the app', () => {
  it('tells every other tab which event happened on the channel, never itself', async () => {
    const a = tab();
    const b = tab();
    const c = tab();

    a.link.announce('quick-exit');
    await vi.waitFor(() => {
      expect(b.events).toEqual(['quick-exit']);
      expect(c.events).toEqual(['quick-exit']);
    });
    b.link.announce('profile-deleted', 'profile-7');
    await vi.waitFor(() => {
      expect(a.events).toEqual(['profile-deleted']);
    });
    expect(a.ids).toEqual(['profile-7']);
    expect(b.events).toEqual(['quick-exit']);
  });

  it('keeps one random token in storage, which says nothing of the event or the profile', () => {
    const marks = markStore();
    const link = tab({ marks }).link;
    const seen = new Set<string>();
    for (const [event, id] of [
      ['quick-exit', undefined],
      ['lock', undefined],
      ['erase', undefined],
      ['profile-deleted', 'profile-id-1'],
    ] as const) {
      link.announce(event, id);
      const text = localStorage.getItem(EPOCH_KEY) ?? '';
      // One token, the same shape whatever happened.
      expect(text).toMatch(/^[0-9a-f]{32}$/);
      expect(marks.stored).toBe(text);
      expect(seen.has(text)).toBe(false);
      seen.add(text);
    }
    // Nothing in a token tells an event: its last digits take every value for one event.
    const lastDigits = (event: TabEvent) => {
      const digits = new Set<string>();
      for (let i = 0; i < 64; i += 1) {
        link.announce(event);
        digits.add((localStorage.getItem(EPOCH_KEY) ?? '').slice(-1));
      }
      return digits.size;
    };
    expect(lastDigits('quick-exit')).toBeGreaterThan(8);
    expect(lastDigits('lock')).toBeGreaterThan(8);
  });

  it('a fresh token at each start or unlock says nothing to a tab that hears the channel', async () => {
    const a = tab();
    const b = tab();
    const before = localStorage.getItem(EPOCH_KEY);

    a.link.refresh();
    expect(localStorage.getItem(EPOCH_KEY)).not.toBe(before);
    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY }));
    window.dispatchEvent(new Event('focus'));
    await afterTheCheck();

    expect(b.events).toEqual([]);
    expect(b.onMissed).not.toHaveBeenCalled();
  });

  it('a tab that hears the channel waits for it: a storage event first is no missed event', async () => {
    const a = tab();
    const b = tab();

    a.link.announce('lock');
    // The storage event may come before the channel's message.
    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY }));
    await afterTheCheck();

    expect(b.events).toEqual(['lock']);
    expect(b.onMissed).not.toHaveBeenCalled();
  });

  it('a tab with no channel hears the token change in local storage, and takes the safest way', async () => {
    const deaf = tab({ deaf: true });
    tab().link.announce('lock');

    // The browser fires it in the other tabs; here, by hand.
    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY }));
    await afterTheCheck();

    // It cannot tell which event: never a guess, the quick exit and a recheck.
    expect(deaf.events).toEqual([]);
    expect(deaf.onMissed).toHaveBeenCalledTimes(1);
    // Once only for one change.
    window.dispatchEvent(new Event('focus'));
    await afterTheCheck();
    expect(deaf.onMissed).toHaveBeenCalledTimes(1);
  });

  it('a tab that missed any event (lock, exit, erase, deletion, code) takes the safest way when it comes back', async () => {
    for (const event of ['lock', 'quick-exit', 'erase', 'profile-deleted'] as const) {
      const asleep = tab({ deaf: true });
      const awake = tab();
      awake.link.announce(event, event === 'profile-deleted' ? 'p1' : undefined);

      setVisibility('hidden');
      setVisibility('visible');
      await afterTheCheck();

      expect(asleep.onMissed, event).toHaveBeenCalledTimes(1);
      expect(asleep.events).toEqual([]);
      for (const link of links.splice(0)) link.close();
    }
    // A code changed elsewhere: told on the channel as a recheck, missed as a change of token.
    const asleep = tab({ deaf: true });
    const awake = tab();
    awake.link.announceCode();
    awake.link.refresh();
    window.dispatchEvent(new Event('pageshow'));
    await afterTheCheck();
    expect(asleep.onMissed).toHaveBeenCalledTimes(1);
    expect(asleep.onRecheck).toHaveBeenCalled();
  });

  it('a tab with no channel and no local storage reads the copy in IndexedDB when it comes back', async () => {
    const marks = markStore();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const deaf = tab({ deaf: true, marks });
    const other = tab({ marks });
    // Both have read the copy as it was when they opened.
    await new Promise((resolve) => setTimeout(resolve, 10));

    other.link.announce('lock');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deaf.onMissed).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => {
      expect(deaf.onMissed).toHaveBeenCalledTimes(1);
    });
    expect(other.onMissed).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('still tells the other tabs when storage refuses the token, and never makes up an event', async () => {
    const a = tab();
    const b = tab();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    a.link.announce('quick-exit');
    await vi.waitFor(() => {
      expect(b.events).toEqual(['quick-exit']);
    });
    window.dispatchEvent(new Event('focus'));
    await afterTheCheck();
    expect(a.events).toEqual([]);
    expect(a.onMissed).not.toHaveBeenCalled();
    expect(b.onMissed).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('reads the wrong codes again when another tab counted one, and when the tab comes back', async () => {
    const a = tab();
    const b = tab();

    a.link.announceLockout();
    await vi.waitFor(() => {
      expect(b.onRecheck).toHaveBeenCalledTimes(1);
    });
    expect(a.onRecheck).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('focus'));
    expect(b.onRecheck).toHaveBeenCalledTimes(2);
    expect(b.events).toEqual([]);
  });

  it('reads the code again when another tab made one', async () => {
    const a = tab();
    const b = tab();

    a.link.announceCode();

    await vi.waitFor(() => {
      expect(b.onRecheck).toHaveBeenCalledTimes(1);
    });
    expect(b.events).toEqual([]);
  });

  it('stops listening once closed', async () => {
    const a = tab();
    const b = tab();
    b.link.close();

    a.link.announce('quick-exit');
    await new Promise((resolve) => setTimeout(resolve, 20));
    window.dispatchEvent(new Event('focus'));
    await afterTheCheck();

    expect(b.events).toEqual([]);
    expect(b.onRecheck).not.toHaveBeenCalled();
    expect(b.onMissed).not.toHaveBeenCalled();
  });
});
