// SPDX-License-Identifier: MIT
// @vitest-environment node
// The image sizes read from the bytes of a PDF before pdf.js decodes
// anything (pdf-images.ts), on hand-written PDF fragments: the syntax the
// reader must not be fooled by. readPdf's own refusals: pdf.test.ts.
import { describe, expect, it } from 'vitest';
import { oversizedImage } from '../src/pdf-images.js';

const LIMIT = 20_000_000;
const latin1 = (text: string) =>
  Uint8Array.from({ length: text.length }, (_, i) => text.charCodeAt(i) & 0xff);
const check = (text: string) => oversizedImage(latin1(text), LIMIT);
const stream = (dict: string, data = 'xxxx') =>
  `1 0 obj\n<< ${dict} /Length ${String(data.length)} >>\nstream\n${data}\nendstream\nendobj\n`;

describe('oversizedImage', () => {
  it('passes images within the limit, and a file with no image', () => {
    expect(check(stream('/Subtype /Image /Width 4000 /Height 5000'))).toBeNull();
    expect(check('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n')).toBeNull();
  });

  it('refuses any stream whose width and height exceed it, an image or not', () => {
    expect(check(stream('/Subtype /Image /Width 6000 /Height 4000'))).toMatch(/6000 x 4000/);
    // A soft mask need not say it is an image: pdf.js decodes it all the same.
    expect(check(stream('/W 6000 /H 4000'))).toMatch(/6000 x 4000/);
    // Width and W both given: pdf.js takes W; the larger is taken here.
    expect(check(stream('/Width 10 /W 6000 /Height 4000'))).not.toBeNull();
    expect(check(stream('/Width 6000 /Width 10 /Height 4000'))).not.toBeNull();
  });

  it('reads through comments, strings, nested dictionaries and escaped names', () => {
    expect(
      check(
        stream(
          '/Sub#74ype/Im#61ge % a comment >> stream\n/Name (a ) << /Width 1 >> stream) /DecodeParms << /K -1 /Columns 1 >> /W#69dth 6000/Height\t4000',
        ),
      ),
    ).not.toBeNull();
    // A comment between the dictionary and its stream keyword.
    expect(
      check('1 0 obj\n<< /Width 6000 /Height 4000 >> % note\nstream\nxx\nendstream\nendobj\n'),
    ).not.toBeNull();
  });

  it('is not misled by a dictionary that is not a stream, nor by a cross-reference stream', () => {
    expect(check('1 0 obj << /Width 6000 /Height 4000 >> endobj\n')).toBeNull();
    expect(check(stream('/Type /XRef /W [1 2 1] /Size 9'))).toBeNull();
  });

  it('resolves a size given by a plain object, and refuses one it cannot read', () => {
    const sized = (value: string) =>
      `${stream('/Subtype /Image /Width 7 0 R /Height 4000')}7 0 obj\n${value}\nendobj\n`;
    expect(check(sized('6000'))).not.toBeNull();
    expect(check(sized('10'))).toBeNull();
    // Two versions of the object (an incremental update): the larger counts.
    expect(check(`${sized('10')}7 0 obj 6000 endobj\n`)).not.toBeNull();
    expect(check(stream('/Subtype /Image /Width 7 0 R /Height 4000'))).toMatch(/cannot be read/);
    expect(check(sized('<< /Value 6000 >>'))).toMatch(/cannot be read/);
  });

  it('takes the largest size of the file for a dimension a mask leaves out', () => {
    // pdf.js gives a mask without a height the height of the image it masks.
    const files =
      stream('/Subtype /Image /Width 100 /Height 4000') + stream('/Subtype /Image /Width 6000');
    expect(check(files)).not.toBeNull();
    expect(check(stream('/Subtype /Image /Width 600'))).toBeNull();
  });

  it('reads the size of JPEG and JPEG 2000 data, which pdf.js decodes at its own size', () => {
    const sof = (width: number, height: number) =>
      String.fromCharCode(
        0xff,
        0xd8,
        0xff,
        0xc0,
        0,
        17,
        8,
        height >> 8,
        height & 255,
        width >> 8,
        width & 255,
        3,
      ) + '\u0001"\u0000\u0002\u0011\u0001\u0003\u0011\u0001ÿÙ';
    const dct = (data: string) =>
      stream('/Subtype /Image /Width 10 /Height 10 /Filter /DCTDecode', data);
    expect(check(dct(sof(6000, 4000)))).toMatch(/JPEG/);
    expect(check(dct(sof(100, 100)))).toBeNull();
    // A height left to a later marker (DNL): its size cannot be told.
    expect(check(dct(sof(6000, 0)))).not.toBeNull();
    const siz = (width: number, height: number) => {
      const bytes = new Uint8Array(42);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, 0xff4f);
      view.setUint16(2, 0xff51);
      view.setUint16(4, 38);
      view.setUint32(8, width);
      view.setUint32(12, height);
      view.setUint16(40, 1);
      return String.fromCharCode(...bytes);
    };
    const jpx = (data: string, filter = '/JPXDecode') =>
      stream(`/Subtype /Image /Width 10 /Height 10 /Filter ${filter}`, data);
    expect(check(jpx(siz(6000, 4000)))).toMatch(/JPEG 2000/);
    expect(check(jpx(siz(620, 877)))).toBeNull();
    expect(check(jpx(siz(6000, 4000), '[/JPXDecode]'))).not.toBeNull();
  });

  it('refuses JPEG or JPEG 2000 data compressed again first, and a filter it cannot read', () => {
    expect(
      check(stream('/Subtype /Image /Width 10 /Height 10 /Filter [/FlateDecode /DCTDecode]')),
    ).toMatch(/cannot be read/);
    expect(check(stream('/Subtype /Image /Width 10 /Height 10 /Filter 9 0 R'))).toMatch(
      /cannot be read/,
    );
    expect(check(stream('/Subtype /Image /Width 10 /Height 10 /Filter /FlateDecode'))).toBeNull();
  });

  it('leaves the data of an encrypted file alone: only its dictionaries are plain', () => {
    // Encrypted data looks like noise: a JPEG header in it is not one.
    const encrypted = (data: string) =>
      `${stream('/Subtype /Image /Width 10 /Height 10 /Filter /DCTDecode', data)}trailer\n<< /Root 1 0 R /Encrypt 2 0 R >>\n`;
    const fake = String.fromCharCode(0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x0f, 0xa0, 0x17, 0x70, 3);
    expect(check(encrypted(fake))).toBeNull();
    expect(
      check(`${stream('/Width 6000 /Height 4000')}trailer << /Encrypt 2 0 R >>\n`),
    ).not.toBeNull();
  });

  it('gives up, refusing, on a file that would take too long to read', () => {
    const started = performance.now();
    expect(check(`1 0 obj ${'<<'.repeat(200_000)}`)).toMatch(/too long/);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('is not slowed by binary data', () => {
    const noise = Array.from({ length: 2_000_000 }, (_, i) =>
      String.fromCharCode((i * 2654435761) >>> 24),
    ).join('');
    expect(check(stream('/Filter /FlateDecode', noise))).toBeNull();
  });
});
