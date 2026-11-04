// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../eval/manifest.js';

const entry = {
  file: 'fr/spk-001-0001.wav',
  text: 'paracétamol',
  lang: 'fr',
  expect: 'paracetamol-1000',
  speaker: 'spk-001',
  consent: 'C-2026-001',
  licence: 'CC-BY-4.0',
};

const yamlOf = (...items: object[]): string => JSON.stringify(items);

describe('parseManifest', () => {
  it('accepts an empty list, the state before any recording', () => {
    expect(parseManifest('[]')).toEqual([]);
  });

  it('accepts a complete entry', () => {
    expect(parseManifest(yamlOf(entry))).toEqual([entry]);
  });

  it('accepts an entry without expect', () => {
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'expect'));
    expect(parseManifest(yamlOf(rest))).toHaveLength(1);
  });

  it('reads YAML', () => {
    const text = [
      '- file: wo/spk-002-0001.wav',
      '  text: kinkeliba',
      '  lang: wo',
      '  speaker: spk-002',
      '  consent: C-2026-002',
      '  licence: CC-BY-4.0',
    ].join('\n');
    expect(parseManifest(text)[0]?.lang).toBe('wo');
  });

  it('rejects a manifest that is not a list', () => {
    expect(() => parseManifest('{}')).toThrow(/list/);
    expect(() => parseManifest('')).toThrow(/list/);
  });

  it.each(['file', 'text', 'lang', 'speaker', 'consent', 'licence'])(
    'rejects an entry without %s',
    (key) => {
      const copy = Object.fromEntries(Object.entries(entry).filter(([name]) => name !== key));
      expect(() => parseManifest(yamlOf(copy))).toThrow(new RegExp(key));
    },
  );

  it('rejects an unknown language', () => {
    expect(() => parseManifest(yamlOf({ ...entry, lang: 'en' }))).toThrow(/lang/);
  });

  it('accepts mixed French and Wolof', () => {
    expect(parseManifest(yamlOf({ ...entry, lang: 'mix' }))).toHaveLength(1);
  });

  it('rejects a licence other than CC-BY-4.0', () => {
    expect(() => parseManifest(yamlOf({ ...entry, licence: 'CC-BY-NC-4.0' }))).toThrow(/licence/);
  });

  it('rejects an empty text or consent reference', () => {
    expect(() => parseManifest(yamlOf({ ...entry, text: '  ' }))).toThrow(/text/);
    expect(() => parseManifest(yamlOf({ ...entry, consent: '' }))).toThrow(/consent/);
  });

  it('rejects an audio path that leaves the audio folder', () => {
    expect(() => parseManifest(yamlOf({ ...entry, file: '../secret.wav' }))).toThrow(/file/);
    expect(() => parseManifest(yamlOf({ ...entry, file: '/etc/x.wav' }))).toThrow(/file/);
    expect(() => parseManifest(yamlOf({ ...entry, file: 'C:\\x.wav' }))).toThrow(/file/);
    expect(() => parseManifest(yamlOf({ ...entry, file: 'a\\b.wav' }))).toThrow(/file/);
  });

  it('rejects an audio file that is not wav', () => {
    expect(() => parseManifest(yamlOf({ ...entry, file: 'fr/a.mp3' }))).toThrow(/file/);
  });

  it('rejects a speaker that is not a pseudonymous id', () => {
    expect(() => parseManifest(yamlOf({ ...entry, speaker: 'Awa Diop' }))).toThrow(/speaker/);
    expect(() => parseManifest(yamlOf({ ...entry, speaker: 'awa@example.org' }))).toThrow(
      /speaker/,
    );
  });

  it('rejects an unknown key, so a typo is not silently ignored', () => {
    expect(() => parseManifest(yamlOf({ ...entry, expects: 'x' }))).toThrow();
  });

  it('rejects a duplicate audio file', () => {
    expect(() => parseManifest(yamlOf(entry, { ...entry, text: 'autre' }))).toThrow(/twice/);
  });

  it('names the entry that is wrong', () => {
    expect(() => parseManifest(yamlOf(entry, { ...entry, file: 'fr/b.wav', lang: 'xx' }))).toThrow(
      /#2/,
    );
  });
});
