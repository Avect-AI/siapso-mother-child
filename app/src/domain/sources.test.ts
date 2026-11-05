// SPDX-License-Identifier: MIT
import type { Source } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import { sourceWords } from './sources.js';

const OPENFDA: Source = {
  id: 'openfda',
  name: 'openFDA drug labels',
  licence: 'CC0 1.0 / public domain',
  url: 'https://open.fda.gov/',
  version: 'Label version or access date, given in each citation',
  documents: 'en',
  fr: {
    name: 'Notices de médicaments des États-Unis (openFDA)',
    licence: 'CC0 1.0 / domaine public',
    version: 'Version de la notice ou date de consultation, donnée dans chaque citation',
  },
};

describe('sourceWords', () => {
  it('says a source in French on a French screen, and that its documents are in English', () => {
    expect(sourceWords(OPENFDA, 'fr')).toEqual({
      name: 'Notices de médicaments des États-Unis (openFDA)',
      licence: 'CC0 1.0 / domaine public',
      version: 'Version de la notice ou date de consultation, donnée dans chaque citation',
      documents: 'en',
    });
  });

  it('keeps the words of its entry in English, with nothing to say about its documents', () => {
    expect(sourceWords(OPENFDA, 'en')).toEqual({
      name: 'openFDA drug labels',
      licence: 'CC0 1.0 / public domain',
      version: 'Label version or access date, given in each citation',
    });
  });

  it('says that French documents are in French on an English screen', () => {
    const bdpm: Source = { ...OPENFDA, documents: 'fr' };
    expect(sourceWords(bdpm, 'en').documents).toBe('fr');
    expect(sourceWords(bdpm, 'fr')).not.toHaveProperty('documents');
  });

  it('writes an access date as the language writes dates', () => {
    const dated: Source = {
      id: 'x',
      name: 'X',
      licence: 'L',
      url: 'https://example.org/',
      version: '2026-11-04',
      fr: { name: 'X', licence: 'L' },
    };
    expect(sourceWords(dated, 'fr').version).toBe('04/11/2026');
    expect(sourceWords(dated, 'en').version).toBe('4 November 2026');
  });

  it('falls back to the words of its entry for a pack that has no French words yet', () => {
    const older: Source = {
      id: 'openfda',
      name: 'openFDA drug labels',
      licence: 'CC0 1.0 / public domain',
      url: 'https://open.fda.gov/',
    };
    expect(sourceWords(older, 'fr')).toEqual({
      name: 'openFDA drug labels',
      licence: 'CC0 1.0 / public domain',
    });
  });
});
