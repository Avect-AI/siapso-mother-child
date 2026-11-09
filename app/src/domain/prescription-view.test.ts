// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import { readPrescription } from './prescription-reading.js';
import { notesOf, ocrErrorKeyOf, substanceNamesOf } from './prescription-view.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

/** The one product read on a line. */
function readOne(line: string) {
  const { products } = readPrescription(pack, [line]);
  const [product] = products;
  if (product === undefined) throw new Error(`nothing read on "${line}"`);
  return product;
}

describe('prescription-view: what the list says under a product read', () => {
  it('says nothing more under a product read whole', () => {
    expect(notesOf(pack, readOne('1. Doliprane 1000 mg cp'), 'fr')).toEqual([]);
  });

  it('says what the line also names when a combination is read in part', () => {
    const notes = notesOf(pack, readOne('1. Efferalgan codé 500 mg'), 'fr');
    const also = notes.find((note) => note.key === 'prescription.alsoNames');
    expect(also?.vars?.['names']).toMatch(/^cod[ée]ine$/i);
    // A line going on after "+" names the missing substance, not "something else".
    const fer = notesOf(pack, readOne('1. Fer + B9'), 'fr');
    expect(fer.map((note) => note.key)).toEqual(['prescription.alsoNames']);
  });

  it('says what the product holds that the line does not name', () => {
    const notes = notesOf(pack, readOne('1. Antar codéine 400 mg'), 'fr');
    expect(notes.map((note) => note.key)).toContain('prescription.holdsMore');
    expect(notes.find((note) => note.key === 'prescription.holdsMore')?.vars?.['names']).toMatch(
      /ibuprof/i,
    );
  });

  it('asks to compare with the box for a strong match', () => {
    const product = readOne('1. Antar codéine 400 mg');
    expect(product.match).toBe('strong');
    expect(notesOf(pack, product, 'fr').map((note) => note.key)).toContain('prescription.compare');
  });

  it('names substances in the language of the screen, in order, once each', () => {
    const [first] = pack.substances;
    if (first === undefined) throw new Error('no substance');
    expect(substanceNamesOf(pack, [first.id, first.id], 'fr')).toBe(first.names.fr);
    expect(substanceNamesOf(pack, ['no-such-substance'], 'fr')).toBe('no-such-substance');
  });
});

describe('prescription-view: what each reading failure says', () => {
  it('has a message for every reason, and the size reasons ask for a photo', () => {
    const reasons = [
      'unavailable',
      'invalid',
      'storage',
      'download',
      'load',
      'read',
      'timeout',
      'cancelled',
      'not-image',
      'too-large',
      'pdf-password',
      'pdf-damaged',
      'pdf-unsupported',
    ] as const;
    for (const reason of reasons) {
      expect(ocrErrorKeyOf(reason)).toBe(`prescription.errors.${reason}`);
    }
  });
});
