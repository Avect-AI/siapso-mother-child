// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';
import type { MessageKey, Vars } from '../i18n/translate.js';
import { sessionState } from '../state/entry-state.js';

/**
 * What the profile screen just did, left on the history entry it went to as
 * marks only (entry-state.ts: the pseudonym stays in the page's memory, never
 * on the entry, which the browser writes to disk): a profile saved or deleted
 * (by its pseudonym), or her own profile deleted.
 */
export type ProfileNote =
  { kind: 'saved'; name: string } | { kind: 'deleted'; name: string } | { kind: 'deletedMine' };

function noteOf(state: unknown): ProfileNote | null {
  if (typeof state !== 'object' || state === null) return null;
  if ('profileSaved' in state && typeof state.profileSaved === 'string') {
    return { kind: 'saved', name: state.profileSaved };
  }
  if ('profileDeleted' in state && typeof state.profileDeleted === 'string') {
    return { kind: 'deleted', name: state.profileDeleted };
  }
  if ('profileDeletedMine' in state && state.profileDeletedMine === true) {
    return { kind: 'deletedMine' };
  }
  return null;
}

/** What the profile screen just did, in words. */
export function profileNoteText(
  note: ProfileNote,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  switch (note.kind) {
    case 'saved':
      return t('home.profileSaved', { name: note.name });
    case 'deleted':
      return t('profiles.deleted', { name: note.name });
    case 'deletedMine':
      return t('profile.deletedMine');
  }
}

/**
 * What the profile screen just did, to say so once: the note is taken off the
 * history entry, so a reload or Back does not repeat it.
 */
export function useProfileNote(): ProfileNote | null {
  const [note] = useState(() => noteOf(sessionState()));
  useEffect(() => {
    if (note !== null) window.history.replaceState(null, '', window.location.href);
  }, [note]);
  return note;
}
