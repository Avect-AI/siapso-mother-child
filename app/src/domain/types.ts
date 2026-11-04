// SPDX-License-Identifier: MIT
import type { CheckedItem, ConditionId, Lang } from '@siapso/engine';

export type Mode = 'woman' | 'accompanied';

export interface Settings {
  lang: Lang;
  mode: Mode | null;
  onboarded: boolean;
}

export type TermInput =
  | { kind: 'lmp'; date: string } // ISO date
  | { kind: 'weeks'; weeks: number }
  | { kind: 'months'; months: number }
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
  premature?: boolean | null;
  conditions: ConditionId[];
  /** Confirmed products taken every day. */
  longTermItems: CheckedItem[];
  createdAt: string;
  updatedAt: string;
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
