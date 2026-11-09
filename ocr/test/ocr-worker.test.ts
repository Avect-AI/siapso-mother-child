// SPDX-License-Identifier: MIT
// @vitest-environment node
// The reading worker closes the network as it starts, before any message:
// a parser bug in a reading cannot open a request by another API than the
// pack-only fetch (runtime.test.ts tests closeNetwork itself).
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('closes every network API but the pack fetch as it starts, then says its address', async () => {
  const Open = vi.fn();
  const network = vi.fn(() => Promise.resolve(new Response('from the network')));
  const posted: unknown[] = [];
  vi.stubGlobal('fetch', network);
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']) {
    vi.stubGlobal(name, Open);
  }
  vi.stubGlobal('importScripts', vi.fn());
  vi.stubGlobal('location', { href: 'https://app.test/assets/ocr-worker-AbCd1234.js' });
  vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
  vi.stubGlobal('addEventListener', vi.fn());

  await import('../src/ocr-worker.js');

  const scope = globalThis as unknown as Record<string, unknown>;
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']) {
    const Api = scope[name] as new (url: string) => unknown;
    expect(() => new Api('https://example.org/'), name).toThrow(/closed in the reading worker/);
  }
  expect(() => {
    (scope['importScripts'] as (url: string) => void)('https://example.org/a.js');
  }).toThrow(/closed in the reading worker/);
  await expect(fetch('https://example.org/')).rejects.toThrow(/refused/);
  expect(network).not.toHaveBeenCalled();
  expect(posted).toEqual([
    { type: 'hello', id: 0, url: 'https://app.test/assets/ocr-worker-AbCd1234.js' },
  ]);
});
