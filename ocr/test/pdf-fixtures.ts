// SPDX-License-Identifier: MIT
// Synthetic PDF files made at test time, so no PDF is committed: pages of
// text lines in Helvetica (a text layer, as a prescription printed from a
// clinic's software), a page with a drawing and no text (as a scan), pages
// with a scanned image (the CCITT Group 4, JBIG2 and JPEG 2000 streams of
// fixtures/, README.md there), and the same text protected by a password
// (standard security handler, revision 2, RC4 40 bits: the oldest scheme,
// which every reader knows). Fake content only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** A line of text at a height on the page, in points from the bottom. */
export interface PdfLine {
  text: string;
  x: number;
  y: number;
  size?: number;
  /** Not painted (text render mode 3), as the text layer a scanner adds over its image. */
  invisible?: boolean;
}

/** An image XObject painted on the page. */
export interface PdfImage {
  /** The entries of its dictionary but /Length (size, colour space, filter and its parameters). */
  dict: string;
  data: Uint8Array;
  /** Where it is painted, in points: x, y, width, height; the whole A4 page by default. */
  rect?: readonly [number, number, number, number];
}

/** A page: text lines, an image under them, or both. */
export interface PdfPage {
  lines?: readonly PdfLine[];
  image?: PdfImage;
}

const latin1 = (text: string) =>
  Uint8Array.from({ length: text.length }, (_, i) => text.charCodeAt(i) & 0xff);

/** A PDF string literal in WinAnsi: brackets and backslashes escaped, accents as octal. */
function pdfString(text: string): string {
  return Array.from(text)
    .map((c) => {
      const code = c.charCodeAt(0);
      if (c === '(' || c === ')' || c === '\\') return `\\${c}`;
      if (code < 32 || code > 126) return `\\${(code & 0xff).toString(8).padStart(3, '0')}`;
      return c;
    })
    .join('');
}

function contentOf(lines: readonly PdfLine[]): string {
  return lines
    .map(
      (l) =>
        `BT /F1 ${String(l.size ?? 14)} Tf ${l.invisible === true ? '3 Tr ' : ''}${String(l.x)} ${String(l.y)} Td (${pdfString(l.text)}) Tj ET`,
    )
    .join('\n');
}

const A4: readonly [number, number, number, number] = [0, 0, 595, 842];

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (s[i] ?? 0) + (key[i % key.length] ?? 0)) & 255;
    [s[i], s[j]] = [s[j] ?? 0, s[i] ?? 0];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + (s[i] ?? 0)) & 255;
    [s[i], s[j]] = [s[j] ?? 0, s[i] ?? 0];
    out[k] = (data[k] ?? 0) ^ (s[((s[i] ?? 0) + (s[j] ?? 0)) & 255] ?? 0);
  }
  return out;
}

const md5 = (...parts: Uint8Array[]) => {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
};

const PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padded(password: string): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = latin1(password).subarray(0, 32);
  out.set(bytes);
  out.set(PADDING.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

function isLines(page: readonly PdfLine[] | PdfPage): page is readonly PdfLine[] {
  return Array.isArray(page);
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The PDF bytes of `pages` (each a list of lines, or a page with an image),
 * optionally with a user password. A page given as an empty list of lines
 * is a drawing with no text.
 */
export function makePdf(
  pages: readonly (readonly PdfLine[] | PdfPage)[],
  password?: string,
): Uint8Array {
  const id = md5(latin1('siapso synthetic test pdf'));
  const permissions = -4;
  let fileKey: Uint8Array | undefined;
  let owner: Uint8Array | undefined;
  let user: Uint8Array | undefined;
  if (password !== undefined) {
    // Algorithm 3 (owner entry), 2 (file key) and 4 (user entry) of ISO 32000-1, revision 2.
    owner = rc4(md5(padded(`${password}-owner`)).subarray(0, 5), padded(password));
    const p = new Uint8Array(4);
    new DataView(p.buffer).setInt32(0, permissions, true);
    fileKey = md5(padded(password), owner, p, id).subarray(0, 5);
    user = rc4(fileKey, PADDING);
  }
  const objects: string[] = [];
  const encrypt = (num: number, data: Uint8Array) => {
    if (fileKey === undefined) return data;
    const salt = Uint8Array.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);
    return rc4(md5(fileKey, salt).subarray(0, 10), data);
  };
  // Each page takes three objects: the page, its content and its image (an
  // empty dictionary when it has none).
  const kids = pages.map((_, i) => `${String(4 + i * 3)} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const streams = new Map<number, Uint8Array>();
  pages.forEach((spec, i) => {
    const { lines = [], image }: PdfPage = isLines(spec) ? { lines: spec } : spec;
    const pageNum = 4 + i * 3;
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    const xobjects = image === undefined ? '' : ` /XObject << /Im1 ${String(imageNum)} 0 R >>`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >>${xobjects} >> /Contents ${String(contentNum)} 0 R >>`,
    );
    const drawing =
      lines.length === 0 && image === undefined
        ? '0.2 0.2 0.2 rg 60 500 300 80 re f\n80 400 m 400 420 l S'
        : '';
    const [x, y, w, h] = image?.rect ?? A4;
    const painted =
      image === undefined
        ? ''
        : `q ${String(w)} 0 0 ${String(h)} ${String(x)} ${String(y)} cm /Im1 Do Q\n`;
    const body = encrypt(contentNum, latin1(painted + contentOf(lines) + drawing));
    streams.set(contentNum, body);
    objects.push(`<< /Length ${String(body.length)} >>`);
    if (image === undefined) {
      objects.push('<< >>');
    } else {
      const data = encrypt(imageNum, image.data);
      streams.set(imageNum, data);
      objects.push(
        `<< /Type /XObject /Subtype /Image ${image.dict} /Length ${String(data.length)} >>`,
      );
    }
  });
  let encryptNum: number | undefined;
  if (owner !== undefined && user !== undefined) {
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> /P ${String(permissions)} >>`,
    );
    encryptNum = objects.length;
  }

  const chunks: Uint8Array[] = [latin1('%PDF-1.4\n%âãÏÓ\n')];
  let offset = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  objects.forEach((dict, index) => {
    const num = index + 1;
    offsets.push(offset);
    const stream = streams.get(num);
    const parts = stream
      ? [latin1(`${String(num)} 0 obj\n${dict}\nstream\n`), stream, latin1('\nendstream\nendobj\n')]
      : [latin1(`${String(num)} 0 obj\n${dict}\nendobj\n`)];
    for (const part of parts) {
      chunks.push(part);
      offset += part.length;
    }
  });
  const xref = [
    'xref',
    `0 ${String(objects.length + 1)}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
  ].join('\n');
  const trailer = `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R${encryptNum === undefined ? '' : ` /Encrypt ${String(encryptNum)} 0 R`} /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${String(offset)}\n%%EOF\n`;
  chunks.push(latin1(`${xref}\n${trailer}`));
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A prescription-like page of synthetic lines (fake names only). */
export const PRINTED_PAGE: PdfLine[] = [
  { text: 'ORDONNANCE', x: 230, y: 760, size: 20 },
  { text: 'Nom et prénom : Awa Diop', x: 60, y: 700 },
  { text: '1. Doliprane 1000 mg cp', x: 60, y: 640 },
  { text: '1 cp x 3/j si douleur', x: 90, y: 615 },
  { text: '2. Fer + Acide folique cp', x: 60, y: 580 },
  { text: 'Signature et cachet', x: 380, y: 200 },
];

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/**
 * The synthetic prescription of fixtures/ (1240 x 1754 pixels, A4 at
 * 150 dpi) in CCITT Group 4, as an office scanner writes a page.
 */
export function ccittScan(): PdfImage {
  return {
    dict: '/Width 1240 /Height 1754 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 1240 /Rows 1754 >>',
    data: fixture('scan-g4.ccitt'),
  };
}

/** The same page as an embedded JBIG2 stream (a generic region coded with MMR). */
export function jbig2Scan(): PdfImage {
  return {
    dict: '/Width 1240 /Height 1754 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /JBIG2Decode',
    data: fixture('scan-mmr.jbig2'),
  };
}

/** The page at half size in JPEG 2000 (620 x 877 pixels, grey). */
export function jpxScan(): PdfImage {
  return {
    dict: '/Width 620 /Height 877 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode',
    data: fixture('scan.j2k'),
  };
}

/**
 * A white image of `width` x `height` pixels, 1 bit, with Flate: a few
 * kilobytes in the file, as many pixels once decoded.
 */
export function flateImage(width: number, height: number): PdfImage {
  const raw = new Uint8Array(Math.ceil(width / 8) * height).fill(0xff);
  return {
    dict: `/Width ${String(width)} /Height ${String(height)} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode`,
    data: new Uint8Array(deflateSync(raw, { level: 9 })),
  };
}
