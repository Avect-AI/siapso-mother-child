// SPDX-License-Identifier: MIT
import type { CheckedItem, ConditionId, Lang } from '@siapso/engine';

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
  | { kind: 'unknown' };

export interface Profile {
  /** Random id from crypto.randomUUID(). */
  id: string;
  pseudonym: string;
  pregnant: boolean;
  term?: TermInput;
  breastfeeding: boolean;
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
