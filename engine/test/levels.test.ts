// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { capForEvidence, LEVELS, levelRank, maxLevel } from '../src/index.js';
import type { Evidence, RuleKind } from '../src/index.js';

describe('levels', () => {
  it('orders the four levels from unknown to danger', () => {
    expect(LEVELS).toEqual(['unknown', 'next-contact', 'before-next-dose', 'danger']);
    expect(levelRank('danger')).toBeGreaterThan(levelRank('before-next-dose'));
    expect(levelRank('before-next-dose')).toBeGreaterThan(levelRank('next-contact'));
    expect(levelRank('next-contact')).toBeGreaterThan(levelRank('unknown'));
  });
  it('has no safe level', () => {
    expect(LEVELS.join(' ')).not.toMatch(/safe|green|ok/i);
  });
});

describe('capForEvidence', () => {
  it('caps weak evidence at next-contact, except for toxicity', () => {
    expect(capForEvidence('before-next-dose', 'D', 'herb-drug')).toEqual({
      level: 'next-contact',
      capped: true,
    });
    expect(capForEvidence('before-next-dose', 'D', 'toxicity')).toEqual({
      level: 'before-next-dose',
      capped: false,
    });
    expect(capForEvidence('before-next-dose', 'B', 'herb-drug')).toEqual({
      level: 'before-next-dose',
      capped: false,
    });
  });

  it('caps D, E and 0 for every kind other than toxicity', () => {
    const kinds: RuleKind[] = [
      'pregnancy',
      'breastfeeding',
      'interaction',
      'herb-drug',
      'duplicate',
      'max-dose',
      'condition',
      'contraception-info',
      'reminder',
    ];
    for (const kind of kinds) {
      for (const evidence of ['D', 'E', '0'] as Evidence[]) {
        expect(capForEvidence('danger', evidence, kind)).toEqual({
          level: 'next-contact',
          capped: true,
        });
        expect(capForEvidence('before-next-dose', evidence, kind)).toEqual({
          level: 'next-contact',
          capped: true,
        });
        expect(capForEvidence('next-contact', evidence, kind)).toEqual({
          level: 'next-contact',
          capped: false,
        });
        expect(capForEvidence('unknown', evidence, kind)).toEqual({
          level: 'unknown',
          capped: false,
        });
      }
    }
  });

  it('keeps the level for evidence A, B and C, and for toxicity', () => {
    for (const evidence of ['A', 'B', 'C'] as Evidence[]) {
      expect(capForEvidence('danger', evidence, 'condition')).toEqual({
        level: 'danger',
        capped: false,
      });
    }
    for (const evidence of ['D', 'E', '0'] as Evidence[]) {
      expect(capForEvidence('danger', evidence, 'toxicity')).toEqual({
        level: 'danger',
        capped: false,
      });
    }
  });
});

describe('maxLevel', () => {
  it('returns unknown for an empty list', () => {
    expect(maxLevel([])).toBe('unknown');
  });

  it('returns the highest level', () => {
    expect(maxLevel(['next-contact', 'danger', 'unknown'])).toBe('danger');
    expect(maxLevel(['unknown', 'next-contact'])).toBe('next-contact');
    expect(maxLevel(['before-next-dose', 'next-contact', 'unknown'])).toBe('before-next-dose');
    expect(maxLevel(['unknown'])).toBe('unknown');
  });
});
