// SPDX-License-Identifier: MIT
// The reading of a prescription text, rule by rule, each case from a failure
// seen in the SCRUM-57 spike (docs/superpowers/specs/2026-11-05-prescription-scan-design.md,
// section 4.3). Synthetic lines only: no real prescription, no real person.
import type { Pack } from '@siapso/engine';
import { normalize, parseStrength } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import {
  mayBePreTicked,
  readPrescription,
  unitsPerDayOf,
  type PrescriptionProduct,
} from './prescription-reading.js';
import { PERSON_NAMES, PLACE_NAMES } from './prescription-words.js';
import { needsUnitsPerDay, strengthChoiceOf } from './search-index.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

/** The sorted substances of a product of the pack. */
function substancesOf(id: string): string {
  const product = pack.products.find((p) => p.id === id);
  return (product?.components ?? [])
    .map((c) => c.substance)
    .sort()
    .join('+');
}

function only(lines: string[]): PrescriptionProduct {
  const { products } = readPrescription(pack, lines);
  expect(products, JSON.stringify(products.map((p) => p.ref.id))).toHaveLength(1);
  return products[0] as PrescriptionProduct;
}

describe('readPrescription: lines', () => {
  it('joins a name wrapped over two lines of a table cell: SP is one product, never MALOCIDE', () => {
    const product = only(['1. SP (Sulfadoxine', 'Pyriméthamine)', '3 cp en une prise, TPI 2']);
    expect(substancesOf(product.ref.id)).toBe('pyrimethamine+sulfadoxine');
    expect(product.line).toBe('1. SP (Sulfadoxine Pyriméthamine)');
    expect(product.lineIndex).toBe(0);
  });

  it('joins a name whose line ends with "+"', () => {
    const product = only(['2. Fer +', 'Acide folique cp', '1 cp/jour pendant 3 mois']);
    expect(substancesOf(product.ref.id)).toBe('folic-acid+iron');
  });

  it('gives the products in the order of the prescription, with the line each was read on', () => {
    const { products } = readPrescription(pack, [
      '1. Doliprane 1000 mg cp : 1 cp x 3/jour si douleur',
      '2. Flagyl 500 mg cp',
      '1 cp x 2/j pendant 7 jours',
    ]);
    expect(products.map((p) => p.ref.id)).toEqual([
      'doliprane-1000-mg-60234100',
      'flagyl-500-mg-61659061',
    ]);
    expect(products.map((p) => p.lineIndex)).toEqual([0, 1]);
    expect(products[1]?.line).toBe('2. Flagyl 500 mg cp');
  });

  it('joins a name wrapped across one posology line while its bracket is open: never MALOCIDE too', () => {
    const { products } = readPrescription(pack, [
      'SP (Sulfadoxine',
      '3 cp en une prise',
      'Pyriméthamine)',
    ]);
    expect(products.map((p) => substancesOf(p.ref.id))).toEqual(['pyrimethamine+sulfadoxine']);
    expect(products[0]?.line).toBe('SP (Sulfadoxine Pyriméthamine)');
    expect(products[0]?.posology).toBe('3 cp en une prise');
  });

  it('accepts a text of several lines as well as a list of lines', () => {
    const text = '1. Flagyl 500 mg cp\n1 cp x 2/j pendant 7 jours';
    expect(readPrescription(pack, [text]).products.map((p) => p.ref.id)).toEqual([
      'flagyl-500-mg-61659061',
    ]);
  });
});

describe('readPrescription: lines that are not products', () => {
  it.each([
    'RÉPUBLIQUE DU SÉNÉGAL',
    'Un Peuple - Un But - Une Foi',
    "MINISTÈRE DE LA SANTÉ ET DE L'ACTION SOCIALE",
    'Région médicale de Kaolack',
    'District sanitaire de Nioro du Rip',
    'Poste de santé de Keur Madiabel',
    'ORDONNANCE',
    'Nom et prénom : Fatou Ndiaye',
    'Âge : 27 ans Date : 06/09/2026',
    'Terme : 36 SA Date : 06/09/2026',
    'Mme Aminata Diop, 31 ans',
    'Signature et cachet',
    'Dr Moussa Diop',
    'Cabinet médical Al Amine',
    'Tél : 33 000 00 00',
    'Rue 10 x 13, Mbour',
    'CENTRE DE SANTÉ DE MBOUR',
    'Service de maternité',
    'Médicament Posologie',
    'POSTE DE SANTÉ DE NGAPAROU',
  ])('proposes nothing and keeps nothing for a header, patient or signature line: %s', (line) => {
    expect(readPrescription(pack, [line])).toEqual({ products: [], typed: [] });
  });

  it('proposes nothing for any synthetic patient name of the evaluation set', () => {
    const first = ['Fatou', 'Awa', 'Aminata', 'Mariama', 'Khady', 'Coumba', 'Ndèye', 'Astou'];
    const last = ['Ndiaye', 'Diop', 'Fall', 'Sow', 'Ba', 'Sarr', 'Gueye', 'Faye', 'Diallo'];
    for (const a of first) {
      for (const b of last) {
        expect(readPrescription(pack, [`Nom et prénom : ${a} ${b}`]).products).toEqual([]);
        expect(readPrescription(pack, [`${a} ${b}`]).products, `${a} ${b}`).toEqual([]);
      }
    }
  });

  it.each([
    'Pharmacie Guigon',
    'PHARMACIE DU POINT E',
    'Visa du pharmacien',
    'Pédiatre',
    'Pédiatrie',
    'SENEGA1',
    'REPUBLIOUE DU SENEGA1',
    'MINISTERE DE LA SANTE',
    'Dutrict sanitaire de Koumpentoum',
    'Dakar, le 06/11/2026',
    'Thiès, le 3 novembre 2026',
    'BP 5035 Dakar Fann',
    'Hôpital régional de Thiès',
    'HOPITAL PRINCIPAL DE DAKAR',
    'Polyclinique de la Médina',
    'Service de gynécologie-obstétrique',
    'Dr Awa Ndiaye, médecin',
    'Mme Ndèye Gueye, sage-femme',
    'Médecin chef',
    'Dakar',
    'Fann',
    'Point E',
    'Saint-Louis',
    'Keur Madiabel',
    'Bamako',
    'Pharmacie centrale',
  ])(
    'proposes nothing and keeps nothing for a pharmacy, hospital, place or date line: %s',
    (line) => {
      expect(readPrescription(pack, [line])).toEqual({ products: [], typed: [] });
    },
  );

  it.each([
    '06 novembre 2026',
    '12 Rue Carnot',
    '14 Avenue Bourguiba',
    'Villa 12, Cité Keur Gorgui',
    '25 ans, Mme Fatou Diop',
    '1. Dr Diop Pédiatre',
    '2. Mlle Awa Sow',
    '3. Madame Coumba Fall',
    '4. 06/11/2026',
    '5. Fatou Ndiaye, 25 ans',
    '6. M. Cheikh Ndao',
  ])('never offers a line of a date, an address, an age or a person as typed: %s', (line) => {
    expect(readPrescription(pack, [line])).toEqual({ products: [], typed: [] });
  });

  it('reads the product of a line the prescriber or the stamp was joined to, and never offers that part', () => {
    const fluconazole = readPrescription(pack, ['4. Fluconazole 150 mg gél Dr Ba']);
    expect(fluconazole.products.map((p) => substancesOf(p.ref.id))).toEqual(['fluconazole']);
    expect(fluconazole.products[0]?.query).toBe('Fluconazole 150 mg gél');
    // The line quoted under it holds no name read from the paper.
    expect(fluconazole.products[0]?.line).toBe('4. Fluconazole 150 mg gél');
    expect(fluconazole.typed).toEqual([]);
    // A product outside the base joined to the stamp is kept, without the stamp.
    const { typed } = readPrescription(pack, ['5. Spasfon Lyoc 80 mg CLINIQUE DE LA PAIX']);
    expect(typed.map((t) => t.text)).toEqual(['Spasfon Lyoc 80 mg']);
  });

  // Review of PR 70, round 2: lines the header cut lost entirely.
  it.each([
    ['Dakar 1. Doliprane 1000 mg cp', 'paracetamol', 1000],
    ['Pour Awa : Doliprane 500 mg', 'paracetamol', 500],
    ['1. Médicament : Doliprane 1000 mg', 'paracetamol', 1000],
    ['1. Médicament Doliprane 1000 mg', 'paracetamol', 1000],
    ['DOXYCYCLINE PHARMACIE CENTRALE DES ARMEES 100 mg, comprimé : 1 cp x 2/j', 'doxycycline', 100],
    ['DOXYCYCLINE PHARMACIE CENTRALE DES ARMEES : 1 cp x 2/j', 'doxycycline', undefined],
  ])(
    'reads the product after a header part, or a header word of a name of the base: %s',
    (line, substances, mg) => {
      const product = only([line]);
      expect(substancesOf(product.ref.id)).toBe(substances);
      expect(product.strengthMg).toBe(mg);
      // No name read from the paper is quoted.
      expect(product.line).not.toMatch(/Awa|Dakar/);
      expect(product.query).not.toMatch(/Awa|Dakar|Médicament/);
    },
  );

  it('reads a first name followed by a substance as the name of a product: "1. Anta codéine 400"', () => {
    const { products } = readPrescription(pack, ['1. Anta codéine 400']);
    expect(products.map((p) => substancesOf(p.ref.id))).toContain('codeine+ibuprofen');
  });

  it('offers a product line whose age is the age of the box: "1. Vermox 500 mg dès 2 ans"', () => {
    expect(readPrescription(pack, ['1. Vermox 500 mg dès 2 ans']).typed.map((t) => t.text)).toEqual(
      ['Vermox 500 mg dès 2 ans'],
    );
  });

  it('never offers a numbered line of a name the base does not know and a family name', () => {
    for (const line of ['3. Mbissine Faye', '4. Zeyna Ndiaye', '5. Thiaba Sarr']) {
      expect(readPrescription(pack, [line]), line).toEqual({ products: [], typed: [] });
    }
  });

  it(
    'reads every name, brand and local name of the base, numbered or with a posology',
    { timeout: 300_000 },
    () => {
      const lost: string[] = [];
      const named = new Map<string, string>();
      for (const p of pack.products) {
        for (const name of [
          p.names.fr,
          p.names.en,
          ...p.brands,
          ...p.localNames.map((l) => l.text),
        ]) {
          if (!named.has(name)) named.set(name, substancesOf(p.id));
        }
      }
      for (const p of pack.plants) {
        for (const name of [p.names.fr, p.names.en, ...p.localNames.map((l) => l.text)]) {
          if (!named.has(name)) named.set(name, `plant:${p.id}`);
        }
      }
      for (const [name, want] of named) {
        for (const line of [`1. ${name}`, `${name} : 1 cp x 2/j`]) {
          const got = readPrescription(pack, [line]).products.map((p) =>
            p.ref.kind === 'plant' ? `plant:${p.ref.id}` : substancesOf(p.ref.id),
          );
          if (!got.includes(want)) lost.push(`${line}: ${got.join(', ')}`);
        }
      }
      expect(lost).toEqual([]);
    },
  );

  it('never takes a form word for a header word one slip away ("sachet" is no "cachet")', () => {
    expect(readPrescription(pack, ['Smecta sachet']).typed.map((t) => t.text)).toEqual([
      'Smecta sachet',
    ]);
    expect(only(['Aspégic 500 1 sachet x 3/j']).ref.id).toMatch(/^aspegic-/);
  });

  it('never takes a single laboratory or qualifier word for a product', () => {
    for (const line of [
      '1. Pédiatrique',
      '2. Pharmacie centrale',
      '3. Forte',
      '4. LP',
      '5. Enfant',
    ]) {
      expect(readPrescription(pack, [line]).products, line).toEqual([]);
    }
  });

  it('never reads a place as a product or a remedy, and no place is a name of the base', () => {
    const names = new Set(
      [
        ...pack.plants.flatMap((p) => [p.names.fr, p.names.en, ...p.localNames.map((l) => l.text)]),
        ...pack.products.flatMap((p) => [p.names.fr, ...p.brands]),
      ].flatMap((name) => normalize(name).split(' ')),
    );
    for (const place of PLACE_NAMES) {
      for (const word of normalize(place).split(' ')) {
        if (word.length > 2) expect(names.has(word), `${place}: ${word}`).toBe(false);
      }
      expect(readPrescription(pack, [place]).products, place).toEqual([]);
      expect(readPrescription(pack, [`Fait à ${place}`]).products, place).toEqual([]);
    }
  });

  it('never offers a name read from the paper: a common first or family name ends the line', () => {
    // As Tesseract read the prescriber joined to the last product (development set).
    expect(readPrescription(pack, ['gagnante et M, Cheikh dno CP'])).toEqual({
      products: [],
      typed: [],
    });
    expect(readPrescription(pack, ['M Cheikh Néso, cp'])).toEqual({ products: [], typed: [] });
    expect(readPrescription(pack, ['5. Awa Diop'])).toEqual({ products: [], typed: [] });
    const { typed } = readPrescription(pack, ['6. Primpéran 10 mg DE DPEUmar Ba']);
    expect(typed.map((t) => t.text)).toEqual(['Primpéran 10 mg DE DPEUmar']);
    expect(typed.map((t) => t.line)).toEqual(['6. Primpéran 10 mg DE DPEUmar']);
  });

  it('knows no person name that is a word of a name of the base', () => {
    const names = new Set(
      [
        ...pack.plants.flatMap((p) => [p.names.fr, p.names.en, ...p.localNames.map((l) => l.text)]),
        ...pack.products.flatMap((p) => [p.names.fr, ...p.brands]),
        ...pack.substances.flatMap((s) => [s.names.fr, s.names.en]),
      ].flatMap((name) => normalize(name).split(' ')),
    );
    for (const person of PERSON_NAMES) {
      expect(names.has(normalize(person)), person).toBe(false);
    }
  });

  it('proposes nothing for patient lines written with a title', () => {
    for (const a of ['Fatou', 'Awa', 'Aminata', 'Bineta', 'Rokhaya', 'Seynabou']) {
      for (const b of ['Ndiaye', 'Diop', 'Fall', 'Mbaye', 'Cissé', 'Thiam']) {
        for (const line of [`Mlle ${a} ${b}`, `Madame ${a} ${b}`, `Patiente : ${a} ${b}`]) {
          expect(readPrescription(pack, [line]), line).toEqual({ products: [], typed: [] });
        }
      }
    }
  });

  it.each([
    '1 cp x 3/j pendant 5 jours',
    '2 gél x 3/j pendant 7 jours',
    "3 cp en prise unique (TPI) devant l'agent",
    '2 cp par semaine',
    '1 cp matin, midi et soir pendant 3 jours',
    'pendant 7 jours',
    'QSP 3 mois',
    '1 c. à soupe x 3/j',
  ])('never searches a posology line: %s', (line) => {
    expect(readPrescription(pack, [line])).toEqual({ products: [], typed: [] });
  });

  // As PaddleOCR read "1 cp en prise unique" on a tilted photo: the resolver
  // reads words as they sound, so "price" is "prise", a posology word.
  it('never searches a posology word read with a slip: "1 ap en price unique"', () => {
    expect(readPrescription(pack, ['1 ap en price unique']).products).toEqual([]);
  });

  it('never proposes a weak resemblance: a short prefix or a first name gives nothing', () => {
    for (const line of ['1. Anta', '2. Moussa', '3. Vitamines']) {
      expect(readPrescription(pack, [line]).products, line).toEqual([]);
    }
  });
});

describe('readPrescription: cleaning', () => {
  it('drops a list number whose dot was lost: "2 Acide folique 5 mg" is 5 mg, never 2', () => {
    const product = only(['2 Acide folique 5 mg', '1 cp le soir']);
    expect(substancesOf(product.ref.id)).toBe('folic-acid');
    expect(product.strengthMg).toBe(5);
    expect(product.query).toBe('Acide folique 5 mg');
  });

  it('splits a strength glued to a long word: "Spéciafoldine5 my"', () => {
    const product = only(['3. Spéciafoldine5 my']);
    expect(product.ref.id).toMatch(/^speciafoldine-/);
    expect(product.strengthMg).toBe(5);
  });

  it('reads a numbered product line the stamp was joined to: "Fluconazole 150 mg gél CLINIQUE DE"', () => {
    const product = only(['4. Fluconazole 150 mg gél CLINIQUE DE', '1 gél en prise unique']);
    expect(substancesOf(product.ref.id)).toBe('fluconazole');
    expect(product.strengthMg).toBe(150);
  });

  it('reads a digit the OCR put inside a word as the letter it stands for: "fol1que"', () => {
    expect(substancesOf(only(['5. Fer + Acide fol1que cp']).ref.id)).toBe('folic-acid+iron');
    expect(substancesOf(only(['6. Amox1cilline 500 mg gél']).ref.id)).toBe('amoxicillin');
    expect(substancesOf(only(['8. SP (Sulfadox1ne Pyriméthamine)']).ref.id)).toBe(
      'pyrimethamine+sulfadoxine',
    );
    // A vitamin and its number, and a strength glued to a name, stay as they are.
    expect(only(['7. Tardyféron B9']).ref.id).toMatch(/^tardyferon-b9-/);
    expect(only(['9. Doliprane1g']).strengthMg).toBe(1000);
    expect(only(['9. Ibuprofène400mg']).strengthMg).toBe(400);
  });

  it('snaps a long word misread by the OCR to the substance or brand name it is close to', () => {
    expect(
      substancesOf(only(['1. SP (Gsulfadofine Pyriméthamine) : 3 cp en une prise']).ref.id),
    ).toBe('pyrimethamine+sulfadoxine');
    expect(only(['2. Efferalany 1 g cp eff']).ref.id).toMatch(/^efferalgan-/);
    // Two slips allowed from 9 letters as read, whatever the resolver folds
    // ("ii" read as one letter): PaddleOCR on the handwriting proxy.
    expect(substancesOf(only(['5 Amoxiciine gl: glx 3/ pendant7 jo']).ref.id)).toBe('amoxicillin');
  });
});

describe('readPrescription: one product per line', () => {
  it('reads "Fer + Acide folique" as the iron and folic acid product, never also "Fer" or "Acide folique"', () => {
    const product = only(['1. Fer + Acide folique cp : 1 cp/jour pendant 3 mois']);
    expect(substancesOf(product.ref.id)).toBe('folic-acid+iron');
    expect(product.missingSubstances).toEqual([]);
  });

  it('reads ASAQ written with its substances as the combination', () => {
    const product = only(['3. ASAQ (Artésunate + Amodiaquine)', '2 cp/j pendant 3 jours']);
    expect(substancesOf(product.ref.id)).toBe('amodiaquine+artesunate');
  });

  it('says how clearly the line names the product, and keeps the resolver candidate', () => {
    const product = only(['1. Doliprane 1000 mg cp']);
    expect(product.match).toBe('very-strong');
    expect(product.candidate.id).toBe(product.ref.id);
    expect(product.ref.kind).toBe('product');
  });
});

describe('readPrescription: a combination read in part (must warn)', () => {
  // The OCR lost part of the name, so the best the line gives is one part of
  // the combination: the item says which substance the line also names, is
  // never pre-ticked, and the line is also offered to add as typed, so the
  // result's safety net looks it up again (a level is never lowered silently).
  it('says the line also names a substance the product lacks, and offers the line as typed', () => {
    const { products, typed } = readPrescription(pack, ['1. Pyriméthamine 25 mg Sulfadox']);
    const product = products[0];
    expect(products).toHaveLength(1);
    expect(product?.ref.id).toBe('malocide-50-mg-67961885');
    expect(product?.missingSubstances).toEqual(['sulfadoxine']);
    expect(product && mayBePreTicked(product)).toBe(false);
    expect(typed).toEqual([
      {
        text: 'Pyriméthamine 25 mg Sulfadox',
        line: '1. Pyriméthamine 25 mg Sulfadox',
        lineIndex: 0,
        reason: 'names-more',
        forProduct: 0,
      },
    ]);
  });

  /**
   * Every product read on the line is the whole combination, or a part of it
   * that says what else the line names, is never pre-ticked, and comes with
   * the line offered as typed.
   */
  function expectWholeOrWarned(line: string, combination: string): void {
    const { products, typed } = readPrescription(pack, [line]);
    expect(products.length, line).toBeGreaterThan(0);
    const parts = combination.split('+');
    products.forEach((product, forProduct) => {
      const got = substancesOf(product.ref.id);
      if (got === combination) return;
      const missing = parts.filter((s) => !got.split('+').includes(s));
      expect(missing.length, `${line}: ${got}`).toBeGreaterThan(0);
      expect(product.missingSubstances, `${line}: ${got}`).toEqual(missing);
      expect(mayBePreTicked(product), line).toBe(false);
      expect(typed, line).toContainEqual(
        expect.objectContaining({ reason: 'names-more', forProduct, lineIndex: 0 }),
      );
    });
  }

  it.each([
    ['2. Fer (Acide folique illisible', 'folic-acid+iron'],
    ['1. Pyriméthamine Sulfadoxyne)', 'pyrimethamine+sulfadoxine'],
    ['3. Amodiaquine (Artésun', 'amodiaquine+artesunate'],
    ['4. Fer + Ac. folique cp', 'folic-acid+iron'],
    // As Tesseract read a printed page (development set): the short name says
    // what the garbled words no longer do.
    ['1. Fer acide otique (FAF)', 'folic-acid+iron'],
  ])('reads %s whole, or in part with the warning', (line, combination) => {
    expectWholeOrWarned(line, combination);
  });

  it('warns for a line read in part (the checks above are not vacuous)', () => {
    for (const line of [
      '3. Amodiaquine (Artésun',
      '4. Fer + Ac. folique cp',
      '1. Fer acide otique (FAF)',
    ]) {
      const [product] = readPrescription(pack, [line]).products;
      expect(product?.missingSubstances.length, line).toBe(1);
    }
  });

  // Lines as Tesseract read the handwriting-style proxy in the spike: the
  // other substance garbled past any spelling slip, yet still resembling it.
  it.each([
    ['3, AP ulfaderne Pynimélhamine) : 5 pen', 'pyrimethamine', 'sulfadoxine'],
    ['/ AP ulfadiire Pyrnimélhamine) ge', 'pyrimethamine', 'sulfadoxine'],
    ['/ AP ubfaderine Pyrimélhamine) pen', 'pyrimethamine', 'sulfadoxine'],
    ['4, AP udfaeine Pyriméthamine) :30p en', 'pyrimethamine', 'sulfadoxine'],
    ['À 4540 Cartécunote + Amodiaquine)', 'amodiaquine', 'artesunate'],
    ['RQ canésunsie + Amodisquin®} 2) pendai', 'amodiaquine', 'artesunate'],
  ])(
    'warns when a garbled word of %s resembles the substance a combination would add',
    (line, read, missing) => {
      const { products, typed } = readPrescription(pack, [line]);
      expect(products.map((p) => substancesOf(p.ref.id))).toEqual([read]);
      expect(products[0]?.missingSubstances).toEqual([missing]);
      expect(typed.map((t) => t.reason)).toEqual(['names-more']);
    },
  );

  it('never warns for the words of the name read, its forms, or a posology', () => {
    for (const line of [
      '1. Doliprane 1000 mg cp effervescent : 1 cp x 3/j',
      '2. Efferalgan 1 g cp eff',
      '3. Acide folique 5 mg comprimé sécable',
      '4. Fer (générique) cp',
      'Ponstan 500 mg 1 cp x 3/j pendant les règles',
    ]) {
      const product = only([line]);
      expect(product.missingSubstances, line).toEqual([]);
    }
  });

  it('says every other substance a line names, when two products were read as one line', () => {
    const { products, typed } = readPrescription(pack, [
      '7. Paracétamol 500 mg cp Amoxicilline 500 mg',
    ]);
    expect(products.map((p) => substancesOf(p.ref.id))).toEqual(['paracetamol']);
    expect(products[0]?.missingSubstances).toEqual(['amoxicillin']);
    expect(typed.map((t) => t.reason)).toEqual(['names-more']);
  });

  it('never warns when the product holds every substance the line names', () => {
    for (const line of [
      '1. SP (Sulfadoxine Pyriméthamine)',
      '2. Fer acide folique (FAF)',
      '3. Paracétamol 500 mg cp',
      '4. Amoxicilline 500 mg gél',
    ]) {
      const product = only([line]);
      expect(product.missingSubstances, line).toEqual([]);
    }
  });
});

describe('readPrescription: a combination named in part by a short word (must warn)', () => {
  /**
   * The line names a combination, one part of it by an abbreviation or the
   * start of its name: the product read holds the other part only, so it
   * says which substance the line also names, is never pre-ticked, and the
   * line is offered as typed too.
   */
  function expectWarned(line: string, other: string): void {
    const { products, typed } = readPrescription(pack, [line]);
    expect(products, line).toHaveLength(1);
    const [product] = products as [PrescriptionProduct];
    expect(product.missingSubstances, `${line}: ${substancesOf(product.ref.id)}`).toContain(other);
    expect(mayBePreTicked(product), line).toBe(false);
    expect(typed, line).toContainEqual(
      expect.objectContaining({ reason: 'names-more', forProduct: 0, lineIndex: 0 }),
    );
  }

  it.each([
    ['Dafalgan codé', 'codeine'],
    ['Efferalgan cod.', 'codeine'],
    ['Efferalgan codé 500 mg', 'codeine'],
    ['Paracétamol + Cod', 'codeine'],
    ['Ibuprofène + codé', 'codeine'],
    ['Paracétamol + Tram', 'tramadol'],
    ['Amodiaquine + AS', 'artesunate'],
    ['Amodiaquine 153 mg + Art.', 'artesunate'],
    ['Triméthoprime + Sulfa', 'sulfamethoxazole'],
    ['Fer + AF', 'folic-acid'],
    ['Fer + B9', 'folic-acid'],
  ])('%s says it also names %s', (line, other) => {
    expectWarned(line, other);
  });

  it('names folic acid for "vitamine B9", never vitamin C for the word "vitamine"', () => {
    const { products } = readPrescription(pack, ['Fer + vitamine B9']);
    expect(products.flatMap((p) => p.missingSubstances)).not.toContain('ascorbic-acid');
    expectWarned('Fer + vitamine B9', 'folic-acid');
  });

  it('says the line names more after a "+", a "/" or "et", even what the base does not know', () => {
    for (const line of [
      'Amoxicilline + acide clavulanique',
      'Amoxicilline / Acide clavulanique 1 g',
      'Paracétamol et caféine 500 mg',
    ]) {
      const { products, typed } = readPrescription(pack, [line]);
      expect(products, line).toHaveLength(1);
      const [product] = products as [PrescriptionProduct];
      expect(product.namesMore, line).toBe(true);
      expect(mayBePreTicked(product), line).toBe(false);
      expect(typed, line).toContainEqual(
        expect.objectContaining({ reason: 'names-more', forProduct: 0 }),
      );
    }
  });

  it('never says a line names more when the product explains every part of it', () => {
    for (const line of [
      '1. Fer + Acide folique cp : 1 cp/jour pendant 3 mois',
      '2. ASAQ (Artésunate + Amodiaquine)',
      '3. Coartem 20/120 mg',
      '4. Paracétamol 500 mg cp',
      '5. Fer et acide folique cp',
      '6. Efferalgan pédiatrique 30 mg/ml',
    ]) {
      const product = only([line]);
      expect(product.namesMore, line).toBe(false);
      expect(product.missingSubstances, line).toEqual([]);
    }
  });

  it('never snaps a misread combination brand to its single-substance sibling', () => {
    for (const line of ['Coliprane 500 mg', 'Efferalgan cod€ine']) {
      const { products, typed } = readPrescription(pack, [line]);
      for (const [forProduct, product] of products.entries()) {
        if (substancesOf(product.ref.id) === 'codeine+paracetamol') continue;
        expect(product.missingSubstances, line).toContain('codeine');
        expect(mayBePreTicked(product), line).toBe(false);
        expect(typed, line).toContainEqual(
          expect.objectContaining({ reason: 'names-more', forProduct }),
        );
      }
      expect(products.length + typed.length, line).toBeGreaterThan(0);
    }
  });
});

describe('readPrescription: a product that holds what the line does not name', () => {
  it('prefers the product of exactly the substances named: "Codéine 30 mg" is codeine alone', () => {
    for (const line of ['Codéine 30 mg', 'Codéine phosphate 30 mg']) {
      const product = only([line]);
      expect(substancesOf(product.ref.id), line).toBe('codeine');
      expect(product.extraSubstances, line).toEqual([]);
    }
  });

  it('says which substances the product adds, and is never pre-ticked: "Ténofovir Lamivudine"', () => {
    const { products, typed } = readPrescription(pack, ['Ténofovir Lamivudine']);
    expect(products).toHaveLength(1);
    const [product] = products as [PrescriptionProduct];
    expect(substancesOf(product.ref.id)).toBe('dolutegravir+lamivudine+tenofovir');
    expect(product.extraSubstances).toEqual(['dolutegravir']);
    expect(mayBePreTicked(product)).toBe(false);
    expect(typed).toContainEqual(expect.objectContaining({ reason: 'holds-more', forProduct: 0 }));
  });

  it('reads "Ténofovir + Lamivudine + Efav" as the efavirenz combination, to check', () => {
    const product = only(['Ténofovir + Lamivudine + Efav']);
    expect(substancesOf(product.ref.id)).toBe('efavirenz+lamivudine+tenofovir');
    expect(product.missingSubstances).toEqual([]);
    expect(product.extraSubstances).toEqual([]);
    expect(mayBePreTicked(product)).toBe(false);
  });

  it('never computes extra substances for a brand: the brand says what the box holds', () => {
    for (const [line, substances] of [
      ['1. Efferalgan codéine', 'codeine+paracetamol'],
      ['2. Doliprane codéine', 'codeine+paracetamol'],
      ['3. Codoliprane cp', 'codeine+paracetamol'],
      // The brand written without its accents, then a substance it holds.
      ['4. Antarene codeine 200', 'codeine+ibuprofen'],
    ] as const) {
      const product = only([line]);
      expect(substancesOf(product.ref.id), line).toBe(substances);
      expect(product.extraSubstances, line).toEqual([]);
      expect(product.missingSubstances, line).toEqual([]);
    }
  });

  // Review of PR 70, round 2: a garbled brand word left on the line was
  // ignored, and the generic of the substance named took the place of the
  // brand, dropping the brand's other substance silently.
  it.each([
    ['1. Antar codéine 400 mg', 'codeine+ibuprofen', 'ibuprofen'],
    ['1. Anta codéine 400', 'codeine+ibuprofen', 'ibuprofen'],
    ['1. Klipai codéine 300', 'codeine+paracetamol', 'paracetamol'],
    ['1. Ixpim tramadol 37,5', 'paracetamol+tramadol', 'paracetamol'],
  ])(
    'keeps the brand a garbled word of %s resembles, which holds more: never pre-ticked',
    (line, substances, extra) => {
      const { products, typed } = readPrescription(pack, [line]);
      expect(products, line).toHaveLength(1);
      const [product] = products as [PrescriptionProduct];
      expect(substancesOf(product.ref.id)).toBe(substances);
      expect(product.extraSubstances).toContain(extra);
      expect(mayBePreTicked(product)).toBe(false);
      expect(typed).toContainEqual(expect.objectContaining({ forProduct: 0 }));
    },
  );

  it('takes the generic of the substances named only when every word of the line is explained', () => {
    // "phosphate" is a salt, "30 mg" a strength, "cp" a form: codeine alone.
    expect(substancesOf(only(['Codéine phosphate 30 mg cp']).ref.id)).toBe('codeine');
    // A word left that resembles nothing keeps the product found, with what it holds more.
    const product = only(['1. Zzqx codéine 400 mg']);
    expect(mayBePreTicked(product)).toBe(substancesOf(product.ref.id) === 'codeine');
    if (substancesOf(product.ref.id) !== 'codeine') {
      expect(product.extraSubstances.length).toBeGreaterThan(0);
    }
  });
});

describe('readPrescription: strengths, posology and units per day', () => {
  it('proposes the strength the line gives, never a strength in micrograms', () => {
    expect(only(['1. Doliprane 1000 mg cp']).strengthMg).toBe(1000);
    expect(only(['1. Efferalgan 1 g cp eff']).strengthMg).toBe(1000);
    expect(only(['1. Brufen 400']).strengthMg).toBe(400);
    expect(only(['1. Cytotec 200 µg']).strengthMg).toBeUndefined();
    expect(only(['1. Cytotec 200 ug']).strengthMg).toBeUndefined();
    expect(only(['1. Fansidar cp']).strengthMg).toBeUndefined();
  });

  it('offers units per day only for a product a daily-maximum rule watches', () => {
    const paracetamol = only(['1. Doliprane 1000 mg cp : 1 cp x 3/jour si douleur']);
    expect(paracetamol.unitsPerDayOffer).toBe(3);
    expect(paracetamol.posology).toBe('1 cp x 3/jour si douleur');
    // Metronidazole has no daily-maximum rule: no count is offered, whatever the posology says.
    const metronidazole = only(['2. Flagyl 500 mg cp', '1 cp x 2/j pendant 7 jours']);
    expect(metronidazole.posology).toBe('1 cp x 2/j pendant 7 jours');
    expect(metronidazole.unitsPerDayOffer).toBeUndefined();
  });

  it('reads the posology on the line after the name, or inside a table row', () => {
    expect(only(['1. Paracétamol 500 mg cp', '2 cp matin et soir']).unitsPerDayOffer).toBe(4);
    const row = only(['Doliprane 500 mg 2 cp x 3/j pendant 5 jours']);
    expect(row.posology).toBe('2 cp x 3/j pendant 5 jours');
    expect(row.unitsPerDayOffer).toBe(6);
  });

  it.each([
    ['Doliprane 1 cp x 3/j', undefined],
    ['Paracétamol 2 cp x 3/j', undefined],
    ['Amoxicilline 2 gél x 2/j', undefined],
    ['Paracétamol 3 x 1 g', undefined],
    ['Doliprane 1000 mg x 3/j', 1000],
    ['Doliprane 500 mg 2 cpx3/j pendant 5 jours', 500],
    ['Doliprane 1 000 mg', 1000],
    ['Acide folique 400 microg', undefined],
    ['Acide folique 400 µ g', undefined],
    ['Cytotec 200 yg', undefined],
    ['Cytotec 200 mcg', undefined],
    ['Cytotec 200 microgrammes', undefined],
    ['Cytotec 200 μg', undefined],
    // A number glued to a stray letter is a misread: "z50 mg" was 250 mg.
    ['Métronidazole z50 mg', undefined],
  ])('reads the strength of "%s" as %s mg: never a count, micrograms or a misread', (line, mg) => {
    expect(only([line]).strengthMg).toBe(mg);
  });

  // As Tesseract and PaddleOCR read the development set: a strength the OCR
  // garbled gives none (she is asked), never a guessed one.
  it.each([
    ['| 1. Dépakine 500 mg : 1 cp x 2/j', 500],
    ['4 4. Flagyl 500 mg cp', 500],
    ['| 2, Flagyl 500 mg cp', 500],
    ['3. Clamoxyl 1 9 : 1 cp matin et soir x 7 jours', undefined],
    ['Efferalgan 1 9 Cp eff', undefined],
    ['2. Laroscorbine 11g', undefined],
    ['5. Amoxilline 500g g: 2glx 3j penant7 jot', undefined],
    ['L Voltarène 0 my Lcpx 2 pendans S jours', undefined],
    ['3. corrimoxazole 96° m£', undefined],
    ['6. Fuconozole /50 M gé] cour DEL', undefined],
    ['Doliprane 2,4 %', undefined],
    // A number without its unit is a strength only when a box of the family
    // has it (or the family gives none): "19 CP" was "1 g".
    ['1. Efferaigan 19 CP eff', undefined],
    ['1. Doliprane 1000 cp', 1000],
    ['1. Aspégic 500', 500],
    ['1. Brufen 400', 400],
  ])('reads "%s" with the strength %s, or none when the OCR garbled it', (line, mg) => {
    expect(only([line]).strengthMg).toBe(mg);
  });

  it('keeps the posology of a table row out of the name: the query and the strength question', () => {
    const product = only(['Doliprane 1 cp x 3/j']);
    expect(product.query).toBe('Doliprane');
    expect(product.posology).toBe('1 cp x 3/j');
    expect(product.unitsPerDayOffer).toBe(3);
  });

  it('gives the strength question the strength proposed, never the posology or micrograms', () => {
    for (const line of [
      '1. Doliprane 1000 mg cp',
      '2. Doliprane 1 cp x 3/j',
      '3. Doliprane 1 000 mg',
      '4. Acide folique 400 microg',
      '5. Cytotec 200 µg',
      '6. Néo-Codion sirop',
    ]) {
      const product = only([line]);
      const choice = strengthChoiceOf(pack, product.candidate, product.strengthQuery);
      expect(parseStrength(product.strengthQuery).strengthMg, line).toBe(product.strengthMg);
      if (product.strengthMg === undefined && !/sirop/.test(line)) {
        expect(choice?.preselected ?? null, line).toBeNull();
      }
    }
    const doliprane = only(['1. Doliprane 1000 mg cp']);
    expect(strengthChoiceOf(pack, doliprane.candidate, doliprane.strengthQuery)?.preselected).toBe(
      'candidate',
    );
    // A form still chooses among the products of a family: "Néo-Codion sirop".
    const syrup = only(['6. Néo-Codion sirop']);
    expect(strengthChoiceOf(pack, syrup.candidate, syrup.strengthQuery)?.preselected).toBe(
      strengthChoiceOf(pack, syrup.candidate, 'Néo-Codion sirop')?.preselected,
    );
  });

  it('never proposes the box of another strength than micrograms read: "Acide folique 400 microg"', () => {
    const product = only(['Acide folique 400 microg']);
    const components = pack.products.find((p) => p.id === product.ref.id)?.components ?? [];
    expect(components.map((c) => c.strengthMg)).not.toContain(5);
  });

  it('still asks how many per day when the posology gives no plain count', () => {
    const product = only(['1. Doliprane 1000 mg cp', '2 cp x 2 à 3/j']);
    expect(product.posology).toBe('2 cp x 2 à 3/j');
    expect(product.unitsPerDayOffer).toBeUndefined();
    expect(product.asksUnitsPerDay).toBe(true);
    expect(needsUnitsPerDay(pack, product.ref)).toBe(true);
    // Metronidazole has no daily-maximum rule: no question.
    expect(only(['2. Flagyl 500 mg cp', '1 cp x 2/j']).asksUnitsPerDay).toBe(false);
  });

  it('gives no dose and no units for an unclear posology', () => {
    expect(only(['1. Doliprane 1000 mg cp', 'si douleur']).unitsPerDayOffer).toBeUndefined();
    expect(only(['1. Doliprane 1000 mg cp']).unitsPerDayOffer).toBeUndefined();
  });
});

describe('unitsPerDayOf', () => {
  it.each([
    ['2 cp x 3/j pendant 5 jours', 6],
    ['1 cp x 3/jour si douleur', 3],
    ['1 cp matin, midi et soir', 3],
    ['2 cp matin et soir', 4],
    ['1 cp le matin QSP 3 mois', 1],
    ['1 cp/jour pendant 3 mois', 1],
    ["1 cp par jour jusqu'à l'accouchement", 1],
    ['4 cp x 2/j pendant 3 jours', 8],
    ['1 c. à soupe x 3/j', 3],
    ['3 cp en une prise, TPI 2', 3],
    ['1 gél en prise unique', 1],
    ['1 sachet x 3/j', 3],
    ['1 sachet le midi', 1],
  ])('reads a plain count: %s is %d', (text, units) => {
    expect(unitsPerDayOf(text)).toBe(units);
  });

  it.each(['2 cp par semaine', '1 cp tous les 3 jours', 'si douleur', 'QSP 3 mois', ''])(
    'gives nothing for a weekly or unclear posology: %s',
    (text) => {
      expect(unitsPerDayOf(text)).toBeUndefined();
    },
  );

  it.each([
    '2 cp x 2 à 3/j',
    '1 à 2 cp x 3/j',
    '1-2 cp x 3/j',
    '1 ou 2 cp x 3/j',
    '1 cp matin et 2 cp le soir',
    '1 cp matin et soir, 2 cp le midi',
    '1 cp/j pendant 3 j puis 2 cp/j',
    '1 cp x 2/j puis 2 cp x 3/j',
    '1/2 cp x 2/j',
    '½ cp x 2/j',
    '0,5 cp x 2/j',
    'un demi cp x 2/j',
    '1 cp x 3/j, max 4 cp/j',
    '1 cp x 3/j maximum',
    // As the OCR garbled the times of day: never fewer than said.
    '1 cp matin, 72304 pendant 3 ju',
    '1 cp mat in, midi et soir pendant 3 jours',
  ])('gives nothing for a range, a change, a fraction, several counts or a maximum: %s', (text) => {
    expect(unitsPerDayOf(text)).toBeUndefined();
  });

  it.each([
    ['2 cp * 3 / j', 6],
    // The multiplication sign, written as an escape so the file stays ASCII.
    ['2 cp \u00d7 3/j', 6],
    ['2 cp matin et 2 cp le soir', 4],
    ['1 cp le matin et 1 cp le soir', 2],
  ])('reads a plain count written another way: %s is %d', (text, units) => {
    expect(unitsPerDayOf(text)).toBe(units);
  });
});

describe('readPrescription: short names of combinations', () => {
  it.each([
    ['1. SP', 'pyrimethamine+sulfadoxine'],
    ['TPI : SP', 'pyrimethamine+sulfadoxine'],
    ['S.P', 'pyrimethamine+sulfadoxine'],
    ['SP 3 cp en une prise', 'pyrimethamine+sulfadoxine'],
    ['FAF', 'folic-acid+iron'],
    ['2. FAF 1 cp/j', 'folic-acid+iron'],
    ['3. AL 20/120', 'artemether+lumefantrine'],
    ['4. CTX 960 mg', 'sulfamethoxazole+trimethoprim'],
  ])('reads the short name in %s as its combination, never pre-ticked', (line, substances) => {
    const product = only([line]);
    expect(substancesOf(product.ref.id)).toBe(substances);
    expect(product.match).toBe('strong');
    expect(mayBePreTicked(product)).toBe(false);
  });

  it.each([
    ['TDF/3TC/DTG', 'dolutegravir+lamivudine+tenofovir'],
    ['TDF/3TC/EFV', 'efavirenz+lamivudine+tenofovir'],
    ['AS/AQ', 'amodiaquine+artesunate'],
    ['SMX + TMP 800/160', 'sulfamethoxazole+trimethoprim'],
  ])(
    'reads a line of short names only, %s, as the combination of exactly them, never pre-ticked',
    (line, substances) => {
      const product = only([line]);
      expect(substancesOf(product.ref.id)).toBe(substances);
      expect(mayBePreTicked(product)).toBe(false);
    },
  );

  it('reads a short name only in capitals, as a whole word, on a line that says nothing else', () => {
    for (const line of [
      'sp',
      'Al Hassane Ndiaye',
      'AL HASSANE NDIAYE',
      'Cabinet Al Amine',
      'SPASFON',
      // As Tesseract read the handwriting proxy: garbled, never a short name.
      '§ AL. § ;: 3 en',
    ]) {
      const { products } = readPrescription(pack, [line]);
      expect(
        products.filter((p) => p.match === 'strong').map((p) => p.ref.id),
        line,
      ).toEqual([]);
    }
  });

  it('reads the product after a label and a colon: "Si douleur : Doliprane 1 g"', () => {
    expect(only(['Si douleur : Doliprane 1 g']).strengthMg).toBe(1000);
  });

  it('keeps a numbered line of two letters or more as typed', () => {
    for (const [line, text] of [
      ['5. NS', 'NS'],
      ['6. Kz 2', 'Kz 2'],
    ] as const) {
      expect(readPrescription(pack, [line]).typed, line).toEqual([
        { text, line, lineIndex: 0, reason: 'not-recognised' },
      ]);
    }
  });
});

describe('readPrescription: lines kept to add as typed', () => {
  it.each([
    ['3. Spasfon Lyoc 80 mg : 1 lyoc x 3/j si douleur', 'Spasfon Lyoc 80 mg'],
    ['4. Mébendazole 500 mg', 'Mébendazole 500 mg'],
    ['5. Magné B6 cp', 'Magné B6 cp'],
    ['Gaviscon suspension', 'Gaviscon suspension'],
    ['6. Polygynax ovule', 'Polygynax ovule'],
  ])('keeps a product outside the base as a line to add as typed: %s', (line, text) => {
    const { products, typed } = readPrescription(pack, [line]);
    expect(products).toEqual([]);
    expect(typed).toEqual([{ text, line, lineIndex: 0, reason: 'not-recognised' }]);
  });

  it('keeps the posology of a typed line out of its text', () => {
    const { typed } = readPrescription(pack, ['2. Duphaston 10 mg', '1 cp x 2/j pendant 10 jours']);
    expect(typed.map((t) => t.text)).toEqual(['Duphaston 10 mg']);
  });
});

describe('mayBePreTicked', () => {
  it('is false for a strong match ("À vérifier") and true only for a very strong one with nothing missing', () => {
    const product = only(['1. Doliprane 1000 mg cp']);
    expect(mayBePreTicked(product)).toBe(true);
    expect(mayBePreTicked({ ...product, match: 'strong' })).toBe(false);
    expect(mayBePreTicked({ ...product, missingSubstances: ['codeine'] })).toBe(false);
    expect(mayBePreTicked({ ...product, extraSubstances: ['codeine'] })).toBe(false);
    expect(mayBePreTicked({ ...product, namesMore: true })).toBe(false);
  });
});
