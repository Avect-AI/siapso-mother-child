// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ADDED_BRANDS,
  ADDED_SUBSTANCES,
  brandOf,
  decodeBdpm,
  importBdpm,
  LOCAL_NAMES,
  MAX_ENTRIES,
  parseCompositions,
  parseSpecialities,
  PRIORITY_BRANDS,
  productIdOf,
  renderProducts,
  selectProducts,
  strengthMgOf,
  validateContent,
} from '../src/index.js';
import type { AuthoredProduct, SelectOptions } from '../src/index.js';
import { copyOf, loadValid } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Synthetic BDPM-format lines (test data, see fixtures/bdpm/README.md). */
const FIXTURE = path.join(HERE, 'fixtures', 'bdpm');

const ALL = new Set([
  'paracetamol',
  'codeine',
  'ibuprofen',
  'diclofenac',
  'iron',
  'isotretinoin',
  'misoprostol',
]);

async function fixture(): Promise<{ cis: string; compo: string }> {
  const read = async (name: string): Promise<string> =>
    decodeBdpm(await readFile(path.join(FIXTURE, name)));
  return { cis: await read('CIS_bdpm.txt'), compo: await read('CIS_COMPO_bdpm.txt') };
}

async function selected(
  options: Partial<Omit<SelectOptions, 'substances'>> & { substances?: Set<string> },
): Promise<AuthoredProduct[]> {
  const { cis, compo } = await fixture();
  return selectProducts(parseSpecialities(cis), parseCompositions(compo), {
    ...options,
    substances: options.substances ?? ALL,
  });
}

function cisOf(product: AuthoredProduct | undefined): string | undefined {
  return product && 'bdpm' in product.source ? product.source.bdpm : undefined;
}

function byCis(products: AuthoredProduct[], code: string): AuthoredProduct | undefined {
  return products.find((p) => cisOf(p) === code);
}

describe('decodeBdpm', () => {
  it('decodes the Windows-1252 files, typographic apostrophe included', () => {
    const bytes = Uint8Array.from([0x63, 0x6f, 0x6d, 0x70, 0x72, 0x69, 0x6d, 0xe9, 0x20, 0x92]);
    expect(decodeBdpm(bytes)).toBe('comprimé ’');
  });
});

describe('parseSpecialities and parseCompositions', () => {
  it('reads the tab-separated columns and ignores the CRLF line ends', async () => {
    const { cis, compo } = await fixture();
    const specs = parseSpecialities(cis);
    expect(specs).toHaveLength(16);
    expect(specs[0]).toStrictEqual({
      cis: '99000001',
      denomination: 'TESTDOL 500 mg, comprimé',
      form: 'comprimé',
      routes: ['orale'],
      marketed: true,
    });
    expect(specs.find((s) => s.cis === '99000005')?.marketed).toBe(false);
    expect(specs.find((s) => s.cis === '99000013')?.routes).toEqual(['orale', 'rectale']);
    const components = parseCompositions(compo);
    expect(components.filter((c) => c.cis === '99000004').map((c) => c.label)).toEqual([
      'PARACÉTAMOL',
      'PHOSPHATE DE CODÉINE HÉMIHYDRATÉ',
    ]);
    expect(components.find((c) => c.cis === '99000009' && c.nature === 'FT')).toMatchObject({
      label: 'FER',
      dosage: '80 mg',
      link: '1',
    });
  });

  it('refuses a file whose lines do not have the expected columns', () => {
    expect(() => parseSpecialities('99000001\tTESTDOL\r\n')).toThrow(/CIS_bdpm\.txt line 1/);
    expect(() => parseCompositions('99000001\tcomprimé\r\n')).toThrow(/CIS_COMPO_bdpm\.txt line 1/);
  });
});

describe('strengthMgOf', () => {
  it('reads mg, g and microgrammes for one unit, with a decimal comma', () => {
    expect(strengthMgOf('500 mg', 'un comprimé')).toBe(500);
    expect(strengthMgOf('1 g', 'un comprimé')).toBe(1000);
    expect(strengthMgOf('256,30 mg', 'un comprimé')).toBe(256.3);
    expect(strengthMgOf('1 000 mg', 'un sachet')).toBe(1000);
    expect(strengthMgOf('200 microgrammes', 'un comprimé')).toBe(0.2);
    expect(strengthMgOf('20 mg', 'une capsule')).toBe(20);
    expect(strengthMgOf('300 mg', 'un suppositoire')).toBe(300);
  });

  it('gives no strength for a percentage, a volume or a weight of cream', () => {
    expect(strengthMgOf('2,4 %', 'un flacon')).toBeUndefined();
    expect(strengthMgOf('2,4 g', '100 ml de suspension')).toBeUndefined();
    expect(strengthMgOf('1 g', '100 g de gel')).toBeUndefined();
    expect(strengthMgOf('400 mg', 'un flacon')).toBeUndefined();
    expect(strengthMgOf('4CH à 30CH', 'un tube')).toBeUndefined();
  });
});

describe('brandOf and productIdOf', () => {
  it('takes the words of the denomination before the strength or the comma', () => {
    expect(brandOf('DOLIPRANE 1000 mg, comprimé')).toBe('DOLIPRANE');
    expect(brandOf('PARACETAMOL BIOGARAN 1 g, comprimé')).toBe('PARACETAMOL BIOGARAN');
    expect(brandOf('TESTDOL ENFANTS 2,4 %, suspension buvable')).toBe('TESTDOL ENFANTS');
    expect(brandOf('TESTHOMEO, granules')).toBe('TESTHOMEO');
  });

  it('makes a kebab-case id from the denomination and the CIS code', () => {
    expect(productIdOf('TESTDOL 500 mg, comprimé', '99000001')).toBe('testdol-500-mg-99000001');
    expect(productIdOf('TEST’MISO 200 microgrammes, comprimé', '99000014')).toBe(
      'test-miso-200-microgrammes-99000014',
    );
    const long = productIdOf(`${'VERYLONGNAME '.repeat(8)}10 mg, comprimé`, '99000099');
    expect(long.length).toBeLessThanOrEqual(49);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*-99000099$/);
  });
});

describe('selectProducts', () => {
  it('keeps marketed oral, cutaneous and rectal products whose substances all map', async () => {
    const products = await selected({});
    expect(products.map((p) => p.source)).toEqual(
      [
        // Sorted by first substance id (codeine before paracetamol), then denomination.
        '99000004',
        '99000007',
        '99000015',
        '99000009',
        '99000011',
        '99000014',
        '99000002',
        '99000001',
        '99000003',
        '99000013',
      ].map((bdpm) => ({ bdpm })),
    );
  });

  it('leaves out what is not marketed, injectable, unmapped or homeopathic', async () => {
    const products = await selected({});
    for (const code of ['99000005', '99000006', '99000008', '99000010']) {
      expect(byCis(products, code), code).toBeUndefined();
    }
  });

  it('keeps isotretinoin by mouth only', async () => {
    const products = await selected({});
    expect(byCis(products, '99000011')?.route).toBe('oral');
    expect(byCis(products, '99000012')).toBeUndefined();
  });

  it('maps substances and strengths, the therapeutic fraction first', async () => {
    const products = await selected({});
    expect(byCis(products, '99000004')?.components).toEqual([
      { substance: 'paracetamol', 'strength-mg': 500 },
      { substance: 'codeine', 'strength-mg': 30 },
    ]);
    expect(byCis(products, '99000009')?.components).toEqual([
      { substance: 'iron', 'strength-mg': 80 },
    ]);
    expect(byCis(products, '99000007')?.components).toEqual([{ substance: 'diclofenac' }]);
    expect(byCis(products, '99000014')?.components).toEqual([
      { substance: 'misoprostol', 'strength-mg': 0.2 },
    ]);
  });

  it('writes the product fields: names, brand, form, route, source, not demo', async () => {
    const products = await selected({});
    expect(byCis(products, '99000013')).toStrictEqual({
      id: 'testsuppo-300-mg-99000013',
      names: { fr: 'TESTSUPPO 300 mg, suppositoire', en: 'TESTSUPPO 300 mg, suppositoire' },
      brands: ['TESTSUPPO'],
      'local-names': [],
      components: [{ substance: 'paracetamol', 'strength-mg': 300 }],
      form: 'suppositoire',
      route: 'oral, rectal',
      source: { bdpm: '99000013' },
      demo: false,
    });
    expect(byCis(products, '99000007')?.route).toBe('cutaneous');
  });

  it('keeps only products whose substances are all in the registry', async () => {
    const products = await selected({ substances: new Set(['paracetamol']) });
    expect(products.map((p) => p.id)).toEqual([
      'testdol-1-g-99000002',
      'testdol-500-mg-99000001',
      'testdol-enfants-2-4-99000003',
      'testsuppo-300-mg-99000013',
    ]);
  });

  it('keeps one product per denomination, the one with the lowest CIS code', async () => {
    const products = await selected({});
    expect(byCis(products, '99000013')).toBeDefined();
    expect(byCis(products, '99000016')).toBeUndefined();
  });

  it('keeps at most three products per brand by default, the first ones by denomination', async () => {
    const one = await selected({ maxPerBrand: 1 });
    const testdol = one.filter((p) => p.brands[0] === 'TESTDOL');
    expect(testdol.map((p) => p.source)).toEqual([{ bdpm: '99000002' }]);
    // TESTDOL ENFANTS is another brand.
    expect(byCis(one, '99000003')).toBeDefined();
    expect((await selected({})).filter((p) => p.brands[0] === 'TESTDOL')).toHaveLength(2);
  });

  it('always keeps the products of a priority brand, whatever the caps', async () => {
    // TESTDOL matches "TESTDOL 1 g", "TESTDOL 500 mg" and "TESTDOL ENFANTS", not TESTSUPPO.
    const perSubstance = await selected({ priorityBrands: ['TESTDOL'], maxPerSubstance: 1 });
    expect(perSubstance.map((p) => cisOf(p))).toEqual([
      '99000004',
      '99000007',
      '99000015',
      '99000011',
      '99000014',
      '99000002',
      '99000001',
      '99000003',
    ]);
    const total = await selected({ priorityBrands: ['TESTSUPPO'], maxEntries: 2 });
    expect(total.map((p) => cisOf(p))).toEqual(['99000004', '99000013']);
    // A priority brand is not limited to three products.
    const brand = await selected({ priorityBrands: ['TESTDOL'], maxPerBrand: 1 });
    expect(brand.filter((p) => p.brands[0] === 'TESTDOL')).toHaveLength(2);
  });

  it('matches a priority brand on whole words, accents and case aside', async () => {
    const products = await selected({ priorityBrands: ['TEST'], maxEntries: 1 });
    // "TEST’MISO" starts with TEST but is another word: nothing is a priority.
    expect(products).toHaveLength(1);
    expect(cisOf(products[0])).toBe('99000004');
    const accented = await selected({ priorityBrands: ['testsuppo'], maxEntries: 1 });
    expect(accented.map((p) => cisOf(p))).toEqual(['99000013']);
  });

  it('gives priority by default to the brands most used in Senegal', () => {
    for (const brand of ['DOLIPRANE', 'EFFERALGAN', 'KARDEGIC', 'NEO-CODION', 'TARDYFERON B9']) {
      expect(PRIORITY_BRANDS).toContain(brand);
    }
  });

  it('gives a brand the other names people use for it, as unchecked local names', async () => {
    const products = await selected({
      localNames: { TESTSUPPO: [{ text: 'Suppo test', lang: 'fr' }] },
    });
    expect(byCis(products, '99000013')?.['local-names']).toEqual([
      { text: 'Suppo test', lang: 'fr', checked: false },
    ]);
    expect(byCis(products, '99000001')?.['local-names']).toEqual([]);
  });

  it('names Codoliprane by default as people say it: "Doliprane codéine"', () => {
    expect(LOCAL_NAMES['CODOLIPRANE']).toContainEqual({ text: 'Doliprane codéine', lang: 'fr' });
  });

  it('caps the entries per substance, keeping the first ones by denomination', async () => {
    const perSubstance = await selected({ maxPerSubstance: 2 });
    const paracetamol = perSubstance.filter((p) =>
      p.components.every((c) => c.substance === 'paracetamol'),
    );
    expect(paracetamol.map((p) => p.source)).toEqual([{ bdpm: '99000002' }, { bdpm: '99000001' }]);
  });

  it('caps the total rank by rank, so that every substance keeps its first products', async () => {
    // Rank 1 of every substance comes before rank 2 of any: the second iron
    // product (99000009) gives way to the first paracetamol one (99000002).
    const total = await selected({ maxEntries: 6 });
    expect(total.map((p) => p.source)).toEqual(
      ['99000004', '99000007', '99000015', '99000011', '99000014', '99000002'].map((bdpm) => ({
        bdpm,
      })),
    );
    const seven = await selected({ maxEntries: 7 });
    expect(seven.map((p) => p.source)).toContainEqual({ bdpm: '99000009' });
    expect(seven).toHaveLength(7);
  });

  it('keeps every product of an added brand outside the caps, and changes nothing else', async () => {
    const without = await selected({ maxEntries: 6 });
    expect(byCis(without, '99000013')).toBeUndefined();
    const added = await selected({ maxEntries: 6, addedBrands: ['TESTSUPPO'] });
    // In the sorted order of the import (TESTSUPPO after TESTDOL), one per denomination.
    expect(added.map((p) => cisOf(p))).toEqual([...without.map((p) => cisOf(p)), '99000013']);
  });

  it('brings in a substance only through its added brands', async () => {
    const none = await selected({ addedSubstances: ['iron'] });
    expect(none.some((p) => p.components.some((c) => c.substance === 'iron'))).toBe(false);
    const brand = await selected({
      addedSubstances: ['iron'],
      addedBrands: ['TESTFER'],
      maxEntries: 1,
    });
    expect(brand.filter((p) => p.brands[0] === 'TESTFER').map((p) => cisOf(p))).toEqual([
      '99000015',
      '99000009',
    ]);
  });

  it('adds by default the brands looked for in the live test round 2', () => {
    for (const brand of ['TRIFLUCAN', 'ASPRO', 'GRANUDOXY', 'TOPLEXIL']) {
      expect(ADDED_BRANDS).toContain(brand);
      expect(PRIORITY_BRANDS).not.toContain(brand);
    }
    expect(ADDED_SUBSTANCES).toEqual(['oxomemazine']);
  });

  it('gives the same result whatever the order of the lines', async () => {
    const { cis, compo } = await fixture();
    const specs = parseSpecialities(cis);
    const components = parseCompositions(compo);
    const forward = selectProducts(specs, components, { substances: ALL });
    const backward = selectProducts([...specs].reverse(), [...components].reverse(), {
      substances: ALL,
    });
    expect(backward).toStrictEqual(forward);
  });
});

describe('renderProducts', () => {
  it('writes a licensed, generated YAML list that the knowledge check accepts', async () => {
    const products = await selected({ substances: new Set(['paracetamol', 'ibuprofen']) });
    const text = renderProducts(products);
    expect(text.split('\n', 1)[0]).toBe('# SPDX-License-Identifier: CC-BY-4.0');
    expect(text).toMatch(/Generated by "pnpm knowledge:import-bdpm"/);
    expect(parse(text)).toStrictEqual(products);
    const raw = copyOf(await loadValid());
    raw.products.push({ file: 'registry/products/bdpm.yaml', data: parse(text), text });
    expect(validateContent(raw)).toEqual([]);
  });

  it('writes a file that already follows the repository Prettier style', async () => {
    const products = await selected({});
    const apostrophe = products[0];
    if (!apostrophe) throw new Error('No product');
    const text = renderProducts([
      ...products,
      { ...apostrophe, id: 'apostrophe-1', names: { fr: "L'A 1 mg", en: 'Say "a" and \'b\'' } },
    ]);
    const file = path.join(HERE, '..', '..', '..', 'registry', 'products', 'bdpm.yaml');
    const options = (await resolveConfig(file)) ?? {};
    expect(await check(text, { ...options, filepath: file })).toBe(true);
  });

  it('writes the local names of a product', async () => {
    const products = await selected({
      substances: new Set(['paracetamol']),
      localNames: { TESTSUPPO: [{ text: "Suppo d'essai", lang: 'fr' }] },
    });
    const text = renderProducts(products);
    expect(parse(text)).toStrictEqual(products);
    expect(text).toContain(
      `  local-names:\n    - { text: "Suppo d'essai", lang: fr, checked: false }`,
    );
    const raw = copyOf(await loadValid());
    raw.products.push({ file: 'registry/products/bdpm.yaml', data: parse(text), text });
    expect(validateContent(raw)).toEqual([]);
  });

  it('quotes text that YAML would read otherwise', () => {
    const text = renderProducts([
      {
        id: 'x-1',
        names: { fr: "L'AB: 1 #2", en: 'Say "a" \\ \'b\'' },
        brands: ['YES'],
        'local-names': [],
        components: [{ substance: 'paracetamol' }],
        form: 'comprimé',
        route: 'oral',
        source: { bdpm: '00012' },
        demo: false,
      },
    ]);
    expect(parse(text)).toStrictEqual([
      expect.objectContaining({
        names: { fr: "L'AB: 1 #2", en: 'Say "a" \\ \'b\'' },
        brands: ['YES'],
        source: { bdpm: '00012' },
      }),
    ]);
  });
});

describe('importBdpm', () => {
  it('reads the two files of a folder and returns the products with a count per substance', async () => {
    const result = await importBdpm(FIXTURE, ALL);
    expect(result.products).toHaveLength(10);
    expect(result.perSubstance).toEqual({
      codeine: 1,
      diclofenac: 1,
      iron: 2,
      isotretinoin: 1,
      misoprostol: 1,
      paracetamol: 5,
    });
  });

  it('identifies each input file by its size and sha256', async () => {
    const result = await importBdpm(FIXTURE, ALL);
    expect(result.inputs.map((input) => input.file)).toEqual([
      'CIS_bdpm.txt',
      'CIS_COMPO_bdpm.txt',
    ]);
    for (const input of result.inputs) {
      const bytes = await readFile(path.join(FIXTURE, input.file));
      expect(input.bytes).toBe(bytes.length);
      expect(input.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(input.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('names the missing file', async () => {
    await expect(importBdpm(path.join(FIXTURE, 'missing'), ALL)).rejects.toThrow(/CIS_bdpm\.txt/);
  });
});

describe('registry/products/bdpm.yaml (the committed import)', () => {
  /** Priority brands that the BDPM files of 2026-11-04 do not list as marketed. */
  const NOT_MARKETED = ['NEO-CODION', 'VIBRAMYCINE'];

  it('keeps every marketed priority brand, Doliprane 500 mg and 1000 mg tablets included', async () => {
    const file = path.join(HERE, '..', '..', '..', 'registry', 'products', 'bdpm.yaml');
    const products = parse(await readFile(file, 'utf8')) as AuthoredProduct[];
    const names = products.map((p) => p.names.fr);
    expect(names).toContain('DOLIPRANE 1000 mg, comprimé');
    expect(names).toContain('DOLIPRANE 500 mg, comprimé');
    const plain = (text: string): string =>
      text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
    const ofBrand = (name: string, brand: string) => {
      const upper = plain(name);
      return upper.startsWith(brand) && /^($|[ ,])/.test(upper.slice(brand.length));
    };
    for (const brand of [...PRIORITY_BRANDS, ...ADDED_BRANDS].filter(
      (b) => !NOT_MARKETED.includes(b),
    )) {
      expect(
        names.some((name) => ofBrand(name, brand)),
        brand,
      ).toBe(true);
    }
    // The added brands are kept outside the cap.
    const capped = names.filter((name) => !ADDED_BRANDS.some((brand) => ofBrand(name, brand)));
    expect(capped.length).toBeLessThanOrEqual(MAX_ENTRIES);
  });

  it('holds what the live test round of 2026-11-05 looked for', async () => {
    const file = path.join(HERE, '..', '..', '..', 'registry', 'products', 'bdpm.yaml');
    const products = parse(await readFile(file, 'utf8')) as AuthoredProduct[];
    const holding = (substance: string) =>
      products.filter((p) => p.components.some((c) => c.substance === substance));
    expect(holding('fluconazole').length).toBeGreaterThan(0);
    expect(holding('methotrexate').length).toBeGreaterThan(0);
    for (const codoliprane of products.filter((p) => p.brands[0]?.startsWith('CODOLIPRANE'))) {
      expect(codoliprane['local-names']).toContainEqual({
        text: 'Doliprane codéine',
        lang: 'fr',
        checked: false,
      });
    }
  });
});
