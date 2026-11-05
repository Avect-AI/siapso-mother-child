// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.js';
import { fr } from '../i18n/fr.js';
import { INTENDED_USE, intendedUseOf } from './intended-use.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
/** Shared with tools/legal/intended-use.test.mjs: one list of required statements. */
const statements = JSON.parse(
  readFileSync(path.join(root, 'tools', 'legal', 'intended-use-statements.json'), 'utf8'),
) as { sentences: number; english: string[]; french: string[] };

describe('intended use', () => {
  it('is the marked paragraph of docs/intended-use.md, read at build time', () => {
    const doc = readFileSync(path.join(root, 'docs', 'intended-use.md'), 'utf8');
    const match = /<!-- intended-use:start -->([\s\S]*?)<!-- intended-use:end -->/.exec(doc);
    expect(match).not.toBeNull();
    expect(INTENDED_USE).toBe(squash(match?.[1] ?? ''));
    expect(INTENDED_USE).toContain('general health information, education and referral');
  });

  it('is word for word the English text of the app', () => {
    expect(en.about.intendedUse).toBe(INTENDED_USE);
  });

  it('has the statements of the shared fixture in English', () => {
    for (const part of statements.english) expect(INTENDED_USE).toContain(part);
    expect(sentencesOf(INTENDED_USE)).toBe(statements.sentences);
  });

  it('has a French text that says the same things and no more', () => {
    const text = fr.about.intendedUse.replaceAll(String.fromCharCode(160), ' ');
    for (const part of statements.french) expect(text).toContain(part);
    expect(sentencesOf(text)).toBe(statements.sentences);
  });

  it('counts sentences', () => {
    expect(sentencesOf('One. Two! Three?')).toBe(3);
    expect(sentencesOf('One, and one.')).toBe(1);
  });

  it('refuses a document without markers', () => {
    expect(() => intendedUseOf('no markers here')).toThrow(/intended-use/);
  });

  it('squashes the white space of the marked paragraph', () => {
    expect(
      intendedUseOf('<!-- intended-use:start -->\n\n  One\n  two. \n<!-- intended-use:end -->'),
    ).toBe('One two.');
  });
});
