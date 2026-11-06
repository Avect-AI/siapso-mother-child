// SPDX-License-Identifier: MIT
// The dose range a box is read in, for a box whose dose the confirm screen
// asks by a range (generic aspirin, SCRUM-56: "100 mg ou moins", "Plus de
// 100 mg" or "Je ne sais pas"). It is said wherever the box is named, so that
// the woman and a health worker see why an aspirin card applies or not: the
// list, the same-box question, the result and who to call.
import type { CheckedItem, Lang, Pack } from '@siapso/engine';
import { parseStrength } from '@siapso/resolver';
import type { MessageKey, Vars } from '../i18n/translate.js';
import { productDoseRangeOf, strengthText } from './search-index.js';

type Translate = (key: MessageKey, vars?: Vars) => string;

/** A dose answered by a range: at most `mg`, or above it. */
export interface DoseBand {
  kind: 'at-most' | 'above';
  mg: number;
}

/**
 * The range an item is read in: "100 mg ou moins" (strengthAtMostMg), or
 * "Plus de 100 mg" for a box whose dose is asked by a range (productDoseRangeOf)
 * listed without one and not with "Je ne sais pas". Undefined otherwise: a box
 * with a strength, "Je ne sais pas" (said "Dosage non précisé"), a remedy.
 */
export function doseBandOf(pack: Pack, item: CheckedItem): DoseBand | undefined {
  if (item.ref.kind !== 'product') return undefined;
  if (item.strengthAtMostMg !== undefined) return { kind: 'at-most', mg: item.strengthAtMostMg };
  if (item.strengthUnknown === true) return undefined;
  const range = productDoseRangeOf(pack, item.ref.id);
  return range === undefined ? undefined : { kind: 'above', mg: range };
}

/** The range on a line of its own: "100 mg ou moins", "Plus de 100 mg". */
export function doseBandLine(t: Translate, band: DoseBand, lang: Lang): string {
  const strength = strengthText(band.mg, lang);
  return t(band.kind === 'at-most' ? 'check.strengthAtMost' : 'check.strengthAbove', { strength });
}

/** The name of a box with its range, in a sentence or on a card: "Aspirine (générique), plus de 100 mg". */
export function bandedName(
  pack: Pack,
  item: CheckedItem,
  name: string,
  lang: Lang,
  t: Translate,
): string {
  const band = doseBandOf(pack, item);
  if (band === undefined) return name;
  const strength = strengthText(band.mg, lang);
  return t(band.kind === 'at-most' ? 'check.nameAtMost' : 'check.nameAbove', { name, strength });
}

/** The lowest dose of a range chosen for her: a typed "50 mg" to the threshold. */
const LOW_DOSE_MIN_MG = 50;

/**
 * Whether "100 mg ou moins" is chosen at first from the text the box was
 * found by: only when she typed it (never from the voice), with "mg" written,
 * from 50 mg to the threshold. A bare number ("aspirine 1"), a gram, a count
 * ("2 x 500 mg" reads 500 mg) or anything else chooses nothing.
 */
export function lowDoseTyped(query: string, heard: boolean, thresholdMg: number): boolean {
  if (heard) return false;
  const { strengthMg, unit } = parseStrength(query);
  return (
    unit === 'mg' &&
    strengthMg !== undefined &&
    strengthMg >= LOW_DOSE_MIN_MG &&
    strengthMg <= thresholdMg
  );
}
