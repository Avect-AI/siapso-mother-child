// SPDX-License-Identifier: MIT
// @vitest-environment node
// The image sizes read from the bytes of a PDF before pdf.js decodes
// anything (pdf-images.ts), on hand-written PDF fragments: the syntax the
// reader must not be fooled by. readPdf's own refusals: pdf.test.ts.
import { describe, expect, it } from 'vitest';
import { oversizedImage } from '../src/pdf-images.js';

const LIMIT = 20_000_000;
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}
const check = (text: string) => oversizedImage(latin1(text), LIMIT);
/** A size that is too large, and a size that cannot be read: two reasons. */
const tooLarge = (why: RegExp = /./) => ({
  reason: 'too-large',
  why: expect.stringMatching(why) as string,
});
const unsupported = (why: RegExp = /./) => ({
  reason: 'pdf-unsupported',
  why: expect.stringMatching(why) as string,
});
const stream = (dict: string, data = 'xxxx') =>
  `1 0 obj\n<< ${dict} /Length ${String(data.length)} >>\nstream\n${data}\nendstream\nendobj\n`;

describe('oversizedImage', () => {
  it('passes images within the limit, and a file with no image', () => {
    expect(check(stream('/Subtype /Image /Width 4000 /Height 5000'))).toBeNull();
    expect(check('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n')).toBeNull();
  });

  it('refuses any stream whose width and height exceed it, an image or not', () => {
    expect(check(stream('/Subtype /Image /Width 6000 /Height 4000'))).toEqual(
      tooLarge(/6000 x 4000/),
    );
    // A soft mask need not say it is an image: pdf.js decodes it all the same.
    expect(check(stream('/W 6000 /H 4000'))).toEqual(tooLarge(/6000 x 4000/));
    // Width and W both given: pdf.js takes W; the larger is taken here.
    expect(check(stream('/Width 10 /W 6000 /Height 4000'))).toEqual(tooLarge());
    expect(check(stream('/Width 6000 /Width 10 /Height 4000'))).toEqual(tooLarge());
  });

  it('reads through comments, strings, nested dictionaries and escaped names', () => {
    expect(
      check(
        stream(
          '/Sub#74ype/Im#61ge % a comment >> stream\n/Name (a ) << /Width 1 >> stream) /DecodeParms << /K -1 /Columns 1 >> /W#69dth 6000/Height\t4000',
        ),
      ),
    ).toEqual(tooLarge());
    // A comment between the dictionary and its stream keyword.
    expect(
      check('1 0 obj\n<< /Width 6000 /Height 4000 >> % note\nstream\nxx\nendstream\nendobj\n'),
    ).toEqual(tooLarge());
  });

  it('is not misled by a dictionary that is not a stream, nor by a cross-reference stream', () => {
    expect(check('1 0 obj << /Width 6000 /Height 4000 >> endobj\n')).toBeNull();
    expect(check(stream('/Type /XRef /W [1 2 1] /Size 9'))).toBeNull();
  });

  it('resolves a size given by a plain object, and refuses one it cannot read', () => {
    const sized = (value: string) =>
      `${stream('/Subtype /Image /Width 7 0 R /Height 4000')}7 0 obj\n${value}\nendobj\n`;
    expect(check(sized('6000'))).toEqual(tooLarge());
    expect(check(sized('10'))).toBeNull();
    // Two versions of the object (an incremental update): the larger counts.
    expect(check(`${sized('10')}7 0 obj 6000 endobj\n`)).toEqual(tooLarge());
    // Not too large: not readable here (in an object stream, missing, not a number).
    expect(check(stream('/Subtype /Image /Width 7 0 R /Height 4000'))).toEqual(
      unsupported(/cannot be read/),
    );
    expect(check(sized('<< /Value 6000 >>'))).toEqual(unsupported(/cannot be read/));
    // A size too large is said so, even when another one cannot be read.
    expect(
      check(`${stream('/Subtype /Image /Width 7 0 R /Height 4000')}${stream('/W 6000 /H 4000')}`),
    ).toEqual(tooLarge());
  });

  it('takes the largest size of the file for a dimension a mask leaves out', () => {
    // pdf.js gives a mask without a height the height of the image it masks.
    const files =
      stream('/Subtype /Image /Width 100 /Height 4000') + stream('/Subtype /Image /Width 6000');
    expect(check(files)).toEqual(tooLarge());
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
    expect(check(dct(sof(6000, 4000)))).toEqual(tooLarge(/JPEG/));
    expect(check(dct(sof(100, 100)))).toBeNull();
    // A height left to a later marker (DNL): its size cannot be told.
    expect(check(dct(sof(6000, 0)))).toEqual(unsupported());
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
    expect(check(jpx(siz(6000, 4000)))).toEqual(tooLarge(/JPEG 2000/));
    expect(check(jpx(siz(620, 877)))).toBeNull();
    expect(check(jpx(siz(6000, 4000), '[/JPXDecode]'))).toEqual(tooLarge());
  });

  it('refuses JPEG or JPEG 2000 data compressed again first, and a filter it cannot read', () => {
    for (const first of ['/FlateDecode', '/ASCII85Decode', '/A85']) {
      expect(
        check(stream(`/Subtype /Image /Width 10 /Height 10 /Filter [${first} /DCTDecode]`)),
        first,
      ).toEqual(unsupported(/cannot be read/));
    }
    expect(check(stream('/Subtype /Image /Width 10 /Height 10 /Filter 9 0 R'))).toEqual(
      unsupported(/cannot be read/),
    );
    expect(check(stream('/Subtype /Image /Width 10 /Height 10 /Filter /FlateDecode'))).toBeNull();
  });

  it('leaves the data of an encrypted file alone: only its dictionaries are plain', () => {
    // Encrypted data looks like noise: a JPEG header in it is not one.
    const encrypted = (data: string) =>
      `${stream('/Subtype /Image /Width 10 /Height 10 /Filter /DCTDecode', data)}trailer\n<< /Root 1 0 R /Encrypt 2 0 R >>\n`;
    const fake = String.fromCharCode(0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x0f, 0xa0, 0x17, 0x70, 3);
    expect(check(encrypted(fake))).toBeNull();
    expect(check(`${stream('/Width 6000 /Height 4000')}trailer << /Encrypt 2 0 R >>\n`)).toEqual(
      tooLarge(),
    );
  });

  it('gives up, refusing, on a file that would take too long to read', () => {
    const started = performance.now();
    expect(check(`1 0 obj ${'<<'.repeat(200_000)}`)).toEqual(unsupported(/too long/));
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('is not slowed by binary data', () => {
    const noise = Array.from({ length: 2_000_000 }, (_, i) =>
      String.fromCharCode((i * 2654435761) >>> 24),
    ).join('');
    expect(check(stream('/Filter /FlateDecode', noise))).toBeNull();
  });
});

// Each file is built in the test, up to 20 MB: more than the default 5 s in all.
describe('oversizedImage on files crafted to be slow', { timeout: 120_000 }, () => {
  // Bounds loose enough for a loaded machine: a file of 20 MB is refused in
  // about 2 s on the laptop of the bench (docs/ocr.md), within the 90 s limit
  // of a reading on a slow phone.
  const timed = (text: string) => {
    const bytes = latin1(text);
    const started = performance.now();
    const result = oversizedImage(bytes, LIMIT);
    return { result, ms: performance.now() - started };
  };

  it('looks each object up once: 5,000 images sized by references behind an 8 MB stream', () => {
    const images = Array.from(
      { length: 5000 },
      (_, i) =>
        `${String(i + 10)} 0 obj\n<< /Subtype /Image /Width ${String(i + 20_000)} 0 R /Height 10 /Length 1 >>\nstream\nx\nendstream\nendobj\n${String(i + 20_000)} 0 obj 10 endobj\n`,
    ).join('');
    const { result, ms } = timed(stream('/Filter /FlateDecode', 'z'.repeat(8_000_000)) + images);
    expect(result).toBeNull();
    expect(ms).toBeLessThan(2000);
  });

  it('refuses in time a file of 200,000 stray stream keywords', () => {
    const { result, ms } = timed(`1 0 obj\n${'q 1 0 0 1 0 0 cm stream\n'.repeat(200_000)}`);
    expect(result).toEqual(unsupported(/too long/));
    expect(ms).toBeLessThan(3000);
  });

  it('reads or refuses in time a file of 20 MB of syntax with tens of thousands of references', () => {
    // Every size by a reference of its own, each defined: 120,000 lookups.
    const objects = Array.from(
      { length: 60_000 },
      (_, i) =>
        `${String(i + 2)} 0 obj << /Subtype /Image /Width ${String(i + 100_000)} 0 R /Height ${String(i + 200_000)} 0 R /Length 0 >>\nstream\n\nendstream\nendobj\n${String(i + 100_000)} 0 obj 10 endobj\n${String(i + 200_000)} 0 obj 10 endobj\n`,
    ).join('');
    const filler = '/Name [1 2 3 4 5 6 7 8 9 10] (text) '.repeat(
      Math.ceil(Math.max(0, 20_000_000 - objects.length) / 36),
    );
    const { result, ms } = timed(`${objects}1 0 obj << ${filler} >> endobj\n`);
    expect(result).not.toEqual(tooLarge());
    expect(ms).toBeLessThan(6000);
  });

  it('refuses in time 20 MB of tokens, the slowest syntax to read', () => {
    for (const unit of ['1 ', '/a ', '[1] ', '<< >>stream\n']) {
      const { result, ms } = timed(`1 0 obj ${unit.repeat(Math.ceil(20_000_000 / unit.length))}`);
      expect(result, unit).not.toEqual(tooLarge());
      expect(ms, unit).toBeLessThan(6000);
    }
  });
});
