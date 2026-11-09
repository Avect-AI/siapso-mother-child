// SPDX-License-Identifier: MIT
// Import of medicines from the official BDPM download files (Base de données
// publique des médicaments, ANSM, Licence Ouverte 2.0):
//
// - CIS_bdpm.txt: one line per medicine (CIS code), tab-separated columns:
//   CIS, denomination, form, routes (";"), authorisation status, procedure,
//   marketing state, authorisation date, BdM status, EU number, holder,
//   reinforced monitoring;
// - CIS_COMPO_bdpm.txt: one line per active component, tab-separated columns:
//   CIS, element, substance code, substance label, dosage, dosage reference,
//   nature ("SA" active substance, "FT" therapeutic fraction), link number
//   (joins a substance and its therapeutic fraction).
//
// Both files are encoded in Windows-1252 with CRLF line ends. The import
// keeps marketed medicines taken by mouth, on the skin or rectally whose
// active substances all map to registry substances, and writes them to
// registry/products/bdpm.yaml. The selection is deterministic: sorted by
// substance then denomination, one product per denomination; the brands most
// used in Senegal (PRIORITY_BRANDS) are always kept, and the other products
// fill the rest, at most 3 per brand, 15 per substance and MAX_ENTRIES in
// total (taken rank by rank across substances, see selectProducts). The
// brands added once the selection was settled (ADDED_BRANDS) are kept in
// addition, outside the caps. The other names people use for a brand
// (LOCAL_NAMES) become local names of its products.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LICENCE_LINE } from './load.js';
import type { AuthoredProduct } from './types.js';

/** The two official files read by the import. */
export const BDPM_FILES = { specialities: 'CIS_bdpm.txt', compositions: 'CIS_COMPO_bdpm.txt' };

/** One line of CIS_bdpm.txt. */
export interface BdpmSpeciality {
  cis: string;
  denomination: string;
  form: string;
  routes: string[];
  /** "Commercialisée" in the marketing state column. */
  marketed: boolean;
}

/** One line of CIS_COMPO_bdpm.txt. */
export interface BdpmComponent {
  cis: string;
  element: string;
  label: string;
  dosage: string;
  reference: string;
  nature: 'SA' | 'FT';
  link: string;
}

/** Decodes a BDPM file: the official files are encoded in Windows-1252. */
export function decodeBdpm(bytes: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(bytes);
}

/** Uppercase, without accents, with straight apostrophes and single spaces: the key of the label table. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/’/g, "'")
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function rows(text: string, file: string, columns: number): string[][] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== '')
    .map(({ line, number }) => {
      const cells = line.split('\t').map((cell) => cell.replace(/\s+/g, ' ').trim());
      if (cells.length < columns) {
        throw new Error(
          `${file} line ${String(number)}: expected ${String(columns)} columns, found ${String(cells.length)}`,
        );
      }
      return cells;
    });
}

/** Parses CIS_bdpm.txt (already decoded). */
export function parseSpecialities(text: string): BdpmSpeciality[] {
  return rows(text, BDPM_FILES.specialities, 12).map((cells) => ({
    cis: cells[0] ?? '',
    denomination: cells[1] ?? '',
    form: cells[2] ?? '',
    routes: (cells[3] ?? '')
      .split(';')
      .map((route) => route.trim())
      .filter((route) => route !== ''),
    marketed: normalise(cells[6] ?? '') === 'COMMERCIALISEE',
  }));
}

/** Parses CIS_COMPO_bdpm.txt (already decoded). */
export function parseCompositions(text: string): BdpmComponent[] {
  return rows(text, BDPM_FILES.compositions, 8).map((cells) => ({
    cis: cells[0] ?? '',
    element: cells[1] ?? '',
    label: cells[3] ?? '',
    dosage: cells[4] ?? '',
    reference: cells[5] ?? '',
    nature: cells[6] === 'FT' ? 'FT' : 'SA',
    link: cells[7] ?? '',
  }));
}

/**
 * BDPM active substance labels (uppercase, without accents) and the
 * registry substance (INN) each one stands for. A label missing from this
 * table keeps its medicine out of the import. Homeopathic preparations,
 * other salts and other molecules (dexketoprofen, chlortetracycline,
 * oxytetracycline, tenofovir alafenamide, ferric iron) are left out on
 * purpose.
 */
export const SUBSTANCE_LABELS: Readonly<Record<string, string>> = {
  'ACETYLSALICYLATE DE DL-LYSINE': 'aspirin',
  'ACETYLSALICYLIQUE (ACIDE)': 'aspirin',
  'ACIDE ACETYLSALICYLIQUE': 'aspirin',
  'DL-LYSINE (ACETYLSALICYLATE DE)': 'aspirin',
  'ACIDE ASCORBIQUE': 'ascorbic-acid',
  'ASCORBIQUE (ACIDE)': 'ascorbic-acid',
  'ASCORBATE DE SODIUM': 'ascorbic-acid',
  'SODIUM (ASCORBATE DE)': 'ascorbic-acid',
  'ACIDE FOLIQUE': 'folic-acid',
  'ACIDE FOLIQUE ANHYDRE': 'folic-acid',
  'ACIDE FOLIQUE HYDRATE': 'folic-acid',
  'ACIDE VALPROIQUE': 'valproic-acid',
  'DIVALPROATE DE SODIUM': 'valproic-acid',
  'SODIUM (VALPROATE DE)': 'valproic-acid',
  'VALPROATE DE SODIUM': 'valproic-acid',
  VALPROMIDE: 'valpromide',
  AMOXICILLINE: 'amoxicillin',
  'AMOXICILLINE TRIHYDRATEE': 'amoxicillin',
  ARTEMETHER: 'artemether',
  LUMEFANTRINE: 'lumefantrine',
  CAPTOPRIL: 'captopril',
  CARBAMAZEPINE: 'carbamazepine',
  'CLOBETASOL (PROPIONATE DE)': 'clobetasol',
  'PROPIONATE DE CLOBETASOL': 'clobetasol',
  CODEINE: 'codeine',
  'CODEINE (PHOSPHATE DE)': 'codeine',
  'CODEINE (PHOSPHATE DE) HEMIHYDRATE': 'codeine',
  'PHOSPHATE DE CODEINE HEMIHYDRATE': 'codeine',
  'DICLOFENAC DE DIETHYLAMINE': 'diclofenac',
  'DICLOFENAC SODIQUE': 'diclofenac',
  'EPOLAMINE DE DICLOFENAC': 'diclofenac',
  'DOLUTEGRAVIR SODIQUE': 'dolutegravir',
  'DOXYCYCLINE (HYCLATE DE)': 'doxycycline',
  'DOXYCYCLINE MONOHYDRATEE': 'doxycycline',
  'HYCLATE DE DOXYCYCLINE': 'doxycycline',
  EFAVIRENZ: 'efavirenz',
  "ENALAPRIL (MALEATE D')": 'enalapril',
  "MALEATE D'ENALAPRIL": 'enalapril',
  'ASCORBATE FERREUX': 'iron',
  'FERREUX (SULFATE) DESSECHE': 'iron',
  'FUMARATE FERREUX': 'iron',
  'GLUCONATE FERREUX': 'iron',
  'GLUCONATE FERREUX DIHYDRATE': 'iron',
  'GLUCONATE FERREUX HYDRATE': 'iron',
  'SUCCINATE FERREUX': 'iron',
  'SULFATE FERREUX': 'iron',
  'SULFATE FERREUX DESSECHE': 'iron',
  'SULFATE FERREUX HEPTAHYDRATE': 'iron',
  IBUPROFENE: 'ibuprofen',
  FLUCONAZOLE: 'fluconazole',
  "IBUPROFENE (LYSINATE D')": 'ibuprofen',
  'IBUPROFENE SODIQUE DIHYDRATE': 'ibuprofen',
  "LYSINATE D'IBUPROFENE": 'ibuprofen',
  "CHLORHYDRATE D'IRBESARTAN": 'irbesartan',
  IRBESARTAN: 'irbesartan',
  "IRBESARTAN (CHLORHYDRATE D')": 'irbesartan',
  ISOTRETINOINE: 'isotretinoin',
  KETOPROFENE: 'ketoprofen',
  LAMIVUDINE: 'lamivudine',
  LISINOPRIL: 'lisinopril',
  'LISINOPRIL DIHYDRATE': 'lisinopril',
  'LOSARTAN POTASSIQUE': 'losartan',
  METHOTREXATE: 'methotrexate',
  METRONIDAZOLE: 'metronidazole',
  'METRONIDAZOLE (BENZOATE DE)': 'metronidazole',
  'CHLORHYDRATE DE MINOCYCLINE': 'minocycline',
  'MINOCYCLINE (CHLORHYDRATE DE)': 'minocycline',
  MISOPROSTOL: 'misoprostol',
  NAPROXENE: 'naproxen',
  OXOMEMAZINE: 'oxomemazine',
  'NAPROXENE SODIQUE': 'naproxen',
  PARACETAMOL: 'paracetamol',
  ETORICOXIB: 'etoricoxib',
  PIROXICAM: 'piroxicam',
  'COMPLEXE PIROXICAM-BETACYCLODEXTRINE': 'piroxicam',
  'PIROXICAM-BETACYCLODEXTRINE (COMPLEXE)': 'piroxicam',
  'PERINDOPRIL ARGININE': 'perindopril',
  'PERINDOPRIL ERBUMINE': 'perindopril',
  'PERINDOPRIL TERT-BUTYLAMINE': 'perindopril',
  'TERT-BUTYLAMINE DE PERINDOPRIL': 'perindopril',
  'TOSILATE DE PERINDOPRIL': 'perindopril',
  'MALEATE DE PHENIRAMINE': 'pheniramine',
  PYRIMETHAMINE: 'pyrimethamine',
  'CHLORHYDRATE DE QUININE': 'quinine',
  'GLUCONATE DE QUININE': 'quinine',
  RAMIPRIL: 'ramipril',
  RIFAMPICINE: 'rifampicin',
  SULFAMETHOXAZOLE: 'sulfamethoxazole',
  'FUMARATE DE TENOFOVIR DISOPROXIL': 'tenofovir',
  'MALEATE DE TENOFOVIR DISOPROXIL': 'tenofovir',
  'PHOSPHATE DE TENOFOVIR DISOPROXIL': 'tenofovir',
  'SUCCINATE DE TENOFOVIR DISOPROXIL': 'tenofovir',
  'TENOFOVIR DISOPROXIL': 'tenofovir',
  'TENOFOVIR DISOPROXIL (FUMARATE DE)': 'tenofovir',
  'CHLORHYDRATE DE TETRACYCLINE': 'tetracycline',
  'CHLORHYDRATE DE TRAMADOL': 'tramadol',
  'TRAMADOL (CHLORHYDRATE DE)': 'tramadol',
  TRIMETHOPRIME: 'trimethoprim',
  VALSARTAN: 'valsartan',
  'WARFARINE SODIQUE': 'warfarin',
  ZIDOVUDINE: 'zidovudine',
};

/** BDPM routes kept by the import, and how products name them. */
const ROUTES: Readonly<Record<string, string>> = {
  ORALE: 'oral',
  CUTANEE: 'cutaneous',
  RECTALE: 'rectal',
};

/**
 * Substances kept by mouth only: the rules about them rest on oral use
 * (isotretinoin capsules; metronidazole, whose skin use is of little concern
 * during breastfeeding).
 */
const ORAL_ONLY: ReadonlySet<string> = new Set(['isotretinoin', 'metronidazole']);

/** A dosage reference that stands for one unit taken. */
const ONE_UNIT = /^(un|une) (comprimé|gélule|capsule|sachet|suppositoire|lyophilisat|pastille)/i;
const DOSAGE = /^(\d[\d ]*(?:,\d+)?) ?(mg|g|microgrammes?|µg)$/i;
const UNIT_MG: Readonly<Record<string, number>> = {
  mg: 1,
  g: 1000,
  microgramme: 0.001,
  microgrammes: 0.001,
  µg: 0.001,
};

/**
 * The strength in mg of one unit (tablet, capsule, sachet, suppository), or
 * undefined when the dosage is a percentage or refers to a volume or a weight
 * of cream: the engine then treats the strength as unknown.
 */
export function strengthMgOf(dosage: string, reference: string): number | undefined {
  if (!ONE_UNIT.test(reference.trim())) return undefined;
  const match = DOSAGE.exec(dosage.trim());
  const amount = match?.[1];
  const unit = match?.[2]?.toLowerCase();
  if (amount === undefined || unit === undefined) return undefined;
  const value = Number(amount.replace(/ /g, '').replace(',', '.'));
  const factor = UNIT_MG[unit] ?? 0;
  // Rounded to remove binary noise: 200 microgrammes is 0.2 mg, not 0.20000000000000001.
  return Math.round(value * factor * 1e6) / 1e6;
}

/** The part of a denomination before its pharmaceutical form (", comprimé"). */
function nameOf(denomination: string): string {
  const comma = denomination.indexOf(', ');
  return (comma === -1 ? denomination : denomination.slice(0, comma)).trim();
}

/** The brand: the words of the denomination before the first one that starts with a digit. */
export function brandOf(denomination: string): string {
  const words = nameOf(denomination).split(' ');
  const firstDigit = words.findIndex((word, index) => index > 0 && /^\d/.test(word));
  return (firstDigit === -1 ? words : words.slice(0, firstDigit)).join(' ');
}

const MAX_SLUG = 40;

/** A kebab-case product id: the denomination before its form, then the CIS code. */
export function productIdOf(denomination: string, cis: string): string {
  let slug = nameOf(denomination)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > MAX_SLUG) {
    const cut = slug.slice(0, MAX_SLUG + 1);
    slug = cut.slice(0, Math.max(cut.lastIndexOf('-'), 1)).replace(/-+$/, '');
  }
  return slug === '' ? `bdpm-${cis}` : `${slug}-${cis}`;
}

/**
 * At most this many products in the import, by default. It was 300 until
 * fluconazole and methotrexate joined the registry (2026-11-05); their
 * products take their rank in the cut, and 315 keeps every product the 300
 * cap kept before.
 */
export const MAX_ENTRIES = 315;

/** Another name people use for a brand, as a product's local name (not checked by a speaker). */
export interface BrandLocalName {
  text: string;
  lang: 'fr' | 'wo' | 'en';
}

/**
 * Other names people use for a brand, given to every product of the brand
 * (matched as PRIORITY_BRANDS are, by the first whole words of the
 * denomination) as local names that no speaker has checked. From the live
 * test round of 2026-11-05: a depot keeper asked for "Doliprane codéine".
 */
export const LOCAL_NAMES: Readonly<Record<string, readonly BrandLocalName[]>> = {
  CODOLIPRANE: [{ text: 'Doliprane codéine', lang: 'fr' }],
};

export interface SelectOptions {
  /** Registry substance ids: a product is kept only if all its substances are listed. */
  substances: ReadonlySet<string>;
  /** At most this many products in total (MAX_ENTRIES by default). */
  maxEntries?: number;
  /** At most this many products per first substance (15 by default). */
  maxPerSubstance?: number;
  /**
   * At most this many products per brand (3 by default), so that one brand
   * with many forms does not fill the share of its substance.
   */
  maxPerBrand?: number;
  /** Brands always kept, whatever the caps (PRIORITY_BRANDS by default). */
  priorityBrands?: readonly string[];
  /** Brands kept in addition to the selection, outside its caps (ADDED_BRANDS by default). */
  addedBrands?: readonly string[];
  /** Substances brought in only through the added brands (ADDED_SUBSTANCES by default). */
  addedSubstances?: readonly string[];
  /** Other names of a brand, given to its products (LOCAL_NAMES by default). */
  localNames?: Readonly<Record<string, readonly BrandLocalName[]>>;
}

/**
 * Brands added once the selection was settled (live test round 2,
 * 2026-11-05: brands on the boxes of substances the rules read, fluconazole,
 * aspirin and doxycycline, and a common cough syrup): every marketed product
 * of these brands that passes the filters is kept in addition to the
 * selection, outside its caps, so that adding a brand leaves every other
 * product as it was (as priority brands, they would take the places of other
 * products in the caps). Matched as PRIORITY_BRANDS are.
 */
export const ADDED_BRANDS: readonly string[] = ['TRIFLUCAN', 'ASPRO', 'GRANUDOXY', 'TOPLEXIL'];

/**
 * Substances brought into the registry only through an added brand: their
 * other products are left out, so they take no place in the selection
 * (oxomemazine, for the cough syrup TOPLEXIL).
 */
export const ADDED_SUBSTANCES: readonly string[] = ['oxomemazine'];

/**
 * Brands most used in Senegal (decision of the project, 2026-11-04): every
 * marketed product of these brands that passes the filters is kept, whatever
 * the caps. A brand matches the first whole words of the denomination,
 * accents and case aside ("DOXY" matches "DOXY 100 mg", not "DOXYPALU").
 */
export const PRIORITY_BRANDS: readonly string[] = [
  'DOLIPRANE',
  'EFFERALGAN',
  'DAFALGAN',
  'CODOLIPRANE',
  'ADVIL',
  'NUROFEN',
  'VOLTARENE',
  'ASPEGIC',
  'KARDEGIC',
  'FLAGYL',
  'BACTRIM',
  'NEO-CODION',
  'IXPRIM',
  'CONTRAMAL',
  'DEPAKINE',
  'COUMADINE',
  'DOXY',
  'VIBRAMYCINE',
  'TARDYFERON B9',
  'DERMOVAL',
  'FERVEX',
  'CLAMOXYL',
  'RIFADINE',
  'TEGRETOL',
];

/** Whether a denomination starts with the brand, as whole words. */
function startsWithBrand(denomination: string, brand: string): boolean {
  const name = normalise(denomination);
  const prefix = normalise(brand);
  return name.startsWith(prefix) && /^($|[ ,])/.test(name.slice(prefix.length));
}

/** Whether a denomination starts with one of the brands, as whole words. */
function isPriority(denomination: string, brands: readonly string[]): boolean {
  return brands.some((brand) => startsWithBrand(denomination, brand));
}

/** The local names of a product: the other names of its brand, not checked by a speaker. */
function localNamesOf(
  denomination: string,
  table: Readonly<Record<string, readonly BrandLocalName[]>>,
): AuthoredProduct['local-names'] {
  return Object.entries(table)
    .filter(([brand]) => startsWithBrand(denomination, brand))
    .flatMap(([, names]) => names.map((name) => ({ ...name, checked: false })));
}

type Component = AuthoredProduct['components'][number];

/**
 * The components of one medicine: each active substance (SA) mapped to its
 * registry id, with the strength of its therapeutic fraction (FT) when the
 * BDPM gives one, otherwise its own. Undefined when a substance does not map.
 */
function componentsOf(
  lines: readonly BdpmComponent[],
  substances: ReadonlySet<string>,
): Component[] | undefined {
  const groups = new Map<string, BdpmComponent[]>();
  for (const line of lines) {
    const key = `${line.element}\n${line.link}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const byId = new Map<string, number | undefined>();
  const order: string[] = [];
  for (const group of groups.values()) {
    for (const active of group.filter((line) => line.nature === 'SA')) {
      const id = SUBSTANCE_LABELS[normalise(active.label)];
      if (id === undefined || !substances.has(id)) return undefined;
      const fraction = group.find((line) => line.nature === 'FT');
      const strength = strengthMgOf((fraction ?? active).dosage, (fraction ?? active).reference);
      if (!byId.has(id)) {
        order.push(id);
        byId.set(id, strength);
      } else if (byId.get(id) !== strength) {
        // The same substance with two strengths (two elements): unknown.
        byId.set(id, undefined);
      }
    }
  }
  if (order.length === 0) return undefined;
  return order.map((substance) => {
    const strength = byId.get(substance);
    return strength === undefined ? { substance } : { substance, 'strength-mg': strength };
  });
}

/** The product routes, or undefined when one route is not oral, cutaneous or rectal. */
function routeOf(routes: readonly string[]): string | undefined {
  const mapped = routes.map((route) => ROUTES[normalise(route)]);
  if (mapped.length === 0 || mapped.some((route) => route === undefined)) return undefined;
  return [...new Set(mapped)].join(', ');
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The products to import, in their final order: marketed, by mouth, on the
 * skin or rectally, every active substance in the registry. Sorted by first
 * substance id (alphabetical), then denomination, then CIS code; one product
 * per denomination. Every product of a priority brand is kept; the others
 * fill the rest, at most `maxPerBrand` per brand, `maxPerSubstance` per first
 * substance (priority products included) and `maxEntries` in total, the
 * total cap taking them rank by rank across substances. The products of an
 * added brand (`addedBrands`) are kept in addition, outside every cap, and
 * the other products of a substance only they bring (`addedSubstances`) are
 * left out: the selection of the other products does not change.
 */
export function selectProducts(
  specialities: readonly BdpmSpeciality[],
  compositions: readonly BdpmComponent[],
  options: SelectOptions,
): AuthoredProduct[] {
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxPerSubstance = options.maxPerSubstance ?? 15;
  const maxPerBrand = options.maxPerBrand ?? 3;
  const priorityBrands = options.priorityBrands ?? PRIORITY_BRANDS;
  const localNames = options.localNames ?? LOCAL_NAMES;
  const linesOf = new Map<string, BdpmComponent[]>();
  for (const line of compositions) {
    linesOf.set(line.cis, [...(linesOf.get(line.cis) ?? []), line]);
  }
  const candidates: { key: string; sort: string; product: AuthoredProduct }[] = [];
  for (const speciality of specialities) {
    if (!speciality.marketed) continue;
    const route = routeOf(speciality.routes);
    if (route === undefined) continue;
    const lines = [...(linesOf.get(speciality.cis) ?? [])].sort(
      (a, b) =>
        compare(a.element, b.element) ||
        Number(a.link) - Number(b.link) ||
        compare(a.nature, b.nature) ||
        compare(a.label, b.label),
    );
    const components = componentsOf(lines, options.substances);
    if (components === undefined) continue;
    if (route !== 'oral' && components.some((c) => ORAL_ONLY.has(c.substance))) continue;
    const key = components.map((c) => c.substance).sort(compare)[0] ?? '';
    candidates.push({
      key,
      sort: `${normalise(speciality.denomination)}\n${speciality.cis}`,
      product: {
        id: productIdOf(speciality.denomination, speciality.cis),
        names: { fr: speciality.denomination, en: speciality.denomination },
        brands: [brandOf(speciality.denomination)],
        'local-names': localNamesOf(speciality.denomination, localNames),
        components,
        form: speciality.form,
        route,
        source: { bdpm: speciality.cis },
        demo: false,
      },
    });
  }
  candidates.sort((a, b) => compare(a.key, b.key) || compare(a.sort, b.sort));
  const ordered = candidates.map((candidate, position) => ({ ...candidate, position }));
  // The products of an added brand are kept apart, outside the caps, one per
  // denomination; the other products of a substance only they bring are left out.
  const addedBrands = options.addedBrands ?? ADDED_BRANDS;
  const addedSubstances = new Set(options.addedSubstances ?? ADDED_SUBSTANCES);
  const isAdded = (candidate: (typeof ordered)[number]) =>
    isPriority(candidate.product.names.fr, addedBrands);
  const addedNames = new Set<string>();
  const added = ordered.filter((candidate) => {
    if (!isAdded(candidate)) return false;
    const denomination = normalise(candidate.product.names.fr);
    if (addedNames.has(denomination)) return false;
    addedNames.add(denomination);
    return true;
  });
  const pool = ordered.filter(
    (candidate) =>
      !isAdded(candidate) &&
      !candidate.product.components.some((c) => addedSubstances.has(c.substance)),
  );
  // One product per denomination (the lowest CIS code); outside the priority
  // brands, at most maxPerBrand per brand.
  const denominations = new Set<string>();
  const perBrand = new Map<string, number>();
  const distinct = pool.flatMap((candidate) => {
    const { product } = candidate;
    const denomination = normalise(product.names.fr);
    if (denominations.has(denomination)) return [];
    const priority = isPriority(product.names.fr, priorityBrands);
    const brand = normalise(product.brands[0] ?? '');
    const count = perBrand.get(brand) ?? 0;
    if (!priority && count >= maxPerBrand) return [];
    denominations.add(denomination);
    perBrand.set(brand, count + 1);
    return [{ ...candidate, priority }];
  });
  // Rank within the first substance, priority products first: they are always
  // kept and fill the share of their substance before the other products,
  // which are left out past maxPerSubstance.
  const perKey = new Map<string, number>();
  const ranked = [...distinct]
    .sort(
      (a, b) =>
        compare(a.key, b.key) || Number(b.priority) - Number(a.priority) || a.position - b.position,
    )
    .flatMap((candidate) => {
      const rank = perKey.get(candidate.key) ?? 0;
      if (!candidate.priority && rank >= maxPerSubstance) return [];
      perKey.set(candidate.key, rank + 1);
      return [{ ...candidate, rank }];
    });
  // The priority products come first; the total cap is then applied rank by
  // rank (the first product of every substance, then the second...), so that
  // substances late in the alphabet are not left out. The result keeps the
  // sorted order.
  const selection = ranked
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) || a.rank - b.rank || a.position - b.position,
    )
    .slice(0, maxEntries);
  return [...selection, ...added]
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.product);
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * A quoted YAML scalar, always read as a string: single quotes, or double
 * quotes when the text holds more apostrophes than double quotes (the choice
 * Prettier makes, so that the generated file passes the format check).
 */
function quoted(text: string): string {
  if (count(text, "'") > count(text, '"')) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${text.replace(/'/g, "''")}'`;
}

const HEADER = [
  LICENCE_LINE,
  '# Generated by "pnpm knowledge:import-bdpm" from the BDPM files CIS_bdpm.txt and',
  '# CIS_COMPO_bdpm.txt (download date: see the bdpm entry of knowledge/sources.yaml).',
  '# Do not edit by hand: run the import again.',
];

/** The YAML text of registry/products/bdpm.yaml: a list of products, block style. */
export function renderProducts(products: readonly AuthoredProduct[]): string {
  const lines = [...HEADER];
  for (const product of products) {
    lines.push(`- id: ${product.id}`);
    lines.push('  names:');
    lines.push(`    fr: ${quoted(product.names.fr)}`);
    lines.push(`    en: ${quoted(product.names.en)}`);
    lines.push(`  brands: [${product.brands.map(quoted).join(', ')}]`);
    const locals = product['local-names'];
    if (locals.length === 0) lines.push('  local-names: []');
    else lines.push('  local-names:');
    for (const local of locals) {
      lines.push(
        `    - { text: ${quoted(local.text)}, lang: ${local.lang}, checked: ${String(local.checked)} }`,
      );
    }
    lines.push('  components:');
    for (const component of product.components) {
      lines.push(`    - substance: ${component.substance}`);
      const strength = component['strength-mg'];
      if (strength !== undefined) lines.push(`      strength-mg: ${String(strength)}`);
    }
    lines.push(`  form: ${quoted(product.form)}`);
    lines.push(`  route: ${quoted(product.route)}`);
    const source = product.source;
    lines.push('  source:');
    lines.push('bdpm' in source ? `    bdpm: ${quoted(source.bdpm)}` : '    demo-manual: true');
    lines.push(`  demo: ${String(product.demo)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** An input file of the import, identified by its size and its sha256. */
export interface BdpmInput {
  file: string;
  bytes: number;
  sha256: string;
}

/**
 * The result of an import: the products, how many contain each substance, and
 * the input files (to record in the bdpm entry of knowledge/sources.yaml).
 */
export interface BdpmImport {
  products: AuthoredProduct[];
  perSubstance: Record<string, number>;
  inputs: BdpmInput[];
}

async function readBdpm(dir: string, name: string): Promise<{ text: string; input: BdpmInput }> {
  const file = path.join(dir, name);
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new Error(`Cannot read the BDPM file ${file}: download ${name} from the BDPM site`, {
      cause: error,
    });
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { text: decodeBdpm(bytes), input: { file: name, bytes: bytes.length, sha256 } };
}

/** Reads CIS_bdpm.txt and CIS_COMPO_bdpm.txt in `dir` and selects the products to import. */
export async function importBdpm(
  dir: string,
  substances: ReadonlySet<string>,
  options: Omit<SelectOptions, 'substances'> = {},
): Promise<BdpmImport> {
  const specialityFile = await readBdpm(dir, BDPM_FILES.specialities);
  const compositionFile = await readBdpm(dir, BDPM_FILES.compositions);
  const specialities = parseSpecialities(specialityFile.text);
  const compositions = parseCompositions(compositionFile.text);
  const products = selectProducts(specialities, compositions, { ...options, substances });
  const counts = new Map<string, number>();
  for (const product of products) {
    for (const substance of new Set(product.components.map((c) => c.substance))) {
      counts.set(substance, (counts.get(substance) ?? 0) + 1);
    }
  }
  const perSubstance = Object.fromEntries([...counts].sort(([a], [b]) => compare(a, b)));
  return { products, perSubstance, inputs: [specialityFile.input, compositionFile.input] };
}
