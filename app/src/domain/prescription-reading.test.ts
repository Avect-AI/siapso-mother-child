// SPDX-License-Identifier: MIT
// The reading of a prescription text, rule by rule, each case from a failure
// seen in the SCRUM-57 spike (docs/superpowers/specs/2026-11-05-prescription-scan-design.md,
// section 4.3). Synthetic lines only: no real prescription, no real person.
import type { Pack } from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import {
  mayBePreTicked,
  readPrescription,
  unitsPerDayOf,
  type PrescriptionProduct,
} from './prescription-reading.js';

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
  ])('reads %s whole, or in part with the warning', (line, combination) => {
    expectWholeOrWarned(line, combination);
  });

  it('warns for a line read in part (the checks above are not vacuous)', () => {
    for (const line of ['3. Amodiaquine (Artésun', '4. Fer + Ac. folique cp']) {
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
  });
});
