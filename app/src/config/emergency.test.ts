// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { EMERGENCY_NUMBERS } from './emergency.js';

describe('built-in emergency numbers', () => {
  it('are the public national emergency numbers of Senegal: the SAMU, then the fire brigade', () => {
    expect(EMERGENCY_NUMBERS).toEqual([
      { service: 'samu', phone: '1515' },
      { service: 'firefighters', phone: '18' },
    ]);
  });

  it('are short public service numbers only, never a personal number', () => {
    for (const { phone } of EMERGENCY_NUMBERS) expect(phone).toMatch(/^\d{2,4}$/);
  });
});
