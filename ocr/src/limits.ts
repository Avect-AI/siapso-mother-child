// SPDX-License-Identifier: MIT
// What a file is and whether this phone may read it, from its first bytes,
// before anything is decoded: a photo of 40 megapixels or a file of 20 MB
// would take the memory of a 2 GB phone. Pure.

/** Above this a file is refused before it is read (docs/ocr.md). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Above this a photo is refused before it is decoded. */
export const MAX_PIXELS = 40_000_000;

/** The long side of the image the reading works on. */
export const MAX_SIDE = 2000;

export type FileKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'pdf';

export interface ImageSize {
  width: number;
  height: number;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  return signature.every((value, i) => bytes[at + i] === value);
}

const ascii = (text: string) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
const PDF = ascii('%PDF-');

/** The kind of a file by its first bytes (never by its name or its type); undefined for anything else. */
export function fileKindOf(bytes: Uint8Array): FileKind | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, ascii('BM')) && bytes.length >= 26) return 'bmp';
  // A PDF header may come after a few bytes of junk (the specification allows 1024).
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + PDF.length <= head.length; i++) {
    if (startsWith(head, PDF, i)) return 'pdf';
  }
  return undefined;
}

function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes, and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = view.getUint16(at + 2);
    // Start of frame: baseline, progressive, lossless and the others but DHT, JPG and DAC.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    if (length < 2) return undefined;
    at += 2 + length;
  }
  return undefined;
}

function webpSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8 ' && startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return { width, height };
  }
  return undefined;
}

/** The size a photo says in its header; undefined when it cannot be read. */
export function imageSizeOf(bytes: Uint8Array): ImageSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (fileKindOf(bytes)) {
    case 'png':
      return bytes.length >= 24
        ? { width: view.getUint32(16), height: view.getUint32(20) }
        : undefined;
    case 'jpeg':
      return jpegSize(bytes, view);
    case 'webp':
      return webpSize(bytes, view);
    case 'gif':
      return bytes.length >= 10
        ? { width: view.getUint16(6, true), height: view.getUint16(8, true) }
        : undefined;
    case 'bmp':
      return {
        width: Math.abs(view.getInt32(18, true)),
        height: Math.abs(view.getInt32(22, true)),
      };
    default:
      return undefined;
  }
}

export type FileCheck =
  | { kind: 'pdf' }
  | { kind: Exclude<FileKind, 'pdf'>; width: number; height: number }
  | { refused: 'not-image' | 'too-large' };

/**
 * Whether a file of `byteLength` bytes starting with `head` may be read: a
 * photo whose header gives its size within MAX_PIXELS, or a PDF, of
 * MAX_FILE_BYTES at most. `head` needs the first 64 KB at most (a JPEG may
 * carry a large EXIF block before its frame header).
 */
export function checkFile(head: Uint8Array, byteLength: number): FileCheck {
  const kind = fileKindOf(head);
  if (kind === undefined) return { refused: 'not-image' };
  if (byteLength > MAX_FILE_BYTES) return { refused: 'too-large' };
  if (kind === 'pdf') return { kind };
  const size = imageSizeOf(head);
  if (size === undefined || size.width < 1 || size.height < 1) return { refused: 'not-image' };
  if (size.width * size.height > MAX_PIXELS) return { refused: 'too-large' };
  return { kind, ...size };
}

/** The size with its long side brought to `side` at most, never enlarged. */
export function scaledSize(width: number, height: number, side = MAX_SIDE): ImageSize {
  const scale = Math.min(1, side / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
