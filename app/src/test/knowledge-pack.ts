// SPDX-License-Identifier: MIT
// The real knowledge pack, built from knowledge/ and registry/ as `pnpm
// knowledge:build` builds it, for the tests that search real names (a Wolof
// name, a misspelled brand). Built once per test file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pack } from '@siapso/engine';
import { buildPack, loadContent } from '@siapso/pack-tools';
import { todayIso } from '../domain/dates.js';
import type { Profile } from '../domain/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let built: Promise<Pack> | undefined;

export function knowledgePack(): Promise<Pack> {
  built ??= loadContent(ROOT).then(buildPack);
  return built;
}

/**
 * A stored profile: pregnant at 26 weeks given today (the phone's clock, faked
 * or not, so the term never grows outdated as the calendar moves on), no
 * situation, unless `patch` says otherwise.
 */
export function profileOf(patch: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    pseudonym: 'Awa',
    pregnant: true,
    term: { kind: 'weeks', weeks: 26, givenOn: todayIso(new Date()) },
    breastfeeding: false,
    conditions: [],
    longTermItems: [],
    createdAt: '2026-11-04T08:00:00.000Z',
    updatedAt: '2026-11-04T08:00:00.000Z',
    ...patch,
  };
}
