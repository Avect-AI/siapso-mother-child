// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EPOCH_KEY,
  eventOfMark,
  joinTabs,
  type MarkStore,
  type TabEvent,
  type TabLink,
} from './tab-sync.js';

const links: TabLink[] = [];

/** The copy of the epoch in IndexedDB, shared by the tabs of a test. */
function markStore() {
  let stored: unknown = undefined;
  return {
    read: () => Promise.resolve(stored),
    update: (change: (value: unknown) => unknown) => {
      stored = change(stored);
      return Promise.resolve();
    },
    clear: () => {
      stored = undefined;
      return Promise.resolve();
    },
    get stored() {
      return stored;
    },
  };
}

/** A tab of the app; `deaf` misses every message, as a frozen or cached tab does. */
function tab({ deaf = false, marks }: { deaf?: boolean; marks?: MarkStore } = {}) {
  const events: TabEvent[] = [];
  const ids: (string | undefined)[] = [];
  const onRecheck = vi.fn();
  if (deaf) vi.stubGlobal('BroadcastChannel', undefined);
  const link = joinTabs({
    onEvent: (event, id) => {
      events.push(event);
      ids.push(id);
    },
    onRecheck,
    ...(marks === undefined ? {} : { marks }),
  });
  vi.unstubAllGlobals();
  links.push(link);
  return { link, events, ids, onRecheck };
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  for (const link of links.splice(0)) link.close();
  vi.unstubAllGlobals();
  localStorage.clear();
  setVisibility('visible');
});

describe('tabs of the app', () => {
  it('tells every other tab when one exits, locks or erases, never itself', async () => {
    const a = tab();
    const b = tab();
    const c = tab();

    a.link.announce('quick-exit');
    await vi.waitFor(() => {
      expect(b.events).toEqual(['quick-exit']);
      expect(c.events).toEqual(['quick-exit']);
    });
    b.link.announce('erase');
    await vi.waitFor(() => {
      expect(a.events).toEqual(['erase']);
    });
    expect(b.events).toEqual(['quick-exit']);
  });

  it('a tab that missed the message reads the stored epoch when it comes back', async () => {
    const asleep = tab({ deaf: true });
    const awake = tab();

    awake.link.announce('lock');
    // Nothing reaches a frozen tab, or one kept in the back-forward cache.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asleep.events).toEqual([]);

    window.dispatchEvent(new Event('focus'));
    expect(asleep.events).toEqual(['lock']);
    // Once only: the epoch read is now the one it knows.
    window.dispatchEvent(new Event('pageshow'));
    expect(asleep.events).toEqual(['lock']);
    // The tab that announced it knows its own epoch already.
    expect(awake.events).toEqual([]);
  });

  it('checks when the page shows again and when it comes back from the back-forward cache', () => {
    const asleep = tab({ deaf: true });
    const awake = tab();

    awake.link.announce('quick-exit');
    setVisibility('hidden');
    expect(asleep.events).toEqual([]);
    setVisibility('visible');
    expect(asleep.events).toEqual(['quick-exit']);

    awake.link.announce('lock');
    window.dispatchEvent(new Event('pageshow'));
    expect(asleep.events).toEqual(['quick-exit', 'lock']);
  });

  it('applies the strongest event missed: an exit before a lock, a lock before a deletion', () => {
    const asleep = tab({ deaf: true });
    const awake = tab();

    awake.link.announce('profile-deleted', 'p');
    awake.link.announce('lock');
    awake.link.announce('quick-exit');
    window.dispatchEvent(new Event('focus'));

    expect(asleep.events).toEqual(['quick-exit']);
  });

  it('never stores an erase: it takes every mark off, and the other tabs read the code again', async () => {
    const marks = markStore();
    const asleep = tab({ deaf: true, marks });
    const awake = tab({ marks });
    await new Promise((resolve) => setTimeout(resolve, 10));
    awake.link.announce('quick-exit');
    window.dispatchEvent(new Event('focus'));
    expect(asleep.events).toEqual(['quick-exit']);

    awake.link.announce('erase');

    expect(localStorage.getItem(EPOCH_KEY)).toBeNull();
    await vi.waitFor(() => {
      expect(marks.stored).toBeUndefined();
    });
    asleep.onRecheck.mockClear();
    window.dispatchEvent(new Event('focus'));
    // The stored code says whether it was erased (session.tsx), never a mark.
    expect(asleep.onRecheck).toHaveBeenCalledTimes(1);
    expect(asleep.events).toEqual(['quick-exit']);
  });

  it('keeps no private data in storage: opaque marks that never name the event', () => {
    const link = tab().link;
    link.announce('quick-exit');
    link.announce('lock');
    link.announce('profile-deleted', 'profile-id-1');
    const text = localStorage.getItem(EPOCH_KEY) ?? '';
    for (const word of ['erase', 'quick', 'exit', 'lock', 'profile', 'deleted', 'id-1']) {
      expect(text).not.toContain(word);
    }
    const stored = JSON.parse(text) as unknown;
    expect(Array.isArray(stored)).toBe(true);
    const marks = stored as string[];
    expect(marks).toHaveLength(3);
    for (const mark of marks) expect(mark).toMatch(/^[0-9a-f]{32}$/);
    // Only this code knows which mark stands for which event.
    expect(new Set(marks.map(eventOfMark))).toEqual(
      new Set(['quick-exit', 'lock', 'profile-deleted']),
    );
  });

  it('forgets every mark, in local storage and in IndexedDB, and other tabs read the code again', async () => {
    const marks = markStore();
    const a = tab({ marks });
    const b = tab({ marks });
    await new Promise((resolve) => setTimeout(resolve, 10));
    a.link.announce('quick-exit');
    await vi.waitFor(() => {
      expect(b.events).toEqual(['quick-exit']);
    });
    expect(marks.stored).toBeDefined();

    await a.link.forgetMarks();

    expect(localStorage.getItem(EPOCH_KEY)).toBeNull();
    expect(marks.stored).toBeUndefined();
    b.onRecheck.mockClear();
    // The browser fires the removal in the other tabs; here, by hand.
    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY }));
    expect(b.onRecheck).toHaveBeenCalledTimes(1);
    // A mark gone is no event.
    expect(b.events).toEqual(['quick-exit']);
  });

  it('takes the marks an older version named in clear off storage', async () => {
    localStorage.setItem(EPOCH_KEY, JSON.stringify({ 'quick-exit': 'old', erase: 'older' }));
    const marks = markStore();
    await marks.update(() => ({ erase: 'older' }));

    const a = tab({ marks });

    expect(localStorage.getItem(EPOCH_KEY)).toBeNull();
    await vi.waitFor(() => {
      expect(marks.stored).toBeUndefined();
    });
    window.dispatchEvent(new Event('focus'));
    expect(a.events).toEqual([]);
  });

  it('says which profile was deleted on the channel only, never in storage', async () => {
    const marks = markStore();
    const a = tab({ marks });
    const b = tab({ marks });
    const asleep = tab({ deaf: true, marks });
    await new Promise((resolve) => setTimeout(resolve, 10));

    a.link.announce('profile-deleted', 'profile-7');

    await vi.waitFor(() => {
      expect(b.events).toEqual(['profile-deleted']);
    });
    expect(b.ids).toEqual(['profile-7']);
    expect(JSON.stringify(marks.stored)).not.toContain('profile-7');
    // A tab that missed the message knows that a profile was deleted, not which.
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => {
      expect(asleep.events).toEqual(['profile-deleted']);
    });
    expect(asleep.ids).toEqual([undefined]);
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

  it('still tells the other tabs when storage refuses the epoch, and never makes up an event', async () => {
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
    expect(a.events).toEqual([]);
    expect(b.events).toEqual(['quick-exit']);
    vi.restoreAllMocks();
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

  it('a tab with no channel hears the epoch change in local storage at once (storage event)', () => {
    const deaf = tab({ deaf: true });
    tab().link.announce('quick-exit');

    // The browser fires it in the other tabs; here, by hand.
    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY }));

    expect(deaf.events).toEqual(['quick-exit']);
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
    expect(deaf.events).toEqual([]);
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => {
      expect(deaf.events).toEqual(['lock']);
    });
    // Once only, and never in the tab that announced it.
    window.dispatchEvent(new Event('pageshow'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deaf.events).toEqual(['lock']);
    expect(other.events).toEqual([]);
    vi.restoreAllMocks();
  });

  it('applies an event once when it comes by several ways', async () => {
    const marks = markStore();
    const b = tab({ marks });
    const a = tab({ marks });
    await new Promise((resolve) => setTimeout(resolve, 10));

    a.link.announce('quick-exit');
    await vi.waitFor(() => {
      expect(b.events).toEqual(['quick-exit']);
    });
    window.dispatchEvent(new StorageEvent('storage', { key: EPOCH_KEY }));
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(b.events).toEqual(['quick-exit']);
  });

  it('stops listening once closed', async () => {
    const a = tab();
    const b = tab();
    b.link.close();

    a.link.announce('quick-exit');
    await new Promise((resolve) => setTimeout(resolve, 20));
    window.dispatchEvent(new Event('focus'));

    expect(b.events).toEqual([]);
    expect(b.onRecheck).not.toHaveBeenCalled();
  });
});
