// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { LEVELS, levelRank } from '../src/index.js';

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
