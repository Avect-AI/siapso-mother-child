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
