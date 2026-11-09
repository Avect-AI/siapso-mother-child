// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_READ_TIMEOUT_MS, OCR_IDLE_MS, createOcrClient } from '../src/client.js';
import { OCR_CACHE, ORT_WEB_VERSION, PDFJS_VERSION, type OcrPackInfo } from '../src/ocr-pack.js';
import type { WorkerRequest, WorkerResponse } from '../src/protocol.js';
import { FakeCacheStorage } from './fakes.js';

const BASE = 'https://app.test/ocr/ppocrv5-mobile-latin/';
const INFO: OcrPackInfo = {
  id: 'ppocrv5-mobile-latin',
  baseUrl: BASE,
  files: [
    { path: 'models/det.onnx', bytes: 3, sha256: 'a'.repeat(64) },
    { path: 'models/rec-latin.onnx', bytes: 3, sha256: 'b'.repeat(64) },
  ],
  totalBytes: 6,
  licence: 'Apache-2.0 AND MIT',
  models: {
    detection: { repo: 'd', revision: 'e'.repeat(40), licence: 'Apache-2.0' },
    recognition: { repo: 'r', revision: 'f'.repeat(40), licence: 'Apache-2.0' },
  },
  runtime: { onnxruntime: ORT_WEB_VERSION, pdfjs: PDFJS_VERSION },
};

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: { message: WorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.all.push(this);
  }

  postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  answer(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }

  /** Answers the last read with lines. */
  result(lines: string[] = ['Doliprane 1000 mg']) {
    const id = this.posted.at(-1)?.message.id ?? -1;
    this.answer({ type: 'result', id, lines, source: 'image', pages: 1, ms: 12, loadMs: 0 });
  }
}

const PNG_HEAD = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4,
  0xb0, 0, 0, 6, 0x40, 8, 6, 0, 0, 0,
]);
const photo = () => new Blob([PNG_HEAD], { type: 'image/png' });

let storage: FakeCacheStorage;
let network: ReturnType<typeof vi.fn>;

async function install(): Promise<void> {
  const cache = await storage.open(OCR_CACHE);
  for (const file of INFO.files) await cache.put(BASE + file.path, new Response('abc'));
}

/** Lets the client's awaits (cache, file head) run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  FakeWorker.all = [];
  storage = new FakeCacheStorage();
  network = vi.fn(() => Promise.reject(new Error('no network in this test')));
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('before the pack is installed', () => {
  it('starts no worker and asks the network nothing, at creation and at a reading', async () => {
    const client = createOcrClient(INFO);
    expect(FakeWorker.all).toHaveLength(0);
    await expect(client.read(photo())).rejects.toMatchObject({ reason: 'unavailable' });
    expect(FakeWorker.all).toHaveLength(0);
    expect(network).not.toHaveBeenCalled();
  });
});

describe('a reading', () => {
  beforeEach(install);

  it('sends the file to one worker and gives back its lines, with the progress', async () => {
    const client = createOcrClient(INFO);
    const progress: number[] = [];
    const reading = client.read(photo(), { onProgress: (p) => progress.push(p) });
    await settle();
    const [worker] = FakeWorker.all;
    expect(worker?.options).toMatchObject({ type: 'module' });
    const sent = worker?.posted[0]?.message;
    expect(sent).toMatchObject({
      type: 'read',
      baseUrl: BASE,
      files: ['models/det.onnx', 'models/rec-latin.onnx'],
    });
    expect(sent?.input).toBeInstanceOf(Blob);
    worker?.answer({ type: 'progress', id: sent?.id ?? 0, stage: 'load', progress: 0.5 });
    worker?.answer({ type: 'progress', id: sent?.id ?? 0, stage: 'read', progress: 0.5 });
    worker?.result(['ORDONNANCE', 'Doliprane 1000 mg']);
    expect(await reading).toEqual({
      lines: ['ORDONNANCE', 'Doliprane 1000 mg'],
      source: 'image',
      pages: 1,
      ms: 12,
    });
    // Loading counts for the first fifth, the reading for the rest.
    expect(progress).toHaveLength(2);
    expect(progress[0]).toBeCloseTo(0.1, 9);
    expect(progress[1]).toBeCloseTo(0.6, 9);
    expect(network).not.toHaveBeenCalled();
  });

  it('transfers a camera frame, so the page keeps no copy', async () => {
    class FakeBitmap {
      close = vi.fn();
    }
    vi.stubGlobal('ImageBitmap', FakeBitmap);
    const client = createOcrClient(INFO);
    const frame = new FakeBitmap();
    const reading = client.read(frame as unknown as ImageBitmap);
    await settle();
    const [worker] = FakeWorker.all;
    expect(worker?.posted[0]?.transfer).toEqual([frame]);
    worker?.result();
    await reading;
  });

  it('refuses a file that is not a photo nor a PDF, or too large, without starting the models', async () => {
    const client = createOcrClient(INFO);
    await expect(client.read(new Blob(['Doliprane 1000 mg']))).rejects.toMatchObject({
      reason: 'not-image',
    });
    const huge = { size: 30 * 1024 * 1024, slice: () => photo() } as unknown as Blob;
    await expect(client.read(huge)).rejects.toMatchObject({ reason: 'too-large' });
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('says why the worker failed', async () => {
    const client = createOcrClient(INFO);
    const reading = client.read(photo());
    await settle();
    const [worker] = FakeWorker.all;
    worker?.answer({
      type: 'error',
      id: worker.posted[0]?.message.id ?? 0,
      reason: 'pdf-password',
      message: 'locked',
    });
    await expect(reading).rejects.toMatchObject({ name: 'OcrPackError', reason: 'pdf-password' });
  });

  it('reads one file at a time, in order', async () => {
    const client = createOcrClient(INFO);
    const first = client.read(photo());
    const second = client.read(photo());
    await settle();
    const [worker] = FakeWorker.all;
    expect(worker?.posted).toHaveLength(1);
    worker?.result(['one']);
    await first;
    await settle();
    expect(worker?.posted).toHaveLength(2);
    worker?.result(['two']);
    expect((await second).lines).toEqual(['two']);
  });

  it('gives up after the time limit, ends the worker and starts a new one for the next reading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const client = createOcrClient(INFO, { timeoutMs: 1000 });
    const reading = client.read(photo());
    const failed = expect(reading).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1001);
    await failed;
    expect(FakeWorker.all[0]?.terminated).toBe(true);
    const next = client.read(photo());
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1]?.result();
    await next;
    expect(DEFAULT_READ_TIMEOUT_MS).toBe(90_000);
  });

  it('cancels at any time: the reading stops with its worker', async () => {
    const client = createOcrClient(INFO);
    const reading = client.read(photo());
    await settle();
    client.cancel();
    await expect(reading).rejects.toMatchObject({ reason: 'cancelled' });
    expect(FakeWorker.all[0]?.terminated).toBe(true);

    const controller = new AbortController();
    const again = client.read(photo(), { signal: controller.signal });
    await settle();
    controller.abort();
    await expect(again).rejects.toMatchObject({ reason: 'cancelled' });
    expect(FakeWorker.all[1]?.terminated).toBe(true);
  });

  it('frees the models some minutes after the last reading, and at once when asked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const client = createOcrClient(INFO);
    const reading = client.read(photo());
    await vi.advanceTimersByTimeAsync(0);
    FakeWorker.all[0]?.result();
    await reading;
    await vi.advanceTimersByTimeAsync(OCR_IDLE_MS - 1);
    expect(FakeWorker.all[0]?.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWorker.all[0]?.terminated).toBe(true);
    expect(OCR_IDLE_MS).toBe(180_000);

    const next = client.read(photo());
    await vi.advanceTimersByTimeAsync(0);
    FakeWorker.all[1]?.result();
    await next;
    client.release();
    expect(FakeWorker.all[1]?.terminated).toBe(true);
  });

  it('starts a new worker after a crash, and refuses everything once disposed', async () => {
    const client = createOcrClient(INFO);
    const reading = client.read(photo());
    await settle();
    FakeWorker.all[0]?.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(reading).rejects.toMatchObject({ reason: 'load' });
    const next = client.read(photo());
    await settle();
    expect(FakeWorker.all).toHaveLength(2);
    client.dispose();
    await expect(next).rejects.toMatchObject({ reason: 'cancelled' });
    await expect(client.read(photo())).rejects.toMatchObject({ reason: 'cancelled' });
  });
});
