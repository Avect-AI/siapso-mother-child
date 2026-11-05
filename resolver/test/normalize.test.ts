// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { normalize, plainText } from '../src/index.js';

describe('plainText', () => {
  // The order of names and their first letter are read on the text as written:
  // "Cytotec" sorts under C, "gélule" after "comprimé".
  it('removes accents, case and punctuation, and keeps every spelling', () => {
    expect(plainText('  Huile de RICIN ')).toBe('huile de ricin');
    expect(plainText('DOLIPRANE 1000 mg, gélule')).toBe('doliprane 1000 mg gelule');
    expect(plainText('Néo-Codion')).toBe('neo codion');
    expect(plainText(' -- ')).toBe('');
  });

  // The Wolof orthography writes ñ and ŋ for the sounds French spelling
  // writes "gn" or "ny" and "ng" (SCRUM-61): ñ is not n.
  it('reads the Wolof letters ñ as ny and ŋ as ng, ë and é as e', () => {
    expect(plainText('Ñaar')).toBe('nyaar');
    expect(plainText('dañu')).toBe('danyu');
    expect(plainText('ŋeen')).toBe('ngeen');
    expect(plainText('gëm déedéet')).toBe('gem deedeet');
    // Decomposed (NFD) input reads the same.
    expect(plainText('ñaar')).toBe('nyaar');
  });
});

describe('normalize: base rules', () => {
  it('removes accents, case, punctuation and extra spaces', () => {
    expect(normalize('  Kinkéliba ')).toBe('kinkeliba');
    expect(normalize('Néo-Codion')).toBe('neo kodion');
    expect(normalize("l'huile  de RICIN")).toBe('l uile de risin');
  });

  it('returns an empty string for text without letters or digits', () => {
    expect(normalize(' -- ')).toBe('');
  });
});

describe('normalize: spelling variants', () => {
  it('maps ph to f', () => {
    expect(normalize('phenytoine')).toBe(normalize('fenitoine'));
    expect(normalize('Pharmacie')).toBe('farmasi');
  });

  it('maps y to i', () => {
    expect(normalize('nebeday')).toBe('nebedai');
    expect(normalize('Kinkeliba')).toBe(normalize('Kinkelyba'));
  });

  it('collapses doubled consonants', () => {
    expect(normalize('doliprann')).toBe('dolipran');
    expect(normalize('Bissap')).toBe('bisap');
    expect(normalize('paracettamol')).toBe(normalize('paracetamol'));
  });

  it('keeps doubled digits', () => {
    expect(normalize('1000 mg')).toBe('1000 mg');
  });

  it('strips a trailing e in words of more than 4 letters only', () => {
    expect(normalize('ibuprofene')).toBe('ibuprofen');
    expect(normalize('Doliprane')).toBe('dolipran');
    expect(normalize('moringae')).toBe('moringa');
    expect(normalize('tube')).toBe('tube');
    expect(normalize('moye')).toBe('moie');
  });

  it('applies to every word', () => {
    expect(normalize('huile de ricine')).toBe(normalize('huile de ricin'));
    expect(normalize('huile de ricine')).toBe('uile de risin');
  });

  it('maps qu to k (the French spelling of the k sound)', () => {
    expect(normalize('quinquéliba')).toBe(normalize('kinkéliba'));
    expect(normalize('Nivaquine')).toBe(normalize('nivakine'));
    expect(normalize('quinine')).toBe('kinin');
  });

  it('does not map kh to x because it changes the meaning', () => {
    expect(normalize('dakhar')).toBe('dakhar');
    expect(normalize('dakhar')).not.toBe(normalize('daxar'));
  });

  it('is idempotent', () => {
    for (const text of [
      'Doliprane',
      'phénytoïne',
      'huile de ricin',
      'Bactrim Forte',
      'Cytotec',
      'cytoteck',
      'chloroquine',
      'kodeyin',
      'Acide méfénamique',
      'succinate',
      'huille de rissin',
      'thé',
      'nebedaay',
    ]) {
      expect(normalize(normalize(text))).toBe(normalize(text));
    }
  });
});

// A name is often written as it sounds (live test round 2: "sitotek" for
// Cytotec, "huile de rissin" for castor oil, "kodeyin" for codeine), by a
// woman, a relay or the Wolof voice, which writes French names phonetically.
describe('normalize: phonetic spellings', () => {
  it('reads c before e, i or y as s, and any other c as k', () => {
    expect(normalize('Cytotec')).toBe('sitotek');
    expect(normalize('sitotek')).toBe(normalize('Cytotec'));
    expect(normalize('ricin')).toBe(normalize('risin'));
    expect(normalize('codéine')).toBe(normalize('kodeine'));
    expect(normalize('Ciprofloxacine')).toBe(normalize('siprofloxasine'));
  });

  it('keeps ch, a sound of its own', () => {
    expect(normalize('chloroquine')).toBe('chlorokin');
    expect(normalize('chloroquine')).not.toBe(normalize('kloroquine'));
  });

  it('reads ck as k', () => {
    expect(normalize('cytoteck')).toBe(normalize('Cytotec'));
  });

  it('drops a silent h at the start of a word and after a consonant', () => {
    expect(normalize('huile')).toBe(normalize('uile'));
    expect(normalize('thé')).toBe(normalize('té'));
    expect(normalize('rhume')).toBe(normalize('rume'));
  });

  it('keeps h after c, s, p and k (ch, sh, ph, kh) and between vowels', () => {
    expect(normalize('shea')).toBe('shea');
    expect(normalize('dakhar')).toBe('dakhar');
    expect(normalize('bahia')).toBe('bahia');
  });

  it('collapses every doubled letter, vowels included, but not digits', () => {
    expect(normalize('rissin')).toBe(normalize('ricin'));
    expect(normalize('huille')).toBe(normalize('huile'));
    expect(normalize('nebedaay')).toBe(normalize('nebeday'));
    expect(normalize('ngeer')).toBe(normalize('nger'));
    expect(normalize('1000 mg')).toBe('1000 mg');
  });

  it('reads a final -que, -c or -k alike', () => {
    expect(normalize('méfénamique')).toBe('mefenamik');
    expect(normalize('mefenamik')).toBe('mefenamik');
    expect(normalize('cytotec')).toBe(normalize('cytotek'));
  });

  it('reads the Wolof spelling ey of é-i as the French one (kodeyin, codéine)', () => {
    expect(normalize('kodeyin')).toBe(normalize('codéine'));
  });

  it('reads the French ou as the Wolof u', () => {
    expect(normalize('Nourofen')).toBe(normalize('Nurofen'));
    expect(normalize('toubab')).toBe(normalize('tubaab'));
  });

  it('keeps a word of one letter as it is: the C of a vitamin is a name, not a sound', () => {
    expect(normalize('Vitamine C')).toBe('vitamin c');
    expect(normalize('vitamine h')).toBe('vitamin h');
    expect(normalize('B9')).toBe('b9');
  });

  it('reads the phonetic spellings of the live test as the names they write', () => {
    expect(normalize('huile de rissin')).toBe(normalize('huile de ricin'));
    expect(normalize('huille de rissin')).toBe(normalize('huile de ricin'));
    expect(normalize('uile de risin')).toBe(normalize('huile de ricin'));
    expect(normalize('cytoteck')).toBe(normalize('sitotek'));
  });
});
