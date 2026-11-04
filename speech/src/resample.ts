// SPDX-License-Identifier: MIT

/** The sample rate Whisper expects: 16 kHz mono. */
export const SPEECH_SAMPLE_RATE = 16000;

/** Zero crossings of the sinc kernel on each side of the centre. */
const HALF_ZEROS = 16;
/** Cut-off as a share of the lower Nyquist frequency, to leave room for the transition band. */
const ROLLOFF = 0.92;
/** Above this number of distinct phases, kernels are computed for every sample instead of tabulated. */
const MAX_PHASES = 4096;

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** Blackman-windowed sinc low-pass kernel at offset `x` (in input samples). */
function kernel(x: number, cutoff: number, half: number): number {
  if (Math.abs(x) >= half) return 0;
  const arg = 2 * cutoff * x;
  const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
  const u = x / half;
  const window = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
  return 2 * cutoff * sinc * window;
}

/** Weights for input samples `first .. first + weights.length - 1` around position `t`. */
function weightsAt(fraction: number, cutoff: number, half: number, taps: number): Float64Array {
  const weights = new Float64Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const w = kernel(k - (taps / 2 - 1) - fraction, cutoff, half);
    weights[k] = w;
    sum += w;
  }
  // Unit gain at 0 Hz, whatever the phase.
  for (let k = 0; k < taps; k++) weights[k] = (weights[k] ?? 0) / sum;
  return weights;
}

/**
 * Resamples mono audio to 16 kHz with a band-limited (windowed sinc) filter, so
 * that content above 8 kHz is removed rather than folded back as noise. Pure:
 * the input is never changed, and 16 kHz input comes back as a copy.
 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (!Number.isFinite(inputRate) || inputRate <= 0) {
    throw new RangeError(`Invalid sample rate: ${String(inputRate)}`);
  }
  if (inputRate === SPEECH_SAMPLE_RATE) return input.slice();

  const ratio = SPEECH_SAMPLE_RATE / inputRate;
  const out = new Float32Array(Math.round(input.length * ratio));
  // Cut-off in cycles per input sample: below the Nyquist frequency of the lower rate.
  const cutoff = 0.5 * Math.min(1, ratio) * ROLLOFF;
  const half = HALF_ZEROS / (2 * cutoff);
  const taps = 2 * Math.ceil(half);

  const integer = Number.isInteger(inputRate);
  const divisor = integer ? gcd(inputRate, SPEECH_SAMPLE_RATE) : 1;
  const phases = SPEECH_SAMPLE_RATE / divisor;
  const step = inputRate / divisor;
  const table = new Map<number, Float64Array>();

  for (let i = 0; i < out.length; i++) {
    let base: number;
    let fraction: number;
    let weights: Float64Array | undefined;
    if (integer && phases <= MAX_PHASES) {
      const position = i * step;
      base = Math.floor(position / phases);
      const phase = position % phases;
      fraction = phase / phases;
      weights = table.get(phase);
      if (weights === undefined) {
        weights = weightsAt(fraction, cutoff, half, taps);
        table.set(phase, weights);
      }
    } else {
      const t = i / ratio;
      base = Math.floor(t);
      fraction = t - base;
      weights = weightsAt(fraction, cutoff, half, taps);
    }
    const first = base - (taps / 2 - 1);
    let acc = 0;
    const start = Math.max(0, -first);
    const end = Math.min(taps, input.length - first);
    for (let k = start; k < end; k++) acc += (input[first + k] ?? 0) * (weights[k] ?? 0);
    out[i] = acc;
  }
  return out;
}
