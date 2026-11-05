// SPDX-License-Identifier: MIT
import type { CheckedItem, ConditionId, Lang, Localized } from '@siapso/engine';

export type Mode = 'woman' | 'accompanied';

export interface Settings {
  lang: Lang;
  mode: Mode | null;
  onboarded: boolean;
}

/**
 * How the term was given. A date of last period moves on by itself; weeks
 * and months carry `givenOn`, the ISO date they were given, so the term moves
 * on with the weeks since (a profile is kept across visits: a term frozen at
 * the first visit would fall in the wrong window later).
 */
export type TermInput =
  | { kind: 'lmp'; date: string } // ISO date
  | { kind: 'weeks'; weeks: number; givenOn?: string }
  | { kind: 'months'; months: number; givenOn?: string }
  // Dated too: "Je ne sais pas" said long ago no longer tells where she stands.
  | { kind: 'unknown'; givenOn?: string }
  // Past 42 weeks and still pregnant on `givenOn` (domain/term.ts): read as 42
  // weeks and over, with the advice to be seen at the health post today.
  | { kind: 'post-term'; givenOn?: string };

export interface Profile {
  /** Random id from crypto.randomUUID(). */
  id: string;
  /**
   * The woman's own profile, made in woman mode (true), or a profile made in
   * accompanied mode (false). Woman mode opens hers only; a record older than
   * this field opens in woman mode only when it is the only profile.
   */
  self?: boolean;
  pseudonym: string;
  /** Pregnant, or maybe pregnant (`pregnancyUnsure`): every check reads her as pregnant. */
  pregnant: boolean;
  /**
   * "Je ne sais pas" to "Enceinte ?": `pregnant` is true and the term is read
   * as unknown (every week of a pregnancy, the riskier case), whatever `term`.
   */
  pregnancyUnsure?: boolean;
  /** The ISO date "Je ne sais pas" was answered (an older record: its updatedAt). */
  pregnancyUnsureOn?: string;
  term?: TermInput;
  breastfeeding: boolean;
  /**
   * "Je ne sais pas" to the baby's age: no age is stored, and every rule bound
   * to an age applies (as for the youngest babies, the riskier case).
   */
  babyAgeUnknown?: boolean;
  babyBirthDate?: string;
  babyAgeWeeks?: number;
  /** The ISO date babyAgeWeeks was given: the age moves on from it, as the term does. */
  babyAgeGivenOn?: string;
  /** The months as given, when the age was given in months (the profile reopens in months); babyAgeWeeks holds floor(months x 4.345). */
  babyAgeMonths?: number;
  premature?: boolean | null;
  conditions: ConditionId[];
  /** Confirmed products taken every day. */
  longTermItems: CheckedItem[];
  createdAt: string;
  updatedAt: string;
}

/** Who a referral contact is in the circuit: community relay, Bajenu Gox, ICP, midwife, other. */
export type ReferralRole = 'relay' | 'bajenu-gox' | 'icp' | 'midwife' | 'other';

/** Someone to call when a danger sign is there and no health worker is. */
export interface ReferralContact {
  id: string;
  role: ReferralRole;
  /** May be empty: the role alone then names the contact. */
  name: string;
  /** Digits, spaces and an optional leading plus; 6 to 15 digits. */
  phone: string;
}

/**
 * A public emergency number a deployment gives in place of the built-in ones
 * (config/emergency.ts): the service named in a sentence in both languages
 * ("le SAMU", "the SAMU"), and its number.
 */
export interface EmergencyNumber {
  name: Localized;
  /** Digits, spaces and an optional leading plus; 2 to 15 digits (short service numbers too). */
  phone: string;
}

export interface CurrentCheck {
  profileId: string;
  items: CheckedItem[];
  signs: string[];
}

export interface HistoryEntry {
  id: string;
  profileId: string;
  at: string;
  packVersion: string;
  level: string;
  ruleIds: string[];
  items: CheckedItem[];
  signs: string[];
}
