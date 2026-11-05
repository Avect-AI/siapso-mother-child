// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQuota } from '../src/quota.js';
import { KEY, loadTestPack, OTHER_KEY, post, start } from './helpers.js';
import type { Running } from './helpers.js';

let pack: Pack;
let running: Running;

beforeAll(async () => {
  pack = await loadTestPack();
  running = await start(pack);
});
afterAll(async () => {
  await running.close();
});

function request(version = pack.version, context: unknown = {}): unknown {
  return {
    pack_version: version,
    context: { conditions: [], items: [], signs: [], ...(context as object) },
  };
}

describe('GET /v1/health and /v1/pack', () => {
  it('answers health without a key', async () => {
    const response = await fetch(`${running.url}/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('describes the loaded pack', async () => {
    const response = await fetch(`${running.url}/v1/pack`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: pack.version,
      date: pack.date,
      clinicallyValidated: pack.clinicallyValidated,
      counts: {
        substances: pack.substances.length,
        classes: pack.classes.length,
        products: pack.products.length,
        plants: pack.plants.length,
        rules: pack.rules.length,
        dangerSigns: pack.dangerSigns.length,
        sources: pack.sources.length,
      },
    });
  });

  it('answers 404 for an unknown path and 405 for a wrong method', async () => {
    expect((await fetch(`${running.url}/v1/nothing`)).status).toBe(404);
    expect((await fetch(`${running.url}/v1/evaluate`)).status).toBe(405);
    const health = await fetch(`${running.url}/v1/health`, { method: 'POST' });
    expect(health.status).toBe(405);
    expect(health.headers.get('allow')).toBe('GET');
  });
});

describe('POST /v1/evaluate', () => {
  it('answers 200 with the evaluation for a valid key', async () => {
    const response = await post(running, request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { level: string; pack: { version: string } };
    expect(body.pack.version).toBe(pack.version);
    expect(body.level).toBeTypeOf('string');
  });

  it('accepts the key in X-API-Key too', async () => {
    const response = await post(running, request(), { 'x-api-key': OTHER_KEY });
    expect(response.status).toBe(200);
  });

  it('answers 401 without a valid key, before reading the body', async () => {
    for (const headers of [
      {},
      { authorization: 'Bearer wrong' },
      { authorization: KEY },
      { 'x-api-key': 'wrong' },
    ]) {
      const response = await post(running, request(), headers);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(await response.json()).toEqual({
        error: 'unauthorized',
        message: 'A valid API key is required.',
      });
    }
  });

  it('answers 409 when the pack version differs', async () => {
    const response = await post(running, request('0.0.0-other'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'pack_version_mismatch',
      message: 'The request was made for another pack version.',
      packVersion: pack.version,
    });
  });

  it('answers 400 with the error path and no value', async () => {
    const secret = 'Fatou-Sow-0771234567';
    const response = await post(running, {
      pack_version: pack.version,
      context: {
        conditions: [],
        signs: [],
        items: [{ ref: { kind: 'unrecognised', text: secret.repeat(5) } }],
      },
    });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain('Fatou');
    const body = JSON.parse(text) as { error: string; details: { path: string }[] };
    expect(body.error).toBe('invalid_request');
    expect(body.details[0]?.path).toBe('context.items[0].ref.text');
  });

  it('rejects every identifying field with 400 and never echoes it', async () => {
    const identifying = {
      name: 'Fatou Sow',
      phone: '+221771234567',
      address: 'Rue 10 Medina',
      dateOfBirth: '1992-02-03',
      notes: 'free text',
    };
    for (const [key, value] of Object.entries(identifying)) {
      for (const target of ['top', 'context']) {
        const body = request() as { context: Record<string, unknown> } & Record<string, unknown>;
        (target === 'top' ? body : body.context)[key] = value;
        const response = await post(running, body);
        expect(response.status, `${target}.${key}`).toBe(400);
        const text = await response.text();
        expect(text).not.toContain(value);
      }
    }
  });

  it('answers 400 on invalid JSON and 415 on another content type', async () => {
    const invalid = await post(running, '{not json');
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'invalid_json',
      message: 'The body is not valid JSON.',
    });
    const other = await fetch(`${running.url}/v1/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', authorization: `Bearer ${KEY}` },
      body: 'x',
    });
    expect(other.status).toBe(415);
  });

  it('answers 413 above the body limit', async () => {
    const limited = await start(pack, { maxBodyBytes: 512 });
    try {
      const big = request(pack.version, {
        signs: new Array<string>(200).fill('bleeding'),
      });
      const response = await post(limited, big);
      expect(response.status).toBe(413);
      expect((await response.json()) as { error: string }).toMatchObject({
        error: 'payload_too_large',
      });
      expect((await post(limited, request())).status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('answers 429 above the quota of a key, per key, with Retry-After', async () => {
    let now = 0;
    const limited = await start(pack, {
      quota: createQuota({ limit: 2, windowMs: 60_000, now: () => now }),
    });
    try {
      expect((await post(limited, request())).status).toBe(200);
      expect((await post(limited, request())).status).toBe(200);
      const refused = await post(limited, request());
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('60');
      expect((await refused.json()) as { error: string }).toMatchObject({
        error: 'quota_exceeded',
      });
      const other = await post(limited, request(), { authorization: `Bearer ${OTHER_KEY}` });
      expect(other.status).toBe(200);
      now = 61_000;
      expect((await post(limited, request())).status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('does not count a request without a valid key against any quota', async () => {
    const limited = await start(pack, {
      quota: createQuota({ limit: 1, windowMs: 60_000 }),
    });
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await post(limited, request(), { authorization: 'Bearer wrong' })).status).toBe(
          401,
        );
      }
      expect((await post(limited, request())).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('logging', () => {
  it('logs method, path, status and latency only', async () => {
    const logged = await start(pack);
    try {
      const secretText = 'Mariama-Ba-0779999999';
      await post(logged, {
        pack_version: pack.version,
        context: {
          conditions: [],
          signs: [],
          items: [{ ref: { kind: 'unrecognised', text: secretText } }],
        },
      });
      await post(logged, request(), { authorization: 'Bearer leaked-key-value' });
      await fetch(`${logged.url}/v1/health?name=${secretText}`);
      await fetch(`${logged.url}/v1/secret-path-${secretText}`);
      expect(logged.logs).toHaveLength(4);
      const entries = logged.logs.map((line) => JSON.parse(line) as Record<string, unknown>);
      for (const entry of entries) {
        expect(Object.keys(entry).sort()).toEqual(['latencyMs', 'method', 'path', 'status']);
        expect(entry.latencyMs).toBeTypeOf('number');
      }
      expect(entries.map((e) => [e.method, e.path, e.status])).toEqual([
        ['POST', '/v1/evaluate', 200],
        ['POST', '/v1/evaluate', 401],
        ['GET', '/v1/health', 200],
        ['GET', '-', 404],
      ]);
      const all = logged.logs.join('\n');
      for (const forbidden of ['Mariama', 'leaked-key', KEY, '0779999999']) {
        expect(all).not.toContain(forbidden);
      }
    } finally {
      await logged.close();
    }
  });
});
