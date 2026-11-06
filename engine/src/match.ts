// SPDX-License-Identifier: MIT
import type { CheckedItem, Component, Pack, Product, Subject } from './types.js';

/**
 * The strength in mg of a component of an item, as the rules read it:
 * undefined when the pack gives none, or when the user does not know the
 * strength on the box (strengthUnknown).
 */
export function strengthOf(item: CheckedItem, component: Component): number | undefined {
  return item.strengthUnknown === true ? undefined : component.strengthMg;
}

/** The pack product of a product item; undefined for any other item or a missing id. */
export function productOf(pack: Pack, item: CheckedItem): Product | undefined {
  const ref = item.ref;
  return ref.kind === 'product' ? pack.products.find((p) => p.id === ref.id) : undefined;
}

/**
 * A stable key for an item the pack knows ("product:<id>" or "plant:<id>"),
 * or undefined for an unrecognised item or an id missing from the pack.
 */
export function entryKey(pack: Pack, item: CheckedItem): string | undefined {
  const ref = item.ref;
  if (ref.kind === 'unrecognised') return undefined;
  const entries: readonly { id: string }[] = ref.kind === 'product' ? pack.products : pack.plants;
  return entries.some((e) => e.id === ref.id) ? `${ref.kind}:${ref.id}` : undefined;
}

/** Whether a substance is the subject, or belongs to the subject class and is not excluded. */
export function substanceMatches(pack: Pack, substanceId: string, subject: Subject): boolean {
  if ('substance' in subject) return substanceId === subject.substance;
  if ('plant' in subject) return false;
  const substance = pack.substances.find((s) => s.id === substanceId);
  const excluded = pack.classes.find((c) => c.id === subject.class)?.excludes ?? [];
  return (
    substance !== undefined &&
    substance.classes.includes(subject.class) &&
    !excluded.includes(substanceId)
  );
}

/**
 * Whether a checked item matches a rule subject:
 * - substance: a component of the product is that substance;
 * - class: a component substance belongs to the class and is not in its excludes;
 * - plant: the item is that plant.
 * An unrecognised item, or an id missing from the pack, matches nothing.
 *
 * With strengthAboveMg and a substance subject, the component must also be
 * stronger than that value; a component of unknown strength still matches,
 * and so does every component of an item whose strength the user does not know,
 * unless the user said the strength is at most a value the rule does not
 * exceed (CheckedItem.strengthAtMostMg).
 */
export function itemMatches(
  pack: Pack,
  item: CheckedItem,
  subject: Subject,
  strengthAboveMg?: number,
): boolean {
  if ('plant' in subject) {
    return item.ref.kind === 'plant' && entryKey(pack, item) === `plant:${subject.plant}`;
  }
  const components = productOf(pack, item)?.components ?? [];
  return components.some((c) => {
    if (!substanceMatches(pack, c.substance, subject)) return false;
    if (strengthAboveMg === undefined) return true;
    const strength = strengthOf(item, c);
    if (strength !== undefined) return strength > strengthAboveMg;
    const atMost = item.strengthAtMostMg;
    return atMost === undefined || atMost > strengthAboveMg;
  });
}

/** Substances of a product item, in component order; none for any other item. */
export function substancesOf(pack: Pack, item: CheckedItem): string[] {
  const components = productOf(pack, item)?.components ?? [];
  return [...new Set(components.map((c) => c.substance))];
}
