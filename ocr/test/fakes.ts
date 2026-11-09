// SPDX-License-Identifier: MIT
// Test doubles for the browser APIs used by the reading pack: fetch with
// streamed bodies and abort, and the Cache API (the same as speech/test).

function keyOf(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

export class FakeCache {
  readonly entries = new Map<string, { body: ArrayBuffer; headers: Headers }>();

  match(request: RequestInfo | URL): Promise<Response | undefined> {
    const entry = this.entries.get(keyOf(request));
    return Promise.resolve(
      entry === undefined
        ? undefined
        : new Response(entry.body.slice(0), { headers: entry.headers }),
    );
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    // The real Cache API reads the whole body before storing it.
    const body = await response.arrayBuffer();
    this.entries.set(keyOf(request), { body, headers: new Headers(response.headers) });
  }

  delete(request: RequestInfo | URL): Promise<boolean> {
    return Promise.resolve(this.entries.delete(keyOf(request)));
  }

  /** The requests stored, as the Cache API gives them. */
  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((url) => new Request(url)));
  }

  /** The URLs stored, sorted (for assertions). */
  urls(): string[] {
    return [...this.entries.keys()].sort();
  }
}

export class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (cache === undefined) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return Promise.resolve(cache);
  }

  has(name: string): Promise<boolean> {
    return Promise.resolve(this.caches.has(name));
  }
}

export interface FakeFile {
  body: Uint8Array;
  status?: number;
  /** Bytes per streamed chunk (default 1000). */
  chunk?: number;
}

/** A fetch that serves `files` by absolute URL, streams bodies in chunks and honours AbortSignal. */
export function fakeFetch(files: Record<string, FakeFile | string>) {
  const requests: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = keyOf(input);
    requests.push(url);
    inits.push(init);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted)
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    const file = files[url];
    if (file === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    const {
      body,
      status = 200,
      chunk = 1000,
    } = typeof file === 'string' ? { body: new TextEncoder().encode(file) } : file;
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (signal?.aborted) {
          controller.error(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        if (offset >= body.length) {
          controller.close();
          return;
        }
        controller.enqueue(body.slice(offset, offset + chunk));
        offset += chunk;
      },
    });
    return Promise.resolve(
      new Response(stream, {
        status,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(body.length),
        },
      }),
    );
  };
  return { fetch, requests, inits };
}

export function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) % 251;
  return out;
}
