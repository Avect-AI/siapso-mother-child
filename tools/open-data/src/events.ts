// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import type { Level } from '@siapso/engine';
import Ajv2020 from 'ajv/dist/2020.js';
import { isIsoWeek } from './release.js';

export const CHECK_IDS = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
  'C12',
] as const;
export type OpenCheckId = (typeof CHECK_IDS)[number];

/** Upper bound of the sum of findings in one event (each count is capped by the schema). */
export const MAX_FINDINGS_PER_EVENT = 30;

/** What a device could later send. It cannot identify anyone (see event.schema.json). */
export interface OpenDataEvent {
  week: string;
  region: string;
  /** Optional health district id, validated against a list by the DHIS2 export. */
  district?: string;
  /** Optional: the IPTp reminder was shown in this check. */
  iptpReminderShown?: boolean;
  mode: 'woman' | 'accompanied';
  level: Level;
  /** Number of findings per check id in this check. */
  findings: Record<OpenCheckId, number>;
  unknownItems: number;
  unrecognisedNames: number;
}

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}

const SCHEMA_URL = new URL('../../../open-data/schema/event.schema.json', import.meta.url);

type Validator = ReturnType<Ajv2020['compile']>;
let validator: Validator | undefined;

function getValidator(): Validator {
  validator ??= new Ajv2020({ allErrors: true, strict: true }).compile(
    JSON.parse(readFileSync(SCHEMA_URL, 'utf8')) as object,
  );
  return validator;
}

/** Validates one event against the schema and the rules a schema cannot state; throws EventError. */
export function validateEvent(value: unknown): OpenDataEvent {
  const validate = getValidator();
  if (!validate(value)) {
    const problems = (validate.errors ?? []).map((error) => {
      const where = error.instancePath === '' ? 'event' : error.instancePath;
      return `${where} ${error.message ?? 'is invalid'}`;
    });
    throw new EventError(problems.join('; '));
  }
  const event = value as OpenDataEvent;
  if (!isIsoWeek(event.week)) throw new EventError(`/week ${event.week} is not an ISO week`);
  const total = CHECK_IDS.reduce((sum, id) => sum + event.findings[id], 0);
  if (total > MAX_FINDINGS_PER_EVENT) {
    throw new EventError(
      `/findings total ${String(total)} exceeds ${String(MAX_FINDINGS_PER_EVENT)}`,
    );
  }
  return event;
}

/** Parses a JSON Lines text. Blank lines and lines starting with # are skipped. */
export function parseEvents(text: string): OpenDataEvent[] {
  const events: OpenDataEvent[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const number = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new EventError(`line ${String(number)}: not valid JSON`);
    }
    try {
      events.push(validateEvent(value));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new EventError(`line ${String(number)}: ${reason}`);
    }
  });
  return events;
}
