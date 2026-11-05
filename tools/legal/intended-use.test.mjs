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

function source() {
  const text = read('docs/intended-use.md');
  const match = /<!-- intended-use:start -->([\s\S]*?)<!-- intended-use:end -->/.exec(text);
  if (!match) throw new Error('docs/intended-use.md has no intended-use markers');
  return squash(match[1]);
}

describe('intended use', () => {
  it('has one source paragraph that holds the key statements', () => {
    const paragraph = source();
    expect(paragraph).toContain('general health information, education and referral');
    expect(paragraph).toContain('pregnant and breastfeeding women in Senegal');
    expect(paragraph).toContain('the people who accompany them');
    expect(paragraph).toContain('does not diagnose, prescribe or set a dose');
    expect(paragraph).toContain('does not replace a health professional');
  });

  it.each(['README.md', 'MEDICAL_DISCLAIMER.md'])('is carried word for word by %s', (file) => {
    expect(squash(read(file))).toContain(source());
  });

  it('is referenced from the README and the medical disclaimer', () => {
    expect(read('README.md')).toContain('docs/intended-use.md');
    expect(read('MEDICAL_DISCLAIMER.md')).toContain('docs/intended-use.md');
  });

  it('states that no rule is validated, in the disclaimer and the governance', () => {
    expect(read('MEDICAL_DISCLAIMER.md')).toContain('not clinically validated');
    expect(read('GOVERNANCE.md')).toContain('Today no rule is validated');
    expect(read('knowledge/pack.yaml')).toContain('clinically-validated: false');
  });
});
