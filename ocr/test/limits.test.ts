// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_PIXELS,
  MAX_SIDE,
  checkFile,
  fileKindOf,
  imageSizeOf,
  scaledSize,
} from '../src/limits.js';

/** A PNG header with its IHDR chunk (the rest of the file does not matter here). */
function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(out.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}

/** A JPEG start with an APP0 segment, then a SOF0 frame header. */
function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)];
  const frame = [
    0xff,
    sof,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
  ];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...frame, ...new Array<number>(9).fill(0)]);
}

function webpLossy(width: number, height: number): Uint8Array {
  const out = new Uint8Array(30);
  out.set(new TextEncoder().encode('RIFF'), 0);
  out.set(new TextEncoder().encode('WEBPVP8 '), 8);
  out.set([0x9d, 0x01, 0x2a], 23);
  const view = new DataView(out.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return out;
}

const ascii = (text: string) => new TextEncoder().encode(text);

describe('fileKindOf', () => {
  it('tells photos and PDFs by their first bytes, never by a name', () => {
    expect(fileKindOf(png(10, 10))).toBe('png');
    expect(fileKindOf(jpeg(10, 10))).toBe('jpeg');
    expect(fileKindOf(webpLossy(10, 10))).toBe('webp');
    expect(fileKindOf(ascii('GIF89a\u0001\u0000\u0001\u0000'))).toBe('gif');
    expect(fileKindOf(ascii('%PDF-1.7\n'))).toBe('pdf');
    // A PDF may have a few bytes before its header.
    expect(fileKindOf(ascii('\n\n%PDF-1.4\n'))).toBe('pdf');
  });

  it('says nothing of anything else: a text, a zip, an empty file', () => {
    expect(fileKindOf(ascii('Doliprane 1000 mg'))).toBeUndefined();
    expect(fileKindOf(Uint8Array.from([0x50, 0x4b, 3, 4]))).toBeUndefined();
    expect(fileKindOf(new Uint8Array(0))).toBeUndefined();
  });
});

describe('imageSizeOf', () => {
  it('reads the size from the header, before any decoding', () => {
    expect(imageSizeOf(png(1200, 1600))).toEqual({ width: 1200, height: 1600 });
    expect(imageSizeOf(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    expect(imageSizeOf(jpeg(640, 480, 0xc2))).toEqual({ width: 640, height: 480 });
    expect(imageSizeOf(webpLossy(800, 600))).toEqual({ width: 800, height: 600 });
    expect(imageSizeOf(ascii('GIF89a \u0003X\u0002'))).toEqual({ width: 800, height: 600 });
  });

  it('gives undefined for a header it cannot read', () => {
    expect(imageSizeOf(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(imageSizeOf(ascii('%PDF-1.7'))).toBeUndefined();
  });
});

describe('checkFile', () => {
  it('accepts a photo or a PDF within the limits', () => {
    expect(checkFile(png(1200, 1600), 50_000)).toEqual({ kind: 'png', width: 1200, height: 1600 });
    expect(checkFile(ascii('%PDF-1.4'), 70_000)).toEqual({ kind: 'pdf' });
  });

  it('refuses a file that is neither, one too heavy, and one of too many pixels', () => {
    expect(checkFile(ascii('hello'), 5)).toEqual({ refused: 'not-image' });
    expect(checkFile(png(10, 10), MAX_FILE_BYTES + 1)).toEqual({ refused: 'too-large' });
    expect(checkFile(ascii('%PDF-1.4'), MAX_FILE_BYTES + 1)).toEqual({ refused: 'too-large' });
    expect(checkFile(jpeg(8000, 6000), 1000)).toEqual({ refused: 'too-large' });
    expect(MAX_PIXELS).toBe(40_000_000);
    // A photo whose size the header does not say is not decoded blind.
    expect(checkFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 4)).toEqual({
      refused: 'not-image',
    });
  });
});

describe('scaledSize', () => {
  it('brings the long side to 2000 pixels at most, never up', () => {
    expect(MAX_SIDE).toBe(2000);
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(1200, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(3000, 4000, 960)).toEqual({ width: 720, height: 960 });
  });
});
