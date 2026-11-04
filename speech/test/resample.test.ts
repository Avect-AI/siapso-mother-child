// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { resampleTo16k } from '../src/resample.js';

function sine(frequency: number, rate: number, seconds: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++)
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate);
  return out;
}

/** Magnitude of the discrete Fourier transform of `x` at `frequency`, normalised to the amplitude. */
function magnitudeAt(x: Float32Array, frequency: number, rate: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / rate;
    re += (x[i] ?? 0) * Math.cos(angle);
    im -= (x[i] ?? 0) * Math.sin(angle);
  }
  return (2 * Math.hypot(re, im)) / x.length;
}

function rms(x: Float32Array): number {
  let sum = 0;
  for (const v of x) sum += v * v;
  return Math.sqrt(sum / x.length);
}

describe('resampleTo16k', () => {
  it.each([48000, 44100, 32000, 22050, 8000])('keeps the duration of %i Hz audio', (rate) => {
    const input = new Float32Array(rate * 2);
    expect(resampleTo16k(input, rate).length).toBe(32000);
  });

  it('rounds the output length for a fractional ratio', () => {
    expect(resampleTo16k(new Float32Array(441), 44100).length).toBe(160);
    expect(resampleTo16k(new Float32Array(1000), 48000).length).toBe(333);
  });

  it.each([48000, 44100, 8000])('keeps the frequency of a 1 kHz sine at %i Hz', (rate) => {
    const out = resampleTo16k(sine(1000, rate, 1), rate);
    // Leave out the edges, where the filter sees zeros beyond the signal.
    const middle = out.subarray(800, out.length - 800);
    expect(magnitudeAt(middle, 1000, 16000)).toBeCloseTo(0.5, 1);
    expect(magnitudeAt(middle, 1100, 16000)).toBeLessThan(0.02);
    expect(magnitudeAt(middle, 900, 16000)).toBeLessThan(0.02);
  });

  it('removes content above 8 kHz instead of folding it back (no aliasing)', () => {
    // 12 kHz cannot be represented at 16 kHz; without a low-pass filter it would fold to 4 kHz.
    const out = resampleTo16k(sine(12000, 48000, 1), 48000);
    const middle = out.subarray(800, out.length - 800);
    expect(magnitudeAt(middle, 4000, 16000)).toBeLessThan(0.02);
    expect(rms(middle)).toBeLessThan(0.02);
  });

  it('returns 16 kHz input unchanged, as a copy', () => {
    const input = sine(440, 16000, 0.25);
    const out = resampleTo16k(input, 16000);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('returns an empty array for empty input', () => {
    expect(resampleTo16k(new Float32Array(0), 48000).length).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the sample rate %s', (rate) => {
    expect(() => resampleTo16k(new Float32Array(10), rate)).toThrow(RangeError);
  });

  it('does not change its input', () => {
    const input = sine(1000, 48000, 0.1);
    const copy = input.slice();
    resampleTo16k(input, 48000);
    expect(input).toEqual(copy);
  });
});
