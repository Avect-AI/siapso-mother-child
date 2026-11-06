// SPDX-License-Identifier: MIT
// From the detection model's probability map to text boxes, as PaddleOCR's
// DBPostProcess does it (thresh 0.3, box_thresh 0.6, unclip_ratio 1.5 in the
// model's inference.yml): the regions above the threshold, each with an
// oriented box along the principal axis of its pixels, kept when their mean
// probability is high enough, then grown by the unclip distance. Pure.
import type { Box } from './raster.js';

export interface BoxOptions {
  /** A pixel above this probability is text. */
  thresh?: number;
  /** A region whose mean probability is below this is dropped. */
  boxThresh?: number;
  /** How much a box is grown: area times this, over its perimeter, on each side. */
  unclip?: number;
  /** At most this many boxes (the first found, top to bottom). */
  maxCandidates?: number;
}

/** Fewer pixels than this is a speck, not text. */
const MIN_PIXELS = 10;
/** A box thinner than this (in map pixels) is a sliver, not text. */
const MIN_SIDE = 3;

/**
 * The oriented boxes of the text regions of `prob` (`width` x `height`), in
 * map pixels, in the order found (top to bottom). Regions are 4-connected.
 */
export function boxesFromProbability(
  prob: Float32Array,
  width: number,
  height: number,
  options: BoxOptions = {},
): Box[] {
  const thresh = options.thresh ?? 0.3;
  const boxThresh = options.boxThresh ?? 0.6;
  const unclip = options.unclip ?? 1.5;
  const maxCandidates = options.maxCandidates ?? 1000;
  const seen = new Uint8Array(width * height);
  const boxes: Box[] = [];
  const stack: number[] = [];
  const points: number[] = [];
  for (let start = 0; start < width * height && boxes.length < maxCandidates; start++) {
    if (seen[start] === 1 || (prob[start] ?? 0) <= thresh) continue;
    stack.length = 0;
    points.length = 0;
    stack.push(start);
    seen[start] = 1;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let sp = 0;
    while (stack.length > 0) {
      const q = stack.pop() ?? 0;
      const x = q % width;
      const y = (q - x) / width;
      n += 1;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      sp += prob[q] ?? 0;
      points.push(x, y);
      const neighbours = [
        x > 0 ? q - 1 : -1,
        x < width - 1 ? q + 1 : -1,
        y > 0 ? q - width : -1,
        y < height - 1 ? q + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || seen[next] === 1 || (prob[next] ?? 0) <= thresh) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (n < MIN_PIXELS || sp / n < boxThresh) continue;
    const mx = sx / n;
    const my = sy / n;
    const cxx = sxx / n - mx * mx;
    const cyy = syy / n - my * my;
    const cxy = sxy / n - mx * my;
    // The principal axis of the region's pixels: the direction of the text line.
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      const dx = (points[i] ?? 0) - mx;
      const dy = (points[i + 1] ?? 0) - my;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const bw = u1 - u0 + 1;
    const bh = v1 - v0 + 1;
    if (Math.min(bw, bh) < MIN_SIDE) continue;
    // DBNet shrank the text regions in training: grown back by area times unclip over perimeter.
    const d = (bw * bh * unclip) / (2 * (bw + bh));
    const uc = (u0 + u1) / 2;
    const vc = (v0 + v1) / 2;
    boxes.push({
      cx: mx + uc * cos - vc * sin,
      cy: my + uc * sin + vc * cos,
      w: bw + 2 * d,
      h: bh + 2 * d,
      angle,
    });
  }
  return boxes;
}
