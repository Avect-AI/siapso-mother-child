// SPDX-License-Identifier: MIT
// The intended use is one paragraph (docs/intended-use.md). The README and the
// medical disclaimer must carry it word for word. The About screen of the app
// (SCRUM-28) is wired to the same source.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const squash = (text) => text.replace(/\s+/g, ' ').trim();
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
const statements = JSON.parse(read('tools/legal/intended-use-statements.json'));

function source() {
  const text = read('docs/intended-use.md');
  const match = /<!-- intended-use:start -->([\s\S]*?)<!-- intended-use:end -->/.exec(text);
  if (!match) throw new Error('docs/intended-use.md has no intended-use markers');
  return squash(match[1]);
}

describe('intended use', () => {
  it('has one source paragraph that holds the key statements', () => {
    const paragraph = source();
    for (const part of statements.english) expect(paragraph).toContain(part);
    expect(sentencesOf(paragraph)).toBe(statements.sentences);
  });

  it.each(['README.md', 'MEDICAL_DISCLAIMER.md'])('is carried word for word by %s', (file) => {
    expect(squash(read(file))).toContain(source());
  });

  it('is referenced from the README and the medical disclaimer', () => {
    expect(read('README.md')).toContain('docs/intended-use.md');
    expect(read('MEDICAL_DISCLAIMER.md')).toContain('docs/intended-use.md');
  });

  it('is bundled into the app from the same source, in English word for word', () => {
    expect(read('app/src/domain/intended-use.ts')).toContain("'../../../docs/intended-use.md?raw'");
    expect(read('app/src/i18n/en.ts')).toMatch(/intendedUse:\s*INTENDED_USE,/);
  });

  it('has a French translation in the app that says the same things and no more', () => {
    const french = squash(read('app/src/i18n/fr.ts')).replace(/\\u00a0/g, ' ');
    const match = /intendedUse:\s*"([^"]+)"/.exec(french);
    expect(match).not.toBeNull();
    const text = match?.[1] ?? '';
    for (const part of statements.french) expect(text).toContain(part);
    expect(sentencesOf(text)).toBe(statements.sentences);
  });

  it('states that no rule is validated, in the disclaimer and the governance', () => {
    expect(read('MEDICAL_DISCLAIMER.md')).toContain('not clinically validated');
    expect(read('GOVERNANCE.md')).toContain('Today no rule is validated');
    expect(read('knowledge/pack.yaml')).toContain('clinically-validated: false');
  });
});
