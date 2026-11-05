// SPDX-License-Identifier: MIT
import { normalize, splitAgeWords } from './normalize.js';
import type { IndexEntry, NameLang } from './types.js';

type Names = IndexEntry['names'];

/** The part of the knowledge pack the resolver reads. */
export interface PackNames {
  products: {
    id: string;
    names: { fr: string; en: string };
    brands: string[];
    localNames: { text: string; lang: 'fr' | 'wo' | 'en' }[];
    components: { substance: string; strengthMg?: number }[];
  }[];
  plants: {
    id: string;
    latinName: string;
    names: { fr: string; en: string };
    localNames: { text: string; lang: 'fr' | 'wo' | 'en' }[];
  }[];
  substances: { id: string; names: { fr: string; en: string } }[];
}

/** Adds a name unless the same text is already there (the first language wins). */
function add(names: Names, text: string, lang: NameLang, substance?: string): void {
  if (text.trim() === '') return;
  if (names.some((name) => name.text === text)) return;
  names.push(substance === undefined ? { text, lang } : { text, lang, substance });
}

/** Priority of a brand product, a generic product or plant, and an INN-only match. */
const BRAND_PRIORITY = 3;
const GENERIC_PRIORITY = 2;
const INN_PRIORITY = 1;

/**
 * Whether a product is a brand product: its French name starts with its first
 * brand (every BDPM product, Néo-Codion). A generic may also list brands, the
 * names people use for its substance (Coartem for artemether-lumefantrine):
 * they are other names of the generic, which stays a generic.
 */
function namedByItsBrand(product: PackNames['products'][number]): boolean {
  const brand = product.brands[0];
  if (brand === undefined) return false;
  const name = normalize(product.names.fr);
  const key = normalize(brand);
  return key !== '' && (name === key || name.startsWith(`${key} `));
}

/**
 * Index entries of a pack. A brand product is indexed at priority 3 by its
 * names, brands and local names, and a second time at priority 1 by the INN
 * of its substances, so that a plain INN query lists generics first; its
 * family is its first brand. A generic (no brand, or brands that do not name
 * it) has a single entry at priority 2 holding its names, brands, local names
 * and INN names; its family is its sorted substances. A plant is indexed at
 * priority 2.
 */
export function entriesFromPack(pack: PackNames): IndexEntry[] {
  const substances = new Map(pack.substances.map((substance) => [substance.id, substance]));
  const entries: IndexEntry[] = [];

  for (const product of pack.products) {
    const inn: Names = [];
    const parts: string[] = [];
    for (const component of product.components) {
      const substance = substances.get(component.substance);
      if (!substance) continue;
      add(inn, substance.names.fr, 'inn', substance.id);
      add(inn, substance.names.en, 'inn', substance.id);
      parts.push(
        component.strengthMg === undefined
          ? substance.names.fr
          : `${substance.names.fr} ${String(component.strengthMg)} mg`,
      );
    }
    const names: Names = [];
    add(names, product.names.fr, 'fr');
    add(names, product.names.en, 'en');
    for (const brand of product.brands) add(names, brand, 'brand');
    for (const local of product.localNames) add(names, local.text, local.lang);
    const substanceIds = [
      ...new Set(product.components.map((component) => component.substance)),
    ].sort();
    const brandProduct = namedByItsBrand(product);
    // The age words of a brand ("DOLIPRANE ADULTES") name a variant of the
    // brand, not another brand: one family, whose age variants a query word
    // chooses between.
    const family =
      brandProduct && product.brands[0] !== undefined
        ? `brand:${splitAgeWords(normalize(product.brands[0])).text}`
        : `substances:${substanceIds.join('+')}`;
    const base = {
      family,
      strengths: product.components.flatMap((component) =>
        component.strengthMg === undefined ? [] : [component.strengthMg],
      ),
      componentCount: product.components.length,
      substances: substanceIds,
      id: product.id,
      kind: 'product' as const,
      display: { fr: product.names.fr, en: product.names.en },
      detail: parts.join(', '),
    };
    if (brandProduct) {
      entries.push({ ...base, names, priority: BRAND_PRIORITY });
      if (inn.length > 0) entries.push({ ...base, names: inn, priority: INN_PRIORITY });
    } else {
      for (const name of inn) add(names, name.text, name.lang, name.substance);
      entries.push({ ...base, names, priority: GENERIC_PRIORITY });
    }
  }

  for (const plant of pack.plants) {
    const names: Names = [];
    add(names, plant.names.fr, 'fr');
    add(names, plant.names.en, 'en');
    add(names, plant.latinName, 'latin');
    for (const local of plant.localNames) add(names, local.text, local.lang);
    entries.push({
      family: plant.id,
      id: plant.id,
      kind: 'plant',
      display: { fr: plant.names.fr, en: plant.names.en },
      detail: plant.latinName,
      names,
      priority: GENERIC_PRIORITY,
    });
  }
  return entries;
}
