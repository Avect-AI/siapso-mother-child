// SPDX-License-Identifier: MIT
// Hostile and broken clients: malformed request targets, garbage bytes, bodies
// that are never read or never finish, aborted requests, engine failures.
import net from 'node:net';
import type { Pack } from '@siapso/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KEY, loadTestPack, post, start } from './helpers.js';
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

function portOf(r: Running): number {
  return Number(new URL(r.url).port);
}

interface Exchange {
  text: string;
  closed: boolean;
}

/** Writes raw bytes, collects the answer, and says whether the server closed the socket. */
function raw(r: Running, bytes: string, waitMs = 1500): Promise<Exchange> {
  return new Promise((resolve) => {
    const socket = net.connect(portOf(r), '127.0.0.1');
    let text = '';
    let closed = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (text += chunk));
    socket.on('error', () => undefined);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ text, closed });
    }, waitMs);
    socket.on('close', () => {
      closed = true;
      clearTimeout(timer);
      resolve({ text, closed });
    });
    socket.on('connect', () => {
      socket.write(bytes);
    });
  });
}

async function alive(r: Running): Promise<boolean> {
  return (await fetch(`${r.url}/v1/health`)).status === 200;
}

describe('malformed request targets', () => {
  it('do not crash the process and do not reach the logs', async () => {
    for (const target of ['//[', 'http://[', '/%', '*', 'x', '//']) {
      const result = await raw(running, `GET ${target} HTTP/1.1\r\nHost: x\r\n\r\n`, 400);
      expect(result.text, target).toMatch(/^HTTP\/1\.1 (400|404) /);
      expect(await alive(running), target).toBe(true);
    }
    for (const line of running.logs) {
      expect((JSON.parse(line) as { path: string }).path).not.toMatch(/\[/);
    }
    expect(running.logs.join('')).not.toContain('http://');
  });

  it('answer 400 to bytes that are not HTTP, and stay up', async () => {
    const result = await raw(running, '\u0001\u0002 junk\r\n\r\n', 400);
    expect(result.text).toMatch(/^HTTP\/1\.1 400 /);
    expect(await alive(running)).toBe(true);
  });
});

describe('refusals before the body is read', () => {
  it('close the connection after a 401 and stop reading a chunked body', async () => {
    const result = await raw(
      running,
      'POST /v1/evaluate HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n',
      800,
    );
    expect(result.text).toMatch(/^HTTP\/1\.1 401 /);
    expect(result.text.toLowerCase()).toContain('connection: close');
    expect(result.closed).toBe(true);
  });

  it('close the connection after 415, 404 and 405 too', async () => {
    const head = (line: string, extra: string): string =>
      `${line} HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n${extra}\r\n`;
    for (const [bytes, status] of [
      [
        head('POST /v1/evaluate', `Authorization: Bearer ${KEY}\r\nContent-Type: text/plain\r\n`),
        415,
      ],
      [head('POST /v1/nothing', ''), 404],
      [head('POST /v1/health', ''), 405],
    ] as const) {
      const result = await raw(running, bytes + 'abc', 800);
      expect(result.text).toMatch(new RegExp(`^HTTP/1\\.1 ${String(status)} `));
      expect(result.closed, String(status)).toBe(true);
    }
  });
});

describe('timeouts', () => {
  it('cut a body that never finishes at the request timeout', async () => {
    const slow = await start(pack, { requestTimeoutMs: 300, checkIntervalMs: 50 });
    try {
      const started = Date.now();
      const result = await raw(
        slow,
        `POST /v1/evaluate HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${KEY}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"pa`,
        3000,
      );
      expect(result.closed).toBe(true);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await slow.close();
    }
  });

  it('applies the request timeout within seconds with the default check interval', async () => {
    const slow = await start(pack, { requestTimeoutMs: 1500 });
    try {
      const started = Date.now();
      const result = await raw(
        slow,
        `POST /v1/evaluate HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${KEY}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"pa`,
        8000,
      );
      expect(result.closed).toBe(true);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await slow.close();
    }
  }, 15_000);

  it('refuse connections above maxConnections', async () => {
    const small = await start(pack, { maxConnections: 1 });
    try {
      const held = net.connect(portOf(small), '127.0.0.1');
      await new Promise((resolve) => held.on('connect', resolve));
      const second = await raw(small, 'GET /v1/health HTTP/1.1\r\nHost: x\r\n\r\n', 500);
      expect(second.text).not.toMatch(/200 OK/);
      held.destroy();
    } finally {
      await small.close();
    }
  });
});

describe('aborted requests', () => {
  it('are logged with status "-"', async () => {
    const logged = await start(pack);
    try {
      await raw(
        logged,
        `POST /v1/evaluate HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${KEY}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"pa`,
        300,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(logged.logs).toHaveLength(1);
      expect(JSON.parse(logged.logs[0] ?? '{}')).toMatchObject({
        method: 'POST',
        path: '/v1/evaluate',
        status: '-',
      });
    } finally {
      await logged.close();
    }
  });
});

describe('engine failures', () => {
  const ok = (): unknown => ({
    pack_version: pack.version,
    context: { conditions: [], items: [], signs: [] },
  });

  it('maps a RangeError of the engine to 400 without its message', async () => {
    for (const error of [new RangeError('Awa 0770000000')]) {
      const r = await start(pack, {
        evaluate: () => {
          throw error;
        },
      });
      try {
        const response = await post(r, ok());
        expect(response.status).toBe(400);
        const text = await response.text();
        expect(text).not.toContain('Awa');
      } finally {
        await r.close();
      }
    }
  });

  it('maps a TypeError and any other failure to a generic 500 and stays up', async () => {
    for (const error of [new TypeError('Awa 0770000000'), new Error('stack with Awa 0770000000')]) {
      const r = await start(pack, {
        evaluate: () => {
          throw error;
        },
      });
      try {
        const response = await post(r, ok());
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ error: 'internal_error', message: 'Internal error.' });
        expect(await alive(r)).toBe(true);
      } finally {
        await r.close();
      }
    }
  });
});

describe('request details', () => {
  it('reads the Bearer scheme case-insensitively', async () => {
    for (const scheme of ['bearer', 'BEARER', 'Bearer']) {
      const response = await post(
        running,
        { pack_version: pack.version, context: { conditions: [], items: [], signs: [] } },
        {
          authorization: `${scheme} ${KEY}`,
        },
      );
      expect(response.status, scheme).toBe(200);
    }
  });

  it('does not echo the name of an unknown property', async () => {
    const response = await post(running, {
      pack_version: pack.version,
      mariama_sow_0770000000: 1,
      context: { conditions: [], items: [], signs: [], awa_diop: 'x' },
    });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toMatch(/mariama|awa|0770/);
    expect(text).toContain('unknown property');
  });
});
