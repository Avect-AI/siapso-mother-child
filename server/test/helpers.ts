// SPDX-License-Identifier: MIT
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePack } from '@siapso/engine';
import type { Pack } from '@siapso/engine';
import { buildPack, loadContent } from '@siapso/pack-tools';
import { createAuthenticator, hashKey } from '../src/auth.js';
import { createQuota } from '../src/quota.js';
import { createServer } from '../src/server.js';
import type { ServerOptions } from '../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The repository root. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const KEY = 'test-key-1234567890';
export const OTHER_KEY = 'other-key-0987654321';

/** The pack as the server sees it: built from the content, through JSON and parsePack. */
export async function loadTestPack(): Promise<Pack> {
  const built = buildPack(await loadContent(REPO_ROOT));
  return parsePack(JSON.parse(JSON.stringify(built)));
}

export interface Running {
  url: string;
  logs: string[];
  close: () => Promise<void>;
}

export async function start(pack: Pack, overrides: Partial<ServerOptions> = {}): Promise<Running> {
  const logs: string[] = [];
  const server = createServer({
    pack,
    authenticate: createAuthenticator([
      { id: 'test', sha256: hashKey(KEY) },
      { id: 'other', sha256: hashKey(OTHER_KEY) },
    ]),
    quota: createQuota({ limit: 1000, windowMs: 60_000 }),
    log: (line) => logs.push(line),
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

export function post(
  running: Running,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${KEY}` },
): Promise<Response> {
  return fetch(`${running.url}/v1/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
