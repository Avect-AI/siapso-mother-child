// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { validateRequest } from '../src/validate.js';

type Where = (string | number)[];

function valid(): Record<string, unknown> {
  return {
    pack_version: '2026.11.1',
    context: {
      pregnancy: { weeksMin: 8, weeksMax: 10, precision: 'estimated' },
      breastfeeding: { babyAgeWeeks: 3, premature: false },
      conditions: ['sickle-cell'],
      items: [
        { ref: { kind: 'product', id: 'ibuprofen-400' }, unitsPerDay: 3, longTerm: false },
        { ref: { kind: 'plant', id: 'neem' }, strengthUnknown: true },
        { ref: { kind: 'unrecognised', text: 'a herbal tea' } },
      ],
      signs: ['bleeding'],
    },
  };
}

/** Sets (or, for undefined, removes) the value at a path of a nested request. */
function put(body: unknown, where: Where, value: unknown): void {
  let node = body as Record<string | number, unknown>;
  for (const key of where.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = where[where.length - 1] as string | number;
  if (value === undefined) Reflect.deleteProperty(node, last);
  else node[last] = value;
}

function pathsOf(body: unknown): string[] {
  const result = validateRequest(body);
  if (result.ok) return [];
  return result.errors.map((e) => e.path);
}

describe('validateRequest', () => {
  it('accepts a full request and a minimal one', () => {
    expect(validateRequest(valid()).ok).toBe(true);
    expect(
      validateRequest({ pack_version: 'x', context: { conditions: [], items: [], signs: [] } }).ok,
    ).toBe(true);
  });

  it('rejects an unknown key at every level, with its path', () => {
    const cases: [Where, string][] = [
      [['name'], ''],
      [['context', 'phone'], 'context'],
      [['context', 'address'], 'context'],
      [['context', 'dateOfBirth'], 'context'],
      [['context', 'pregnancy', 'lmp'], 'context.pregnancy'],
      [['context', 'breastfeeding', 'babyName'], 'context.breastfeeding'],
      [['context', 'items', 0, 'note'], 'context.items[0]'],
      [['context', 'items', 0, 'ref', 'label'], 'context.items[0].ref'],
      [['context', 'items', 2, 'ref', 'comment'], 'context.items[2].ref'],
    ];
    for (const [where, expected] of cases) {
      const body = valid();
      put(body, where, 'free text');
      expect(validateRequest(body).ok, expected).toBe(false);
      expect(pathsOf(body), expected).toContain(expected);
      // Only the parent path is reported: the name of the key is not echoed.
      expect(JSON.stringify(validateRequest(body)), expected).not.toContain(
        String(where[where.length - 1]),
      );
    }
  });

  it('rejects wrong types, ranges and shapes', () => {
    const cases: [Where, unknown][] = [
      [['pack_version'], 12],
      [['pack_version'], undefined],
      [['context'], undefined],
      [['context', 'conditions'], ['asthma']],
      [
        ['context', 'conditions'],
        ['sickle-cell', 'sickle-cell'],
      ],
      [['context', 'pregnancy', 'weeksMax'], 99],
      [['context', 'pregnancy', 'weeksMin'], 1.5],
      [['context', 'pregnancy', 'precision'], 'sure'],
      [['context', 'breastfeeding', 'babyAgeWeeks'], -1],
      [['context', 'items', 0, 'unitsPerDay'], 0],
      [['context', 'items', 0, 'ref', 'kind'], 'brand'],
      [['context', 'items', 0, 'ref', 'id'], 'Not An Id!'],
      [['context', 'items', 1, 'strengthUnknown'], 'yes'],
      [['context', 'items'], new Array<unknown>(100).fill({ ref: { kind: 'plant', id: 'neem' } })],
      [['context', 'signs'], [12]],
    ];
    for (const [where, value] of cases) {
      const body = valid();
      put(body, where, value);
      expect(validateRequest(body).ok, where.join('.')).toBe(false);
    }
    for (const body of [null, 'text', 12, [], undefined]) {
      expect(validateRequest(body).ok).toBe(false);
    }
  });

  it('limits unrecognised text to 80 characters', () => {
    const where: Where = ['context', 'items', 2, 'ref', 'text'];
    const body = valid();
    put(body, where, 'x'.repeat(80));
    expect(validateRequest(body).ok).toBe(true);
    put(body, where, 'x'.repeat(81));
    expect(validateRequest(body).ok).toBe(false);
    put(body, where, '');
    expect(validateRequest(body).ok).toBe(false);
  });

  it('never echoes a value in the errors', () => {
    const secret = 'Awa-Diop-0770000000';
    const attempts: unknown[] = [
      { pack_version: secret, context: 'x' },
      { pack_version: '1', context: { conditions: [secret], items: [], signs: [] } },
      {
        pack_version: '1',
        context: {
          conditions: [],
          items: [{ ref: { kind: 'unrecognised', text: secret.repeat(10) } }],
          signs: [],
        },
      },
      {
        pack_version: '1',
        context: { conditions: [], items: [{ ref: { kind: secret, id: secret } }], signs: [] },
      },
      { pack_version: '1', context: { conditions: [], items: [], signs: [secret] } },
    ];
    for (const body of attempts) {
      const result = validateRequest(body);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret.slice(0, 8));
    }
  });
});
