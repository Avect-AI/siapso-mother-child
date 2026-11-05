// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';

/** The pseudonym of the profile just saved (the profile screen leaves it in the history entry), or null. */
function justSaved(): string | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null || !('profileSaved' in state)) return null;
  return typeof state.profileSaved === 'string' ? state.profileSaved : null;
}

/**
 * Which profile was just saved, to say so once: the note is taken off the
 * history entry, so a reload or Back does not repeat it.
 */
export function useSavedNote(): string | null {
  const [saved] = useState(justSaved);
  useEffect(() => {
    if (saved !== null) window.history.replaceState(null, '', window.location.href);
  }, [saved]);
  return saved;
}
