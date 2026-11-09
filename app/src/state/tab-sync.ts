// SPDX-License-Identifier: MIT
// The tabs of the app on one phone tell each other when the session exits,
// locks or is erased, so that "Quitter" in one tab hides every tab and an
// erase sends every tab back to the welcome; when a profile was deleted, so
// that no other tab keeps it on screen or writes it back; and when a code was
// made or a wrong code counted, so that a tab on the welcome moves to the
// code screen and a code screen says the right count.
//
// What happened, and the id of a deleted profile, travel only on the
// BroadcastChannel, in memory: a tab that hears it does exactly that.
//
// For a tab that may miss the message (frozen, kept in the back-forward
// cache, or a browser with no channel), one random epoch token is kept in
// local storage, whose change also reaches the other tabs (the storage
// event), and a copy in IndexedDB. The token says nothing: it changes at every
// event and also at every start and unlock of a tab (refresh), so neither its
// value nor its change tells what was done. A tab that finds a token it did
// not hear about (on the storage event, or when it gets the focus, shows
// again or comes back from the back-forward cache) knows only that something
// happened, and takes the safest way (onMissed): the session exits as with
// "Quitter" (locked, memory forgotten, the neutral screen) and reads the
// stored code again. A tab that hears the channel waits a moment before it
// reads a token, so the channel's message, which may come after the storage
// event, tells it first.
//
// Nothing here is trusted alone: the session re-reads the stored code before
// it follows an erase or a new code (session.tsx), and a screen reads its
// profile again before it leaves for a deletion, so a forged token or message
// cannot fake them; a forged token only locks.

export type TabEvent = 'lock' | 'quick-exit' | 'erase' | 'profile-deleted';

export const SESSION_CHANNEL = 'siapso-session';
export const EPOCH_KEY = 'siapso-session-epoch';
/**
 * How long a tab that hears the channel waits before it reads a token it
 * found changed: the channel's message tells it first when it comes.
 */
export const CHECK_DELAY_MS = 250;

const EVENTS: readonly TabEvent[] = ['erase', 'quick-exit', 'lock', 'profile-deleted'];
/** Messages that only ask to read the stored code and wrong codes again. */
const RECHECKS = ['lockout', 'code'] as const;
/** A new token, with no event: a tab started or unlocked. */
const REFRESH = 'refresh';
const TOKEN = /^[0-9a-f]{32}$/;

/** The copy of the epoch token in IndexedDB (data/db.ts): read and written. */
export interface MarkStore {
  read: () => Promise<unknown>;
  write: (token: string) => Promise<void>;
}

export interface TabLink {
  /**
   * Tells the other tabs, now (on the channel, with the id of a deleted
   * profile) and when they come back (a new token).
   */
  announce: (event: TabEvent, id?: string) => void;
  /** A new token with no event (a start, an unlock), so a token's change says nothing. */
  refresh: () => void;
  /** Tells the other tabs that the wrong codes changed. */
  announceLockout: () => void;
  /** Tells the other tabs that a code was made. */
  announceCode: () => void;
  close: () => void;
}

/** A new random token: 16 random bytes, in hex. */
function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** The token in `value`; null when it holds none (an older version's marks included). */
function tokenOf(value: unknown): string | null {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

/** The token in local storage; null when there is none or it cannot be read. */
function localToken(): string | null {
  try {
    return tokenOf(localStorage.getItem(EPOCH_KEY));
  } catch {
    return null;
  }
}

/**
 * Joins the other tabs of the app: `onEvent` runs when another tab exits,
 * locks, erases or deletes a profile, told on the channel (with the id of a
 * profile deleted); `onMissed` when this tab finds that something happened it
 * did not hear about; `onRecheck` when the stored code or the wrong codes may
 * have changed (another tab made a code or counted a try, or this tab comes
 * back).
 */
export function joinTabs({
  onEvent,
  onMissed,
  onRecheck,
  marks: store,
}: {
  onEvent: (event: TabEvent, id?: string) => void;
  onMissed: () => void;
  onRecheck: () => void;
  /** The copy of the token in IndexedDB; none in a test that leaves it out. */
  marks?: MarkStore;
}): TabLink {
  /** The tokens of the events and refreshes heard here or written from here. */
  const known = new Set<string>();
  const startLocal = localToken();
  if (startLocal !== null) known.add(startLocal);
  /** The copy in IndexedDB as first read: what was there before this tab is no event. */
  let storedRead = false;
  let open = true;
  let pending: ReturnType<typeof setTimeout> | undefined;
  // Very old browsers have no BroadcastChannel: the token alone.
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSION_CHANNEL) : null;

  /** A token found: missed when this tab never heard of it. */
  const found = (token: string | null) => {
    if (token === null || known.has(token) || !open) return;
    known.add(token);
    onMissed();
  };
  const readStored = () => {
    void store?.read().then(
      (value) => {
        const token = tokenOf(value);
        if (!storedRead) {
          storedRead = true;
          if (token !== null) known.add(token);
          return;
        }
        found(token);
      },
      () => {
        // IndexedDB unreadable: the other ways remain.
      },
    );
  };
  const check = () => {
    found(localToken());
    readStored();
  };
  /** With a channel, its message comes first; without one, the token is all there is. */
  const checkSoon = () => {
    if (channel === null) {
      check();
      return;
    }
    clearTimeout(pending);
    pending = setTimeout(check, CHECK_DELAY_MS);
  };

  const onMessage = (message: MessageEvent<unknown>) => {
    const data = message.data;
    if (RECHECKS.includes(data as (typeof RECHECKS)[number])) {
      onRecheck();
      return;
    }
    if (typeof data !== 'object' || data === null) return;
    const { event, mark, id } = data as Record<string, unknown>;
    if (typeof mark !== 'string' || !open) return;
    known.add(mark);
    if (event === REFRESH || !EVENTS.includes(event as TabEvent)) return;
    onEvent(event as TabEvent, typeof id === 'string' ? id : undefined);
  };
  const comeBack = () => {
    checkSoon();
    onRecheck();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') comeBack();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === EPOCH_KEY) checkSoon();
  };

  channel?.addEventListener('message', onMessage);
  window.addEventListener('focus', comeBack);
  window.addEventListener('pageshow', comeBack);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisibility);
  readStored();

  /** A new token, written everywhere, and said on the channel with what it stands for. */
  const write = (message: Record<string, unknown>) => {
    const token = newToken();
    known.add(token);
    try {
      localStorage.setItem(EPOCH_KEY, token);
    } catch {
      // No local storage (a private mode, a full phone): the other ways.
    }
    store?.write(token).catch(() => {
      // IndexedDB refused: the other ways.
    });
    channel?.postMessage({ ...message, mark: token });
  };

  return {
    announce(event, id) {
      write(id === undefined ? { event } : { event, id });
    },
    refresh() {
      write({ event: REFRESH });
    },
    announceLockout() {
      channel?.postMessage('lockout');
    },
    announceCode() {
      channel?.postMessage('code');
    },
    close() {
      open = false;
      clearTimeout(pending);
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      window.removeEventListener('focus', comeBack);
      window.removeEventListener('pageshow', comeBack);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
