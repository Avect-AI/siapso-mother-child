// SPDX-License-Identifier: MIT
import { findForbiddenWording, type Lang } from '@siapso/engine';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { en } from './en.js';
import { fr, type Dictionary } from './fr.js';
import { interpolate, translate, type MessageKey } from './translate.js';

/** Every leaf of a nested dictionary as [dotted key, value]. */
function leaves(value: unknown, prefix = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

const dictionaries: Record<Lang, unknown> = { fr, en };
const EM_DASH = String.fromCodePoint(0x2014);
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '').sort();
}

describe('dictionaries', () => {
  it('have exactly the same keys in French and English', () => {
    const frKeys = leaves(fr).map(([key]) => key);
    const enKeys = leaves(en).map(([key]) => key);
    expect(enKeys.sort()).toEqual(frKeys.sort());
    expect(frKeys.length).toBeGreaterThan(0);
  });

  it('hold only non-empty strings', () => {
    for (const lang of ['fr', 'en'] as const) {
      for (const [key, value] of leaves(dictionaries[lang])) {
        expect(typeof value, `${lang} ${key}`).toBe('string');
        expect((value as string).trim(), `${lang} ${key}`).not.toBe('');
      }
    }
  });

  it.each(['fr', 'en'] as const)('never use forbidden wording in %s', (lang) => {
    for (const [key, value] of leaves(dictionaries[lang])) {
      expect(findForbiddenWording(value as string, lang), `${lang} ${key}`).toEqual([]);
    }
  });

  it.each(['fr', 'en'] as const)('never contain an em dash or an emoji in %s', (lang) => {
    for (const [key, value] of leaves(dictionaries[lang])) {
      expect(value as string, `${lang} ${key}`).not.toContain(EM_DASH);
      expect(PICTOGRAPHIC.test(value as string), `${lang} ${key}`).toBe(false);
    }
  });

  it('never say "vérifier" in French, in any form: the tool flags, it does not verify', () => {
    for (const [key, value] of leaves(fr)) {
      expect(value as string, `fr ${key}`).not.toMatch(/v[ée]rifi/i);
    }
  });

  it('use the same placeholders in both languages', () => {
    const english = new Map(leaves(en));
    for (const [key, value] of leaves(fr)) {
      expect(placeholders(english.get(key) as string), key).toEqual(placeholders(value as string));
    }
  });

  it('catch forbidden wording, em dashes and emoji (the checks are not vacuous)', () => {
    expect(findForbiddenWording('This is safe.', 'en')).toEqual(['safe']);
    expect(findForbiddenWording("C'est vérifié.", 'fr')).toEqual(['vérifié']);
    expect(`a${EM_DASH}b`).toContain(EM_DASH);
    expect(PICTOGRAPHIC.test(String.fromCodePoint(0x1f600))).toBe(true);
    expect(placeholders('{name} and {count}')).toEqual(['count', 'name']);
  });
});

describe('types (checked by tsc)', () => {
  it('reject a missing key, an extra key and an unknown dotted key', () => {
    // @ts-expect-error: a section without one of its French keys
    const missing: Dictionary['update'] = { ready: 'x' };
    // @ts-expect-error: a section with a key French does not have
    const extra: Dictionary['update'] = { ready: 'x', reload: 'y', later: 'z' };
    expectTypeOf<'home.check'>().toExtend<MessageKey>();
    expectTypeOf<'home.later'>().not.toExtend<MessageKey>();
    expectTypeOf<'home'>().not.toExtend<MessageKey>();
    expect([missing, extra]).toHaveLength(2);
  });
});

describe('translate', () => {
  it('returns the string of a dotted key in the requested language', () => {
    expect(translate('fr', 'danger.orientation')).toBe('Allez au poste de santé maintenant.');
    expect(translate('en', 'danger.orientation')).toBe('Go to the health post now.');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(interpolate('{count} of {total}', { count: 2, total: 5 })).toBe('2 of 5');
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('No placeholder')).toBe('No placeholder');
  });
});
