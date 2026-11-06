// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import { recognitionAlphabet } from '../src/ctc.js';
import { readRaster, type OcrEngine } from '../src/pipeline.js';
import type { Raster } from '../src/raster.js';

const alphabet = recognitionAlphabet(['F', 'e', 'r']);

function white(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

/** Probabilities that decode to `classes` (indices of the alphabet), one step each. */
function steps(classes: number[]) {
  const data = new Float32Array(classes.length * alphabet.length).fill(0.01);
  classes.forEach((c, t) => {
    data[t * alphabet.length + c] = 0.95;
  });
  return { data, steps: classes.length, classes: alphabet.length };
}

/** A detection model that sees one line of text in the middle of its input, and its recogniser. */
function engine(regions: { x0: number; x1: number; y0: number; y1: number }[], read = [1, 2, 3]) {
  const detect = vi.fn((_tensor: Float32Array, width: number, height: number) => {
    const prob = new Float32Array(width * height);
    for (const r of regions) {
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) prob[y * width + x] = 0.9;
    }
    return Promise.resolve(prob);
  });
  const recognize = vi.fn(() => Promise.resolve(steps(read)));
  return { detect, recognize } satisfies OcrEngine;
}

describe('readRaster', () => {
  it('detects on the 960-pixel input, recognises each box of the page, and gives its lines', async () => {
    const model = engine([{ x0: 96, x1: 864, y0: 200, y1: 260 }]);
    const progress: number[] = [];
    const lines = await readRaster(white(2000, 1000), model, alphabet, {
      onProgress: (p) => progress.push(p),
    });
    expect(lines).toEqual(['Fer']);
    expect(model.detect).toHaveBeenCalledOnce();
    const [tensor, width, height] = model.detect.mock.calls[0] ?? [];
    expect([width, height]).toEqual([960, 480]);
    expect(tensor).toHaveLength(3 * 960 * 480);
    expect(model.recognize).toHaveBeenCalledOnce();
    // The box keeps its proportions at 48 pixels high: 769 by 61 map pixels,
    // grown by 42.4 on each side, is 853.8 by 145.8, so 281 pixels wide.
    const [recTensor, recWidth] = (model.recognize.mock.calls[0] ?? []) as unknown as [
      Float32Array,
      number,
    ];
    expect(recWidth).toBe(281);
    expect(recTensor).toHaveLength(3 * 48 * 281);
    expect(progress.at(-1)).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('skips boxes too small to hold a letter, and boxes read as nothing', async () => {
    // 4 by 3 map pixels, grown by 1.3 on each side: under 6 pixels high.
    const tiny = engine([{ x0: 10, x1: 13, y0: 10, y1: 12 }]);
    expect(await readRaster(white(960, 480), tiny, alphabet)).toEqual([]);
    expect(tiny.recognize).not.toHaveBeenCalled();
    const blank = engine([{ x0: 100, x1: 500, y0: 100, y1: 130 }], [0, 0, 0]);
    expect(await readRaster(white(960, 480), blank, alphabet)).toEqual([]);
  });

  it('stops when cancelled, before the models and between boxes', async () => {
    const model = engine([
      { x0: 100, x1: 500, y0: 100, y1: 130 },
      { x0: 100, x1: 500, y0: 300, y1: 330 },
    ]);
    const before = new AbortController();
    before.abort();
    await expect(
      readRaster(white(960, 480), model, alphabet, { signal: before.signal }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
    expect(model.detect).not.toHaveBeenCalled();

    const during = new AbortController();
    model.recognize.mockImplementationOnce(() => {
      during.abort();
      return Promise.resolve(steps([1]));
    });
    await expect(
      readRaster(white(960, 480), model, alphabet, { signal: during.signal }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
    expect(model.recognize).toHaveBeenCalledTimes(1);
  });

  it('refuses a recogniser whose classes are not those of its dictionary', async () => {
    const model = engine([{ x0: 100, x1: 500, y0: 100, y1: 130 }]);
    model.recognize.mockResolvedValueOnce({ data: new Float32Array(9), steps: 3, classes: 3 });
    await expect(readRaster(white(960, 480), model, alphabet)).rejects.toMatchObject({
      reason: 'load',
    });
  });
});
