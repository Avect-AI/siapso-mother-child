// SPDX-License-Identifier: MIT
import { normalize } from './normalize.js';
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
function add(names: Names, text: string, lang: NameLang): void {
  if (text.trim() === '') return;
  if (names.some((name) => name.text === text)) return;
  names.push({ text, lang });
}

/** Priority of a brand product, a generic product or plant, and an INN-only match. */
const BRAND_PRIORITY = 3;
const GENERIC_PRIORITY = 2;
const INN_PRIORITY = 1;

/**
 * Index entries of a pack. A product with brands is indexed at priority 3 by
 * its names, brands and local names, and a second time at priority 1 by the
 * INN of its substances, so that a plain INN query lists generics first. A
 * product without a brand is a generic: its INN names are part of its single
 * entry, at priority 2. A plant is indexed at priority 2.
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
      add(inn, substance.names.fr, 'inn');
      add(inn, substance.names.en, 'inn');
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
    const family =
      product.brands[0] === undefined
        ? `substances:${substanceIds.join('+')}`
        : `brand:${normalize(product.brands[0])}`;
    const base = {
      family,
      strengths: product.components.flatMap((component) =>
        component.strengthMg === undefined ? [] : [component.strengthMg],
      ),
      componentCount: product.components.length,
      id: product.id,
      kind: 'product' as const,
      display: { fr: product.names.fr, en: product.names.en },
      detail: parts.join(', '),
    };
    if (product.brands.length > 0) {
      entries.push({ ...base, names, priority: BRAND_PRIORITY });
      if (inn.length > 0) entries.push({ ...base, names: inn, priority: INN_PRIORITY });
    } else {
      for (const name of inn) add(names, name.text, name.lang);
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
