// SPDX-License-Identifier: MIT
// Microphone capture: mono, in memory only, never stored or sent, and the
// microphone is released as soon as the recording ends.
import { resampleTo16k } from './resample.js';

/** A recording stops by itself after 8 seconds: a product or remedy name is short. */
export const MAX_RECORDING_MS = 8000;

const PROCESSOR = 'siapso-capture';
const BLOCK_SIZE = 2048;

// The audio worklet: copies the microphone samples in blocks to the page.
// Inline (loaded from a Blob URL), so the build needs no separate asset.
const WORKLET_SOURCE = `
class SiapsoCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(${String(BLOCK_SIZE)});
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const n = Math.min(channel.length - offset, this.block.length - this.filled);
        this.block.set(channel.subarray(offset, offset + n), this.filled);
        this.filled += n;
        offset += n;
        if (this.filled === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(${String(BLOCK_SIZE)});
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSOR}', SiapsoCapture);
`;

export interface Recorder {
  /** Opens the microphone and starts recording (rejects with NotAllowedError when permission is refused). */
  start(): Promise<void>;
  /** Stops and returns the recording as 16 kHz mono samples; the recorder keeps no copy. */
  stop(): Promise<Float32Array>;
  /** Input level of the last block, from 0 to 1, for a visible recording state. */
  level(): number;
  /** Stops and drops the recording. */
  cancel(): void;
}

export interface RecorderOptions {
  /** Called when the recording stops by itself at MAX_RECORDING_MS; call stop() to get the samples. */
  onAutoStop?: () => void;
}

type AudioContextConstructor = new () => AudioContext;

function audioContextClass(): AudioContextConstructor {
  const scope = globalThis as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (ctor === undefined) throw new Error('This browser cannot record audio (no Web Audio API).');
  return ctor;
}

interface Session {
  stream: MediaStream;
  context: AudioContext | undefined;
  nodes: AudioNode[];
  worklet: AudioWorkletNode | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createRecorder(options: RecorderOptions = {}): Recorder {
  let state: 'idle' | 'starting' | 'recording' | 'ended' = 'idle';
  let session: Session | undefined;
  let chunks: Float32Array[] = [];
  let kept = 0;
  let limit = 0;
  let rate = 0;
  let lastLevel = 0;
  let attempt = 0;

  /** Stops one session: its timer, its audio graph and its microphone. */
  function close(owned: Session): void {
    const { stream, context, nodes, worklet, timer } = owned;
    clearTimeout(timer);
    if (worklet !== undefined) worklet.port.onmessage = null;
    for (const node of nodes) node.disconnect();
    for (const track of stream.getTracks()) track.stop();
    if (context !== undefined) void context.close().catch(() => undefined);
  }

  function release(): void {
    if (session === undefined) return;
    const current = session;
    session = undefined;
    close(current);
  }

  function take(): Float32Array {
    const samples = new Float32Array(kept);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    chunks = [];
    kept = 0;
    lastLevel = 0;
    return resampleTo16k(samples, rate);
  }

  function onBlock(input: Float32Array): void {
    let sum = 0;
    for (const value of input) sum += value * value;
    lastLevel = Math.min(1, Math.sqrt(sum / Math.max(1, input.length)));
    const room = limit - kept;
    if (room <= 0) return;
    const chunk = input.length <= room ? input : input.slice(0, room);
    chunks.push(chunk);
    kept += chunk.length;
  }

  /** Drops a session that is no longer the current attempt, or that failed to start. */
  function abandon(owned: Session): void {
    if (session === owned) session = undefined;
    close(owned);
  }

  async function open(current: number): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    // Each attempt owns its session: a cancelled attempt answered late only
    // closes its own microphone, never the one of a newer attempt.
    const owned: Session = {
      stream,
      context: undefined,
      nodes: [],
      worklet: undefined,
      timer: undefined,
    };
    if (current !== attempt) {
      // Cancelled while the permission prompt was open.
      close(owned);
      return;
    }
    session = owned;
    try {
      await wire(owned, current);
    } catch (error) {
      abandon(owned);
      throw error;
    }
  }

  async function wire(owned: Session, current: number): Promise<void> {
    const { stream } = owned;
    const context = new (audioContextClass())();
    owned.context = context;
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (current !== attempt) {
      abandon(owned);
      return;
    }
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    // The worklet only runs when connected to the output; a muted gain keeps the speakers silent.
    const mute = context.createGain();
    mute.gain.value = 0;
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      onBlock(event.data);
    };
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(context.destination);

    chunks = [];
    kept = 0;
    rate = context.sampleRate;
    limit = Math.round((context.sampleRate * MAX_RECORDING_MS) / 1000);
    owned.nodes = [source, worklet, mute];
    owned.worklet = worklet;
    owned.timer = setTimeout(() => {
      if (state !== 'recording') return;
      release();
      state = 'ended';
      options.onAutoStop?.();
    }, MAX_RECORDING_MS);
    state = 'recording';
    await context.resume();
  }

  return {
    async start() {
      if (state !== 'idle') throw new Error('The recorder is already recording.');
      state = 'starting';
      const current = ++attempt;
      try {
        await open(current);
      } catch (error) {
        if (current === attempt) {
          release();
          state = 'idle';
        }
        throw error;
      }
    },

    stop() {
      if (state !== 'recording' && state !== 'ended') {
        return Promise.reject(new Error('The recorder is not recording.'));
      }
      release();
      state = 'idle';
      return Promise.resolve(take());
    },

    level() {
      return state === 'recording' ? lastLevel : 0;
    },

    cancel() {
      attempt++;
      release();
      chunks = [];
      kept = 0;
      lastLevel = 0;
      state = 'idle';
    },
  };
}
