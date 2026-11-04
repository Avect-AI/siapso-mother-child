// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { percentile, renderMarkdown, summariseSet, withoutReference } from '../eval/report.js';
import type { UtteranceResult } from '../eval/report.js';
import { wordErrors } from '../eval/wer.js';

const result = (reference: string, hypothesis: string, ms: number): UtteranceResult => ({
  id: reference,
  reference,
  hypothesis,
  errors: wordErrors(reference, hypothesis),
  audioSeconds: 2,
  ms,
});

describe('percentile', () => {
  it('uses the nearest rank', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  });
  it('is 0 for no value', () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('summariseSet', () => {
  it('pools the words of all utterances', () => {
    const s = summariseSet([result('a b', 'a', 100), result('c d e f', 'c d e f', 300)]);
    expect(s).toMatchObject({ utterances: 2, words: 6, deletions: 1, audioSeconds: 4 });
    expect(s.wer).toBeCloseTo(1 / 6);
    expect(s.ms).toEqual({ mean: 200, median: 100, p95: 300 });
  });
  it('has no rate for an empty set', () => {
    expect(summariseSet([]).wer).toBeNull();
  });
});

describe('renderMarkdown', () => {
  const base = {
    date: '2026-11-05',
    rows: [{ pack: 'p', set: 'FLEURS fr_fr', summary: summariseSet([result('a b', 'a b', 1000)]) }],
    environment: ['Node'],
    datasets: ['FLEURS'],
  };
  it('marks the name measure as pending without recordings', () => {
    expect(renderMarkdown({ ...base, names: [] })).toContain('Pending recordings');
    expect(
      renderMarkdown({
        ...base,
        names: [{ pack: 'p', set: 'volunteers-fr', count: 0, top1: 0, top3: 0 }],
      }),
    ).toContain('Pending recordings');
  });
  it('reports the name measure per pack and set', () => {
    const text = renderMarkdown({
      ...base,
      names: [
        { pack: 'p', set: 'volunteers-fr', count: 4, top1: 2, top3: 3 },
        { pack: 'p', set: 'volunteers-mix', count: 2, top1: 0, top3: 1 },
      ],
    });
    expect(text).toContain('| `p` | volunteers-fr | 4 | 50.0 % | 75.0 % |');
    expect(text).toContain('| `p` | volunteers-mix | 2 | 0.0 % | 50.0 % |');
    expect(text).not.toContain('Pending recordings');
  });
  it('drops the reference text of stored results', () => {
    const stored = withoutReference([result('secret words', 'secret word', 5)]);
    expect(JSON.stringify(stored)).not.toContain('"reference":');
    expect(stored[0]).toMatchObject({ hypothesis: 'secret word', ms: 5 });
  });
});
