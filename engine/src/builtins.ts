// SPDX-License-Identifier: MIT
// Findings that do not come from a pack rule: danger signs (C11), unrecognised
// items (C12) and recognised items without any finding (no-finding).
import { itemMatches } from './match.js';
import { BUILTIN_MESSAGES } from './types.js';
import type { CheckedItem, Finding, Pack, SourceRef } from './types.js';

export function copySources(sources: readonly SourceRef[]): SourceRef[] {
  return sources.map((s) => ({ ...s }));
}

/**
 * One danger finding per distinct sign present now, with the message of the
 * sign when the pack gives it one, otherwise the standard danger message.
 */
export function dangerSignFindings(pack: Pack, signs: readonly string[]): Finding[] {
  return [...new Set(signs)].map((sign) => ({
    level: 'danger',
    check: 'C11',
    items: [],
    message: pack.dangerSigns.find((d) => d.id === sign)?.message ?? BUILTIN_MESSAGES.dangerSign,
    sign,
    capped: false,
    sources: [],
  }));
}

/** The unknown finding of an item the pack does not know. */
export function unrecognisedFinding(index: number): Finding {
  return {
    level: 'unknown',
    check: 'C12',
    items: [index],
    message: BUILTIN_MESSAGES.notRecognised,
    capped: false,
    sources: [],
  };
}

/**
 * Whether a rule of the pack that gives findings reads the item, as its
 * subject (whatever the strength threshold) or as a partner it requires: then
 * the base holds something about its risk, even when no rule applies to the
 * situation. A reminder or a contraception note says nothing about the item's
 * risk, and neither do the exceptions of a reminder.
 */
function readByARule(pack: Pack, item: CheckedItem): boolean {
  return pack.rules.some((rule) => {
    if (rule.kind === 'reminder' || rule.kind === 'contraception-info') return false;
    const { subject, requires = [] } = rule.when;
    const partners = requires.flatMap((r) => ('with' in r ? [r.with] : []));
    return [...(subject === undefined ? [] : [subject]), ...partners].some((s) =>
      itemMatches(pack, item, s),
    );
  });
}

/**
 * The unknown finding of a recognised item without any finding: the plant's
 * own message and evidence for a plant; for a product, "nothing applies" when
 * a rule reads it (the base has something on it, but not for this
 * situation), else "nothing found".
 */
export function noFinding(pack: Pack, item: CheckedItem, index: number): Finding {
  const ref = item.ref;
  const plant = ref.kind === 'plant' ? pack.plants.find((p) => p.id === ref.id) : undefined;
  if (plant) {
    return {
      level: 'unknown',
      check: 'no-finding',
      evidence: plant.evidence,
      items: [index],
      message: plant.message,
      capped: false,
      sources: copySources(plant.sources),
    };
  }
  return {
    level: 'unknown',
    check: 'no-finding',
    items: [index],
    message: readByARule(pack, item)
      ? BUILTIN_MESSAGES.nothingApplies
      : BUILTIN_MESSAGES.nothingFound,
    capped: false,
    sources: [],
  };
}
