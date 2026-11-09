// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { boxesFromProbability } from '../src/boxes.js';
import { ctcGreedyDecode, recognitionAlphabet } from '../src/ctc.js';
import { readingOrder } from '../src/reading-order.js';
import {
  cropBox,
  detectionInputSize,
  recognitionWidth,
  resizeArea,
  toDetectionTensor,
  toRecognitionTensor,
  type Raster,
} from '../src/raster.js';

function raster(width: number, height: number, rgba: (x: number, y: number) => number[]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(rgba(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('detection input', () => {
  it('brings the long side to 960 pixels, both sides multiples of 32', () => {
    expect(detectionInputSize(2000, 1500)).toEqual({ width: 960, height: 736 });
    // 720 pixels is 22.5 times 32: rounded to 23 times.
    expect(detectionInputSize(1200, 1600)).toEqual({ width: 736, height: 960 });
    expect(detectionInputSize(1000, 1600)).toEqual({ width: 608, height: 960 });
    expect(detectionInputSize(20, 10)).toEqual({ width: 960, height: 480 });
    expect(detectionInputSize(5000, 40)).toEqual({ width: 960, height: 32 });
  });

  it('is in BGR order, normalised with the ImageNet mean and deviation, channels first', () => {
    const image = raster(2, 1, () => [255, 128, 0, 255]);
    const tensor = toDetectionTensor(image);
    expect(tensor).toHaveLength(6);
    // Blue first: 0 / 255.
    expect(tensor[0]).toBeCloseTo((0 - 0.485) / 0.229, 5);
    expect(tensor[2]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 5);
    expect(tensor[4]).toBeCloseTo((1 - 0.406) / 0.225, 5);
  });
});

describe('recognition input', () => {
  it('is 48 pixels high, as wide as the box keeps its proportions, 16 to 3200', () => {
    expect(recognitionWidth(300, 30)).toBe(480);
    expect(recognitionWidth(5, 40)).toBe(16);
    expect(recognitionWidth(100000, 20)).toBe(3200);
  });

  it('is in BGR order, scaled to -1 to 1', () => {
    const tensor = toRecognitionTensor(raster(1, 1, () => [255, 0, 128, 255]));
    expect(tensor[0]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 5);
    expect(tensor[1]).toBeCloseTo(-1, 5);
    expect(tensor[2]).toBeCloseTo(1, 5);
  });
});

describe('resizeArea', () => {
  it('averages the pixels it shrinks, so thin strokes are not lost', () => {
    const stripes = raster(4, 2, (x) => (x % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const half = resizeArea(stripes, 2, 1);
    expect(half.width).toBe(2);
    expect(half.height).toBe(1);
    expect(half.data[0]).toBeCloseTo(128, -1);
  });

  it('keeps the image when the size is the same', () => {
    const image = raster(3, 3, (x, y) => [x * 10, y * 10, 0, 255]);
    expect(resizeArea(image, 3, 3).data).toEqual(image.data);
  });
});

describe('cropBox', () => {
  it('cuts the box along its angle, as wide and high as asked', () => {
    // A dark bar from x 20 to 60 at y 10 to 20, on white.
    const page = raster(80, 40, (x, y) =>
      x >= 20 && x < 60 && y >= 10 && y < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
    const crop = cropBox(page, { cx: 40, cy: 15, w: 40, h: 10, angle: 0 }, 96, 24);
    expect(crop.width).toBe(96);
    expect(crop.height).toBe(24);
    // The middle is the bar, dark.
    expect(crop.data[(12 * 96 + 48) * 4]).toBeLessThan(10);
  });

  it('turns a box drawn at an angle upright', () => {
    const angle = Math.PI / 2;
    // A vertical bar: as a box turned a quarter, it reads as a horizontal one.
    const page = raster(40, 80, (x, y) =>
      x >= 15 && x < 25 && y >= 20 && y < 60 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
    const crop = cropBox(page, { cx: 20, cy: 40, w: 40, h: 10, angle }, 40, 10);
    const dark = [...crop.data].filter((value, i) => i % 4 === 0 && value < 64).length;
    expect(dark).toBeGreaterThan(0.8 * 40 * 10);
  });

  it('repeats the edge pixels for a box that goes past the page', () => {
    const page = raster(10, 10, () => [200, 200, 200, 255]);
    const crop = cropBox(page, { cx: 0, cy: 0, w: 10, h: 10, angle: 0 }, 10, 10);
    expect(crop.data[0]).toBe(200);
  });
});

describe('boxesFromProbability', () => {
  function map(width: number, height: number, value: (x: number, y: number) => number) {
    const prob = new Float32Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) prob[y * width + x] = value(x, y);
    return prob;
  }

  it('gives one box per text region, unclipped as DBNet does', () => {
    const prob = map(64, 32, (x, y) => (x >= 10 && x <= 40 && y >= 10 && y <= 16 ? 0.9 : 0));
    const boxes = boxesFromProbability(prob, 64, 32);
    expect(boxes).toHaveLength(1);
    const [box] = boxes;
    expect(box?.cx).toBeCloseTo(25, 5);
    expect(box?.cy).toBeCloseTo(13, 5);
    const d = (31 * 7 * 1.5) / (2 * (31 + 7));
    expect(box?.w).toBeCloseTo(31 + 2 * d, 5);
    expect(box?.h).toBeCloseTo(7 + 2 * d, 5);
    expect(Math.abs(box?.angle ?? 1)).toBeLessThan(1e-9);
  });

  it('drops faint regions, specks and slivers', () => {
    const prob = map(64, 32, (x, y) => {
      if (x >= 2 && x <= 20 && y >= 2 && y <= 8) return 0.5; // faint: mean below 0.6
      if (x >= 40 && x <= 42 && y >= 20 && y <= 22) return 0.95; // a speck of 9 pixels
      if (x >= 30 && x <= 60 && y === 28) return 0.95; // one pixel high
      return 0;
    });
    expect(boxesFromProbability(prob, 64, 32)).toEqual([]);
  });

  it('follows the angle of a tilted line', () => {
    const angle = (8 * Math.PI) / 180;
    const prob = map(120, 60, (x, y) => {
      const along = (x - 60) * Math.cos(angle) + (y - 30) * Math.sin(angle);
      const across = -(x - 60) * Math.sin(angle) + (y - 30) * Math.cos(angle);
      return Math.abs(along) < 40 && Math.abs(across) < 3 ? 0.9 : 0;
    });
    const [box] = boxesFromProbability(prob, 120, 60);
    expect(box?.angle).toBeCloseTo(angle, 1);
    expect(box?.cx).toBeCloseTo(60, 0);
    expect(box?.cy).toBeCloseTo(30, 0);
  });

  it('keeps regions apart when they only touch at a corner, and at most maxCandidates', () => {
    const prob = map(40, 20, (x, y) =>
      (x < 10 && y < 5) || (x >= 10 && x < 20 && y >= 5 && y < 10) ? 0.9 : 0,
    );
    expect(boxesFromProbability(prob, 40, 20)).toHaveLength(2);
    expect(boxesFromProbability(prob, 40, 20, { maxCandidates: 1 })).toHaveLength(1);
  });
});

describe('CTC decoding', () => {
  const alphabet = recognitionAlphabet(['a', 'b']);

  it('reads blank first, then the characters of the model, then a space', () => {
    expect(alphabet).toEqual(['', 'a', 'b', ' ']);
  });

  it('keeps the best character at each step, drops blanks and repeats', () => {
    // Steps: a, a, blank, a, b, space, b.
    const best = [1, 1, 0, 1, 2, 3, 2];
    const logits = new Float32Array(best.length * 4);
    best.forEach((c, t) => {
      for (let k = 0; k < 4; k++) logits[t * 4 + k] = k === c ? 0.9 : 0.03;
    });
    const read = ctcGreedyDecode(logits, best.length, 4, alphabet);
    expect(read.text).toBe('aab b');
    expect(read.confidence).toBeCloseTo(0.9, 5);
  });

  it('gives an empty text and no confidence when every step is blank', () => {
    expect(ctcGreedyDecode(new Float32Array([0.9, 0.1, 0.9, 0.1]), 2, 2, ['', 'a'])).toEqual({
      text: '',
      confidence: 0,
    });
  });
});

describe('readingOrder', () => {
  it('rebuilds the lines top to bottom, the boxes of a line left to right', () => {
    const lines = readingOrder([
      { text: '1000 mg', cx: 300, cy: 101, w: 120, h: 30, angle: 0 },
      { text: '1 cp x 3/j', cx: 150, cy: 150, w: 200, h: 28, angle: 0 },
      { text: 'Doliprane', cx: 100, cy: 99, w: 160, h: 30, angle: 0 },
    ]);
    expect(lines).toEqual(['Doliprane 1000 mg', '1 cp x 3/j']);
  });

  it('follows the angle of the page, so a tilted photo keeps its lines', () => {
    const angle = 0.12;
    const at = (u: number, v: number) => ({
      cx: u * Math.cos(angle) - v * Math.sin(angle),
      cy: u * Math.sin(angle) + v * Math.cos(angle),
    });
    const lines = readingOrder([
      { text: 'Fer', ...at(100, 200), w: 90, h: 24, angle },
      { text: 'Acide folique', ...at(900, 200), w: 300, h: 24, angle },
      { text: 'Spasfon', ...at(100, 240), w: 160, h: 24, angle },
    ]);
    expect(lines).toEqual(['Fer Acide folique', 'Spasfon']);
  });

  it('drops boxes read as nothing, and gives nothing for nothing', () => {
    expect(readingOrder([])).toEqual([]);
    expect(readingOrder([{ text: '  ', cx: 1, cy: 1, w: 30, h: 10, angle: 0 }])).toEqual([]);
  });
});
