// SPDX-License-Identifier: MIT
// @vitest-environment node
// The PDF reading with the pdf.js of the pack (the legacy build of the same
// pdfjs-dist, which runs in Node), on synthetic PDFs made in the test, and
// on the scanned page fixtures (fixtures/README.md). pdf.js's WebAssembly
// image decoders are read from the installed pdfjs-dist here, as the worker
// reads them from the pack: through packDecoders, never fetched.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PDF_IMAGE_PIXELS } from '../src/limits.js';
import { PDF_FILES } from '../src/ocr-pack.js';
import { oversizedImage } from '../src/pdf-images.js';
import {
  MAX_PDF_PAGES,
  PDF_WASM_URL,
  hasProductLine,
  imageShare,
  linesFromTextItems,
  mergeLines,
  packDecoders,
  readPdf,
  type PdfPageLike,
  type PdfjsLike,
} from '../src/pdf.js';
import {
  PRINTED_PAGE,
  ccittScan,
  flateImage,
  jbig2Scan,
  jpxScan,
  makePdf,
  type PdfImage,
} from './pdf-fixtures.js';

const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike & {
  OPS: Record<string, number>;
};
const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/** The pack files pdf.js asked for, through the decoders' reader. */
const asked: string[] = [];
const decoders = packDecoders(async (file) => {
  asked.push(file);
  return readFile(path.join(pdfjsDir, 'wasm', path.posix.basename(file)));
});

const item = (str: string, x: number, y: number, width = str.length * 7, height = 14) => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width,
  height,
});

interface DecodedImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray | null;
}

/**
 * The share of dark pixels in the images pdf.js decoded for `page`, as the
 * OCR would see them drawn: 0 when it decoded none (a blank page).
 */
async function inked(page: PdfPageLike): Promise<number> {
  type Objects = { get(id: string, callback: (data: unknown) => void): void };
  const proxy = page as unknown as {
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
    objs: Objects;
    commonObjs: Objects;
  };
  const list = await proxy.getOperatorList();
  const ids = list.fnArray.flatMap((fn, i) =>
    fn === pdfjs.OPS['paintImageXObject'] ? [String(list.argsArray[i]?.[0])] : [],
  );
  // An image arrives once decoded, or as null when pdf.js could not decode it.
  const images = await Promise.all(
    ids.map(
      (id) =>
        new Promise<DecodedImage | null>((resolve) => {
          (id.startsWith('g_') ? proxy.commonObjs : proxy.objs).get(id, (data) => {
            resolve(data as DecodedImage | null);
          });
        }),
    ),
  );
  let dark = 0;
  let total = 0;
  images.forEach((image) => {
    if (image === null) return;
    const { width, height, kind, data } = image;
    if (data === undefined || data === null) return;
    total += width * height;
    if (kind === 1) {
      // One bit a pixel, rows padded to a byte: 0 is black.
      const row = Math.ceil(width / 8);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (((data[y * row + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) === 0) dark += 1;
        }
      }
    } else {
      const step = kind === 2 ? 3 : 4;
      for (let at = 0; at < width * height * step; at += step) {
        if ((data[at] ?? 255) < 128) dark += 1;
      }
    }
  });
  return total === 0 ? 0 : dark / total;
}

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
      { readScan, BinaryDataFactory: decoders },
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
    const read = await readPdf(pdfjs, makePdf([[]]), { readScan, BinaryDataFactory: decoders });
    expect(readScan).toHaveBeenCalledOnce();
    expect(read).toEqual({ lines: ['Fer + Acide folique cp'], pages: 1, scanned: 1 });
  });

  it(`reads ${String(MAX_PDF_PAGES)} pages at most`, async () => {
    const pages = Array.from({ length: 5 }, (_, i) => [
      { text: `Page ${String(i + 1)} : Doliprane 500 mg cp`, x: 60, y: 700 },
    ]);
    const read = await readPdf(pdfjs, makePdf(pages), {
      readScan: () => Promise.resolve([]),
      BinaryDataFactory: decoders,
    });
    expect(read.pages).toBe(3);
    expect(read.lines).toHaveLength(3);
  });

  it('says a PDF protected by a password is one', async () => {
    const protectedPdf = makePdf([PRINTED_PAGE], 'secret');
    await expect(
      readPdf(pdfjs, protectedPdf, {
        readScan: () => Promise.resolve([]),
        BinaryDataFactory: decoders,
      }),
    ).rejects.toMatchObject({ reason: 'pdf-password' });
  });

  it('says a damaged PDF cannot be opened', async () => {
    const damaged = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >>\ntruncated');
    await expect(
      readPdf(pdfjs, damaged, { readScan: () => Promise.resolve([]), BinaryDataFactory: decoders }),
    ).rejects.toMatchObject({ reason: 'pdf-damaged' });
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readPdf(pdfjs, makePdf([PRINTED_PAGE]), {
        readScan: () => Promise.resolve([]),
        BinaryDataFactory: decoders,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
  });

  it('opens the file with nothing to fetch: the bytes given, decoders from the pack only', async () => {
    let params: Record<string, unknown> = {};
    const watched: PdfjsLike = {
      ...pdfjs,
      getDocument: (given) => {
        params = given;
        return pdfjs.getDocument(given);
      },
    };
    await readPdf(watched, makePdf([PRINTED_PAGE]), {
      readScan: () => Promise.resolve([]),
      BinaryDataFactory: decoders,
    });
    expect(params).toMatchObject({
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: true,
      wasmUrl: PDF_WASM_URL,
      BinaryDataFactory: decoders,
      maxImageSize: MAX_PDF_IMAGE_PIXELS,
    });
    for (const key of ['url', 'cMapUrl', 'standardFontDataUrl', 'iccUrl', 'docBaseUrl']) {
      expect(params[key], key).toBeUndefined();
    }
    // The fallback pdf.js imports when a decoder fails is never an address it could fetch.
    expect(PDF_WASM_URL).not.toMatch(/^(https?|file|blob|data|ftp|wss?):/i);
    expect(new URL(PDF_WASM_URL).protocol).toBe('siapso-ocr-pack:');
  });
});

describe('readPdf: scanned pages', () => {
  const scans: [string, () => PdfImage, string][] = [
    ['CCITT Group 4', ccittScan, 'jbig2.wasm'],
    ['JBIG2', jbig2Scan, 'jbig2.wasm'],
    ['JPEG 2000', jpxScan, 'openjpeg.wasm'],
  ];

  for (const [name, scan, decoder] of scans) {
    it(`decodes a ${name} scan with the decoder of the pack, and hands it to the OCR`, async () => {
      let share = 0;
      const read = await readPdf(pdfjs, makePdf([{ image: scan() }]), {
        BinaryDataFactory: decoders,
        readScan: async (page) => {
          share = await inked(page);
          return ['read by the OCR'];
        },
      });
      expect(read).toEqual({ lines: ['read by the OCR'], pages: 1, scanned: 1 });
      // The printed lines take a few percent of the page: never a blank page.
      expect(share).toBeGreaterThan(0.01);
      expect(share).toBeLessThan(0.3);
      expect(asked).toContain(`pdf/6.4.299/wasm/${decoder}`);
    });
  }

  it('asked the pack for each decoder once (pdf.js keeps it for the next file), nothing else', () => {
    expect([...asked].sort()).toEqual([PDF_FILES.jbig2, PDF_FILES.openjpeg]);
  });

  it('reads the OCR too on a scanned page with a typed footer, and the footer once', async () => {
    const footer = 'Clinique de Test, 12 rue des Essais, Dakar, tel 33 800 00 00';
    const readScan = vi.fn(() =>
      Promise.resolve([
        'ORDONNANCE',
        '1. Doliprane 1000 mg cp',
        'Clinique  de test, 12 rue des Essais, Dakar, tel 33 800 00 00',
      ]),
    );
    const read = await readPdf(
      pdfjs,
      makePdf([{ image: ccittScan(), lines: [{ text: footer, x: 40, y: 30, size: 9 }] }]),
      { readScan, BinaryDataFactory: decoders },
    );
    expect(readScan).toHaveBeenCalledOnce();
    expect(read).toEqual({
      lines: [footer, 'ORDONNANCE', '1. Doliprane 1000 mg cp'],
      pages: 1,
      scanned: 1,
    });
  });

  it('does not trust an invisible text layer over a scan: the OCR reads the image too', async () => {
    // A scanner's own reading, wrong: the OCR's lines are kept with it.
    const readScan = vi.fn(() => Promise.resolve(['1. Doliprane 1000 mg cp']));
    const read = await readPdf(
      pdfjs,
      makePdf([
        {
          image: ccittScan(),
          lines: [{ text: '1. Dolipane 100 mg cp', x: 60, y: 640, invisible: true }],
        },
      ]),
      { readScan, BinaryDataFactory: decoders },
    );
    expect(readScan).toHaveBeenCalledOnce();
    expect(read.lines).toEqual(['1. Dolipane 100 mg cp', '1. Doliprane 1000 mg cp']);
  });

  it('reads the OCR too when the text layer has no line like a product', async () => {
    const readScan = vi.fn(() => Promise.resolve(['2. Amoxicilline 500 mg gél']));
    const read = await readPdf(
      pdfjs,
      makePdf([[{ text: 'Centre de santé de test, service de maternité', x: 60, y: 800 }]]),
      { readScan, BinaryDataFactory: decoders },
    );
    expect(readScan).toHaveBeenCalledOnce();
    expect(read).toEqual({
      lines: ['Centre de santé de test, service de maternité', '2. Amoxicilline 500 mg gél'],
      pages: 1,
      scanned: 1,
    });
  });

  it('keeps a typed prescription with a small logo to its text layer: no OCR', async () => {
    const readScan = vi.fn(() => Promise.resolve(['never']));
    const logo = { ...ccittScan(), rect: [40, 770, 50, 50] as const };
    const read = await readPdf(pdfjs, makePdf([{ image: logo, lines: PRINTED_PAGE }]), {
      readScan,
      BinaryDataFactory: decoders,
    });
    expect(readScan).not.toHaveBeenCalled();
    expect(read).toMatchObject({ pages: 1, scanned: 0 });
    expect(read.lines).toContain('1. Doliprane 1000 mg cp');
  });
});

describe('readPdf: images too large for the phone', () => {
  const tooLarge = () => flateImage(6000, Math.ceil(MAX_PDF_IMAGE_PIXELS / 6000) + 1);

  it('refuses a scanned page whose image has more pixels than the phone decodes, as too large', async () => {
    await expect(
      readPdf(pdfjs, makePdf([{ image: tooLarge() }]), {
        // As the worker draws the page: pdf.js parses it, and leaves the image out.
        readScan: async (page) => {
          await inked(page);
          return [];
        },
        BinaryDataFactory: decoders,
      }),
    ).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('refuses it on a typed page too, rather than a reading with a page missing', async () => {
    const readScan = vi.fn(() => Promise.resolve([]));
    await expect(
      readPdf(pdfjs, makePdf([{ image: tooLarge(), lines: PRINTED_PAGE }]), {
        readScan,
        BinaryDataFactory: decoders,
      }),
    ).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('reads an image at the limit', async () => {
    const side = Math.floor(Math.sqrt(MAX_PDF_IMAGE_PIXELS));
    const read = await readPdf(pdfjs, makePdf([{ image: flateImage(side, side) }]), {
      readScan: async (page) => {
        await inked(page);
        return ['read'];
      },
      BinaryDataFactory: decoders,
    });
    expect(read.lines).toEqual(['read']);
  });
});

describe('readPdf: masks and image data larger than their image', () => {
  // pdf.js checks maxImageSize against the painted image only: a soft mask,
  // a stencil mask or the image data of a JPEG or JPEG 2000 stream can be far
  // larger, and are decoded at their own size. The file's bytes say them all.
  const small = (entries = '') => ({
    dict: `/Width 10 /Height 10 /ColorSpace /DeviceGray /BitsPerComponent 8 ${entries}`,
    data: new Uint8Array(100),
  });
  const side = Math.floor(Math.sqrt(MAX_PDF_IMAGE_PIXELS));
  const softMask = (width: number, height: number) => ({
    dict: `/Type /XObject /Subtype /Image /Width ${String(width)} /Height ${String(height)} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
    data: new Uint8Array(deflateSync(new Uint8Array(64))),
  });
  // The page is never drawn here: a refusal comes before pdf.js decodes anything.
  const read = (pdf: Uint8Array) =>
    readPdf(pdfjs, pdf, { readScan: () => Promise.resolve(['read']), BinaryDataFactory: decoders });

  it('refuses a small image whose soft mask has more pixels than the phone decodes', async () => {
    const pdf = makePdf([{ image: small('/SMask @0 0 R') }], undefined, [softMask(6000, 4000)]);
    await expect(read(pdf)).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('refuses a small image whose stencil mask has more pixels than the phone decodes', async () => {
    const mask = {
      dict: '/Type /XObject /Subtype /Image /Width 6000 /Height 4000 /ImageMask true /BitsPerComponent 1',
      data: new Uint8Array(64),
    };
    const pdf = makePdf([{ image: small('/Mask @0 0 R') }], undefined, [mask]);
    await expect(read(pdf)).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('reads a PDF whose mask is at the limit', async () => {
    const pdf = makePdf([{ image: small('/SMask @0 0 R') }], undefined, [softMask(side, side)]);
    expect((await read(pdf)).lines).toEqual(['read']);
  });

  it('reads a size given by another object, and refuses a size it cannot read', async () => {
    const sized = (width: string) =>
      makePdf([{ image: small('/SMask @0 0 R') }], undefined, [
        { ...softMask(1, 4000), dict: softMask(1, 4000).dict.replace('/Width 1', '/Width @1 0 R') },
        { value: width },
      ]);
    await expect(read(sized('6000'))).rejects.toMatchObject({ reason: 'too-large' });
    expect((await read(sized('10'))).lines).toEqual(['read']);
    // An object that is not in the file as such (in an object stream, or missing): refused.
    const unreadable = makePdf([{ image: small('/SMask @0 0 R') }], undefined, [
      { ...softMask(1, 4000), dict: softMask(1, 4000).dict.replace('/Width 1', '/Width 999 0 R') },
    ]);
    await expect(read(unreadable)).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('reads names written with escapes and no spaces, and a mask with no /Subtype', async () => {
    const escaped = {
      dict: '/Type/XObject/Sub#74ype/Im#61ge/W#69dth 6000/He#69ght 4000/ColorSpace/DeviceGray/BitsPerComponent 8',
      data: new Uint8Array(64),
    };
    await expect(
      read(makePdf([{ image: small('/SMask @0 0 R') }], undefined, [escaped])),
    ).rejects.toMatchObject({ reason: 'too-large' });
    const bare = { dict: '/W 6000 /H 4000 /BitsPerComponent 8', data: new Uint8Array(64) };
    await expect(
      read(makePdf([{ image: small('/SMask @0 0 R') }], undefined, [bare])),
    ).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('refuses JPEG 2000 data larger than its image says (pdf.js decodes the size of the data)', async () => {
    const { dict, data } = jpxScan();
    const larger = data.slice();
    // The SIZ marker: Xsiz and Ysiz, 6000 x 4000.
    const at = larger.findIndex((byte, i) => byte === 0xff && larger[i + 1] === 0x51);
    new DataView(larger.buffer).setUint32(at + 6, 6000);
    new DataView(larger.buffer).setUint32(at + 10, 4000);
    await expect(read(makePdf([{ image: { dict, data: larger } }]))).rejects.toMatchObject({
      reason: 'too-large',
    });
  });

  it('refuses JPEG data larger than its image says, and JPEG data it cannot read', async () => {
    // A frame header of 6000 x 4000 pixels behind a dictionary of 10 x 10.
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x17, 0x70, 0x03, 0x01, 0x22, 0x00,
      0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
    ]);
    const dct = {
      dict: '/Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
      data: jpeg,
    };
    await expect(read(makePdf([{ image: dct }]))).rejects.toMatchObject({ reason: 'too-large' });
    // Compressed again before the JPEG decoder: its size cannot be read from the file.
    const hidden = {
      dict: '/Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/FlateDecode /DCTDecode]',
      data: new Uint8Array(deflateSync(jpeg)),
    };
    await expect(read(makePdf([{ image: hidden }]))).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('leaves inline images to pdf.js, which applies its limit to them and to inline masks', async () => {
    // An inline image lives in a content stream, often compressed: the file's
    // bytes do not show it. pdf.js leaves out one over maxImageSize, and its
    // warning makes the PDF refused (the second line of the check).
    const zeros = String.fromCharCode(...deflateSync(new Uint8Array(3_000_000)));
    for (const kind of ['/CS /G /BPC 1', '/IM true']) {
      const content = `q 595 0 0 842 0 0 cm BI /W 6000 /H 4000 ${kind} /F /Fl ID ${zeros} EI Q\n`;
      const pdf = makePdf([{ content }]);
      expect(oversizedImage(pdf, MAX_PDF_IMAGE_PIXELS)).toBeNull();
      await expect(
        readPdf(pdfjs, pdf, {
          readScan: async (page) => {
            await inked(page);
            return [];
          },
          BinaryDataFactory: decoders,
        }),
        kind,
      ).rejects.toMatchObject({ reason: 'too-large' });
    }
  });

  it('reads the scanned fixtures and a typed page as before', async () => {
    for (const image of [ccittScan(), jbig2Scan(), jpxScan()]) {
      expect((await read(makePdf([{ image }]))).lines).toEqual(['read']);
    }
    expect((await read(makePdf([PRINTED_PAGE]))).lines).toContain('1. Doliprane 1000 mg cp');
  });
});

describe('packDecoders', () => {
  it('reads pdf.js decoders from the pack, and refuses any other file it may ask for', async () => {
    const read = vi.fn(() => Promise.resolve(new Uint8Array([0, 97, 115, 109])));
    const Factory = packDecoders(read) as new (options: unknown) => {
      fetch(request: { kind: string; filename: string }): Promise<Uint8Array>;
    };
    const factory = new Factory({ wasmUrl: PDF_WASM_URL });
    expect(await factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' })).toEqual(
      new Uint8Array([0, 97, 115, 109]),
    );
    await factory.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' });
    expect(read.mock.calls).toEqual([[PDF_FILES.jbig2], [PDF_FILES.openjpeg]]);
    for (const request of [
      { kind: 'wasmUrl', filename: 'qcms_bg.wasm' },
      { kind: 'wasmUrl', filename: 'quickjs-eval.wasm' },
      { kind: 'wasmUrl', filename: '../pdf.min.mjs' },
      { kind: 'cMapUrl', filename: 'UniJIS-UCS2-H.bcmap' },
      { kind: 'standardFontDataUrl', filename: 'FoxitSans.pfb' },
    ]) {
      await expect(factory.fetch(request), request.filename).rejects.toThrow(
        /not in the reading pack/,
      );
    }
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('the rule of a page read by the OCR too', () => {
  it('tells a line like a product from a header or a footer', () => {
    for (const line of [
      '1. Doliprane 1000 mg cp',
      'Amoxicilline 1 g',
      'Vitamine D3 100 000 UI',
      'Spasfon Lyoc 80mg',
      'Fer + Acide folique comprimé',
      'Sirop pour la toux',
      'Bétadine 10 %',
    ]) {
      expect(hasProductLine([line]), line).toBe(true);
    }
    for (const line of [
      'Centre de santé de test, service de maternité',
      'Clinique de Test, 12 rue des Essais, Dakar, tel 33 800 00 00',
      'Dakar, le 5 novembre 2026',
      'Signature et cachet',
    ]) {
      expect(hasProductLine([line]), line).toBe(false);
    }
  });

  it('merges the lines read with the typed ones, each typed line standing for one line read', () => {
    expect(
      mergeLines(
        ['1 cp x 3/j', 'Clinique de Test'],
        [
          'Doliprane 1000 mg',
          '1 CP  x 3/j',
          'Amoxicilline 500 mg',
          '1 cp x 3/j',
          'clinique de test',
        ],
      ),
    ).toEqual([
      '1 cp x 3/j',
      'Clinique de Test',
      'Doliprane 1000 mg',
      'Amoxicilline 500 mg',
      '1 cp x 3/j',
    ]);
  });

  it('measures the share of the page its images cover, through saves, transforms and forms', () => {
    const { OPS } = pdfjs;
    const op = (name: string) => OPS[name] ?? -1;
    const list = (ops: [string, unknown[]][]) => ({
      fnArray: ops.map(([name]) => op(name)),
      argsArray: ops.map(([, args]) => args),
    });
    const page = 595 * 842;
    // A scan painted over the page.
    expect(
      imageShare(
        list([
          ['save', []],
          ['transform', [595, 0, 0, 842, 0, 0]],
          ['paintImageXObject', ['img_p0_1', 1240, 1754]],
          ['restore', []],
        ]),
        OPS,
        page,
      ),
    ).toBeCloseTo(1);
    // A logo of 50 x 50 points inside a form scaled by 2: a small share.
    expect(
      imageShare(
        list([
          [
            'paintFormXObjectBegin',
            [
              [2, 0, 0, 2, 0, 0],
              [0, 0, 100, 100],
            ],
          ],
          ['save', []],
          ['transform', [50, 0, 0, 50, 10, 10]],
          ['paintImageMaskXObject', [{}]],
          ['restore', []],
          ['paintFormXObjectEnd', []],
          ['paintImageXObject', ['after the form: the unit square']],
        ]),
        OPS,
        page,
      ),
    ).toBeCloseTo((4 * 2500 + 1) / page);
    // The same small image repeated 40 times.
    expect(
      imageShare(
        list([['paintImageXObjectRepeat', ['img', 100, 100, new Float32Array(80)]]]),
        OPS,
        page,
      ),
    ).toBeCloseTo((40 * 10_000) / page);
  });
});
