// SPDX-License-Identifier: MIT
// The reading itself, with the browser's APIs: the models loaded with ONNX
// Runtime Web from the installed pack (Cache API only), a photo or a camera
// frame decoded into pixels, a PDF read with pdf.js from the pack. The worker
// (ocr-worker.ts) runs it; the bench page runs it on the page thread too, where
// DevTools CPU throttling applies. No side effect at import.
import * as ort from 'onnxruntime-web/wasm';
import { recognitionAlphabet } from './ctc.js';
import { MAX_SIDE, checkFile, scaledSize } from './limits.js';
import { MODEL_FILES, OcrPackError, PDF_FILES, RUNTIME_FILES } from './ocr-pack.js';
import { packDecoders, readPdf, type PdfPageLike, type PdfjsLike } from './pdf.js';
import { readRaster, type OcrEngine } from './pipeline.js';
import type { OcrSource } from './protocol.js';
import type { Raster } from './raster.js';
import { readInstalledFile, withModuleUrl } from './runtime.js';

/** Bytes of a file read first, to tell what it is and its size in pixels. */
const HEAD_BYTES = 64 * 1024;

export interface LoadedEngine {
  baseUrl: string;
  engine: OcrEngine;
  alphabet: string[];
}

export interface Reading {
  lines: string[];
  source: OcrSource;
  pages: number;
}

/**
 * Loads the two models from the installed pack at `baseUrl`. ONNX Runtime's
 * loader is imported from a blob address, revoked once the models are loaded
 * (the workers of its threads start from it while they load), and its
 * WebAssembly handed over as bytes, so it fetches nothing. `onProgress`
 * receives 0 to 1.
 */
export async function loadEngine(
  baseUrl: string,
  threads: number,
  onProgress: (progress: number) => void = () => undefined,
): Promise<LoadedEngine> {
  return withModuleUrl(new URL(RUNTIME_FILES.mjs, baseUrl).href, (loader) =>
    loadModels(baseUrl, loader, threads, onProgress),
  );
}

async function loadModels(
  baseUrl: string,
  loader: string,
  threads: number,
  onProgress: (progress: number) => void,
): Promise<LoadedEngine> {
  const url = (path: string) => new URL(path, baseUrl).href;
  ort.env.wasm.wasmPaths = { mjs: loader };
  ort.env.wasm.wasmBinary = await readInstalledFile(url(RUNTIME_FILES.wasm));
  ort.env.wasm.numThreads = threads;
  // The exported graphs keep a few unused constants: ONNX Runtime warns once per constant.
  ort.env.logLevel = 'error';
  onProgress(0.1);
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    // Errors only: the exported graphs keep unused constants, one warning each.
    logSeverityLevel: 3,
  };
  const detection = await ort.InferenceSession.create(
    new Uint8Array(await readInstalledFile(url(MODEL_FILES.detection))),
    options,
  );
  onProgress(0.4);
  const recognition = await ort.InferenceSession.create(
    new Uint8Array(await readInstalledFile(url(MODEL_FILES.recognition))),
    options,
  );
  onProgress(0.9);
  const characters = JSON.parse(
    new TextDecoder().decode(await readInstalledFile(url(MODEL_FILES.dictionary))),
  ) as unknown;
  if (!Array.isArray(characters) || !characters.every((c) => typeof c === 'string')) {
    throw new OcrPackError('invalid', 'The dictionary of the recognition model is damaged.');
  }
  const engine: OcrEngine = {
    async detect(tensor, width, height) {
      const input = new ort.Tensor('float32', tensor, [1, 3, height, width]);
      const output = await detection.run({ [detection.inputNames[0] ?? 'x']: input });
      const map = output[detection.outputNames[0] ?? ''];
      if (map === undefined) throw new OcrPackError('load', 'The detection model gave nothing.');
      return map.data as Float32Array;
    },
    async recognize(tensor, width) {
      const input = new ort.Tensor('float32', tensor, [1, 3, 48, width]);
      const output = await recognition.run({ [recognition.inputNames[0] ?? 'x']: input });
      const probabilities = output[recognition.outputNames[0] ?? ''];
      if (probabilities === undefined) {
        throw new OcrPackError('load', 'The recognition model gave nothing.');
      }
      const [, steps = 0, classes = 0] = probabilities.dims;
      return { data: probabilities.data as Float32Array, steps, classes };
    },
  };
  onProgress(1);
  return { baseUrl, engine, alphabet: recognitionAlphabet(characters) };
}

let pdfjs: PdfjsLike | undefined;

/**
 * pdf.js from the pack: its worker code imported here first (it sets
 * `globalThis.pdfjsWorker`, so pdf.js parses in this very thread, with no
 * nested worker), then its API. Each is imported from a blob address,
 * revoked once imported.
 */
async function loadPdfjs(baseUrl: string): Promise<PdfjsLike> {
  if (pdfjs !== undefined) return pdfjs;
  const url = (path: string) => new URL(path, baseUrl).href;
  const parser = await withModuleUrl(url(PDF_FILES.worker), async (address) => {
    await import(/* @vite-ignore */ address);
    return address;
  });
  const api = await withModuleUrl(
    url(PDF_FILES.api),
    async (address) =>
      (await import(/* @vite-ignore */ address)) as PdfjsLike & {
        GlobalWorkerOptions: { workerSrc: string };
      },
  );
  // Never loaded: pdfjsWorker is set, so pdf.js starts no worker of its own.
  api.GlobalWorkerOptions.workerSrc = parser;
  pdfjs = api;
  return api;
}

/** pdf.js's canvases where there may be no document (a worker): OffscreenCanvas. */
export class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }

  reset(pair: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (pair.canvas === null) throw new Error('Canvas is not specified');
    pair.canvas.width = width;
    pair.canvas.height = height;
  }

  destroy(pair: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (pair.canvas !== null) {
      pair.canvas.width = 0;
      pair.canvas.height = 0;
    }
    pair.canvas = null;
    pair.context = null;
  }
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new OcrPackError('read', 'No canvas to read the image.');
  return context;
}

/** The pixels of a bitmap, its long side at MAX_SIDE at most; the bitmap is closed. */
export function rasterOf(bitmap: ImageBitmap): Raster {
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(width, height);
  const context = context2d(canvas);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = context.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return { width, height, data };
}

/** A PDF page with no text layer, drawn with its long side at MAX_SIDE. */
async function drawPage(page: PdfPageLike): Promise<Raster> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);
  const canvas = new OffscreenCanvas(width, height);
  const context = context2d(canvas);
  await page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
  const { data } = context.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return { width, height, data };
}

/** Decodes a photo once, already shrunk when it is larger than the reading needs. */
async function decode(blob: Blob, width: number, height: number): Promise<Raster> {
  const target = scaledSize(width, height);
  const long = width >= height ? 'resizeWidth' : 'resizeHeight';
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(
      blob,
      Math.max(width, height) > MAX_SIDE
        ? { [long]: Math.max(target.width, target.height), resizeQuality: 'high' }
        : {},
    );
  } catch (error) {
    throw new OcrPackError('not-image', 'The photo cannot be decoded.', { cause: error });
  }
  return rasterOf(bitmap);
}

/**
 * Reads a photo or a PDF (Blob) or a camera frame (ImageBitmap, closed once
 * drawn) with the loaded models. The image and its pixels are dropped when
 * this returns; only the lines remain.
 */
export async function readInput(
  input: Blob | ImageBitmap,
  loaded: LoadedEngine,
  onProgress: (progress: number) => void = () => undefined,
): Promise<Reading> {
  const { engine, alphabet } = loaded;
  if (!(input instanceof Blob)) {
    return {
      lines: await readRaster(rasterOf(input), engine, alphabet, { onProgress }),
      source: 'image',
      pages: 1,
    };
  }
  const head = new Uint8Array(await input.slice(0, HEAD_BYTES).arrayBuffer());
  const check = checkFile(head, input.size);
  if ('refused' in check) throw new OcrPackError(check.refused, 'This file cannot be read here.');
  if (check.kind !== 'pdf') {
    const raster = await decode(input, check.width, check.height);
    return {
      lines: await readRaster(raster, engine, alphabet, { onProgress }),
      source: 'image',
      pages: 1,
    };
  }
  const reader = await loadPdfjs(loaded.baseUrl);
  const result = await readPdf(reader, new Uint8Array(await input.arrayBuffer()), {
    readScan: async (page) => readRaster(await drawPage(page), engine, alphabet, { onProgress }),
    CanvasFactory: OffscreenCanvasFactory,
    // The image decoders of scans, from the pack in the cache: never fetched.
    BinaryDataFactory: packDecoders((path) =>
      readInstalledFile(new URL(path, loaded.baseUrl).href),
    ),
  });
  return {
    lines: result.lines,
    source: result.scanned > 0 ? 'pdf-scan' : 'pdf-text',
    pages: result.pages,
  };
}
