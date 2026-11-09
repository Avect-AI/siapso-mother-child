// SPDX-License-Identifier: MIT
// @siapso/ocr: the text of a prescription read on the phone, from a photo or
// a PDF, offline, with the optional "Lecture d'ordonnance" pack. The reading
// only gives lines of text: the app reads them into products she confirms,
// and the engine alone decides the level. The photo is never stored nor sent.
//
// What the prescription screens call (phase 3, docs/ocr.md):
// - isOcrSupported(): whether to show "Photo ou fichier de l'ordonnance";
// - installedOcrPackInfo(): whether the pack is installed (Cache API only,
//   never the network); null opens the pack screen;
// - ocrPackInfo(), installOcrPack(), storedOcrPackBytes(), removeOcrPack():
//   the pack screen, the only place that downloads, on her tap;
// - createOcrClient(info).read(file or camera frame): the lines, in order;
//   cancel(), release() when the page is hidden or the app locks, dispose();
// - OcrPackError and its reason: what to say when it fails.
export {
  OCR_CACHE,
  OCR_PACK_URL,
  OcrPackError,
  installOcrPack,
  installedOcrPackInfo,
  ocrPackInfo,
  removeOcrPack,
  storedOcrPackBytes,
  type OcrErrorReason,
  type OcrModelSource,
  type OcrPackFile,
  type OcrPackInfo,
} from './ocr-pack.js';
export {
  DEFAULT_READ_TIMEOUT_MS,
  OCR_IDLE_MS,
  createOcrClient,
  type OcrClient,
  type OcrClientOptions,
  type OcrReadOptions,
  type OcrReading,
} from './client.js';
export { MAX_FILE_BYTES, MAX_PIXELS, MAX_SIDE } from './limits.js';
export type { OcrSource } from './protocol.js';

/**
 * Whether this browser can read a prescription on the phone: a secure page,
 * WebAssembly, module workers, OffscreenCanvas, createImageBitmap and the
 * Cache API (as for the voice). The entry is shown only where it is true.
 */
export function isOcrSupported(scope: Record<string, unknown> = globalThis): boolean {
  return (
    scope['isSecureContext'] === true &&
    ['WebAssembly', 'Worker', 'OffscreenCanvas', 'createImageBitmap', 'caches'].every(
      (name) => scope[name] !== undefined && scope[name] !== null,
    )
  );
}
