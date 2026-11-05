// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LEVELS } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import {
  CHECK_IDS,
  EventError,
  parseEvents,
  REGION_IDS,
  REGIONS,
  validateEvent,
} from '../src/index.js';
import { makeEvent, REPO_ROOT } from './helpers.js';

describe('regions', () => {
  it('lists the 14 regions of Senegal with ASCII ids', () => {
    expect(REGIONS).toHaveLength(14);
    for (const region of REGIONS) expect(region.id).toMatch(/^[a-z]+(-[a-z]+)?$/);
    expect(REGIONS.map((region) => region.name)).toContain('Kédougou');
  });

  it('matches the enumeration of the published schema', async () => {
    const schema = JSON.parse(
      await readFile(path.join(REPO_ROOT, 'open-data/schema/event.schema.json'), 'utf8'),
    ) as {
      properties: { region: { enum: string[] }; level: { enum: string[] } };
    };
    expect(schema.properties.region.enum).toEqual([...REGION_IDS]);
    expect(schema.properties.level.enum).toEqual([...LEVELS]);
  });
});

describe('validateEvent', () => {
  it('accepts a well-formed event', () => {
    expect(validateEvent(makeEvent())).toEqual(makeEvent());
  });

  it('rejects a region outside the 14 regions', () => {
    expect(() => validateEvent({ ...makeEvent(), region: 'paris' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), region: 'Dakar' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), region: 'dakar-medina' })).toThrow(EventError);
  });

  it('rejects free text in any field', () => {
    expect(() => validateEvent({ ...makeEvent(), region: 'Dakar, rue 10, Medina' })).toThrow(
      EventError,
    );
    expect(() => validateEvent({ ...makeEvent(), note: 'doliprane 1000' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), productName: 'Doliprane' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), profileId: 'a1b2' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), unrecognisedNames: 'moringa tea' })).toThrow(
      EventError,
    );
    expect(() =>
      validateEvent({ ...makeEvent(), findings: { ...makeEvent().findings, C1: 'text' } }),
    ).toThrow(EventError);
    expect(() =>
      validateEvent({ ...makeEvent(), findings: { ...makeEvent().findings, C13: 1 } }),
    ).toThrow(EventError);
  });

  it('rejects a date finer than the ISO week', () => {
    expect(() => validateEvent({ ...makeEvent(), week: '2026-11-05' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), week: '2026-W45-4' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), week: '2026-W54' })).toThrow(EventError);
  });

  it('rejects an unknown level or mode and a missing field', () => {
    expect(() => validateEvent({ ...makeEvent(), level: 'severe' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), mode: 'partner' })).toThrow(EventError);
    const withoutWeek: Record<string, unknown> = { ...makeEvent() };
    delete withoutWeek.week;
    expect(() => validateEvent(withoutWeek)).toThrow(EventError);
  });

  it('rejects negative, fractional and oversized counts', () => {
    expect(() => validateEvent({ ...makeEvent(), unknownItems: -1 })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), unknownItems: 1.5 })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), unknownItems: 20 })).not.toThrow();
    expect(() => validateEvent({ ...makeEvent(), unknownItems: 21 })).toThrow(EventError);
  });

  it('limits the sum of findings in one event', () => {
    const ok = Object.fromEntries(CHECK_IDS.map((id) => [id, 0]));
    const many = { ...ok, C1: 10, C2: 10, C3: 10 };
    expect(() => validateEvent({ ...makeEvent(), findings: many })).not.toThrow();
    expect(() => validateEvent({ ...makeEvent(), findings: { ...many, C4: 1 } })).toThrow(/total/);
  });

  it('rejects a grey result that carries findings', () => {
    const findings = { ...makeEvent().findings, C2: 1 };
    expect(() => validateEvent({ ...makeEvent(), level: 'unknown', findings })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), level: 'danger', findings })).not.toThrow();
  });

  it('checks week 53 against the ISO calendar', () => {
    expect(() => validateEvent({ ...makeEvent(), week: '2026-W53' })).not.toThrow();
    expect(() => validateEvent({ ...makeEvent(), week: '2025-W53' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), week: '2027-W53' })).toThrow(EventError);
    expect(() => validateEvent({ ...makeEvent(), week: '2032-W53' })).not.toThrow();
  });
});

describe('parseEvents', () => {
  it('skips blank lines and comment lines and validates each event', () => {
    const text = ['# TEST DATA', '', JSON.stringify(makeEvent()), ''].join('\n');
    expect(parseEvents(text)).toEqual([makeEvent()]);
  });

  it('names the line of an invalid event', () => {
    const text = [
      JSON.stringify(makeEvent()),
      JSON.stringify({ ...makeEvent(), region: 'x' }),
    ].join('\n');
    expect(() => parseEvents(text)).toThrow(/line 2/);
  });

  it('names the line of a line that is not JSON', () => {
    expect(() => parseEvents('{not json')).toThrow(/line 1/);
  });
});
