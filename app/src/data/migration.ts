// SPDX-License-Identifier: MIT
// The records of the profile stores (profiles, history entries, saved
// contacts) and the code's verifier, kept consistent in single transactions.
//
// Invariant: once a verifier of version 2 is stored, no legitimate record is
// in clear. Records in clear exist only on a phone updated from a version
// before SCRUM-39 (its verifier has no version) or on a phone from before
// codes existed (no verifier at all):
// - The first right code after the update makes a new verifier (a new salt)
//   and, in one transaction with the code check, seals every record in clear
//   and stores the new verifier (sealStoredData with `next`).
// - A code made on a phone that kept records in clear stores its verifier and
//   the sealed records in one transaction, refused when a code is stored
//   (storeNewCode).
// - With a version 2 verifier, a record in clear can only have been written
//   into the storage from outside: it is deleted at the next unlock, never
//   sealed, and the readers never show it (profiles.ts, history.ts,
//   referral.ts).
// - A verifier made again (fewer iterations than the app makes) wraps every
//   data key again for the new key, in the same transaction as the verifier.
//
// All or nothing: the records are read and worked out first (a transaction
// cannot wait for WebCrypto), then written in one readwrite transaction that
// reads them again: a record written meanwhile by another tab starts the pass
// again. A failure, or a tab closed in the middle, aborts it: the phone keeps
// every record and the verifier as they were. Only the storage steps are
// timed (`storageTimeoutMs`), never the encryption: a read that does not
// answer writes nothing; a write that does not end in time is aborted, and
// counts as done only when its transaction committed anyway.
import {
  codeLength,
  isCodeVerifier,
  verifierFields,
  type CodeKeys,
  type CodeVerifier,
} from '../domain/code.js';
import { isSealed, rewrap, seal, UnsealError, type Sealed } from '../domain/crypto.js';
import { CodeExistsError, codeFingerprint, NoCodeError, requireCode } from './code-guard.js';
import { openAppDb } from './db.js';
import { CONTACTS_SCOPE, historyScope, profileScope } from './vault.js';

export interface SealOptions {
  /**
   * The code the tab opened: the fingerprint of the verifier stored now, and
   * its wrapping key (null for a verifier of the format before SCRUM-39).
   */
  current: { fingerprint: string; wrappingKey: CryptoKey | null };
  /** A verifier made again and its key: stored in the same transaction, every data key wrapped for it. */
  next?: CodeKeys;
  /**
   * The length of the code opened (SCRUM-56): added, in the same transaction,
   * to a version 2 verifier stored without one, its salt and check unchanged
   * (the same code, the same keys). Nothing else changes for it.
   */
  codeLength?: number;
  /** How long each storage step may take (the encryption is never timed); none by default. */
  storageTimeoutMs?: number;
}

/**
 * What a pass did: records sealed from clear, data keys wrapped again,
 * records in clear deleted (a version 2 verifier), sealed records left as
 * they are because no key opens them (they stay unreadable).
 */
export interface SealOutcome {
  sealed: number;
  rewrapped: number;
  deleted: number;
  skipped: number;
}

/** A storage step that did not answer in time: nothing was written. */
export class SealTimeoutError extends Error {
  constructor() {
    super('The phone storage did not answer in time: nothing was written');
    this.name = 'SealTimeoutError';
  }
}

/** A record written by another tab between the reading and the writing. */
class StorageChangedError extends Error {
  constructor() {
    super('The stored profile data changed meanwhile');
    this.name = 'StorageChangedError';
  }
}

/** How many times a pass starts again when another tab writes meanwhile. */
const ATTEMPTS = 3;

type Stored = Record<string, unknown>;

interface Snapshot {
  code: unknown;
  profiles: Stored[];
  history: Stored[];
  contacts: unknown;
}

interface Work {
  puts: { profiles: Stored[]; history: Stored[]; contacts: Stored | undefined };
  deletes: { profiles: string[]; history: string[]; contacts: boolean };
  outcome: SealOutcome;
}

/** `promise`, or SealTimeoutError once `ms` passed (no limit when undefined). */
function inTime<T>(promise: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SealTimeoutError());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function read(): Promise<Snapshot> {
  const tx = (await openAppDb()).transaction(
    ['settings', 'profiles', 'history', 'contacts'],
    'readonly',
  );
  const [code, profiles, history, contacts] = await Promise.all([
    tx.objectStore('settings').get('code'),
    tx.objectStore('profiles').getAll(),
    tx.objectStore('history').getAll(),
    tx.objectStore('contacts').get('saved'),
  ]);
  await tx.done;
  return {
    code,
    profiles: profiles as unknown as Stored[],
    history: history as unknown as Stored[],
    contacts,
  };
}

function sealedOf(record: unknown): Sealed | null {
  if (typeof record !== 'object' || record === null || !('sealed' in record)) return null;
  return isSealed(record.sealed) ? record.sealed : null;
}

/** What to do with each record: `inClear` and `sealed` decide, per record, its new sealed form, or none. */
interface Rules {
  /** A record in clear: its sealed form, or 'delete'. */
  inClear: (record: unknown, scope: string) => Promise<Sealed | 'delete'>;
  /** A sealed record: its new sealed form, 'skip' when no key opens it, or null when it stays. */
  sealed: (sealed: Sealed, scope: string) => Promise<Sealed | 'skip' | null>;
}

async function workOut(snapshot: Snapshot, rules: Rules): Promise<Work> {
  const outcome: SealOutcome = { sealed: 0, rewrapped: 0, deleted: 0, skipped: 0 };
  const work: Work = {
    puts: { profiles: [], history: [], contacts: undefined },
    deletes: { profiles: [], history: [], contacts: false },
    outcome,
  };
  /** The record's new sealed form, null when it is deleted or stays. */
  const redo = async (record: unknown, scope: string): Promise<Sealed | 'delete' | null> => {
    const sealed = sealedOf(record);
    if (sealed === null) {
      const done = await rules.inClear(record, scope);
      if (done === 'delete') outcome.deleted += 1;
      else outcome.sealed += 1;
      return done;
    }
    const done = await rules.sealed(sealed, scope);
    if (done === 'skip') {
      outcome.skipped += 1;
      return null;
    }
    if (done !== null) outcome.rewrapped += 1;
    return done;
  };
  for (const record of snapshot.profiles) {
    const id = String(record.id);
    const done = await redo(record, profileScope(id));
    if (done === 'delete') work.deletes.profiles.push(id);
    else if (done !== null) work.puts.profiles.push({ id, sealed: done });
  }
  for (const record of snapshot.history) {
    const id = String(record.id);
    const profileId = String(record.profileId);
    const done = await redo(record, historyScope(profileId, id));
    if (done === 'delete') work.deletes.history.push(id);
    else if (done !== null) work.puts.history.push({ id, profileId, sealed: done });
  }
  if (snapshot.contacts !== undefined) {
    const done = await redo(snapshot.contacts, CONTACTS_SCOPE);
    if (done === 'delete') work.deletes.contacts = true;
    else if (done !== null) work.puts.contacts = { sealed: done };
  }
  if (outcome.skipped > 0) {
    console.warn(
      `${String(outcome.skipped)} record(s) on this phone open with no key of this code: left as they are, unreadable`,
    );
  }
  if (outcome.deleted > 0) {
    console.warn(
      `${String(outcome.deleted)} record(s) in clear written into the storage after the update: deleted, never read`,
    );
  }
  return work;
}

function changes(work: Work): number {
  const { puts, deletes } = work;
  return (
    puts.profiles.length +
    puts.history.length +
    (puts.contacts ? 1 : 0) +
    deletes.profiles.length +
    deletes.history.length +
    (deletes.contacts ? 1 : 0)
  );
}

/** Whether the stores still hold exactly what was read (getAll lists by key: a stable order). */
function same(before: unknown, now: unknown): boolean {
  return JSON.stringify(before) === JSON.stringify(now);
}

type WriteTx = ReturnType<Awaited<ReturnType<typeof openAppDb>>['transaction']>;

/**
 * Writes `work` (and `verifier`) in one readwrite transaction, once `check`
 * passed and the stores still hold `snapshot`; aborted on any failure. A
 * write that does not end within `ms` is aborted: it counts as done only when
 * the transaction committed anyway, SealTimeoutError otherwise.
 */
async function write(
  snapshot: Snapshot,
  work: Work,
  verifier: CodeVerifier | undefined,
  check: (tx: WriteTx) => Promise<void>,
  ms: number | undefined,
): Promise<void> {
  const tx = (await inTime(openAppDb(), ms)).transaction(
    ['settings', 'profiles', 'history', 'contacts'],
    'readwrite',
  );
  const abort = () => {
    // Abandoned on purpose: its end is not an error to report.
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // Already committed or aborted.
    }
  };
  const body = async () => {
    try {
      await check(tx);
      const profiles = tx.objectStore('profiles');
      const history = tx.objectStore('history');
      const contacts = tx.objectStore('contacts');
      const [profilesNow, historyNow, contactsNow] = await Promise.all([
        profiles.getAll(),
        history.getAll(),
        contacts.get('saved'),
      ]);
      if (
        !same(snapshot.profiles, profilesNow) ||
        !same(snapshot.history, historyNow) ||
        !same(snapshot.contacts, contactsNow)
      ) {
        throw new StorageChangedError();
      }
      // In place: each record replaces its plaintext or its old form under the same key.
      for (const record of work.puts.profiles) await profiles.put(record as never);
      for (const record of work.puts.history) await history.put(record as never);
      if (work.puts.contacts) await contacts.put(work.puts.contacts as never, 'saved');
      for (const id of work.deletes.profiles) await profiles.delete(id);
      for (const id of work.deletes.history) await history.delete(id);
      if (work.deletes.contacts) await contacts.delete('saved');
      if (verifier) await tx.objectStore('settings').put(verifierFields(verifier), 'code');
    } catch (failure) {
      // Nothing of a failed pass is kept: the records stay as they were.
      abort();
      throw failure;
    }
    await tx.done;
  };
  const done = body();
  try {
    await inTime(done, ms);
  } catch (failure) {
    if (!(failure instanceof SealTimeoutError)) throw failure;
    // Too slow: aborted, unless it committed meanwhile.
    abort();
    const committed = await tx.done.then(
      () => true,
      () => false,
    );
    done.catch(() => undefined);
    if (!committed) throw failure;
  }
}

/** Runs a pass, again when another tab wrote meanwhile (a few times at most). */
async function again<T>(pass: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await pass();
    } catch (failure) {
      if (!(failure instanceof StorageChangedError) || attempt >= ATTEMPTS) throw failure;
    }
  }
}

/**
 * The stored verifier `code` with the length `length` added, when it is a
 * version 2 verifier kept without one and `length` is the length of a code;
 * otherwise undefined (nothing to write for it).
 */
function withLength(code: CodeVerifier, length: number | undefined): CodeVerifier | undefined {
  if (length === undefined || code.version === undefined || codeLength(code) !== null) {
    return undefined;
  }
  const added = { ...verifierFields(code), length };
  return codeLength(added) === null ? undefined : added;
}

async function sealOnce({
  current,
  next,
  codeLength: length,
  storageTimeoutMs,
}: SealOptions): Promise<SealOutcome> {
  const snapshot = await inTime(read(), storageTimeoutMs);
  // Read with the code stored: another verifier (made again in another tab) is said at once.
  const { code } = snapshot;
  if (!isCodeVerifier(code) || codeFingerprint(code) !== current.fingerprint) {
    throw new NoCodeError();
  }
  const legacy = code.version === undefined;
  if (legacy && next === undefined) {
    throw new Error(
      'A verifier of the format before SCRUM-39 is made again before anything is sealed',
    );
  }
  const target = next?.wrappingKey ?? current.wrappingKey;
  const work = await workOut(snapshot, {
    // Sealed only in the transaction that replaces a verifier of the format
    // before SCRUM-39; with a version 2 verifier, written from outside.
    inClear: (record, scope) =>
      legacy && target !== null ? seal(record, target, scope) : Promise.resolve('delete'),
    sealed: async (sealed, scope) => {
      if (next === undefined) return null;
      if (current.wrappingKey === null) return 'skip';
      try {
        return await rewrap(sealed, current.wrappingKey, next.wrappingKey, scope);
      } catch (failure) {
        if (failure instanceof UnsealError) return 'skip';
        throw failure;
      }
    },
  });
  const verifier = next?.verifier ?? withLength(code, length);
  if (changes(work) === 0 && verifier === undefined) return work.outcome;
  await write(
    snapshot,
    work,
    verifier,
    (tx) => requireCode(tx, current.fingerprint),
    storageTimeoutMs,
  );
  return work.outcome;
}

/**
 * Seals and makes the verifier again, or sweeps (SealOptions, the invariant
 * above), in one transaction written only with the code opened (NoCodeError
 * otherwise, nothing changed). Starts again, a few times, when another tab
 * writes meanwhile.
 */
export function sealStoredData(options: SealOptions): Promise<SealOutcome> {
  return again(() => sealOnce(options));
}

/**
 * Stores the verifier of a code just made and, in the same transaction, the
 * records an older version kept in clear, sealed with its key (a phone from
 * before codes existed). CodeExistsError, and nothing written, when a code is
 * already stored (made in another tab). A sealed record found without a
 * code is left as it is.
 */
export function storeNewCode(
  keys: CodeKeys,
  { storageTimeoutMs }: { storageTimeoutMs?: number } = {},
): Promise<SealOutcome> {
  return again(async () => {
    const snapshot = await inTime(read(), storageTimeoutMs);
    if (isCodeVerifier(snapshot.code)) throw new CodeExistsError();
    const work = await workOut(snapshot, {
      inClear: (record, scope) => seal(record, keys.wrappingKey, scope),
      sealed: () => Promise.resolve('skip'),
    });
    await write(
      snapshot,
      work,
      keys.verifier,
      async (tx) => {
        if (isCodeVerifier(await tx.objectStore('settings').get('code'))) {
          throw new CodeExistsError();
        }
      },
      storageTimeoutMs,
    );
    return work.outcome;
  });
}
