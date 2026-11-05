// SPDX-License-Identifier: MIT
// The tabs of the app on one phone tell each other when the session exits,
// locks or is erased, so that "Quitter" in one tab hides every tab and an
// erase sends every tab back to the welcome; and when a code was made or a
// wrong code counted, so that a tab on the welcome moves to the code screen
// and a code screen says the right count.
//
// Several ways, because a tab may miss a message: a BroadcastChannel reaches
// the other tabs at once; an epoch (one random mark per kind of event, never
// anything about a profile) is kept in local storage, whose change also
// reaches the other tabs (the storage event), and a copy in IndexedDB; every
// tab reads both again when it gets the focus, shows again or comes back from
// the back-forward cache, so a tab that was frozen or cached when the message
// went out still applies it before anyone reads it. Only the strongest event
// missed is applied (an erase covers an exit, an exit covers a lock), and an
// event is applied once, whichever way it came.
//
// Nothing here is trusted alone: the session re-reads the stored code before
// it follows an erase or a new code (session.tsx), so a forged mark or
// message cannot fake them.

export type TabEvent = 'lock' | 'quick-exit' | 'erase';

export const SESSION_CHANNEL = 'siapso-session';
export const EPOCH_KEY = 'siapso-session-epoch';

/** Strongest first. */
const EVENTS: readonly TabEvent[] = ['erase', 'quick-exit', 'lock'];
/** Messages that only ask to read the stored code and wrong codes again. */
const RECHECKS = ['lockout', 'code'] as const;

export type Marks = Partial<Record<TabEvent, string>>;

/** The copy of the epoch in IndexedDB (data/db.ts): read and added to. */
export interface MarkStore {
  read: () => Promise<unknown>;
  add: (event: TabEvent, mark: string) => Promise<void>;
}

export interface TabLink {
  /** Tells the other tabs, now and when they come back. */
  announce: (event: TabEvent) => void;
  /** Tells the other tabs that the wrong codes changed. */
  announceLockout: () => void;
  /** Tells the other tabs that a code was made. */
  announceCode: () => void;
  close: () => void;
}

function isTabEvent(value: unknown): value is TabEvent {
  return EVENTS.includes(value as TabEvent);
}

/** The marks in `value`; none when it holds none. */
function marksOf(value: unknown): Marks {
  const marks: Marks = {};
  if (typeof value !== 'object' || value === null) return marks;
  for (const event of EVENTS) {
    const mark = (value as Record<string, unknown>)[event];
    if (typeof mark === 'string') marks[event] = mark;
  }
  return marks;
}

/** The marks in local storage; none when it cannot be read. */
function localMarks(): Marks {
  try {
    return marksOf(JSON.parse(localStorage.getItem(EPOCH_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

/** The strongest event whose mark changed since `seen`; null when none (a mark gone is no event). */
function missedEvent(seen: Marks, now: Marks): { event: TabEvent; mark: string } | null {
  for (const event of EVENTS) {
    const mark = now[event];
    if (mark !== undefined && mark !== seen[event]) return { event, mark };
  }
  return null;
}

/**
 * Joins the other tabs of the app: `onEvent` runs when another tab exits,
 * locks or erases (at once, or when this tab comes back if it missed it);
 * `onRecheck` when the stored code or the wrong codes may have changed
 * (another tab made a code or counted a try, or this tab comes back).
 */
export function joinTabs({
  onEvent,
  onRecheck,
  marks: store,
}: {
  onEvent: (event: TabEvent) => void;
  onRecheck: () => void;
  /** The copy of the epoch in IndexedDB; none in a test that leaves it out. */
  marks?: MarkStore;
}): TabLink {
  let seenLocal = localMarks();
  let seenStored: Marks | null = null;
  /** The marks of the events applied here or announced from here: never applied twice. */
  const known = new Set<string>();
  let open = true;
  // Very old browsers have no BroadcastChannel: the epoch alone.
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSION_CHANNEL) : null;

  const apply = (missed: { event: TabEvent; mark: string } | null) => {
    if (missed === null || known.has(missed.mark) || !open) return;
    known.add(missed.mark);
    onEvent(missed.event);
  };
  const readStored = () => {
    void store?.read().then(
      (value) => {
        const now = marksOf(value);
        const missed = seenStored === null ? null : missedEvent(seenStored, now);
        seenStored = now;
        apply(missed);
      },
      () => {
        // IndexedDB unreadable: the other ways remain.
      },
    );
  };
  const checkLocal = () => {
    const now = localMarks();
    const missed = missedEvent(seenLocal, now);
    seenLocal = now;
    apply(missed);
  };

  const onMessage = (message: MessageEvent<unknown>) => {
    const data = message.data;
    if (RECHECKS.includes(data as (typeof RECHECKS)[number])) {
      onRecheck();
      return;
    }
    if (typeof data !== 'object' || data === null) return;
    const { event, mark } = data as Record<string, unknown>;
    if (!isTabEvent(event) || typeof mark !== 'string') return;
    seenLocal = localMarks();
    apply({ event, mark });
  };
  const comeBack = () => {
    checkLocal();
    readStored();
    onRecheck();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') comeBack();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === EPOCH_KEY) checkLocal();
  };

  channel?.addEventListener('message', onMessage);
  window.addEventListener('focus', comeBack);
  window.addEventListener('pageshow', comeBack);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisibility);
  readStored();

  return {
    announce(event) {
      const mark = crypto.randomUUID();
      known.add(mark);
      try {
        localStorage.setItem(EPOCH_KEY, JSON.stringify({ ...localMarks(), [event]: mark }));
      } catch {
        // No local storage (a private mode, a full phone): the other ways.
      }
      seenLocal = localMarks();
      if (seenStored !== null) seenStored = { ...seenStored, [event]: mark };
      store?.add(event, mark).catch(() => {
        // IndexedDB refused: the other ways.
      });
      channel?.postMessage({ event, mark });
    },
    announceLockout() {
      channel?.postMessage('lockout');
    },
    announceCode() {
      channel?.postMessage('code');
    },
    close() {
      open = false;
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      window.removeEventListener('focus', comeBack);
      window.removeEventListener('pageshow', comeBack);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
