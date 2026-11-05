// SPDX-License-Identifier: MIT
// A prescription sent as a PDF: the text layer when the PDF has one (printed
// from a clinic's software), read with pdf.js, three pages at most; a page
// without text (a scan in a PDF) is handed to the OCR. pdf.js comes from the
// reading pack and is handed in, so the same code runs in the worker and,
// with the legacy build of the same version, in the tests. pdf.js opens an
// untrusted file: no XFA, no scripting (the pack has no pdf.sandbox and no
// annotation layer is drawn), no font faces, no system fonts, no WebAssembly
// decoders and no fetch of any kind (the bytes are given; no cMap, font or
// wasm URL is set). pdf.js 6 has no eval path at all (`isEvalSupported` is
// gone). docs/threat-model.md.
import { OcrPackError } from './ocr-pack.js';

/** A PDF is read up to its third page. */
export const MAX_PDF_PAGES = 3;

/** A page with fewer characters than this in its text layer is read as a scan. */
export const MIN_TEXT_CHARS = 20;

/** What readPdf uses of a text item of pdf.js (a marked content item has no `str`). */
export interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

export interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
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
}

export interface PdfReadOptions {
  /** Reads a page with no text layer (draws it and runs the OCR). */
  readScan: (page: PdfPageLike) => Promise<string[]>;
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
 * Reads the PDF `bytes` (handed over: pdf.js may detach them): the text
 * layer of each of its first three pages, or the OCR for a page without one.
 * Rejects with OcrPackError `pdf-password`, `pdf-damaged` or `cancelled`.
 */
export async function readPdf(
  pdfjs: PdfjsLike,
  bytes: Uint8Array,
  options: PdfReadOptions,
): Promise<PdfRead> {
  const { readScan, signal } = options;
  stopIfCancelled(signal);
  const task = pdfjs.getDocument({
    data: bytes,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: true,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: false,
    verbosity: 0,
    ...(options.CanvasFactory === undefined ? {} : { CanvasFactory: options.CanvasFactory }),
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
      if (text.join('').replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
        lines.push(...text);
      } else {
        scanned += 1;
        lines.push(...(await readScan(page)));
      }
      page.cleanup();
    }
    return { lines, pages, scanned };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
