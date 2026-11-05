// SPDX-License-Identifier: MIT
// The request schema. `additionalProperties: false` at every level: no field
// that is not listed (a name, a phone number, an address, a date of birth, a
// note) can be accepted. The only free text is the name of an unrecognised
// item, at most 80 characters.
import { CONDITION_IDS } from '@siapso/engine';
import type { EvaluationContext } from '@siapso/engine';
import { Ajv2020 } from 'ajv/dist/2020.js';

/** The longest text of an unrecognised item. */
export const MAX_UNRECOGNISED_TEXT = 80;

const ID = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', minLength: 1, maxLength: 64 };
/**
 * The app reads a month estimate moved on by the weeks since it was given, so
 * weeksMax can pass 45 (about 54); weeksMin stays within 45 weeks. 60 leaves room.
 */
const WEEKS_MIN = { type: 'integer', minimum: 0, maximum: 45 };
const WEEKS_MAX = { type: 'integer', minimum: 0, maximum: 60 };

export const REQUEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://siapso.org/schemas/server/evaluate-request.json',
  title: 'EvaluateRequest',
  type: 'object',
  additionalProperties: false,
  required: ['pack_version', 'context'],
  properties: {
    pack_version: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description: 'The version of the knowledge pack the caller expects.',
    },
    context: {
      type: 'object',
      additionalProperties: false,
      required: ['conditions', 'items', 'signs'],
      properties: {
        pregnancy: {
          type: 'object',
          additionalProperties: false,
          required: ['weeksMin', 'weeksMax', 'precision'],
          properties: {
            weeksMin: WEEKS_MIN,
            weeksMax: WEEKS_MAX,
            precision: { enum: ['exact', 'estimated', 'unknown'] },
          },
        },
        breastfeeding: {
          type: 'object',
          additionalProperties: false,
          properties: {
            babyAgeWeeks: { type: 'number', minimum: 0, maximum: 520 },
            premature: { type: 'boolean' },
          },
        },
        conditions: {
          type: 'array',
          uniqueItems: true,
          maxItems: CONDITION_IDS.length,
          items: { enum: [...CONDITION_IDS] },
        },
        items: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['ref'],
            properties: {
              ref: {
                type: 'object',
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'id'],
                    properties: { kind: { const: 'product' }, id: ID },
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'id'],
                    properties: { kind: { const: 'plant' }, id: ID },
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'text'],
                    properties: {
                      kind: { const: 'unrecognised' },
                      text: {
                        type: 'string',
                        minLength: 1,
                        maxLength: MAX_UNRECOGNISED_TEXT,
                        description:
                          'Free text typed by a user. It must not contain personal data. It is never logged and never echoed.',
                      },
                    },
                  },
                ],
                discriminator: { propertyName: 'kind' },
              },
              unitsPerDay: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
              longTerm: { type: 'boolean' },
              strengthUnknown: { type: 'boolean' },
            },
          },
        },
        signs: { type: 'array', maxItems: 64, uniqueItems: true, items: ID },
      },
    },
  },
} as const;

export interface EvaluateRequest {
  pack_version: string;
  context: EvaluationContext;
}

/** A problem of the request: where, and what rule it breaks. Never the value. */
export interface Issue {
  path: string;
  message: string;
}

export type Validated = { ok: true; value: EvaluateRequest } | { ok: false; errors: Issue[] };

const ajv = new Ajv2020({ allErrors: false, strict: true, discriminator: true });
const validate = ajv.compile(REQUEST_SCHEMA);

/** 'context.items[0].ref' from the JSON pointer '/context/items/0/ref'. */
function pathOf(pointer: string): string {
  let result = '';
  for (const raw of pointer.split('/').slice(1)) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    result += /^\d+$/.test(segment) ? `[${segment}]` : `${result === '' ? '' : '.'}${segment}`;
  }
  return result;
}

export function validateRequest(body: unknown): Validated {
  if (validate(body)) return { ok: true, value: body };
  const errors: Issue[] = (validate.errors ?? []).map((error) => {
    const base = pathOf(error.instancePath);
    const params = error.params as Record<string, unknown>;
    // Neither the value nor the name of an unknown key is shown: only where it is.
    if (error.keyword === 'additionalProperties') {
      return { path: base, message: 'unknown property' };
    }
    if (error.keyword === 'required') {
      const key = String(params.missingProperty);
      return { path: base === '' ? key : `${base}.${key}`, message: 'missing required property' };
    }
    return { path: base, message: error.message ?? 'is not valid' };
  });
  return { ok: false, errors };
}
