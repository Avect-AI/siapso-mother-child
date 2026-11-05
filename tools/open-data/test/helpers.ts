// SPDX-License-Identifier: MIT
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenDataEvent } from '../src/index.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const NO_FINDINGS = {
  C1: 0,
  C2: 0,
  C3: 0,
  C4: 0,
  C5: 0,
  C6: 0,
  C7: 0,
  C8: 0,
  C9: 0,
  C10: 0,
  C11: 0,
  C12: 0,
};

export function makeEvent(overrides: Partial<OpenDataEvent> = {}): OpenDataEvent {
  return {
    week: '2026-W45',
    region: 'dakar',
    mode: 'woman',
    level: 'next-contact',
    findings: { ...NO_FINDINGS },
    unknownItems: 0,
    unrecognisedNames: 0,
    ...overrides,
  };
}

export function makeEvents(count: number, overrides: Partial<OpenDataEvent> = {}): OpenDataEvent[] {
  return Array.from({ length: count }, () => makeEvent(overrides));
}
