// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import * as ocr from '../src/index.js';

describe('the API the prescription screens call', () => {
  it('is small: the pack, the client, the limits and the support check', () => {
    expect(Object.keys(ocr).sort()).toEqual(
      [
        'DEFAULT_READ_TIMEOUT_MS',
        'MAX_FILE_BYTES',
        'MAX_PIXELS',
        'MAX_SIDE',
        'OCR_CACHE',
        'OCR_IDLE_MS',
        'OCR_PACK_URL',
        'OcrPackError',
        'createOcrClient',
        'installOcrPack',
        'installedOcrPackInfo',
        'isOcrSupported',
        'ocrPackInfo',
        'removeOcrPack',
        'storedOcrPackBytes',
      ].sort(),
    );
  });
});

describe('isOcrSupported', () => {
  const full = {
    WebAssembly: {},
    Worker: () => undefined,
    OffscreenCanvas: () => undefined,
    createImageBitmap: () => undefined,
    caches: {},
    isSecureContext: true,
  };

  it('is true where the browser can read on the phone: WebAssembly, workers, canvas, Cache API', () => {
    expect(ocr.isOcrSupported(full)).toBe(true);
  });

  it('is false when one of them is missing, or the page is not secure', () => {
    for (const key of Object.keys(full)) {
      const scope = Object.fromEntries(Object.entries(full).filter(([name]) => name !== key));
      expect(ocr.isOcrSupported(scope), key).toBe(false);
    }
    expect(ocr.isOcrSupported({ ...full, isSecureContext: false })).toBe(false);
  });
});
