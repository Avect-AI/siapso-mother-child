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

export interface PinnedText {
  repo: string;
  /** Full commit of the repository the text is taken from. */
  commit: string;
  /** The file in the repository. */
  file: string;
  /** Where the pack has it. */
  path: string;
  bytes: number;
  sha256: string;
  url: string;
}

export const PINNED_TEXTS: {
  paddleocr: PinnedText;
  onnxruntime: PinnedText;
  onnxruntimeNotices: PinnedText;
};
/** The bytes of a pinned text, from `<dir>/<path>` or downloaded; refused unless it is the pinned file. */
export function pinnedText(
  text: PinnedText,
  dir: string | undefined,
  download?: (url: string) => Promise<Response>,
): Promise<Buffer>;
export function dictionaryOf(ymlText: string): string[];
export function checkDetectionSettings(ymlText: string): void;
/** The files of the installed pdfjs-dist the pack carries: [path in the pack, path in the package]. */
export function pdfjsCopies(version: string): [string, string][];
