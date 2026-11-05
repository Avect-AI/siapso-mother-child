// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REQUEST_TIMEOUT_MS, createSpeechClient } from '../src/client.js';
import type { WorkerRequest, WorkerResponse } from '../src/protocol.js';
import {
  ORT_WEB_VERSION,
  VOICE_CACHE,
  VoicePackError,
  type VoicePackInfo,
} from '../src/voice-pack.js';
import { FakeCacheStorage } from './fakes.js';

const INFO: VoicePackInfo = {
  id: 'whisper-small-wolof-q8',
  baseUrl: 'https://app.test/voice/whisper-small-wolof-q8/',
  files: [
    { path: 'config.json', bytes: 10 },
    { path: 'onnx/encoder_model_quantized.onnx', bytes: 100 },
  ],
  totalBytes: 110,
  licence: 'MIT',
  languages: ['wo', 'fr'],
  prompts: { wo: [50258], fr: [50258, 50265, 50359, 50363] },
  runtime: ORT_WEB_VERSION,
};

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: { message: WorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor(
    readonly url: URL | string,
    readonly options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  /** Sends a message from the worker to the page. */
  reply(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }

  crash(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }

  lastPosted(): { message: WorkerRequest; transfer: Transferable[] } {
    const entry = this.posted.at(-1);
    if (entry === undefined) throw new Error('nothing posted');
    return entry;
  }

  last(): WorkerRequest {
    return this.lastPosted().message;
  }

  transcribes(): WorkerRequest[] {
    return this.posted.map((p) => p.message).filter((m) => m.type === 'transcribe');
  }
}

function worker(): FakeWorker {
  const instance = FakeWorker.instances[0];
  if (instance === undefined) throw new Error('no worker');
  return instance;
}

/** The worker spawned last (a new one after a timeout or a cancel). */
function latest(): FakeWorker {
  const instance = FakeWorker.instances.at(-1);
  if (instance === undefined) throw new Error('no worker');
  return instance;
}

/** Lets the client run until its next postMessage. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let storage: FakeCacheStorage;

async function installPack() {
  const cache = await storage.open(VOICE_CACHE);
  for (const file of INFO.files) {
    await cache.put(
      new URL(file.path, INFO.baseUrl).href,
      new Response(new Uint8Array(file.bytes)),
    );
  }
}

/** Loads the client: waits for the load request and answers it. */
async function loaded(
  client: ReturnType<typeof createSpeechClient>,
  device: 'wasm' | 'webgpu' = 'wasm',
) {
  const loading = client.load();
  await tick();
  worker().reply({ type: 'loaded', id: worker().last().id, device });
  await loading;
}

beforeEach(async () => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  storage = new FakeCacheStorage();
  vi.stubGlobal('caches', storage);
  await installPack();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createSpeechClient', () => {
  it('spawns a module worker', () => {
    createSpeechClient(INFO);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(String(worker().url)).toMatch(/worker\.(ts|js)$/);
    expect(worker().options).toEqual({ type: 'module', name: 'siapso-speech' });
  });

  it('tells the address of the worker script it runs, as the worker says it', async () => {
    const client = createSpeechClient(INFO);
    const url = client.scriptUrl();
    worker().reply({ type: 'hello', id: 0, url: 'https://app.test/assets/worker-Ab1.js' });
    expect(await url).toBe('https://app.test/assets/worker-Ab1.js');
    // Asked again: the same, at once.
    expect(await client.scriptUrl()).toBe('https://app.test/assets/worker-Ab1.js');
  });

  it('asks the new worker for its address after a restart', async () => {
    const client = createSpeechClient(INFO);
    worker().reply({ type: 'hello', id: 0, url: 'https://app.test/assets/worker-old.js' });
    const transcription = client.transcribe(new Float32Array(1)).catch(() => undefined);
    await tick();
    worker().reply({ type: 'loaded', id: worker().last().id, device: 'wasm' });
    await tick();
    client.cancel();
    await transcription;
    const url = client.scriptUrl();
    latest().reply({ type: 'hello', id: 0, url: 'https://app.test/assets/worker-new.js' });
    expect(await url).toBe('https://app.test/assets/worker-new.js');
  });

  it('gives no address when the worker script cannot start', async () => {
    const client = createSpeechClient(INFO);
    const url = client.scriptUrl();
    worker().crash('could not load');
    await expect(url).rejects.toThrow(/stopped/);
  });

  it('loads the pack in the worker and reports progress', async () => {
    const client = createSpeechClient(INFO);
    const progress: number[] = [];
    const loading = client.load((p) => progress.push(p));
    await tick();
    const request = worker().last();
    expect(request).toEqual({
      type: 'load',
      id: expect.any(Number) as number,
      baseUrl: INFO.baseUrl,
      files: INFO.files,
    });
    worker().reply({ type: 'progress', id: request.id, progress: 0.25 });
    worker().reply({ type: 'progress', id: request.id, progress: 1 });
    worker().reply({ type: 'loaded', id: request.id, device: 'wasm' });
    await loading;
    expect(progress).toEqual([0.25, 1]);
  });

  it('never asks the worker to load a pack that is not installed (no download behind the user)', async () => {
    const cache = await storage.open(VOICE_CACHE);
    await cache.delete(new URL('onnx/encoder_model_quantized.onnx', INFO.baseUrl).href);
    const client = createSpeechClient(INFO);
    const loading = client.load();
    await expect(loading).rejects.toBeInstanceOf(VoicePackError);
    await expect(loading).rejects.toMatchObject({ reason: 'unavailable' });
    expect(worker().posted).toHaveLength(0);
  });

  it('tells which device the worker chose once loaded', async () => {
    const client = createSpeechClient(INFO);
    expect(client.device).toBeUndefined();
    await loaded(client, 'webgpu');
    expect(client.device).toBe('webgpu');
  });

  it('loads once, however many times load is called', async () => {
    const client = createSpeechClient(INFO);
    const first = client.load();
    const second = client.load();
    await tick();
    expect(worker().posted).toHaveLength(1);
    worker().reply({ type: 'loaded', id: worker().last().id, device: 'wasm' });
    await Promise.all([first, second]);
    await client.load();
    expect(worker().posted).toHaveLength(1);
  });

  it('transfers the samples to the worker and returns the text and the time', async () => {
    const client = createSpeechClient(INFO);
    await loaded(client);

    const samples = new Float32Array([0.1, 0.2, 0.3]);
    const transcription = client.transcribe(samples, { language: 'fr' });
    await tick();
    const { message, transfer } = worker().lastPosted();
    // The French prompt of the pack: <|startoftranscript|><|fr|><|transcribe|><|notimestamps|>.
    expect(message).toMatchObject({ type: 'transcribe', prompt: [50258, 50265, 50359, 50363] });
    expect(message.type === 'transcribe' && Array.from(message.samples)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
    // The buffer moves to the worker: the page keeps no copy of the audio.
    expect(transfer).toEqual([message.type === 'transcribe' ? message.samples.buffer : null]);
    worker().reply({ type: 'result', id: message.id, text: 'nebeday', ms: 1234 });
    expect(await transcription).toEqual({ text: 'nebeday', ms: 1234 });
  });

  it('loads first when transcribe is called before load', async () => {
    const client = createSpeechClient(INFO);
    const transcription = client.transcribe(new Float32Array(4));
    await tick();
    expect(worker().last().type).toBe('load');
    worker().reply({ type: 'loaded', id: worker().last().id, device: 'webgpu' });
    await tick();
    const request = worker().last();
    // The first language of the pack (Wolof) by default.
    expect(request).toMatchObject({ type: 'transcribe', prompt: [50258] });
    worker().reply({ type: 'result', id: request.id, text: 'moringa', ms: 10 });
    expect((await transcription).text).toBe('moringa');
  });

  it('sends one transcription at a time, in order', async () => {
    const client = createSpeechClient(INFO);
    await loaded(client);
    const a = client.transcribe(new Float32Array(1));
    const b = client.transcribe(new Float32Array(2));
    await tick();
    expect(worker().transcribes()).toHaveLength(1);
    worker().reply({ type: 'result', id: worker().last().id, text: 'a', ms: 1 });
    expect(await a).toEqual({ text: 'a', ms: 1 });
    await tick();
    expect(worker().transcribes()).toHaveLength(2);
    worker().reply({ type: 'result', id: worker().last().id, text: 'b', ms: 2 });
    expect(await b).toEqual({ text: 'b', ms: 2 });
  });

  it('goes on with the next transcription when one fails', async () => {
    const client = createSpeechClient(INFO);
    await loaded(client);
    const a = client.transcribe(new Float32Array(1));
    const b = client.transcribe(new Float32Array(2));
    await tick();
    worker().reply({ type: 'error', id: worker().last().id, code: 'transcribe', message: 'boom' });
    await expect(a).rejects.toMatchObject({ reason: 'transcribe', message: 'boom' });
    await tick();
    worker().reply({ type: 'result', id: worker().last().id, text: 'b', ms: 2 });
    expect((await b).text).toBe('b');
  });

  it('refuses a language the pack does not transcribe', async () => {
    const client = createSpeechClient(INFO);
    await expect(client.transcribe(new Float32Array(1), { language: 'en' })).rejects.toThrow(/en/);
    expect(worker().posted).toHaveLength(0);
  });

  it.each(['unavailable', 'load', 'storage'] as const)(
    'rejects a failed load with the worker reason %s',
    async (code) => {
      const client = createSpeechClient(INFO);
      const loading = client.load();
      await tick();
      worker().reply({ type: 'error', id: worker().last().id, code, message: 'file missing' });
      await expect(loading).rejects.toBeInstanceOf(VoicePackError);
      await expect(loading).rejects.toMatchObject({ reason: code, message: 'file missing' });
    },
  );

  it('can load again after a failed load', async () => {
    const client = createSpeechClient(INFO);
    const failed = client.load();
    await tick();
    worker().reply({ type: 'error', id: worker().last().id, code: 'load', message: 'offline' });
    await expect(failed).rejects.toThrow('offline');
    const retry = client.load();
    await tick();
    expect(worker().posted).toHaveLength(2);
    worker().reply({ type: 'loaded', id: worker().last().id, device: 'wasm' });
    await retry;
  });

  it('rejects what is pending when the worker crashes, and starts a new worker for the next call', async () => {
    const client = createSpeechClient(INFO);
    const loading = client.load();
    await tick();
    worker().crash('out of memory');
    await expect(loading).rejects.toMatchObject({ reason: 'load', message: /out of memory/ });
    expect(worker().terminated).toBe(true);

    const transcription = client.transcribe(new Float32Array(1));
    await tick();
    expect(latest()).not.toBe(worker());
    latest().reply({ type: 'loaded', id: latest().last().id, device: 'wasm' });
    await tick();
    latest().reply({ type: 'result', id: latest().last().id, text: 'nebeday', ms: 1 });
    expect((await transcription).text).toBe('nebeday');
  });

  it('gives the transcribe reason when the worker crashes during a transcription', async () => {
    const client = createSpeechClient(INFO);
    await loaded(client);
    const transcription = client.transcribe(new Float32Array(1));
    await tick();
    worker().crash('out of memory');
    await expect(transcription).rejects.toMatchObject({ reason: 'transcribe' });
  });

  it('says so when the worker script cannot be loaded (an error event without a message)', async () => {
    const client = createSpeechClient(INFO);
    const loading = client.load();
    await tick();
    worker().onerror?.({ message: undefined } as unknown as ErrorEvent);
    await expect(loading).rejects.toThrow('The speech worker stopped: it could not be started.');
  });

  it('rejects what is pending when a worker message cannot be read', async () => {
    const client = createSpeechClient(INFO);
    await loaded(client);
    const transcription = client.transcribe(new Float32Array(1));
    await tick();
    worker().onmessageerror?.({} as MessageEvent);
    await expect(transcription).rejects.toMatchObject({ reason: 'transcribe' });
  });

  it(`times out a request after ${String(DEFAULT_REQUEST_TIMEOUT_MS)} ms by default`, async () => {
    // About 1.5 times the 123 s measured for one utterance on one thread with
    // the CPU slowed 6 times, the stand-in for an entry-level phone (docs/voice.md).
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(180_000);
    vi.useFakeTimers();
    const client = createSpeechClient(INFO);
    const loading = client.load();
    const settled = loading.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS - 1);
    expect(worker().posted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toMatchObject({ reason: 'load', message: /did not answer/ });
  });

  it('takes a timeout option, and the next transcription still runs after a timeout', async () => {
    const client = createSpeechClient(INFO, { timeoutMs: 1000 });
    await loaded(client);
    vi.useFakeTimers();
    const a = client.transcribe(new Float32Array(1));
    const settled = a.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await settled).toMatchObject({ reason: 'transcribe', message: /did not answer/ });
    const b = client.transcribe(new Float32Array(2));
    await vi.advanceTimersByTimeAsync(0);
    // A new worker: it loads the model first, then transcribes.
    expect(latest().last().type).toBe('load');
    latest().reply({ type: 'loaded', id: latest().last().id, device: 'wasm' });
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().last().type).toBe('transcribe');
    latest().reply({ type: 'result', id: latest().last().id, text: 'b', ms: 2 });
    expect((await b).text).toBe('b');
  });

  it('terminates a worker that does not answer in time and starts a new one', async () => {
    const client = createSpeechClient(INFO, { timeoutMs: 1000 });
    await loaded(client);
    vi.useFakeTimers();
    const stuck = client.transcribe(new Float32Array(1)).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    await stuck;
    // The stuck worker still holds the model and burns the battery: it is stopped.
    expect(worker().terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(latest().terminated).toBe(false);
    expect(latest().options).toEqual({ type: 'module', name: 'siapso-speech' });
    // A late answer of the old worker changes nothing.
    worker().reply({ type: 'result', id: 2, text: 'late', ms: 1 });
    expect(client.device).toBeUndefined();
  });

  it('loads again in a new worker after a load timed out', async () => {
    const client = createSpeechClient(INFO, { timeoutMs: 1000 });
    vi.useFakeTimers();
    const load = client.load().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await load).toMatchObject({ reason: 'load', message: /did not answer/ });
    const retry = client.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).not.toBe(worker());
    latest().reply({ type: 'loaded', id: latest().last().id, device: 'wasm' });
    await retry;
    expect(client.device).toBe('wasm');
  });

  it('cancels what is pending: the worker is stopped and the next transcription gets a new one', async () => {
    const client = createSpeechClient(INFO);
    await loaded(client);
    const transcription = client.transcribe(new Float32Array(1));
    await tick();
    client.cancel();
    await expect(transcription).rejects.toMatchObject({ reason: 'transcribe', message: /cancel/ });
    expect(worker().terminated).toBe(true);

    const next = client.transcribe(new Float32Array(2));
    await tick();
    expect(latest()).not.toBe(worker());
    latest().reply({ type: 'loaded', id: latest().last().id, device: 'wasm' });
    await tick();
    latest().reply({ type: 'result', id: latest().last().id, text: 'nebeday', ms: 5 });
    expect((await next).text).toBe('nebeday');
  });

  it('never cancels the shared model load: only the transcriptions waiting for it', async () => {
    const client = createSpeechClient(INFO);
    const loading = client.load();
    const transcription = client.transcribe(new Float32Array(1));
    const settled = transcription.catch((error: unknown) => error);
    await tick();
    client.cancel();
    // The load goes on in the same worker.
    expect(worker().terminated).toBe(false);
    worker().reply({ type: 'loaded', id: worker().last().id, device: 'wasm' });
    await loading;
    expect(await settled).toMatchObject({ reason: 'transcribe', message: /cancel/ });
    // The transcription queued before the cancel was never sent.
    await tick();
    expect(worker().transcribes()).toHaveLength(0);

    // The next one runs on the model already loaded.
    const next = client.transcribe(new Float32Array(2));
    await tick();
    expect(worker().transcribes()).toHaveLength(1);
    worker().reply({ type: 'result', id: worker().last().id, text: 'moringa', ms: 1 });
    expect((await next).text).toBe('moringa');
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('keeps the worker and its model when there is nothing to cancel', async () => {
    const client = createSpeechClient(INFO);
    await loaded(client);
    client.cancel();
    expect(worker().terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(client.device).toBe('wasm');
  });

  it('terminates the worker on dispose and rejects what is pending', async () => {
    const client = createSpeechClient(INFO);
    const loading = client.load();
    await tick();
    client.dispose();
    expect(worker().terminated).toBe(true);
    await expect(loading).rejects.toThrow(/stopped/);
    await expect(client.load()).rejects.toThrow(/stopped/);
  });
});
