// SPDX-License-Identifier: MIT
// Findings that do not come from a pack rule: danger signs (C11), unrecognised
// items (C12) and recognised items without any finding (no-finding).
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
 * The unknown finding of a recognised item without any finding: "nothing
 * found" for a product, the plant's own message and evidence for a plant.
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
    message: BUILTIN_MESSAGES.nothingFound,
    capped: false,
    sources: [],
  };
}
