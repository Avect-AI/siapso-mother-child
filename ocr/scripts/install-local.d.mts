// SPDX-License-Identifier: MIT
// Types of the helpers of install-local.mjs, for its tests.

export interface PinnedFile {
  bytes: number;
  sha256: string;
}

export interface PinnedModel {
  repo: string;
  revision: string;
  licence: string;
  folder: string;
  onnx: PinnedFile;
  yml: PinnedFile;
}

export const PINNED_MODELS: { detection: PinnedModel; recognition: PinnedModel };
export function dictionaryOf(ymlText: string): string[];
export function checkDetectionSettings(ymlText: string): void;
/** The files of the installed pdfjs-dist the pack carries: [path in the pack, path in the package]. */
export function pdfjsCopies(version: string): [string, string][];
