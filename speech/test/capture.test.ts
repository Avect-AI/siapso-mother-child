// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORDING_MS, createRecorder } from '../src/capture.js';

const RATE = 48000;
const BLOCK = 2048;

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeNode {
  connected: unknown[] = [];
  connect(target: unknown) {
    this.connected.push(target);
    return target;
  }
  disconnect() {
    this.connected = [];
  }
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakeWorkletNode extends FakeNode {
  static instances: FakeWorkletNode[] = [];
  readonly port = { onmessage: null as ((event: { data: Float32Array }) => void) | null };
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: unknown,
  ) {
    super();
    FakeWorkletNode.instances.push(this);
  }
}

let contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  readonly sampleRate = RATE;
  readonly destination = new FakeNode();
  readonly audioWorklet = {
    modules: [] as string[],
    addModule: (url: string) => this.addModule(url),
  };
  state = 'running';
  gainNode = new FakeGain();
  source = new FakeNode();
  constructor() {
    contexts.push(this);
  }
  addModule(url: string) {
    this.audioWorklet.modules.push(url);
    return Promise.resolve();
  }
  createMediaStreamSource() {
    return this.source;
  }
  createGain() {
    return this.gainNode;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function only<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1)
    throw new Error(`expected one item, got ${String(items.length)}`);
  return item;
}

const context = () => only(contexts);
const node = () => only(FakeWorkletNode.instances);
const track = () => only(stream.tracks);

/** Delivers one block of microphone samples from the worklet. */
function feed(value: number) {
  node().port.onmessage?.({ data: new Float32Array(BLOCK).fill(value) });
}

let stream: FakeStream;
let getUserMedia: ReturnType<typeof vi.fn<() => Promise<FakeStream>>>;

beforeEach(() => {
  contexts = [];
  FakeWorkletNode.instances = [];
  stream = new FakeStream();
  getUserMedia = vi.fn(() => Promise.resolve(stream));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createRecorder', () => {
  it('asks for one microphone channel with voice processing', async () => {
    await createRecorder().start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it('captures in an audio worklet, mixed down to one channel', async () => {
    await createRecorder().start();
    expect(context().audioWorklet.modules).toHaveLength(1);
    expect(node().name).toBe('siapso-capture');
    expect(node().options).toMatchObject({ channelCount: 1, channelCountMode: 'explicit' });
    expect(context().source.connected).toEqual([node()]);
  });

  it('returns 16 kHz mono samples and releases the microphone on stop', async () => {
    const recorder = createRecorder();
    await recorder.start();
    for (let i = 0; i < 24; i++) feed(0.25);
    const samples = await recorder.stop();
    expect(samples.length).toBe(Math.round((24 * BLOCK * 16000) / RATE));
    expect(samples[samples.length >> 1]).toBeCloseTo(0.25, 3);
    expect(track().stopped).toBe(true);
    expect(context().state).toBe('closed');
    expect(node().port.onmessage).toBeNull();
  });

  it('sends nothing to the speakers: the worklet output goes through a muted gain', async () => {
    await createRecorder().start();
    expect(node().connected).toEqual([context().gainNode]);
    expect(context().gainNode.gain.value).toBe(0);
  });

  it(`stops by itself at ${String(MAX_RECORDING_MS)} ms and keeps at most that much audio`, async () => {
    expect(MAX_RECORDING_MS).toBe(8000);
    const onAutoStop = vi.fn();
    const recorder = createRecorder({ onAutoStop });
    await recorder.start();
    // 10 seconds of audio arrive, but only 8 are kept.
    const blocks = Math.ceil((10 * RATE) / BLOCK);
    for (let i = 0; i < blocks; i++) feed(0.1);
    vi.advanceTimersByTime(MAX_RECORDING_MS - 1);
    expect(onAutoStop).not.toHaveBeenCalled();
    expect(track().stopped).toBe(false);
    vi.advanceTimersByTime(1);
    expect(onAutoStop).toHaveBeenCalledOnce();
    expect(track().stopped).toBe(true);
    const samples = await recorder.stop();
    expect(samples.length).toBe((16000 * MAX_RECORDING_MS) / 1000);
  });

  it('reports the input level of the last block, between 0 and 1', async () => {
    const recorder = createRecorder();
    expect(recorder.level()).toBe(0);
    await recorder.start();
    feed(0.5);
    expect(recorder.level()).toBeCloseTo(0.5, 5);
    feed(2);
    expect(recorder.level()).toBe(1);
  });

  it('drops the audio on cancel and releases the microphone', async () => {
    const recorder = createRecorder();
    await recorder.start();
    feed(0.3);
    recorder.cancel();
    expect(track().stopped).toBe(true);
    expect(context().state).toBe('closed');
    await expect(recorder.stop()).rejects.toThrow(/not recording/);
  });

  it('releases the microphone when cancelled while the permission prompt is open', async () => {
    let grant: (value: FakeStream) => void = () => undefined;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const recorder = createRecorder();
    const starting = recorder.start();
    recorder.cancel();
    grant(stream);
    await starting;
    expect(track().stopped).toBe(true);
    expect(contexts).toHaveLength(0);
  });

  it('never leaks a microphone when a cancelled start is answered after a new start', async () => {
    const first = new FakeStream();
    const second = new FakeStream();
    const grants: ((value: FakeStream) => void)[] = [];
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grants.push(resolve);
        }),
    );
    const recorder = createRecorder();
    const cancelled = recorder.start();
    recorder.cancel();
    const started = recorder.start();
    const [grantFirst, grantSecond] = grants;
    // The second prompt is answered first, then the first one.
    grantSecond?.(second);
    await started;
    grantFirst?.(first);
    await cancelled;

    expect(only(first.tracks).stopped).toBe(true);
    expect(only(second.tracks).stopped).toBe(false);
    expect(contexts).toHaveLength(1);
    feed(0.2);
    const samples = await recorder.stop();
    expect(samples.length).toBeGreaterThan(0);
    expect(only(second.tracks).stopped).toBe(true);
  });

  it('refuses to stop before it started, and to start twice', async () => {
    const recorder = createRecorder();
    await expect(recorder.stop()).rejects.toThrow(/not recording/);
    await recorder.start();
    await expect(recorder.start()).rejects.toThrow(/already/);
  });

  it('passes a refused microphone permission to the caller', async () => {
    getUserMedia.mockImplementationOnce(() =>
      Promise.reject(new DOMException('denied', 'NotAllowedError')),
    );
    await expect(createRecorder().start()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});
