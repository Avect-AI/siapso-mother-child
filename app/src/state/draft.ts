// SPDX-License-Identifier: MIT
// The answers of a form being filled, kept in the session's memory as they
// are typed (session.tsx), never stored: when the two minutes run out, the
// code gives them back to the same screen; the quick exit, a lock from another
// tab, the erase, another code, or leaving the screen drop them. While they
// differ from what is saved, the screen warns before the auto-lock.
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useSession } from './session.js';

/**
 * The answers of the form of the screen `key`, starting from `saved` (what
 * storage holds, or a new form), or from the answers kept for that screen
 * when the session locked on it: `restored` then says so.
 */
export function useDraft<T>(
  key: string,
  saved: T,
): { value: T; setValue: Dispatch<SetStateAction<T>>; restored: boolean } {
  const { draftFor, keepDraft } = useSession();
  // Read once, when the form mounts (StrictMode may render twice: the read does not consume).
  const [start] = useState(() => {
    const kept = draftFor(key);
    return kept === null
      ? { value: saved, restored: false }
      : { value: kept.value as T, restored: true };
  });
  const [value, setValue] = useState<T>(start.value);
  // What is saved, as the form opened: answers that differ from it are not saved yet.
  const [baseline] = useState(() => JSON.stringify(saved));

  useEffect(() => {
    keepDraft(key, value, JSON.stringify(value) !== baseline);
  }, [key, value, baseline, keepDraft]);

  return { value, setValue, restored: start.restored };
}
