// SPDX-License-Identifier: MIT
// The tabs of the app on one phone tell each other when the session exits,
// locks or is erased, so that "Quitter" in one tab hides every tab and an
// erase sends every tab back to the welcome; when a profile was deleted, so
// that no other tab keeps it on screen or writes it back; and when a code was
// made or a wrong code counted, so that a tab on the welcome moves to the
// code screen and a code screen says the right count.
//
// Several ways, because a tab may miss a message: a BroadcastChannel reaches
// the other tabs at once; an epoch (one random mark per kind of event, never
// anything about a profile) is kept in local storage, whose change also
// reaches the other tabs (the storage event), and a copy in IndexedDB; every
// tab reads both again when it gets the focus, shows again or comes back from
// the back-forward cache, so a tab that was frozen or cached when the message
// went out still applies it before anyone reads it. Only the strongest event
// missed is applied (an erase covers an exit, an exit covers a lock, a lock
// covers a profile deleted), and an event is applied once, whichever way it
// came.
//
// The stored marks are opaque: random tokens that never name their event, so
// whoever reads the storage cannot tell a quick exit or an erase from a lock;
// only this code reads which event a mark stands for (eventOfMark). The id of
// a deleted profile goes with the channel's message only, never in storage: a
// tab that missed the message knows that a profile was deleted, and looks for
// its own again. An erase is never stored: it takes every mark off, and a tab
// that missed its message finds it in the stored code (gone) when it comes
// back. The marks are forgotten at a new code too (forgetMarks), so nothing
// tells the next person what was done before.
//
// Nothing here is trusted alone: the session re-reads the stored code before
// it follows an erase or a new code (session.tsx), and a screen reads its
// profile again before it leaves for a deletion, so a forged mark or message
// cannot fake them.

export type TabEvent = 'lock' | 'quick-exit' | 'erase' | 'profile-deleted';

export const SESSION_CHANNEL = 'siapso-session';
export const EPOCH_KEY = 'siapso-session-epoch';

/** Strongest first. */
const EVENTS: readonly TabEvent[] = ['erase', 'quick-exit', 'lock', 'profile-deleted'];
/** The event a mark stands for, by its last hex digit modulo 4: known to this code only. */
const BY_DIGIT: readonly TabEvent[] = ['lock', 'quick-exit', 'erase', 'profile-deleted'];
/** Messages that only ask to read the stored code and wrong codes again. */
const RECHECKS = ['lockout', 'code'] as const;
const MARK_PATTERN = /^[0-9a-f]{32}$/;

export type Marks = Partial<Record<TabEvent, string>>;

/** The copy of the epoch in IndexedDB (data/db.ts): read, changed in one transaction, cleared. */
export interface MarkStore {
  read: () => Promise<unknown>;
  update: (change: (stored: unknown) => unknown) => Promise<void>;
  clear: () => Promise<void>;
}

export interface TabLink {
  /**
   * Tells the other tabs, now and when they come back. `id`, for a profile
   * deleted, goes with the message only.
   */
  announce: (event: TabEvent, id?: string) => void;
  /** Tells the other tabs that the wrong codes changed. */
  announceLockout: () => void;
  /** Tells the other tabs that a code was made. */
  announceCode: () => void;
  /** Takes every mark off local storage and IndexedDB (the erase, a new code). */
  forgetMarks: () => Promise<void>;
  close: () => void;
}

/** The event an opaque mark stands for; null for anything that is not a mark. */
export function eventOfMark(mark: unknown): TabEvent | null {
  if (typeof mark !== 'string' || !MARK_PATTERN.test(mark)) return null;
  return BY_DIGIT[parseInt(mark.slice(-1), 16) % BY_DIGIT.length] ?? null;
}

/** A new opaque mark for `event`: 16 random bytes, the last digit set for the event. */
function markFor(event: TabEvent): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const digit = parseInt(hex.slice(-1), 16);
  const wanted = BY_DIGIT.indexOf(event);
  // Any of the four digits with this remainder: the mark stays random.
  const set = digit - (digit % BY_DIGIT.length) + wanted;
  return hex.slice(0, -1) + set.toString(16);
}

/** The marks in `value`; none when it holds none (an older version's clear names included). */
function marksOf(value: unknown): Marks {
  const marks: Marks = {};
  if (!Array.isArray(value)) return marks;
  for (const mark of value) {
    const event = eventOfMark(mark);
    if (event !== null) marks[event] = mark as string;
  }
  return marks;
}

/** The marks as stored: tokens only, in a random-looking order (sorted). */
function storedForm(marks: Marks): string[] {
  return Object.values(marks)
    .filter((mark): mark is string => typeof mark === 'string')
    .sort();
}

/** Whether a stored value is the epoch of an older version, which named its events. */
function isOldForm(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value in local storage; undefined when it cannot be read. */
function localValue(): unknown {
  try {
    const text = localStorage.getItem(EPOCH_KEY);
    return text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function localMarks(): Marks {
  return marksOf(localValue());
}

/**
 * Takes the marks off local storage. Written empty first: removing a key that
 * is not there tells no other tab, while each change fires their storage
 * event, so a tab with no channel still reads the stored code again.
 */
function removeLocal(): void {
  try {
    localStorage.setItem(EPOCH_KEY, '[]');
    localStorage.removeItem(EPOCH_KEY);
  } catch {
    // No local storage: nothing kept there.
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
 * locks, erases or deletes a profile (at once, with the id of a profile
 * deleted, or without it when this tab comes back and finds it missed one);
 * `onRecheck` when the stored code or the wrong codes may have changed
 * (another tab made a code or counted a try, or this tab comes back).
 */
export function joinTabs({
  onEvent,
  onRecheck,
  marks: store,
}: {
  onEvent: (event: TabEvent, id?: string) => void;
  onRecheck: () => void;
  /** The copy of the epoch in IndexedDB; none in a test that leaves it out. */
  marks?: MarkStore;
}): TabLink {
  // An older version named the events in clear: that copy goes.
  if (isOldForm(localValue())) removeLocal();
  let seenLocal = localMarks();
  let seenStored: Marks | null = null;
  /** The marks of the events applied here or announced from here: never applied twice. */
  const known = new Set<string>();
  let open = true;
  // Very old browsers have no BroadcastChannel: the epoch alone.
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSION_CHANNEL) : null;

  const apply = (missed: { event: TabEvent; mark: string } | null, id?: string) => {
    if (missed === null || known.has(missed.mark) || !open) return;
    known.add(missed.mark);
    onEvent(missed.event, id);
  };
  const readStored = () => {
    void store?.read().then(
      (value) => {
        if (isOldForm(value)) {
          store.clear().catch(() => undefined);
          seenStored = {};
          return;
        }
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
    const { event, mark, id } = data as Record<string, unknown>;
    if (!EVENTS.includes(event as TabEvent) || typeof mark !== 'string') return;
    seenLocal = localMarks();
    apply({ event: event as TabEvent, mark }, typeof id === 'string' ? id : undefined);
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
    if (event.key !== EPOCH_KEY) return;
    checkLocal();
    // The marks forgotten (the erase, a new code): the stored code tells which.
    onRecheck();
  };

  channel?.addEventListener('message', onMessage);
  window.addEventListener('focus', comeBack);
  window.addEventListener('pageshow', comeBack);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisibility);
  readStored();

  const forgetMarks = async () => {
    removeLocal();
    seenLocal = {};
    seenStored = {};
    await store?.clear().catch(() => {
      // IndexedDB refused: the copy stays until the next erase or code.
    });
  };

  return {
    announce(event, id) {
      const mark = markFor(event);
      known.add(mark);
      if (event === 'erase') {
        // Never stored: the marks go, and the other tabs read the stored code.
        void forgetMarks();
        channel?.postMessage({ event, mark });
        return;
      }
      try {
        localStorage.setItem(
          EPOCH_KEY,
          JSON.stringify(storedForm({ ...localMarks(), [event]: mark })),
        );
      } catch {
        // No local storage (a private mode, a full phone): the other ways.
      }
      seenLocal = localMarks();
      if (seenStored !== null) seenStored = { ...seenStored, [event]: mark };
      store
        ?.update((stored) => storedForm({ ...marksOf(stored), [event]: mark }))
        .catch(() => {
          // IndexedDB refused: the other ways.
        });
      channel?.postMessage(id === undefined ? { event, mark } : { event, mark, id });
    },
    announceLockout() {
      channel?.postMessage('lockout');
    },
    announceCode() {
      channel?.postMessage('code');
    },
    forgetMarks,
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
