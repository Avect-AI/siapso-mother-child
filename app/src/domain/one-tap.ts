// SPDX-License-Identifier: MIT
// A tap on a candidate of the search adds it at once (SCRUM-56, S11), only
// where the confirm screen would have nothing to ask and nothing to warn
// about (the safety review): the tap on a named row is then the
// confirmation. Anything else opens "Est-ce bien ce produit ?" as before,
// with its warning: a name close to the one typed, a local name nobody has
// checked against the box, a name the voice heard that is not a whole name,
// a substance the name typed says and the product lacks ("Codéine : ce
// produit n'en contient pas"), the strength a rule reads, the daily count of
// a daily maximum, or a family already listed (is it the same box?).
import type { CheckedItem, Pack } from '@siapso/engine';
import type { Candidate } from '@siapso/resolver';
import {
  localNameOf,
  missingSubstancesOf,
  needsUnitsPerDay,
  productFamilyOf,
  strengthChoiceOf,
} from './search-index.js';
import { strengthNeed } from './strength-need.js';

/** Whether a name matches the whole name, a brand or an alias, or only the substances named. */
function wholeName(candidate: Candidate): boolean {
  return candidate.match === 'exact' || candidate.match === 'substances';
}

/**
 * The item a tap on `candidate` adds at once, or null when the confirm screen
 * must ask or warn first. `query` is the text it was found by; `heard`, that
 * the voice heard it; `items`, the check as it is.
 */
export function oneTapItem(
  pack: Pack,
  candidate: Candidate,
  query: string,
  { heard, items }: { heard: boolean; items: readonly CheckedItem[] },
): CheckedItem | null {
  if (!wholeName(candidate)) return null;
  // A voice transcript adds at once only when it is a whole name itself.
  if (heard && candidate.match !== 'exact') return null;
  if (localNameOf(pack, candidate, candidate.matched) !== undefined) return null;
  if (candidate.kind === 'plant') {
    const listed = items.some(({ ref }) => ref.kind === 'plant' && ref.id === candidate.id);
    return listed ? null : { ref: { kind: 'plant', id: candidate.id } };
  }
  if (missingSubstancesOf(pack, candidate.id, query, 'fr').length > 0) return null;
  const ref = { kind: 'product' as const, id: candidate.id };
  // The daily count of a daily maximum is asked on the confirm screen.
  if (needsUnitsPerDay(pack, ref)) return null;
  const listed = items.some(
    (item) =>
      item.ref.kind === 'product' && productFamilyOf(pack, item.ref.id) === candidate.family,
  );
  if (listed) return null;
  const choice = strengthChoiceOf(pack, candidate, query);
  if (choice === null || choice.preselected === 'candidate') return { ref };
  const members = [candidate.id, ...candidate.variants].flatMap((id) => {
    const product = pack.products.find((p) => p.id === id);
    return product === undefined ? [] : [product];
  });
  // No rule reads the strength: kept not given, and said so ("Dosage non connu").
  return strengthNeed(pack, members) === 'never' ? { ref, strengthUnknown: true } : null;
}
