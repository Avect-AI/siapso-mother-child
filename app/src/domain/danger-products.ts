// SPDX-License-Identifier: MIT
// The products of a result's danger that who to call names (screens/Referral.tsx),
// as the result hands them in the entry's state: references, never names.

/** A product or remedy of a result's danger, as the item refers to it (shown by name). */
export interface DangerProduct {
  kind: 'product' | 'plant';
  id: string;
  strengthUnknown?: true;
  /** The dose range said ("100 mg ou moins"), named with the product. */
  strengthAtMostMg?: number;
  /** She answered "Plus de 100 mg" to its dose (generic aspirin), named with the product. */
  doseAbove?: true;
}

/**
 * How complete the label of a box is: its dose not given ("dosage non
 * précisé"), then "Plus de 100 mg", then nothing said. Of two entries of one
 * box, who to call names the one with the more cautious and complete label.
 */
function labelRank(product: DangerProduct): number {
  if (product.strengthUnknown === true) return 2;
  return product.doseAbove === true ? 1 : 0;
}

/**
 * The products of the state: product or plant references only, each box once
 * (a box of another dose range apart), with its more cautious and complete
 * label whatever the order; a range that is not a number above 0 is dropped.
 */
export function dangerProductsOf(value: unknown): DangerProduct[] {
  if (!Array.isArray(value)) return [];
  const products: DangerProduct[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { kind, id, strengthUnknown, strengthAtMostMg, doseAbove } = entry as Record<
      string,
      unknown
    >;
    if ((kind !== 'product' && kind !== 'plant') || typeof id !== 'string' || id === '') continue;
    const atMost =
      typeof strengthAtMostMg === 'number' &&
      Number.isFinite(strengthAtMostMg) &&
      strengthAtMostMg > 0
        ? strengthAtMostMg
        : undefined;
    const product: DangerProduct = {
      kind,
      id,
      ...(strengthUnknown === true ? { strengthUnknown: true as const } : {}),
      ...(atMost === undefined ? {} : { strengthAtMostMg: atMost }),
      ...(doseAbove === true && strengthUnknown !== true && atMost === undefined
        ? { doseAbove: true as const }
        : {}),
    };
    const same = products.findIndex(
      (p) => p.kind === kind && p.id === id && p.strengthAtMostMg === atMost,
    );
    const listed = products[same];
    if (listed === undefined) products.push(product);
    else if (labelRank(product) > labelRank(listed)) products[same] = product;
  }
  return products;
}
