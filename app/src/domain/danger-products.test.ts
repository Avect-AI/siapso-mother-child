// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { dangerProductsOf } from './danger-products.js';

const aspirin = { kind: 'product', id: 'aspirin-generic' } as const;

describe('dangerProductsOf: the products who to call names', () => {
  it('keeps product and plant references only, each once', () => {
    expect(
      dangerProductsOf([
        aspirin,
        { kind: 'plant', id: 'moringa' },
        { kind: 'unrecognised', text: 'poudre' },
        { kind: 'product', id: '' },
        'aspirin-generic',
        aspirin,
      ]),
    ).toEqual([aspirin, { kind: 'plant', id: 'moringa' }]);
    expect(dangerProductsOf(undefined)).toEqual([]);
  });

  it('names a box once with its more cautious and complete label, whatever the order', () => {
    const unknown = { ...aspirin, strengthUnknown: true as const };
    expect(dangerProductsOf([aspirin, unknown])).toEqual([unknown]);
    expect(dangerProductsOf([unknown, aspirin])).toEqual([unknown]);
    const above = { ...aspirin, doseAbove: true as const };
    expect(dangerProductsOf([aspirin, above])).toEqual([above]);
    expect(dangerProductsOf([above, unknown])).toEqual([unknown]);
  });

  it('keeps a box of another dose range apart, and drops a range that is not a number above 0', () => {
    const low = { ...aspirin, strengthAtMostMg: 100 };
    expect(dangerProductsOf([low, aspirin])).toEqual([low, aspirin]);
    expect(dangerProductsOf([{ ...aspirin, strengthAtMostMg: -1 }])).toEqual([aspirin]);
    expect(dangerProductsOf([{ ...aspirin, strengthAtMostMg: '100' }])).toEqual([aspirin]);
  });
});
