// SPDX-License-Identifier: MIT
// Whether the strength on the box changes what the rules say for a family of
// products (SCRUM-56, S10): the confirm screen asks it only then. A product
// added without its strength is kept with its strength unknown ("Dosage non
// précisé", CheckedItem.strengthUnknown), which the engine reads at least as
// cautiously as any strength: a strengthAboveMg rule matches an unknown
// strength, and a daily maximum counts the family's lowest strength as certain
// and its highest as possible. So the question can go only where no rule
// reads the strength; computed from the pack, never listed by hand.
import type { Pack, Product } from '@siapso/engine';
import { substancesWithMaxDose } from './search-index.js';

/**
 * 'always': a rule reads the strength whatever is given (a strengthAboveMg
 * threshold with a box of the family at or under it: ASPEGIC, KARDEGIC), or
 * the boxes of the family hold different substances, so the answer picks the
 * product. 'with-count': a daily maximum reads it, once a daily count is
 * given (paracetamol). 'never': no rule reads it.
 */
export type StrengthNeed = 'always' | 'with-count' | 'never';

/** The substances a product holds, sorted, as one key. */
function substancesKey(product: Product): string {
  return [...new Set(product.components.map((c) => c.substance))].sort().join('+');
}

/** Whether the strength of the boxes `members` (one family) changes a rule, and when. */
export function strengthNeed(pack: Pack, members: readonly Product[]): StrengthNeed {
  if (new Set(members.map(substancesKey)).size > 1) return 'always';
  const held = new Set(members.flatMap((p) => p.components.map((c) => c.substance)));
  for (const rule of pack.rules) {
    const { subject, strengthAboveMg } = rule.when;
    if (strengthAboveMg === undefined || subject === undefined || !('substance' in subject)) {
      continue;
    }
    if (!held.has(subject.substance)) continue;
    // An unknown strength matches the rule: a box at or under the threshold
    // would not, so its strength changes the answer.
    const under = members.some((p) =>
      p.components.some(
        (c) =>
          c.substance === subject.substance &&
          c.strengthMg !== undefined &&
          c.strengthMg <= strengthAboveMg,
      ),
    );
    if (under) return 'always';
  }
  const maxDose = substancesWithMaxDose(pack);
  return [...held].some((substance) => maxDose.has(substance)) ? 'with-count' : 'never';
}
