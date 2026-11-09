// SPDX-License-Identifier: MIT
// Types of the helpers of install-local.mjs, for its tests.

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
  onnxruntime: PinnedText;
  onnxruntimeNotices: PinnedText;
};

/** A pinned text as read: its path in the pack and its bytes. */
export interface ReadText {
  path: string;
  bytes: Buffer;
}

/** A package the pack carries the files or the licence of. */
export interface PackageInfo {
  dir: string;
  version: string;
  licence: string;
}

export interface PackDependencies {
  transformers: PackageInfo;
  tokenizers: PackageInfo;
  jinja: PackageInfo;
  ort: PackageInfo;
}

/** Refuses an onnxruntime-web built from another commit than the one its texts are pinned at. */
export function checkOrtCommit(built: string): void;
/** The bytes of a pinned text, from `<dir>/<path>` or downloaded; refused unless it is the pinned file. */
export function pinnedText(
  text: PinnedText,
  dir: string | undefined,
  download?: (url: string) => Promise<Response>,
): Promise<Buffer>;
/** The pinned texts, each from the first of `dirs` that has it, else downloaded. */
export function pinnedTexts(
  dirs: string[],
  download?: (url: string) => Promise<Response>,
  texts?: PinnedText[],
): Promise<ReadText[]>;
/** Installs the converted pack `<source>/<id>/` into `<target>/<id>/`, with its manifest. */
export function install(
  id: string,
  deps: PackDependencies,
  pinned: ReadText[],
  dirs?: { source: string; target: string; log?: (line: string) => void },
): Promise<void>;
