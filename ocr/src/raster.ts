// SPDX-License-Identifier: MIT
// The image as the models read it: an RGBA raster, shrunk for the
// detection model, cut box by box for the recognition model, each turned
// into the tensor PaddleOCR expects. Pure, so the same code runs in the
// worker and in the tests.

/** RGBA pixels, row by row, as ImageData holds them. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** An oriented box in pixels of a raster: centre, size along and across, angle in radians. */
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

/** The long side of the detection input (PP-OCRv5 `DetResizeForTest: resize_long: 960`). */
export const DETECTION_SIDE = 960;

/** The height of the recognition input (`RecResizeImg: image_shape: [3, 48, 320]`). */
export const RECOGNITION_HEIGHT = 48;

const DETECTION_MEAN = [0.485, 0.456, 0.406];
const DETECTION_STD = [0.229, 0.224, 0.225];

/** The detection input size: the long side at `side`, both sides multiples of 32. */
export function detectionInputSize(
  width: number,
  height: number,
  side = DETECTION_SIDE,
): { width: number; height: number } {
  const ratio = side / Math.max(width, height);
  const round = (value: number) => Math.max(32, Math.round((value * ratio) / 32) * 32);
  return { width: round(width), height: round(height) };
}

/** The width of a box's recognition input, its proportions kept, 16 to 3200 pixels. */
export function recognitionWidth(boxWidth: number, boxHeight: number): number {
  return Math.min(3200, Math.max(16, Math.round((RECOGNITION_HEIGHT * boxWidth) / boxHeight)));
}

/**
 * Channels first, in BGR order as PaddleOCR reads images; `normal(value, c)`
 * maps a byte of channel c (0 blue, 1 green, 2 red) to the model's scale.
 */
function bgrTensor(
  image: Raster,
  normal: (value: number, channel: number) => number,
): Float32Array {
  const plane = image.width * image.height;
  const out = new Float32Array(3 * plane);
  const { data } = image;
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    out[p] = normal(data[i + 2] ?? 0, 0);
    out[plane + p] = normal(data[i + 1] ?? 0, 1);
    out[2 * plane + p] = normal(data[i] ?? 0, 2);
  }
  return out;
}

/** The detection tensor [3, h, w]: BGR, ImageNet mean and deviation. */
export function toDetectionTensor(image: Raster): Float32Array {
  return bgrTensor(
    image,
    (value, c) => (value / 255 - (DETECTION_MEAN[c] ?? 0)) / (DETECTION_STD[c] ?? 1),
  );
}

/** The recognition tensor [3, 48, w]: BGR, scaled to -1 to 1. */
export function toRecognitionTensor(image: Raster): Float32Array {
  return bgrTensor(image, (value) => (value / 255 - 0.5) / 0.5);
}

/**
 * The raster shrunk (or grown) to `width` x `height`: each output pixel is
 * the average of the input area it covers, so thin strokes stay visible when
 * a 2000-pixel photo becomes the 960-pixel detection input.
 */
export function resizeArea(image: Raster, width: number, height: number): Raster {
  if (width === image.width && height === image.height) {
    return { width, height, data: new Uint8ClampedArray(image.data) };
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  const src = image.data;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = Math.min(image.height, y0 + sy);
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = Math.min(image.width, x0 + sx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          if (wx <= 0) continue;
          const k = wx * wy;
          const i = (yy * image.width + xx) * 4;
          r += (src[i] ?? 0) * k;
          g += (src[i + 1] ?? 0) * k;
          b += (src[i + 2] ?? 0) * k;
          a += (src[i + 3] ?? 0) * k;
          weight += k;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / weight;
      out[o + 1] = g / weight;
      out[o + 2] = b / weight;
      out[o + 3] = a / weight;
    }
  }
  return { width, height, data: out };
}

/**
 * The box cut out of the raster along its own angle and stretched to
 * `width` x `height` (bilinear sampling); a part past the page repeats the
 * edge pixels.
 */
export function cropBox(image: Raster, box: Box, width: number, height: number): Raster {
  const out = new Uint8ClampedArray(width * height * 4);
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const su = box.w / width;
  const sv = box.h / height;
  const src = image.data;
  const maxX = image.width - 1;
  const maxY = image.height - 1;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5 - height / 2) * sv;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5 - width / 2) * su;
      // Pixel centres sit at +0.5: sample between the four nearest.
      const fx = Math.min(maxX, Math.max(0, box.cx + u * cos - v * sin - 0.5));
      const fy = Math.min(maxY, Math.max(0, box.cy + u * sin + v * cos - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(maxX, x0 + 1);
      const y1 = Math.min(maxY, y0 + 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * image.width + x0) * 4;
      const i10 = (y0 * image.width + x1) * 4;
      const i01 = (y1 * image.width + x0) * 4;
      const i11 = (y1 * image.width + x1) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = (src[i00 + c] ?? 0) * (1 - ax) + (src[i10 + c] ?? 0) * ax;
        const bottom = (src[i01 + c] ?? 0) * (1 - ax) + (src[i11 + c] ?? 0) * ax;
        out[o + c] = top * (1 - ay) + bottom * ay;
      }
    }
  }
  return { width, height, data: out };
}
