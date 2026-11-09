// SPDX-License-Identifier: MIT
// What the prescription list says under a product read (SCRUM-57, spec 7.4
// and 7.13): the reading proposes, she compares with the box and ticks. A
// product read in part, one that holds more than the line names, or one only
// strongly read, says so in plain words; nothing here ever ticks for her.
// Pure.
import type { Lang, Pack } from '@siapso/engine';
import type { OcrErrorReason } from '@siapso/ocr';
import type { MessageKey, Vars } from '../i18n/index.js';
import type { PrescriptionProduct } from './prescription-reading.js';

/** A sentence of the list: its key and values. */
export interface Note {
  key: MessageKey;
  vars?: Vars;
}

/** The names of substances, in the screen's language, in order, once each (an unknown id as is). */
export function substanceNamesOf(pack: Pack, ids: readonly string[], lang: Lang): string {
  return [...new Set(ids)]
    .map((id) => pack.substances.find((substance) => substance.id === id)?.names[lang] ?? id)
    .join(', ');
}

/**
 * What the list says under a product read: the substances the line names
 * that it lacks ("Regardez la boîte : la ligne dit aussi « codéine »"), the
 * ones it holds that the line does not name, a line that names more than the
 * product, and "compare with the box" for a strong (not very strong) match.
 * Nothing for a product read whole.
 */
export function notesOf(pack: Pack, product: PrescriptionProduct, lang: Lang): Note[] {
  const notes: Note[] = [];
  if (product.missingSubstances.length > 0) {
    notes.push({
      key: 'prescription.alsoNames',
      vars: { names: substanceNamesOf(pack, product.missingSubstances, lang) },
    });
  } else if (product.namesMore) {
    notes.push({ key: 'prescription.namesMore' });
  }
  if (product.extraSubstances.length > 0) {
    notes.push({
      key: 'prescription.holdsMore',
      vars: { names: substanceNamesOf(pack, product.extraSubstances, lang) },
    });
  }
  if (product.match === 'strong') notes.push({ key: 'prescription.compare' });
  return notes;
}

/** The message of a reading or pack failure: each says what to do instead. */
export function ocrErrorKeyOf(reason: OcrErrorReason): MessageKey {
  return `prescription.errors.${reason}`;
}
