// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluate } from '@siapso/engine';
import { contextOf, loadCases } from '@siapso/pack-tools';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildOpenApi, stripSchemaMeta } from '../src/openapi.js';
import { REQUEST_SCHEMA } from '../src/validate.js';
import { loadTestPack, REPO_ROOT } from './helpers.js';

interface Doc {
  openapi: string;
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
}

async function committed(): Promise<Doc> {
  const text = await readFile(path.join(REPO_ROOT, 'server', 'openapi.yaml'), 'utf8');
  return parse(text) as Doc;
}

describe('openapi.yaml', () => {
  it('is the committed output of the generator (run pnpm --filter @siapso/server openapi)', async () => {
    expect(await committed()).toStrictEqual(JSON.parse(JSON.stringify(buildOpenApi())));
  });

  it('is OpenAPI 3.1 and carries the request schema of the validator', async () => {
    const doc = await committed();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.components.schemas.EvaluateRequest).toStrictEqual(
      JSON.parse(JSON.stringify(stripSchemaMeta(REQUEST_SCHEMA))),
    );
  });

  it('documents the three endpoints and the status codes of evaluate', async () => {
    const doc = await committed();
    expect(Object.keys(doc.paths).sort()).toEqual(['/v1/evaluate', '/v1/health', '/v1/pack']);
    expect(Object.keys(doc.paths['/v1/evaluate']?.post?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '405',
      '409',
      '413',
      '415',
      '429',
      '500',
    ]);
  });

  it('describes the Evaluation the engine returns, for every reference case', async () => {
    const doc = await committed();
    const ajv = new Ajv2020({ strict: false });
    const check = ajv.compile({
      $ref: '#/components/schemas/Evaluation',
      components: doc.components,
    });
    const pack = await loadTestPack();
    const loaded = await loadCases(REPO_ROOT);
    expect(loaded.cases.length).toBeGreaterThanOrEqual(15);
    for (const reference of loaded.cases) {
      const evaluation: unknown = JSON.parse(JSON.stringify(evaluate(pack, contextOf(reference))));
      expect(check(evaluation), `${reference.id} ${JSON.stringify(check.errors)}`).toBe(true);
    }
    expect(check({ level: 'x' })).toBe(false);
  });

  it('documents every field of a Finding, the window start of the look-ahead included', async () => {
    const doc = await committed();
    const finding = doc.components.schemas.Finding as { properties: Record<string, unknown> };
    expect(Object.keys(finding.properties).sort()).toEqual(
      [
        'capped',
        'check',
        'evidence',
        'items',
        'level',
        'message',
        'ruleId',
        'sign',
        'sources',
        'term',
        'windowStart',
      ].sort(),
    );
  });

  it('has no inline discriminator in the request schema', async () => {
    const text = await readFile(path.join(REPO_ROOT, 'server', 'openapi.yaml'), 'utf8');
    expect(text).not.toContain('discriminator');
  });
});
