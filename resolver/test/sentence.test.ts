// SPDX-License-Identifier: MIT
// The products named inside a sentence (SCRUM-61): a voice transcript or a
// typed text says more than the name ("dama naan doliprane ak nivaquine",
// "j'ai pris de l'advil et du coartem"), and the name may be spelt as a Wolof
// speaker writes a French word ("doliparan").
import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_NAME_WORDS,
  buildIndex,
  FILLER_WORDS,
  FOOD_NAME_WORDS,
  normalize,
  phoneticKey,
  productsInSentence,
  respellingsOf,
  WEAK_ALONE_WORDS,
} from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function product(
  id: string,
  names: IndexEntry['names'],
  extra: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    id,
    kind: 'product',
    family: id,
    display: { fr: id, en: id },
    names,
    priority: 3,
    detail: '',
    componentCount: 1,
    ...extra,
  };
}

function plant(id: string, names: IndexEntry['names']): IndexEntry {
  return {
    id,
    kind: 'plant',
    family: id,
    display: { fr: id, en: id },
    names,
    priority: 2,
    detail: '',
  };
}

const index = buildIndex([
  product(
    'doliprane-500',
    [
      { text: 'DOLIPRANE 500 mg, comprimé', lang: 'fr' },
      { text: 'DOLIPRANE', lang: 'brand' },
    ],
    { family: 'brand:dolipran', strengths: [500], substances: ['paracetamol'] },
  ),
  product(
    'doliprane-1000',
    [
      { text: 'DOLIPRANE 1000 mg, comprimé', lang: 'fr' },
      { text: 'DOLIPRANE', lang: 'brand' },
    ],
    { family: 'brand:dolipran', strengths: [1000], substances: ['paracetamol'] },
  ),
  product(
    'codoliprane',
    [
      { text: 'CODOLIPRANE 500 mg/30 mg, comprimé', lang: 'fr' },
      { text: 'CODOLIPRANE', lang: 'brand' },
      { text: 'Doliprane codéine', lang: 'fr' },
    ],
    {
      family: 'brand:kodolipran',
      substances: ['codeine', 'paracetamol'],
      componentCount: 2,
    },
  ),
  product(
    'paracetamol-generic',
    [
      { text: 'Paracétamol (générique)', lang: 'fr' },
      { text: 'paracétamol', lang: 'inn', substance: 'paracetamol' },
    ],
    { family: 'substances:paracetamol', priority: 2, substances: ['paracetamol'] },
  ),
  product(
    'codeine-generic',
    [
      { text: 'Codéine (générique)', lang: 'fr' },
      { text: 'codéine', lang: 'inn', substance: 'codeine' },
    ],
    { family: 'substances:codeine', priority: 2, substances: ['codeine'] },
  ),
  product(
    'chloroquine-generic',
    [
      { text: 'Chloroquine (générique)', lang: 'fr' },
      { text: 'Nivaquine', lang: 'brand' },
      { text: 'chloroquine', lang: 'inn', substance: 'chloroquine' },
    ],
    { family: 'substances:chloroquine', priority: 2, substances: ['chloroquine'] },
  ),
  product(
    'advil-200',
    [
      { text: 'ADVIL 200 mg, comprimé enrobé', lang: 'fr' },
      { text: 'ADVIL', lang: 'brand' },
    ],
    { family: 'brand:advil', strengths: [200], substances: ['ibuprofen'] },
  ),
  product(
    'ibuprofen-generic',
    [
      { text: 'Ibuprofène (générique)', lang: 'fr' },
      { text: 'ibuprofène', lang: 'inn', substance: 'ibuprofen' },
    ],
    { family: 'substances:ibuprofen', priority: 2, substances: ['ibuprofen'] },
  ),
  product(
    'artemether-lumefantrine-generic',
    [
      { text: 'Artéméther-luméfantrine (générique)', lang: 'fr' },
      { text: 'Coartem', lang: 'brand' },
    ],
    {
      family: 'substances:artemether+lumefantrine',
      priority: 2,
      substances: ['artemether', 'lumefantrine'],
      componentCount: 2,
    },
  ),
  product('iron-generic', [{ text: 'Fer (générique)', lang: 'fr' }], {
    family: 'substances:iron',
    priority: 2,
    substances: ['iron'],
  }),
  product('fer-acide-folique', [{ text: 'Fer et acide folique', lang: 'fr' }], {
    family: 'substances:folic-acid+iron',
    priority: 2,
    substances: ['folic-acid', 'iron'],
    componentCount: 2,
  }),
  product(
    'sp',
    [
      { text: 'SP (sulfadoxine-pyriméthamine)', lang: 'fr' },
      { text: 'Fansidar', lang: 'brand' },
    ],
    {
      family: 'substances:pyrimethamine+sulfadoxine',
      priority: 2,
      substances: ['pyrimethamine', 'sulfadoxine'],
      componentCount: 2,
    },
  ),
  product(
    'amoxicilline',
    [
      { text: 'AMOXICILLINE 500 mg, gélule', lang: 'fr' },
      { text: 'amoxicilline', lang: 'inn', substance: 'amoxicillin' },
    ],
    { family: 'brand:amoxisilin', strengths: [500], substances: ['amoxicillin'] },
  ),
  product(
    'kardegic',
    [
      { text: 'KARDEGIC 75 mg, poudre pour solution buvable en sachet', lang: 'fr' },
      { text: 'KARDEGIC', lang: 'brand' },
    ],
    { family: 'brand:kardegik', strengths: [75], substances: ['aspirin'] },
  ),
  product(
    'metronidazole-generic',
    [
      { text: 'Métronidazole (générique)', lang: 'fr' },
      { text: 'métronidazole', lang: 'inn', substance: 'metronidazole' },
    ],
    { family: 'substances:metronidazole', priority: 2, substances: ['metronidazole'] },
  ),
  product(
    'efferalgan-500',
    [
      { text: 'EFFERALGAN 500 mg, comprimé effervescent', lang: 'fr' },
      { text: 'EFFERALGAN', lang: 'brand' },
    ],
    { family: 'brand:eferalgan', strengths: [500], substances: ['paracetamol'] },
  ),
  product(
    'efferalgan-vitamine-c',
    [
      { text: 'EFFERALGAN VITAMINE C 500 mg/200 mg, comprimé effervescent', lang: 'fr' },
      { text: 'EFFERALGAN VITAMINE C', lang: 'brand' },
    ],
    {
      family: 'brand:eferalgan vitamin c',
      substances: ['ascorbic-acid', 'paracetamol'],
      componentCount: 2,
    },
  ),
  product(
    'bi-profenid',
    [
      { text: 'BI PROFENID LP 100 mg, comprimé sécable', lang: 'fr' },
      { text: 'BI PROFENID LP', lang: 'brand' },
    ],
    { family: 'brand:bi profenid lp', strengths: [100], substances: ['ketoprofen'] },
  ),
  product(
    'inofer',
    [
      { text: 'INOFER, comprimé pelliculé', lang: 'fr' },
      { text: 'INOFER', lang: 'brand' },
    ],
    { family: 'brand:inofer', substances: ['iron'] },
  ),
  product(
    'misoprostol-generic',
    [
      { text: 'Misoprostol (générique)', lang: 'fr' },
      { text: 'Cytotec', lang: 'brand' },
    ],
    { family: 'substances:misoprostol', priority: 2, substances: ['misoprostol'] },
  ),
  product(
    'laroscorbine-sans-sucre',
    [
      { text: 'LAROSCORBINE 500 mg SANS SUCRE, comprimé à croquer', lang: 'fr' },
      { text: 'LAROSCORBINE SANS SUCRE', lang: 'brand' },
    ],
    { family: 'brand:laroskorbin sans sukr', strengths: [500], substances: ['ascorbic-acid'] },
  ),
  plant('moringa', [
    { text: 'Moringa', lang: 'fr' },
    { text: 'nebeday', lang: 'wo' },
  ]),
  plant('kinkeliba', [{ text: 'Kinkéliba', lang: 'fr' }]),
  plant('castor-oil', [{ text: 'Huile de ricin', lang: 'fr' }]),
  plant('cola-nut', [
    { text: 'Noix de cola', lang: 'fr' },
    { text: 'guro', lang: 'wo' },
    { text: 'goro', lang: 'wo' },
  ]),
  plant('bitter-leaf', [{ text: 'Feuille amère', lang: 'fr' }]),
  plant('neem', [
    { text: 'Neem', lang: 'fr' },
    { text: 'nim', lang: 'wo' },
  ]),
  plant('ginger', [
    { text: 'Gingembre', lang: 'fr' },
    { text: 'jinjeer', lang: 'wo' },
  ]),
]);

/** The families found, in their order; `heard` for what the voice heard. */
const families = (sentence: string, heard = false): string[] =>
  productsInSentence(index, sentence, { heard }).map((found) => found.candidate.family);

describe('productsInSentence: names inside a sentence', () => {
  it('finds the product a French sentence names', () => {
    const [found, ...others] = productsInSentence(index, "J'ai pris du Doliprane ce matin.");
    expect(others).toEqual([]);
    expect(found?.candidate.family).toBe('brand:dolipran');
    expect(found?.text).toBe('Doliprane');
    expect(found?.strength).toBe('very-strong');
    expect(found?.checked).toBe(true);
  });

  it('finds the products a Wolof sentence names', () => {
    expect(families('Dama naan nebeday bi')).toEqual(['moringa']);
    expect(families('dafa jël kinkéliba ak garab yi')).toEqual(['kinkeliba']);
  });

  it('finds several products, in the order they are said', () => {
    expect(families('doliprane ak nivaquine')).toEqual([
      'brand:dolipran',
      'substances:chloroquine',
    ]);
    expect(families("j'ai pris de l'advil et du coartem")).toEqual([
      'brand:advil',
      'substances:artemether+lumefantrine',
    ]);
    expect(families('dama naan coartem, doliprane')).toEqual([
      'substances:artemether+lumefantrine',
      'brand:dolipran',
    ]);
  });

  it('keeps a name of several words whole', () => {
    const [oil] = productsInSentence(index, "j'ai bu de l'huile de ricin hier");
    expect(oil?.candidate.id).toBe('castor-oil');
    expect(oil?.text).toBe('huile de ricin');
    const [nut] = productsInSentence(index, 'mu ngi lekk noix de cola');
    expect(nut?.candidate.id).toBe('cola-nut');
    expect(nut?.text).toBe('noix de cola');
  });

  it('reads two names without a joining word as the product that bears both', () => {
    expect(families('doliprane codéine')).toEqual(['brand:kodolipran']);
  });

  it('reads two names joined by "et", "ak" or "avec" as two products', () => {
    expect(families('doliprane ak codéine')).toEqual(['brand:dolipran', 'substances:codeine']);
    expect(families('paracétamol et codéine')).toEqual([
      'substances:paracetamol',
      'substances:codeine',
    ]);
  });

  it('keeps a joining word inside a name said whole', () => {
    expect(families('dama naan fer et acide folique')).toEqual(['substances:folic-acid+iron']);
  });

  it('never reads across punctuation', () => {
    expect(families('Doliprane. Codéine.')).toEqual(['brand:dolipran', 'substances:codeine']);
  });

  it('ends a name with a letter alone only when the words make a whole name', () => {
    expect(families("j'ai pris de l'efferalgan vitamine c")).toEqual(['brand:eferalgan vitamin c']);
    expect(families("efferalgan c'est bon")).toEqual(['brand:eferalgan']);
  });

  it('names a family once', () => {
    expect(families('doliprane ak doliprane')).toEqual(['brand:dolipran']);
  });
});

describe('productsInSentence: a strength said with the name', () => {
  it('reads a strength said after the name, in digits or in words', () => {
    const [digits] = productsInSentence(index, 'dama naan doliprane 1000 mg tey');
    expect(digits?.strengthMg).toBe(1000);
    expect(digits?.text).toBe('doliprane 1000 mg');
    expect(digits?.candidate.id).toBe('doliprane-1000');
    const [words] = productsInSentence(index, "j'ai pris doliprane mille ce matin");
    expect(words?.strengthMg).toBe(1000);
    expect(words?.text).toBe('doliprane mille');
  });

  it('never reads a count or a small number without a unit as a strength', () => {
    for (const sentence of ['ñaar doliprane', 'doliprane 2 fois par jour', 'doliprane 2']) {
      const [found] = productsInSentence(index, sentence);
      expect(found?.candidate.family, sentence).toBe('brand:dolipran');
      expect(found?.strengthMg, sentence).toBeUndefined();
    }
  });
});

describe('productsInSentence: no product', () => {
  it('finds nothing in a sentence that names no product', () => {
    for (const sentence of [
      'dama feebar, sama bopp dafa metti',
      "j'ai mangé du riz et du poisson avec du pain",
      'Fatou ak Awa dañu dem marché',
      'ceeb ak jën',
      'waaw',
      '',
      ' ... ',
    ]) {
      expect(productsInSentence(index, sentence), sentence).toEqual([]);
    }
  });

  it('never takes a common word that starts a name for the product alone', () => {
    expect(families("j'ai mangé des noix de cajou")).toEqual([]);
    expect(families("c'est amer")).toEqual([]);
  });

  it('offers unticked a name that is also a common word', () => {
    // "goro" is a Wolof name of the cola nut, and also an in-law.
    const [found] = productsInSentence(index, 'sama goro dafa feebar');
    expect(found?.candidate.id).toBe('cola-nut');
    expect(found?.checked).toBe(false);
  });

  it('reads the short name SP said alone in a sentence', () => {
    expect(families('dama jël SP ci poste bi')).toEqual(['substances:pyrimethamine+sulfadoxine']);
  });

  it('reads letters written one by one with dots as one word ("S.P.")', () => {
    const [found] = productsInSentence(index, "on m'a donné la S.P. au poste");
    expect(found?.candidate.family).toBe('substances:pyrimethamine+sulfadoxine');
    expect(found?.text).toBe('S.P.');
    // A letter and a dot alone is no such word.
    expect(families("c'est M. Diop")).toEqual([]);
  });
});

describe('productsInSentence: names spelt as a Wolof speaker writes them', () => {
  it('reads a vowel put between two consonants, the name then being strong', () => {
    // One vowel put in: the brand within one edit (near).
    expect(families('dama naan doliparan')).toEqual(['brand:dolipran']);
    // Two changes from the name: read with the vowel taken out, then near.
    const [found] = productsInSentence(index, 'dafa naan ibiporofen');
    expect(found?.candidate.family).toBe('substances:ibuprofen');
    expect(found?.strength).toBe('strong');
    expect(found?.checked).toBe(true);
    expect(found?.readAs).toBe('ibiprofen');
  });

  it('reads r for l, b for p and a final vowel added', () => {
    expect(families('mu naan palasetamol')).toEqual(['substances:paracetamol']);
    expect(families('dama naan dolibrane')).toEqual(['brand:dolipran']);
    expect(families('dama jël nivakinu')).toEqual(['substances:chloroquine']);
  });

  // The Wolof orthography writes x for the sound French spells kh: a Wolof
  // writer spells the French x as ks, the French soft g as j, and z as s.
  it('reads ks for x, j for a soft g and s for z', () => {
    expect(families('dama naan amoksisilin')).toEqual(['brand:amoxisilin']);
    expect(families('mu ngi jël kardejik')).toEqual(['brand:kardegik']);
    expect(families('dafa naan metronidasol')).toEqual(['substances:metronidazole']);
  });
});

// The voice splits a name it does not know into words ("King Kyliba" for
// kinkéliba, "Libu Profaine" for l'ibuprofène, "d'Oli-Pran" for Doliprane):
// for a sentence heard, 2 or 3 words joined are read as one, sound for sound,
// and a name found so is offered unticked, to be checked.
describe('productsInSentence: the words of a name the voice split', () => {
  it('reads two or three words heard as one name, offered unticked', () => {
    const [found, ...others] = productsInSentence(
      index,
      'je prends de la tisanne de King Kyliba le matin',
      { heard: true },
    );
    expect(others).toEqual([]);
    expect(found?.candidate.id).toBe('kinkeliba');
    expect(found?.checked).toBe(false);
    expect(found?.strength).toBe('strong');
    expect(found?.heardAs).toBe('King Kyliba');
    expect(families('elle a pris de Libu Profaine pour le mal de dose', true)).toEqual([
      'substances:ibuprofen',
    ]);
    const [split] = productsInSentence(index, "j'ai pris du d'Oli-Pran ce matin", { heard: true });
    expect(split?.candidate.family).toBe('brand:dolipran');
    expect(split?.heardAs).toBe("d'Oli-Pran");
  });

  // The voice moves the article: "l'amoxicilline" heard as "la moxiceline",
  // "l'ibuprofène" as "Libu Profènie".
  it('reads an article the voice glued to the name, or cut from it', () => {
    const [moved] = productsInSentence(index, "on m'a donné de la moxiceline", { heard: true });
    expect(moved?.candidate.family).toBe('brand:amoxisilin');
    expect(moved?.checked).toBe(false);
    expect(moved?.heardAs).toBe('la moxiceline');
    expect(families('elle a pris de Libu Profènie air soir', true)).toEqual([
      'substances:ibuprofen',
    ]);
  });

  it('prefers the name of the words joined to the start of another name in one of them', () => {
    // "profène" alone starts BI PROFENID (ketoprofen); "Libu profène" is ibuprofen.
    expect(families('elle a pris de Libu profène hier soir', true)).toEqual([
      'substances:ibuprofen',
    ]);
    expect(families('elle a pris de Libu profène hier soir')).toEqual(['brand:bi profenid lp']);
  });

  it('keeps a name found ticked when the words joined name the same product', () => {
    const [found, ...others] = productsInSentence(index, "on m'a donné de l'amoxiceline", {
      heard: true,
    });
    expect(others).toEqual([]);
    expect(found?.candidate.family).toBe('brand:amoxisilin');
    expect(found?.checked).toBe(true);
    expect(found?.heardAs).toBeUndefined();
  });

  // With the names of the base given to the decoder, "kinkéliba" was heard as
  // "quinine qu'il y va": a name followed at once by the start of another
  // clause is not the sentence it seems.
  it('offers to confirm a name heard right before the start of another clause', () => {
    const [found] = productsInSentence(index, "je prends de la nivaquine qu'il y va le matin", {
      heard: true,
    });
    expect(found?.candidate.family).toBe('substances:chloroquine');
    expect(found?.checked).toBe(false);
    expect(found?.heardAs).toBe("nivaquine qu'il y va");
    // Typed, the words are what she wrote.
    const [typed] = productsInSentence(index, "je prends de la nivaquine qu'il y va le matin");
    expect(typed?.checked).toBe(true);
    // A name the sentence goes on from as usual stays ticked.
    const [plain] = productsInSentence(index, 'dama naan nivaquine ci suba', { heard: true });
    expect(plain?.checked).toBe(true);
  });

  // A FLEURS transcript: "l'invérée" sounds 1 letter off INOFER, but read as
  // "inver" it has 5 sounds only, too few to be one letter off a name.
  it('never reads words joined of fewer than 6 sounds as a name one letter off', () => {
    expect(families("la monnaie elle a l'invérée des îles", true)).toEqual([]);
  });

  it('reads them so only for what the voice heard, never for a typed text', () => {
    expect(families('je prends de la tisanne de King Kyliba le matin')).toEqual([]);
  });

  it('never offers a name over the words of a name found', () => {
    const found = productsInSentence(index, 'dama naan doliprane ak nivaquine', { heard: true });
    expect(found.map((product) => [product.candidate.family, product.checked])).toEqual([
      ['brand:dolipran', true],
      ['substances:chloroquine', true],
    ]);
  });

  it('finds nothing in words that sound like no name', () => {
    for (const sentence of [
      'Fatou ak Awa dañu dem marché',
      "j'ai mal à la tête depuis hier soir",
      'mburu ak meew laa lekk',
    ]) {
      expect(productsInSentence(index, sentence, { heard: true }), sentence).toEqual([]);
    }
  });
});

// Review of #68: a product named with a negation, by or for another person,
// or as a past use, is offered unticked with the clause that says so; never
// dropped, as she may still take it.
describe('productsInSentence: products named but maybe not taken', () => {
  /** [family, ticked, reason, clause] of each product found. */
  const read = (sentence: string, heard = true) =>
    productsInSentence(index, sentence, { heard }).map((found) => [
      found.candidate.family,
      found.checked,
      found.clause?.reason,
      found.clause?.text,
    ]);

  it('unticks a product said with a negation, in its clause only', () => {
    expect(read('je prends du doliprane mais pas de cytotec')).toEqual([
      ['brand:dolipran', true, undefined, undefined],
      ['substances:misoprostol', false, 'negation', 'pas de cytotec'],
    ]);
    expect(read('dama naan doliprane waaye duma naan cytotec')).toEqual([
      ['brand:dolipran', true, undefined, undefined],
      ['substances:misoprostol', false, 'negation', 'duma naan cytotec'],
    ]);
    expect(read("le médecin a dit de ne pas prendre de l'advil ni de l'ibuprofène")).toEqual([
      [
        'brand:advil',
        false,
        'negation',
        "le médecin a dit de ne pas prendre de l'advil ni de l'ibuprofène",
      ],
      [
        'substances:ibuprofen',
        false,
        'negation',
        "le médecin a dit de ne pas prendre de l'advil ni de l'ibuprofène",
      ],
    ]);
  });

  it('reads the Wolof negative forms of a verb', () => {
    for (const sentence of [
      'naanuma nebeday',
      'jëlul coartem',
      'amuma coartem',
      'duñu ma jox coartem',
      'bul naan nebeday',
    ]) {
      expect(
        read(sentence).map((found) => found.slice(1, 3)),
        sentence,
      ).toEqual([[false, 'negation']]);
    }
  });

  it('unticks a product another person takes, unless it is given to the speaker', () => {
    expect(read('mon mari prend du coartem et moi du doliprane')).toEqual([
      ['substances:artemether+lumefantrine', false, 'other-person', 'mon mari prend du coartem'],
      ['brand:dolipran', true, undefined, undefined],
    ]);
    expect(read('sama jëkkër dafay naan nivaquine')).toEqual([
      ['substances:chloroquine', false, 'other-person', 'sama jëkkër dafay naan nivaquine'],
    ]);
    expect(read('je donne du doliprane à ma petite soeur')[0]?.slice(1, 3)).toEqual([
      false,
      'other-person',
    ]);
    // Given to her, or taken with her: hers too.
    expect(read("ma mère m'a donné du moringa")[0]?.slice(1, 3)).toEqual([true, undefined]);
    expect(read('sama yaay dafa ma jox kinkéliba')[0]?.slice(1, 3)).toEqual([true, undefined]);
    expect(read('ma soeur et moi prenons du coartem')[0]?.slice(1, 3)).toEqual([true, undefined]);
  });

  it('unticks a product taken before or stopped', () => {
    expect(read('avant je prenais de la nivaquine maintenant du coartem')).toEqual([
      ['substances:chloroquine', false, 'past', 'avant je prenais de la nivaquine'],
      ['substances:artemether+lumefantrine', true, undefined, undefined],
    ]);
    for (const sentence of [
      "j'ai arrêté le moringa",
      'je ne prends plus de nivaquine',
      'bàyyi naa nivaquine',
      'dama daan naan nebeday',
    ]) {
      expect(
        read(sentence).map((found) => found.slice(1, 3)),
        sentence,
      ).toEqual([[false, 'past']]);
    }
  });

  it('carries the clause over to the names that follow without a verb of their own', () => {
    expect(read('mon mari prend du coartem et du doliprane').map((found) => found[1])).toEqual([
      false,
      false,
    ]);
    // With a verb or a subject of their own, the next words say something else.
    expect(read('je ne prends pas de cytotec et je prends du doliprane')).toEqual([
      ['substances:misoprostol', false, 'negation', 'je ne prends pas de cytotec'],
      ['brand:dolipran', true, undefined, undefined],
    ]);
    // "mais", "waaye", "maintenant" start a clause of their own.
    expect(read('pas de cytotec mais du doliprane').map((found) => found[1])).toEqual([
      false,
      true,
    ]);
  });

  it('keeps ticked what only looks like a negation', () => {
    // "ne ... que" is "only", "plus" joins two names, a name may hold "sans".
    expect(read('je ne prends que du doliprane').map((found) => found[1])).toEqual([true]);
    expect(read('doliprane plus advil').map((found) => found[1])).toEqual([true, true]);
    expect(read('je prends de la laroscorbine sans sucre')).toEqual([
      ['brand:laroskorbin sans sukr', true, undefined, undefined],
    ]);
    expect(read("je n'ai rien d'autre que du doliprane").map((found) => found[1])).toEqual([true]);
  });

  it('reads a typed sentence the same way', () => {
    expect(
      read('je prends du doliprane mais pas de cytotec', false).map((found) => found[1]),
    ).toEqual([true, false]);
  });

  it('keeps the product taken when the same one is also named as not taken', () => {
    expect(read('mon mari prend du doliprane et moi je prends du doliprane aussi')).toEqual([
      ['brand:dolipran', true, undefined, undefined],
    ]);
  });
});

// Review of #68: a remedy that is also a food may be named as food only.
describe('productsInSentence: a name that is also a food', () => {
  it('offers it unticked, saying it is also a food', () => {
    const found = productsInSentence(index, 'dama naan jinjeer ak nebeday', { heard: true });
    expect(
      found.map((product) => [product.candidate.id, product.checked, product.alsoFood]),
    ).toEqual([
      ['ginger', false, true],
      ['moringa', true, undefined],
    ]);
    expect(productsInSentence(index, 'une tisane de gingembre')[0]?.alsoFood).toBe(true);
  });
});

describe('phoneticKey', () => {
  it('reads alike the letters a voice confuses', () => {
    expect(phoneticKey('kingkiliba')).toBe('kinkilipa');
    expect(phoneticKey('kinkeliba')).toBe('kinkelipa');
    expect(phoneticKey('libuprofain')).toBe('lipuprofen');
    expect(phoneticKey('ibuprofen')).toBe('ipuprofen');
    expect(phoneticKey('dolipran')).toBe('tolipran');
  });
});

describe('respellingsOf', () => {
  it('changes one thing at a time', () => {
    expect(respellingsOf('dolipran')).toEqual(['doripran', 'dolibran', 'doliplan']);
    // Only the vowels that break a French cluster (pr, br, tr, dr, kr, gr, fr, vr, pl, bl, kl, gl, fl).
    expect(respellingsOf('dolipran')).not.toContain('dlipran');
    expect(respellingsOf('amoksisilin')).toContain('amoxisilin');
    expect(respellingsOf('kardejik')).toContain('kardegik');
    expect(respellingsOf('metronidasol')).toContain('metronidazol');
    expect(respellingsOf('nivakinu')).toContain('nivakin');
  });
});

describe('the word lists of a sentence', () => {
  it('lists words that are none of the names of the index', () => {
    for (const word of [...FILLER_WORDS, ...WEAK_ALONE_WORDS]) {
      expect(normalize(word), word).not.toBe('');
    }
    expect(AMBIGUOUS_NAME_WORDS).toContain('goro');
    expect(FOOD_NAME_WORDS).toEqual(expect.arrayContaining(['ail', 'gingembre', 'bissap']));
  });
});
