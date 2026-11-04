// SPDX-License-Identifier: MIT
// Minimal WAV reader for the evaluation: 16-bit PCM (what FLEURS and the
// recording guide use), channels averaged to mono, floats in [-1, 1].

export interface Wav {
  samples: Float32Array;
  sampleRate: number;
}

export function decodeWav(bytes: Uint8Array): Wav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string =>
    offset + 4 <= bytes.length ? String.fromCharCode(...bytes.subarray(offset, offset + 4)) : '';
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF WAV file');
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let format = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      // FLEURS ships 32-bit float WAV (format 3); the recording guide asks for 16-bit PCM.
      const pcm16 = format === 1 && bits === 16;
      const float32 = format === 3 && bits === 32;
      if (!(pcm16 || float32) || channels < 1) {
        throw new Error('Only 16-bit PCM and 32-bit float WAV are supported');
      }
      const width = bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (width * channels));
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          const at = body + (frame * channels + channel) * width;
          sum += pcm16 ? view.getInt16(at, true) / 32768 : view.getFloat32(at, true);
        }
        samples[frame] = sum / channels;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}
