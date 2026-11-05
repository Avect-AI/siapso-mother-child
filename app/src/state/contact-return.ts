// SPDX-License-Identifier: MIT
// A new contact opened from who to call goes back there once saved, and who
// to call says it was saved, once. Shared by the two screens, so that neither
// imports the other. Memory only, tied to the epoch (entry-state.ts): a lock,
// a quick exit or a reload never shows a contact's name on who to call.
import { epochToken } from './entry-state.js';

/** The key left on the history entry of a new contact opened from who to call. */
export const FROM_CALL = 'fromCall';

let saved: { who: string; epoch: string } | null = null;

/** Notes the contact just saved from who to call (how it is named), to be said there. */
export function noteSavedForCall(who: string): void {
  saved = { who, epoch: epochToken() };
}

/** The contact just saved from who to call, with the epoch it was saved in; null when none. */
export function savedForCall(): { who: string; epoch: string } | null {
  return saved;
}

/** Said, or no longer to say: forgotten. */
export function forgetSavedForCall(): void {
  saved = null;
}
