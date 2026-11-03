// SPDX-License-Identifier: MIT
import type { Evidence, RuleKind } from './types.js';

export const LEVELS = ['unknown', 'next-contact', 'before-next-dose', 'danger'] as const;

export type Level = (typeof LEVELS)[number];

/** Position of a level in LEVELS: unknown is 0, danger is 3. */
export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

const WEAK_EVIDENCE: readonly Evidence[] = ['D', 'E', '0'];
const EVIDENCE_CAP: Level = 'next-contact';

/**
 * Applies the evidence cap: evidence D, E or 0 never yields a level above
 * next-contact, unless the rule kind is toxicity.
 */
export function capForEvidence(
  level: Level,
  evidence: Evidence,
  kind: RuleKind,
): { level: Level; capped: boolean } {
  if (
    kind !== 'toxicity' &&
    WEAK_EVIDENCE.includes(evidence) &&
    levelRank(level) > levelRank(EVIDENCE_CAP)
  ) {
    return { level: EVIDENCE_CAP, capped: true };
  }
  return { level, capped: false };
}

/** The highest level of the list, or unknown for an empty list. */
export function maxLevel(levels: Level[]): Level {
  let highest: Level = 'unknown';
  for (const level of levels) {
    if (levelRank(level) > levelRank(highest)) highest = level;
  }
  return highest;
}
