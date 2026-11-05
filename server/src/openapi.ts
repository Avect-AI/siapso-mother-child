// SPDX-License-Identifier: MIT
// The OpenAPI 3.1 document, generated from the request schema of the validator
// so that the two cannot drift. `pnpm --filter @siapso/server openapi`
// rewrites server/openapi.yaml; a test fails when the committed file is stale.
import { CHECK_IDS, EVIDENCE_GRADES, LEVELS } from '@siapso/engine';
import { REQUEST_SCHEMA } from './validate.js';

/** Removes the Ajv-only `discriminator` hints (plain oneOf with const tags stays valid). */
function withoutDiscriminator(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDiscriminator);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'discriminator')
      .map(([key, child]) => [key, withoutDiscriminator(child)]),
  );
}

/**
 * The schema as OpenAPI embeds it: without $schema and $id (3.1 sets the
 * dialect itself) and without the `discriminator` hint Ajv uses for precise
 * errors: inline subschemas have no names to map, and the `kind` constants
 * already make the oneOf exclusive.
 */
export function stripSchemaMeta(schema: typeof REQUEST_SCHEMA): Record<string, unknown> {
  const rest = withoutDiscriminator(schema) as Record<string, unknown>;
  delete rest.$schema;
  delete rest.$id;
  return rest;
}

function problemResponse(description: string): unknown {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Problem' } },
    },
  };
}

export function buildOpenApi(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SIAPSO Mother-Child evaluation API',
      version: '0.1.0',
      summary: 'Runs the same deterministic engine as the offline app.',
      description:
        'The engine package is the one the offline app runs, so the same context and pack version give the same Evaluation online and offline. The API never accepts identifying data: every object of the request refuses unknown properties. The only free text is the name of an unrecognised item (80 characters at most); it must not contain personal data, and the server never logs or echoes it.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: 'http://localhost:8080', description: 'Local instance' }],
    security: [],
    paths: {
      '/v1/health': {
        get: {
          operationId: 'getHealth',
          summary: 'Liveness probe. No key needed.',
          responses: {
            '404': problemResponse('No such endpoint (any path that is not listed answers 404).'),
            '405': problemResponse('Wrong method; the Allow header names the right one.'),
            '500': problemResponse('Internal error; the body is generic.'),
            '200': {
              description: 'The service is running.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['status'],
                    properties: { status: { const: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/pack': {
        get: {
          operationId: 'getPack',
          summary: 'Version, date and counts of the loaded knowledge pack. No key needed.',
          responses: {
            '404': problemResponse('No such endpoint (any path that is not listed answers 404).'),
            '405': problemResponse('Wrong method; the Allow header names the right one.'),
            '500': problemResponse('Internal error; the body is generic.'),
            '200': {
              description: 'The loaded pack.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PackSummary' } },
              },
            },
          },
        },
      },
      '/v1/evaluate': {
        post: {
          operationId: 'evaluate',
          summary: 'Evaluates a context with the loaded pack.',
          security: [{ bearerKey: [] }, { apiKeyHeader: [] }],
          requestBody: {
            required: true,
            description: 'At most 16 KiB.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/EvaluateRequest' } },
            },
          },
          responses: {
            '200': {
              description: 'The engine Evaluation.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Evaluation' } },
              },
            },
            '400': problemResponse(
              'Invalid JSON or invalid request. `details` lists the path of each error, never a value.',
            ),
            '401': problemResponse('No valid API key.'),
            '409': problemResponse('`pack_version` differs from the loaded pack (`packVersion`).'),
            '413': problemResponse('The body is over 16 KiB.'),
            '415': problemResponse('The content type is not application/json.'),
            '429': problemResponse('The quota of the key is used up; see the Retry-After header.'),
            '404': problemResponse('No such endpoint (any path that is not listed answers 404).'),
            '405': problemResponse('Wrong method; the Allow header names the right one.'),
            '500': problemResponse('Internal error; the body is generic.'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerKey: { type: 'http', scheme: 'bearer' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        EvaluateRequest: stripSchemaMeta(REQUEST_SCHEMA),
        Problem: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            packVersion: { type: 'string' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                required: ['path', 'message'],
                properties: { path: { type: 'string' }, message: { type: 'string' } },
              },
            },
          },
        },
        PackSummary: {
          type: 'object',
          required: ['version', 'date', 'clinicallyValidated', 'counts'],
          properties: {
            version: { type: 'string' },
            date: { type: 'string' },
            clinicallyValidated: { type: 'boolean' },
            counts: {
              type: 'object',
              required: [
                'substances',
                'classes',
                'products',
                'plants',
                'rules',
                'dangerSigns',
                'sources',
              ],
              additionalProperties: { type: 'integer', minimum: 0 },
            },
          },
        },
        Level: { enum: [...LEVELS] },
        Evidence: { enum: [...EVIDENCE_GRADES] },
        SourceRef: {
          type: 'object',
          required: ['source', 'locator', 'accessed'],
          properties: {
            source: { type: 'string' },
            locator: { type: 'string' },
            url: { type: 'string' },
            accessed: { type: 'string' },
            quote: { type: 'string' },
          },
        },
        Finding: {
          type: 'object',
          required: ['level', 'check', 'items', 'message', 'capped', 'sources'],
          properties: {
            level: { $ref: '#/components/schemas/Level' },
            check: { enum: [...CHECK_IDS] },
            ruleId: { type: 'string' },
            evidence: { $ref: '#/components/schemas/Evidence' },
            items: {
              type: 'array',
              description: 'Indexes of the request items the finding is about.',
              items: { type: 'integer', minimum: 0 },
            },
            message: { type: 'string', description: 'A message id of the pack.' },
            sign: { type: 'string' },
            term: { enum: ['exact', 'estimated', 'unknown'] },
            capped: { type: 'boolean' },
            sources: { type: 'array', items: { $ref: '#/components/schemas/SourceRef' } },
          },
        },
        Reminder: {
          type: 'object',
          required: ['ruleId', 'message', 'sources'],
          properties: {
            ruleId: { type: 'string' },
            message: { type: 'string' },
            sources: { type: 'array', items: { $ref: '#/components/schemas/SourceRef' } },
          },
        },
        Note: {
          allOf: [
            { $ref: '#/components/schemas/Reminder' },
            {
              type: 'object',
              required: ['kind'],
              properties: { kind: { enum: ['contraception', 'dose'] } },
            },
          ],
        },
        Evaluation: {
          type: 'object',
          description: 'The engine Evaluation (engine/src/types.ts).',
          required: ['level', 'findings', 'reminders', 'notes', 'pack'],
          properties: {
            level: { $ref: '#/components/schemas/Level' },
            findings: { type: 'array', items: { $ref: '#/components/schemas/Finding' } },
            reminders: { type: 'array', items: { $ref: '#/components/schemas/Reminder' } },
            notes: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
            pack: {
              type: 'object',
              required: ['version', 'date', 'clinicallyValidated'],
              properties: {
                version: { type: 'string' },
                date: { type: 'string' },
                clinicallyValidated: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  };
}
