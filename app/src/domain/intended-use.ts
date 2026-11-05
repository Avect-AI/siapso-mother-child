// SPDX-License-Identifier: MIT
// The intended use is one paragraph in docs/intended-use.md, shared with the
// README and MEDICAL_DISCLAIMER.md (tools/legal/intended-use.test.mjs checks
// those two). Vite reads the document into the bundle at build time, so the
// English text of the app is that paragraph, not a copy of it.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- other projects compile this module without app/'s Vite types
/// <reference path="./raw-md.d.ts" />
import source from '../../../docs/intended-use.md?raw';

const MARKED = /<!-- intended-use:start -->([\s\S]*?)<!-- intended-use:end -->/;

/** The marked paragraph of the document, white space squashed. */
export function intendedUseOf(document: string): string {
  const match = MARKED.exec(document);
  if (!match?.[1]) throw new Error('The document has no intended-use markers');
  return match[1].replace(/\s+/g, ' ').trim();
}

export const INTENDED_USE = intendedUseOf(source);
