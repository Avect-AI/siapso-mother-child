// SPDX-License-Identifier: MIT
export const LEVELS = ['unknown', 'next-contact', 'before-next-dose', 'danger'] as const;

export type Level = (typeof LEVELS)[number];

/** Position of a level in LEVELS: unknown is 0, danger is 3. */
export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}
