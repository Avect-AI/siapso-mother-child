// SPDX-License-Identifier: MIT
// One page read: the detection model finds the text boxes, the recognition
// model reads each box, and the boxes are put back into lines. The models
// are handed in (`OcrEngine`), so this runs the same in the worker, with
// ONNX Runtime, and in the tests. The lines are only text: what they name is
// read by the app (models propose, rules decide).
import { boxesFromProbability } from './boxes.js';
import { ctcGreedyDecode } from './ctc.js';
import { OcrPackError } from './ocr-pack.js';
import {
  RECOGNITION_HEIGHT,
  cropBox,
  detectionInputSize,
  recognitionWidth,
  resizeArea,
  toDetectionTensor,
  toRecognitionTensor,
  type Box,
  type Raster,
} from './raster.js';
import { readingOrder, type ReadBox } from './reading-order.js';

export interface OcrEngine {
  /** The probability map (`height` x `width`) of a [1, 3, height, width] detection tensor. */
  detect(tensor: Float32Array, width: number, height: number): Promise<Float32Array>;
  /** The [steps, classes] probabilities of a [1, 3, 48, width] recognition tensor. */
  recognize(
    tensor: Float32Array,
    width: number,
  ): Promise<{ data: Float32Array; steps: number; classes: number }>;
}

export interface ReadOptions {
  /** Called with 0 to 1 as the page is read. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

/** A box smaller than this on either side (page pixels) holds no letter. */
const MIN_BOX_SIDE = 6;
/** The share of the progress the detection stands for. */
const DETECTION_SHARE = 0.2;

function stopIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new OcrPackError('cancelled', 'The reading was cancelled.');
}

/** A box of the detection map in page pixels (the two scales may differ by rounding to 32). */
function toPage(box: Box, sx: number, sy: number): Box {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  return {
    cx: box.cx * sx,
    cy: box.cy * sy,
    w: box.w * Math.hypot(cos * sx, sin * sy),
    h: box.h * Math.hypot(sin * sx, cos * sy),
    angle: Math.atan2(sin * sy, cos * sx),
  };
}

/**
 * The lines of text of `page` (an RGBA raster, 2000 pixels at most on its
 * long side), in reading order. `alphabet` is the recognition model's
 * classes (recognitionAlphabet). Rejects with OcrPackError `cancelled` when
 * the signal aborts, `load` when the recogniser does not match its dictionary.
 */
export async function readRaster(
  page: Raster,
  engine: OcrEngine,
  alphabet: readonly string[],
  options: ReadOptions = {},
): Promise<string[]> {
  const { onProgress, signal } = options;
  stopIfCancelled(signal);
  const size = detectionInputSize(page.width, page.height);
  const input = toDetectionTensor(resizeArea(page, size.width, size.height));
  const prob = await engine.detect(input, size.width, size.height);
  stopIfCancelled(signal);
  const boxes = boxesFromProbability(prob, size.width, size.height)
    .map((box) => toPage(box, page.width / size.width, page.height / size.height))
    .filter((box) => box.w >= MIN_BOX_SIDE && box.h >= MIN_BOX_SIDE);
  onProgress?.(DETECTION_SHARE);

  const read: ReadBox[] = [];
  for (const [i, box] of boxes.entries()) {
    const width = recognitionWidth(box.w, box.h);
    const crop = cropBox(page, box, width, RECOGNITION_HEIGHT);
    const output = await engine.recognize(toRecognitionTensor(crop), width);
    stopIfCancelled(signal);
    if (output.classes !== alphabet.length) {
      throw new OcrPackError(
        'load',
        `The recognition model has ${String(output.classes)} classes, its dictionary ${String(alphabet.length)}.`,
      );
    }
    const { text } = ctcGreedyDecode(output.data, output.steps, output.classes, alphabet);
    if (text !== '') read.push({ text, ...box });
    onProgress?.(DETECTION_SHARE + ((1 - DETECTION_SHARE) * (i + 1)) / boxes.length);
  }
  onProgress?.(1);
  return readingOrder(read);
}
