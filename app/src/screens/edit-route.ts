// SPDX-License-Identifier: MIT
// The screen that changes one profile or one contact (accompanied mode). Its
// address never names which one: the browser keeps addresses in its history,
// and ids there would show how many women were seen, and when. The id goes in
// the entry's state, in memory and tied to the session's epoch
// (entry-state.ts), as the products of a check do.
import { inSession, sessionState } from '../state/entry-state.js';

export const PROFILE_EDIT_PATH = '/profile/edit';
export const CONTACT_EDIT_PATH = '/contacts/edit';
/** The questions of a passer-by looked up without saving (accompanied mode only). */
export const QUICK_PATH = '/quick';

/** The state to open the edit screen of `id` with. */
export function editEntry(id: string): Record<string, unknown> {
  return inSession({ editId: id });
}

/** The id the current entry's edit screen was opened with; null when none is known (a reload). */
export function editedId(): string | null {
  const { editId } = sessionState();
  return typeof editId === 'string' && editId !== '' ? editId : null;
}
