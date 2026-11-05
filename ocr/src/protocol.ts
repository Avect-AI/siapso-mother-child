// SPDX-License-Identifier: MIT
// Messages between the page (client.ts) and the reading worker (worker.ts).
import type { OcrErrorReason } from './ocr-pack.js';

/** Where the lines came from: a photo, the text layer of a PDF, or a PDF page read by the OCR. */
export type OcrSource = 'image' | 'pdf-text' | 'pdf-scan';

export interface WorkerReadRequest {
  type: 'read';
  id: number;
  /** Absolute URL of the reading pack folder. */
  baseUrl: string;
  /** The files of the pack: the worker may read nothing else. */
  files: string[];
  /** The photo or the PDF: a Blob (a file chosen), or an ImageBitmap transferred (a camera frame). */
  input: Blob | ImageBitmap;
}

export type WorkerRequest = WorkerReadRequest;

export type WorkerResponse =
  /** Sent once at start: the address of the worker script, for the page to keep it offline. */
  | { type: 'hello'; id: 0; url: string }
  /** 0 to 1: the models loading (`load`), then the page read (`read`). */
  | { type: 'progress'; id: number; stage: 'load' | 'read'; progress: number }
  | {
      type: 'result';
      id: number;
      lines: string[];
      source: OcrSource;
      pages: number;
      /** Time spent reading, in milliseconds (the models' load apart). */
      ms: number;
      /** Time spent loading the models for this reading; 0 when they were loaded. */
      loadMs: number;
    }
  | { type: 'error'; id: number; reason: OcrErrorReason; message: string };
