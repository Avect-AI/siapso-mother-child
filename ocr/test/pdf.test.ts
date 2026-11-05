// SPDX-License-Identifier: MIT
// @vitest-environment node
// The PDF reading with the pdf.js of the pack (the legacy build of the same
// pdfjs-dist, which runs in Node), on synthetic PDFs made in the test.
import { describe, expect, it, vi } from 'vitest';
import { MAX_PDF_PAGES, linesFromTextItems, readPdf, type PdfjsLike } from '../src/pdf.js';
import { PRINTED_PAGE, makePdf } from './pdf-fixtures.js';

const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike;

const item = (str: string, x: number, y: number, width = str.length * 7, height = 14) => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width,
  height,
});

describe('linesFromTextItems', () => {
  it('puts the items of one baseline in a line, left to right, lines top to bottom', () => {
    expect(
      linesFromTextItems([
        item('1000 mg', 160, 640),
        item('Doliprane', 60, 641),
        item('1 cp x 3/j', 90, 615),
        item('ORDONNANCE', 230, 760),
      ]),
    ).toEqual(['ORDONNANCE', 'Doliprane 1000 mg', '1 cp x 3/j']);
  });

  it('joins the pieces of one word, and drops empty items and marks', () => {
    expect(
      linesFromTextItems([
        item('Dolip', 60, 640, 35),
        item('rane', 95, 640, 28),
        item(' ', 130, 640),
        { type: 'beginMarkedContent' },
        item('', 10, 10),
      ]),
    ).toEqual(['Doliprane']);
  });
});

describe('readPdf', () => {
  it('reads the text layer, page after page, with no drawing and no OCR', async () => {
    const readScan = vi.fn(() => Promise.resolve(['never']));
    const read = await readPdf(
      pdfjs,
      makePdf([PRINTED_PAGE, [{ text: 'Page deux : Spasfon Lyoc 80 mg', x: 60, y: 700 }]]),
      {
        readScan,
      },
    );
    expect(read.lines).toEqual([
      'ORDONNANCE',
      'Nom et prénom : Awa Diop',
      '1. Doliprane 1000 mg cp',
      '1 cp x 3/j si douleur',
      '2. Fer + Acide folique cp',
      'Signature et cachet',
      'Page deux : Spasfon Lyoc 80 mg',
    ]);
    expect(read).toMatchObject({ pages: 2, scanned: 0 });
    expect(readScan).not.toHaveBeenCalled();
  });

  it('hands a page with no text layer to the OCR, as a scan', async () => {
    const readScan = vi.fn(() => Promise.resolve(['Fer + Acide folique cp']));
    const read = await readPdf(pdfjs, makePdf([[]]), { readScan });
    expect(readScan).toHaveBeenCalledOnce();
    expect(read).toEqual({ lines: ['Fer + Acide folique cp'], pages: 1, scanned: 1 });
  });

  it(`reads ${String(MAX_PDF_PAGES)} pages at most`, async () => {
    const pages = Array.from({ length: 5 }, (_, i) => [
      { text: `Page ${String(i + 1)} : Doliprane 500 mg cp`, x: 60, y: 700 },
    ]);
    const read = await readPdf(pdfjs, makePdf(pages), { readScan: () => Promise.resolve([]) });
    expect(read.pages).toBe(3);
    expect(read.lines).toHaveLength(3);
  });

  it('says a PDF protected by a password is one', async () => {
    const protectedPdf = makePdf([PRINTED_PAGE], 'secret');
    await expect(
      readPdf(pdfjs, protectedPdf, { readScan: () => Promise.resolve([]) }),
    ).rejects.toMatchObject({ reason: 'pdf-password' });
  });

  it('says a damaged PDF cannot be opened', async () => {
    const damaged = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >>\ntruncated');
    await expect(
      readPdf(pdfjs, damaged, { readScan: () => Promise.resolve([]) }),
    ).rejects.toMatchObject({ reason: 'pdf-damaged' });
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readPdf(pdfjs, makePdf([PRINTED_PAGE]), {
        readScan: () => Promise.resolve([]),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
  });
});
