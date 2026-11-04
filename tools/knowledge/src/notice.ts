// SPDX-License-Identifier: MIT
import { citedSources } from './provenance.js';
import type { AuthoredSource, RawContent } from './types.js';
import { typedContent } from './validate.js';

/** The generated file at the repository root. */
export const NOTICE_FILE = 'NOTICE';

const HEADER = [
  'SIAPSO Mother-Child',
  'Copyright 2026 AVECT AI SARL',
  '',
  'Licences',
  '  Code: MIT (see LICENSE)',
  '  Content (knowledge/ and registry/): CC BY 4.0',
];

function block(source: AuthoredSource): string[] {
  const when =
    source.version === undefined
      ? `Accessed: ${source.accessed ?? ''}`
      : `Version: ${source.version}`;
  return [
    source.name,
    `  Publisher: ${source.publisher}`,
    `  Licence: ${source.licence}`,
    `  ${when}`,
    `  ${source.notice}`,
  ];
}

function section(title: string, intro: string, sources: AuthoredSource[]): string[] {
  if (sources.length === 0) return [];
  return ['', title, intro, ...sources.flatMap((s) => ['', ...block(s)])];
}

/**
 * The NOTICE text for valid content: licences, then one attribution block
 * per allowed source actually cited, then the fact-only sources cited, each
 * in id order. It holds no date of generation: the same content always gives
 * the same bytes.
 */
export function generateNotice(raw: RawContent): string {
  const { allowed, factOnly } = citedSources(typedContent(raw));
  const lines = [
    ...HEADER,
    ...section('Sources', 'The knowledge pack draws on these sources.', allowed),
    ...section(
      'Facts only',
      'These sources support facts and danger signs. Their text is not copied.',
      factOnly,
    ),
  ];
  return `${lines.join('\n')}\n`;
}
