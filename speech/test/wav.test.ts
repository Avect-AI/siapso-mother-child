// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { decodeWav } from '../eval/wav.js';

function wav(samples: number[], options: { rate?: number; channels?: number } = {}): Uint8Array {
  const rate = options.rate ?? 16000;
  const channels = options.channels ?? 1;
  const data = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((value, index) => {
    data.setInt16(index * 2, value, true);
  });
  const header = new DataView(new ArrayBuffer(44));
  const tag = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      header.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  tag(0, 'RIFF');
  header.setUint32(4, 36 + data.byteLength, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * channels * 2, true);
  header.setUint16(32, channels * 2, true);
  header.setUint16(34, 16, true);
  tag(36, 'data');
  header.setUint32(40, data.byteLength, true);
  const out = new Uint8Array(44 + data.byteLength);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(new Uint8Array(data.buffer), 44);
  return out;
}

describe('decodeWav', () => {
  it('decodes 16-bit mono samples to floats', () => {
    const { samples, sampleRate } = decodeWav(wav([0, 16384, -32768]));
    expect(sampleRate).toBe(16000);
    expect(Array.from(samples)).toEqual([0, 0.5, -1]);
  });

  it('averages channels', () => {
    const { samples } = decodeWav(wav([16384, -16384, 8192, 8192], { channels: 2 }));
    expect(Array.from(samples)).toEqual([0, 0.25]);
  });

  it('skips unknown chunks before the data', () => {
    const base = wav([16384]);
    const extra = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 2, 0, 0, 0, 1, 2]);
    const joined = new Uint8Array(base.length + extra.length);
    joined.set(base.subarray(0, 36), 0);
    joined.set(extra, 36);
    joined.set(base.subarray(36), 36 + extra.length);
    expect(Array.from(decodeWav(joined).samples)).toEqual([0.5]);
  });

  it('decodes 32-bit float samples, the FLEURS format', () => {
    const bytes = wav([0, 0]);
    const view = new DataView(bytes.buffer);
    view.setUint16(20, 3, true);
    view.setUint16(34, 32, true);
    const floats = new Uint8Array(8);
    new DataView(floats.buffer).setFloat32(0, 0.25, true);
    new DataView(floats.buffer).setFloat32(4, -0.5, true);
    const out = new Uint8Array(44 + 8);
    out.set(bytes.subarray(0, 44), 0);
    new DataView(out.buffer).setUint32(40, 8, true);
    out.set(floats, 44);
    expect(Array.from(decodeWav(out).samples)).toEqual([0.25, -0.5]);
  });

  it('refuses a file that is not RIFF WAVE', () => {
    expect(() => decodeWav(new Uint8Array(64))).toThrow(/WAV/);
  });

  it('refuses another sample format', () => {
    const bytes = wav([0]);
    new DataView(bytes.buffer).setUint16(34, 8, true);
    expect(() => decodeWav(bytes)).toThrow(/16-bit PCM/);
  });
});
