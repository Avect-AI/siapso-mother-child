// SPDX-License-Identifier: MIT
// The maximum-dose check on the default path of the app: a woman who types
// "paracétamol" picks the generic, the confirm screen offers its strengths,
// and a unit count on a product of unknown strength gives a note.
import { BUILTIN_MESSAGES, evaluate } from '@siapso/engine';
import type { CheckedItem, Evaluation, Pack } from '@siapso/engine';
import { buildIndex, entriesFromPack, productFamily, search } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPack, loadContent } from '../src/index.js';
import { REPO_ROOT } from './helpers.js';

let pack: Pack;

beforeAll(async () => {
  pack = buildPack(await loadContent(REPO_ROOT));
});

function run(items: CheckedItem[]): Evaluation {
  return evaluate(pack, {
    pregnancy: { weeksMin: 30, weeksMax: 30, precision: 'exact' },
    conditions: [],
    items,
    signs: [],
  });
}

function product(id: string, unitsPerDay?: number): CheckedItem {
  return unitsPerDay === undefined
    ? { ref: { kind: 'product', id } }
    : { ref: { kind: 'product', id }, unitsPerDay };
}

describe('the paracetamol generic and its strengths', () => {
  it('are products of one resolver family', () => {
    const strengths = new Map(
      pack.products
        .filter((p) => p.id.startsWith('paracetamol-') && p.id.endsWith('-generic'))
        .map((p) => [p.id, p.components.map((c) => [c.substance, c.strengthMg])]),
    );
    expect(Object.fromEntries(strengths)).toEqual({
      'paracetamol-generic': [['paracetamol', undefined]],
      'paracetamol-500-generic': [['paracetamol', 500]],
      'paracetamol-1000-generic': [['paracetamol', 1000]],
    });
    const families = new Set(
      entriesFromPack(pack)
        .filter((e) => strengths.has(e.id))
        .map((e) => e.family),
    );
    expect([...families]).toEqual(['substances:paracetamol']);
  });

  it('are offered together on the confirm screen', () => {
    const index = buildIndex(entriesFromPack(pack));
    const [first] = search(index, 'paracétamol');
    expect(first?.family).toBe('substances:paracetamol');
    const family = [first?.id, ...(first?.variants ?? [])].sort();
    expect(family).toEqual([
      'paracetamol-1000-generic',
      'paracetamol-500-generic',
      'paracetamol-generic',
    ]);
    expect(search(index, 'paracetamol 1000')[0]?.id).toBe('paracetamol-1000-generic');
    expect(search(index, 'paracetamol 500 mg')[0]?.id).toBe('paracetamol-500-generic');
  });

  it('let the engine sum a strength the woman confirmed', () => {
    const result = run([product('paracetamol-1000-generic', 4)]);
    expect(result.findings.map((f) => [f.check, f.ruleId])).toEqual([
      ['C7', 'paracetamol-max-daily'],
    ]);
    expect(result.notes).toEqual([]);
  });

  it('give a note, never a level, for units per day of a product without a strength', () => {
    const result = run([product('paracetamol-generic', 8)]);
    expect(result.level).toBe('unknown');
    expect(result.findings.map((f) => f.check)).toEqual(['no-finding']);
    expect(result.notes.map((n) => [n.ruleId, n.message])).toEqual([
      ['paracetamol-max-daily', BUILTIN_MESSAGES.maxDoseNotComputable],
      ['paracetamol-overdose', BUILTIN_MESSAGES.maxDoseNotComputable],
    ]);
    expect(run([product('paracetamol-generic')]).notes).toEqual([]);
  });

  it('carry the resolver family in the pack, for every product', () => {
    for (const item of pack.products) expect(item.family, item.id).toBe(productFamily(item));
  });

  it('give the daily maximum from the strengths of the family when the box is not known', () => {
    const unknown = (unitsPerDay: number): CheckedItem => ({
      ...product('paracetamol-generic', unitsPerDay),
      strengthUnknown: true,
    });
    // 7 x 500 mg is certain: the maximum is exceeded whatever the box; 7 x 1000 mg
    // would be a toxic amount: said apart, held at before the next dose.
    expect(run([unknown(7)]).findings.map((f) => [f.ruleId, f.message, f.level])).toEqual([
      ['paracetamol-max-daily', 'paracetamol-max-daily', 'before-next-dose'],
      ['paracetamol-overdose', 'paracetamol-overdose-possible', 'before-next-dose'],
    ]);
    // 5 x 500 mg is not, 5 x 1000 mg is: it depends on the box.
    expect(run([unknown(5)]).findings.map((f) => [f.ruleId, f.message, f.level])).toEqual([
      ['paracetamol-max-daily', BUILTIN_MESSAGES.maxDoseMayExceed, 'before-next-dose'],
    ]);
    // 12 x 500 mg is twice the maximum whatever the box: a danger.
    expect(run([unknown(12)]).level).toBe('danger');
    expect(run([unknown(12)]).notes).toEqual([]);
  });
});
