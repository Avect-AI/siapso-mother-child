// SPDX-License-Identifier: MIT
// A prescription sent as a PDF, read with pdf.js, three pages at most: the
// text layer of a page printed from a clinic's software; the OCR for a page
// a scanner made (a scan in a PDF), merged with its text layer when it has
// one (a typed footer, or the scanner's own invisible reading, never taken
// alone). pdf.js comes from the reading pack and is handed in, so the same
// code runs in the worker and, with the legacy build of the same version,
// in the tests. pdf.js opens an untrusted file: no XFA, no scripting (the
// pack has no pdf.sandbox and no annotation layer is drawn), no font faces,
// no system fonts, a PDF with an image or a mask of more than
// MAX_PDF_IMAGE_PIXELS refused as too large (read from its bytes first,
// pdf-images.ts, then pdf.js's maxImageSize), and no fetch of any kind: the bytes are
// given, no cMap, font or ICC address is set, and its WebAssembly image
// decoders come from the pack through packDecoders. pdf.js 6 has no eval
// path at all (`isEvalSupported` is gone). docs/threat-model.md.
import { MAX_PDF_IMAGE_PIXELS } from './limits.js';
import { OcrPackError, PDF_FILES } from './ocr-pack.js';
import { oversizedImage } from './pdf-images.js';

/** A PDF is read up to its third page. */
export const MAX_PDF_PAGES = 3;

/**
 * A page whose images cover more than this share of it is read by the OCR
 * too, whatever its text layer says: a scan with a typed footer, or with the
 * invisible text layer a scanner adds (its own reading, never trusted alone).
 * A logo or a stamp covers far less.
 */
export const LARGE_IMAGE_SHARE = 0.25;

/** What readPdf uses of a text item of pdf.js (a marked content item has no `str`). */
export interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

/** The drawing operations of a page, as pdf.js lists them. */
export interface PdfOperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

export interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  getOperatorList(): Promise<PdfOperatorList>;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: unknown; viewport: unknown; background?: string }): {
    promise: Promise<void>;
  };
  cleanup(): unknown;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(number: number): Promise<PdfPageLike>;
}

/** What readPdf uses of the pdf.js module. */
export interface PdfjsLike {
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfDocumentLike>;
    destroy(): Promise<void>;
  };
  /** The codes of the drawing operations (pdf.js `OPS`). */
  OPS: Readonly<Record<string, number>>;
}

/**
 * The folder pdf.js is told its WebAssembly decoders are in: not an address
 * it could fetch. pdf.js reads the decoders through the BinaryDataFactory it
 * is given (packDecoders), and only when a decoder fails does it import a
 * JavaScript fallback from this folder, which then fails at once, with no
 * request (an unknown scheme), and leaves that image out.
 */
export const PDF_WASM_URL = 'siapso-ocr-pack:/pdf/wasm/';

/** The decoders pdf.js may ask for, by file name, and where the pack has them. */
const DECODERS = new Map<string, string>([
  ['jbig2.wasm', PDF_FILES.jbig2],
  ['openjpeg.wasm', PDF_FILES.openjpeg],
]);

/**
 * pdf.js's BinaryDataFactory (its getDocument option) for a place with no
 * document and no fetch: pdf.js asks it for its JBIG2 and CCITT decoder
 * (jbig2.wasm) and its JPEG 2000 decoder (openjpeg.wasm), and `read` gives
 * the bytes of that file of the pack (its path in the pack), from the cache
 * only in the worker. Anything else pdf.js may ask for (a cMap, a standard
 * font, the colour or script engines) is refused, never fetched.
 */
export function packDecoders(read: (path: string) => Promise<ArrayBuffer | Uint8Array>): unknown {
  return class PackDecoders {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const path = kind === 'wasmUrl' ? DECODERS.get(filename) : undefined;
      if (path === undefined) {
        throw new Error(`pdf.js asked for ${kind} ${filename}, which is not in the reading pack.`);
      }
      return new Uint8Array(await read(path));
    }
  };
}

export interface PdfReadOptions {
  /** Reads a page with no text layer (draws it and runs the OCR). */
  readScan: (page: PdfPageLike) => Promise<string[]>;
  /** pdf.js's reader of its image decoders: packDecoders over the pack's files. */
  BinaryDataFactory: unknown;
  signal?: AbortSignal;
  /** pdf.js's canvas factory where there is no document (a worker): OffscreenCanvas. */
  CanvasFactory?: unknown;
}

export interface PdfRead {
  lines: string[];
  /** The pages read. */
  pages: number;
  /** Of which read as scans, by the OCR. */
  scanned: number;
}

function isTextItem(
  value: unknown,
): value is Required<Pick<PdfTextItemLike, 'str' | 'transform'>> & PdfTextItemLike {
  if (typeof value !== 'object' || value === null) return false;
  const { str, transform } = value as PdfTextItemLike;
  return typeof str === 'string' && Array.isArray(transform) && transform.length >= 6;
}

/**
 * The lines of a page from its text items: items on one baseline (within
 * half their height) form a line, left to right; lines go top to bottom (PDF
 * heights grow upwards). Two pieces of one word (no gap between them) are
 * joined without a space.
 */
export function linesFromTextItems(items: readonly unknown[]): string[] {
  const rows: { y: number; size: number; items: { x: number; end?: number; str: string }[] }[] = [];
  for (const raw of items) {
    if (!isTextItem(raw) || raw.str.trim() === '') continue;
    const [a = 0, b = 0, , , x = 0, y = 0] = raw.transform;
    const size = raw.height !== undefined && raw.height > 0 ? raw.height : Math.hypot(a, b) || 10;
    const end = raw.width !== undefined && raw.width > 0 ? x + raw.width : undefined;
    const piece = { x, str: raw.str, ...(end === undefined ? {} : { end }) };
    const row = rows.find((r) => Math.abs(r.y - y) <= 0.5 * Math.min(r.size, size));
    if (row === undefined) rows.push({ y, size, items: [piece] });
    else row.items.push(piece);
  }
  return rows
    .sort((r1, r2) => r2.y - r1.y)
    .map((row) => {
      const sorted = row.items.sort((p, q) => p.x - q.x);
      let text = '';
      let previous: (typeof sorted)[number] | undefined;
      for (const piece of sorted) {
        const touching = previous?.end !== undefined && piece.x - previous.end < 0.15 * row.size;
        text += previous === undefined || touching ? piece.str : ` ${piece.str}`;
        previous = piece;
      }
      return text.replace(/\s+/g, ' ').trim();
    })
    .filter((line) => line !== '');
}

const fold = (line: string) =>
  line.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A strength (500 mg, 1 g, 5 ml, 100 000 UI, 2 %) or a form (cp, gelule,
 * sirop, ampoule...): what a line naming a product of a prescription has,
 * and a footer or a header has not. Matched on the line without accents.
 */
const PRODUCT_LIKE =
  /\d\s*(?:mg|g|mcg|ug|µg|μg|ml|l|ui|u\.i\.|%)(?![a-z])|\b(?:cp|cpr|comprimes?|gel|gelules?|caps|capsules?|sirop|sachets?|amp|ampoules?|inj|injectable|suppo|suppositoires?|pommade|creme|gouttes?|flacon|collyre|ovules?|patch)\b/;

/** Whether one of `lines` reads like a product of a prescription. */
export function hasProductLine(lines: readonly string[]): boolean {
  return lines.some((line) => PRODUCT_LIKE.test(fold(line)));
}

/**
 * The lines of a page read both ways: its text layer, then the lines the
 * OCR read that the text layer does not already give (each typed line
 * stands for one line read, letter case, accents and spaces apart).
 */
export function mergeLines(typed: readonly string[], read: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const line of typed) left.set(fold(line), (left.get(fold(line)) ?? 0) + 1);
  const added = read.filter((line) => {
    const count = left.get(fold(line)) ?? 0;
    if (count === 0) return true;
    left.set(fold(line), count - 1);
    return false;
  });
  return [...typed, ...added];
}

const determinant = (m: ArrayLike<number>) =>
  Math.abs((m[0] ?? 0) * (m[3] ?? 0) - (m[1] ?? 0) * (m[2] ?? 0));

const isMatrix = (value: unknown): value is ArrayLike<number> =>
  typeof value === 'object' && value !== null && (value as ArrayLike<number>).length === 6;

/**
 * The share of the page (`pageArea`, in its units) its images cover, from
 * its drawing operations: each image is the unit square under the current
 * transform, so it covers the area its determinant gives (clipping aside).
 * Over 1 when images overlap; that is enough to tell a scan from a logo.
 */
export function imageShare(
  list: PdfOperatorList,
  ops: Readonly<Record<string, number>>,
  pageArea: number,
): number {
  const op = (name: string) => ops[name] ?? -1;
  // Only the scale of the transform matters for areas: determinants multiply.
  const stack: number[] = [];
  let scale = 1;
  let covered = 0;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = (list.argsArray[i] ?? []) as unknown[];
    if (fn === op('save') || fn === op('paintFormXObjectBegin')) {
      stack.push(scale);
      if (fn === op('paintFormXObjectBegin') && isMatrix(args[0])) scale *= determinant(args[0]);
    } else if (fn === op('restore') || fn === op('paintFormXObjectEnd')) {
      scale = stack.pop() ?? 1;
    } else if (fn === op('transform')) {
      scale *= determinant(args as ArrayLike<number>);
    } else if (
      fn === op('paintImageXObject') ||
      fn === op('paintInlineImageXObject') ||
      fn === op('paintImageMaskXObject') ||
      fn === op('paintSolidColorImageMask')
    ) {
      covered += scale;
    } else if (fn === op('paintImageXObjectRepeat')) {
      const [, scaleX, scaleY, positions] = args as [
        unknown,
        number | undefined,
        number | undefined,
        ArrayLike<number> | undefined,
      ];
      covered += scale * Math.abs((scaleX ?? 0) * (scaleY ?? 0)) * ((positions?.length ?? 0) / 2);
    } else if (fn === op('paintImageMaskXObjectRepeat')) {
      const [, a, b, c, d, positions] = args as [
        unknown,
        number | undefined,
        number | undefined,
        number | undefined,
        number | undefined,
        ArrayLike<number> | undefined,
      ];
      covered +=
        scale *
        determinant([a ?? 0, b ?? 0, c ?? 0, d ?? 0, 0, 0]) *
        ((positions?.length ?? 0) / 2);
    } else if (
      fn === op('paintImageMaskXObjectGroup') ||
      fn === op('paintInlineImageXObjectGroup')
    ) {
      const images = (fn === op('paintImageMaskXObjectGroup') ? args[0] : args[1]) ?? [];
      for (const image of images as { transform?: unknown }[]) {
        if (isMatrix(image.transform)) covered += scale * determinant(image.transform);
      }
    }
  }
  return pageArea > 0 ? covered / pageArea : 0;
}

/** What pdf.js says when it leaves out an image larger than maxImageSize (pdf.js 6.4.299). */
const IMAGE_LEFT_OUT = 'Image exceeded maximum allowed size and was removed.';

/**
 * Watches pdf.js's warnings while a PDF is read (pdf.js parses in this very
 * thread, and says them with console.warn): `onWarning` gets each, and they
 * are not printed. Returns the function that stops watching. One reading at
 * a time: the reading worker reads in order.
 */
function watchWarnings(onWarning: (message: string) => void): () => void {
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === 'string' && first.startsWith('Warning: ')) {
      onWarning(first);
      return;
    }
    original.apply(console, args);
  };
  return () => {
    console.warn = original;
  };
}

function stopIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new OcrPackError('cancelled', 'The reading was cancelled.');
}

function openError(error: unknown): OcrPackError {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : '';
  if (name === 'PasswordException') {
    return new OcrPackError('pdf-password', 'The PDF is protected by a password.', {
      cause: error,
    });
  }
  return new OcrPackError('pdf-damaged', 'The PDF cannot be opened.', { cause: error });
}

/**
 * Whether a page with a text layer `typed` is read by the OCR too: when no
 * line of it reads like a product, or when its images cover more than
 * LARGE_IMAGE_SHARE of it (a scan). A page that cannot be listed is read too.
 */
async function needsOcr(
  page: PdfPageLike,
  typed: readonly string[],
  pdfjs: PdfjsLike,
): Promise<boolean> {
  if (!hasProductLine(typed)) return true;
  const { width, height } = page.getViewport({ scale: 1 });
  try {
    return imageShare(await page.getOperatorList(), pdfjs.OPS, width * height) > LARGE_IMAGE_SHARE;
  } catch {
    return true;
  }
}

/**
 * Reads the PDF `bytes` (handed over: pdf.js may detach them), its first
 * three pages: the text layer of a typed page; the OCR for a page with no
 * text, no line like a product, or a large image, merged with its text layer
 * (mergeLines). Rejects with OcrPackError `pdf-password`, `pdf-damaged`,
 * `too-large` (an image or a mask of more than MAX_PDF_IMAGE_PIXELS),
 * `pdf-unsupported` (an image size that cannot be read from the file, see
 * pdf-images.ts) or `cancelled`.
 */
export async function readPdf(
  pdfjs: PdfjsLike,
  bytes: Uint8Array,
  options: PdfReadOptions,
): Promise<PdfRead> {
  const { readScan, signal } = options;
  stopIfCancelled(signal);
  // First, from the file's bytes: pdf.js checks maxImageSize against the
  // painted image only, not its masks nor the size of JPEG data.
  const refused = oversizedImage(bytes, MAX_PDF_IMAGE_PIXELS);
  if (refused?.reason === 'too-large') {
    throw new OcrPackError('too-large', `The PDF is too large for this phone: ${refused.why}.`);
  }
  if (refused !== null) {
    throw new OcrPackError(
      'pdf-unsupported',
      `This PDF cannot be read safely here: ${refused.why}.`,
    );
  }
  let leftOut = false;
  const stopIfLeftOut = () => {
    if (leftOut) {
      throw new OcrPackError('too-large', 'An image of the PDF is too large for this phone.');
    }
  };
  const task = pdfjs.getDocument({
    data: bytes,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    // The decoders of scanned images (JBIG2, CCITT fax, JPEG 2000) are
    // WebAssembly: pdf.js asks BinaryDataFactory for them (the pack's files,
    // from the cache only), never the network; PDF_WASM_URL is no address.
    useWorkerFetch: false,
    useWasm: true,
    wasmUrl: PDF_WASM_URL,
    BinaryDataFactory: options.BinaryDataFactory,
    isOffscreenCanvasSupported: true,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: false,
    // A second line: larger images are left out with a warning, which watchWarnings sees.
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    verbosity: 1,
    ...(options.CanvasFactory === undefined ? {} : { CanvasFactory: options.CanvasFactory }),
  });
  // From here on, before pdf.js parses anything (it starts once this returns).
  const stopWatching = watchWarnings((message) => {
    if (message.includes(IMAGE_LEFT_OUT)) leftOut = true;
  });
  try {
    let doc: PdfDocumentLike;
    try {
      doc = await task.promise;
    } catch (error) {
      throw openError(error);
    }
    const lines: string[] = [];
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    let scanned = 0;
    for (let n = 1; n <= pages; n++) {
      stopIfCancelled(signal);
      let page: PdfPageLike;
      let text: string[];
      try {
        page = await doc.getPage(n);
        text = linesFromTextItems((await page.getTextContent()).items);
      } catch (error) {
        throw openError(error);
      }
      const scan = await needsOcr(page, text, pdfjs);
      stopIfLeftOut();
      if (scan) {
        // Drawn afresh for the OCR: what was listed to decide is let go first.
        page.cleanup();
        scanned += 1;
        lines.push(...mergeLines(text, await readScan(page)));
        stopIfLeftOut();
      } else {
        lines.push(...text);
      }
      page.cleanup();
    }
    return { lines, pages, scanned };
  } finally {
    stopWatching();
    await task.destroy().catch(() => undefined);
  }
}
