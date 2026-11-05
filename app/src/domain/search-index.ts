// SPDX-License-Identifier: MIT
// What the search and confirm screens read from the knowledge pack: the
// resolver index (built once per pack), the substances whose daily maximum a
// rule watches (the screen then asks for units per day), how a product or a
// remedy is named in the interface language, and the strengths a candidate's
// family offers. Pure: the screens hand in the pack and the language. None of
// this decides a level; it only shows what the user is asked to confirm.
import type { ItemRef, Lang, LocalName, Pack, Product } from '@siapso/engine';
import {
  buildIndex,
  entriesFromPack,
  formWords,
  namedSubstances,
  normalize,
  parseStrength,
  withoutStopWords,
  type Candidate,
  type ResolverIndex,
} from '@siapso/resolver';

/**
 * The resolver's family of generic products: `substances:` then the sorted
 * substance ids joined by `+` (resolver/README.md, "Families and variants").
 * Any other family is a brand or a plant.
 */
const GENERIC_FAMILY = 'substances:';

interface Indexed {
  index: ResolverIndex;
  /** The resolver family of each product id. */
  familyOf: Map<string, string>;
  /** The product ids of each family, strength ascending then id (the resolver's order). */
  members: Map<string, string[]>;
  maxDose: Set<string>;
}

const cache = new WeakMap<Pack, Indexed>();

function maxDoseSubstances(pack: Pack): Set<string> {
  const found = new Set<string>();
  for (const rule of pack.rules) {
    const subject = rule.when.subject;
    if (rule.kind !== 'max-dose' || subject === undefined) continue;
    if ('substance' in subject) {
      found.add(subject.substance);
    } else if ('class' in subject) {
      const excluded = pack.classes.find((c) => c.id === subject.class)?.excludes ?? [];
      for (const substance of pack.substances) {
        if (substance.classes.includes(subject.class) && !excluded.includes(substance.id)) {
          found.add(substance.id);
        }
      }
    }
  }
  return found;
}

/** The first strength in mg of a product, Infinity when it has none (sorted last). */
function firstStrength(product: Product | undefined): number {
  return product?.components.find((c) => c.strengthMg !== undefined)?.strengthMg ?? Infinity;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Strength ascending, then French name (normalised: the plainest form first),
 * then id: the order of the resolver's variants, the same for every brand.
 */
function byStrengthThenName(a: Product, b: Product): number {
  return (
    firstStrength(a) - firstStrength(b) ||
    compareText(normalize(a.names.fr), normalize(b.names.fr)) ||
    compareText(a.id, b.id)
  );
}

function indexedOf(pack: Pack): Indexed {
  let indexed = cache.get(pack);
  if (indexed === undefined) {
    const entries = entriesFromPack(pack);
    const familyOf = new Map<string, string>();
    for (const entry of entries) {
      if (entry.kind === 'product' && !familyOf.has(entry.id)) familyOf.set(entry.id, entry.family);
    }
    const grouped = new Map<string, Product[]>();
    for (const product of pack.products) {
      const family = familyOf.get(product.id);
      if (family === undefined) continue;
      const list = grouped.get(family);
      if (list) list.push(product);
      else grouped.set(family, [product]);
    }
    const members = new Map(
      [...grouped].map(([family, products]) => [
        family,
        products.sort(byStrengthThenName).map((p) => p.id),
      ]),
    );
    indexed = { index: buildIndex(entries), familyOf, members, maxDose: maxDoseSubstances(pack) };
    cache.set(pack, indexed);
  }
  return indexed;
}

/** The resolver index of a pack, built on first use and kept while the pack is. */
export function searchIndexOf(pack: Pack): ResolverIndex {
  return indexedOf(pack).index;
}

/**
 * The substances a max-dose rule of the pack watches: a substance subject, or
 * every substance of a class subject but those the class excludes.
 */
export function substancesWithMaxDose(pack: Pack): Set<string> {
  return new Set(indexedOf(pack).maxDose);
}

function productOf(pack: Pack, id: string): Product | undefined {
  return pack.products.find((product) => product.id === id);
}

/** The resolver family of a product (its brand, or its substances for a generic); undefined for an id the pack does not have. */
export function productFamilyOf(pack: Pack, id: string): string | undefined {
  return indexedOf(pack).familyOf.get(id);
}

/**
 * The name of a product of a brand family whose products differ only by
 * their form (CODOLIPRANE tablet and capsule): the brand and its strengths,
 * strongest first ("CODOLIPRANE 500 mg/30 mg"), since the user chose no form
 * (no question is asked: the rules read strengths). A family with no strength
 * in mg at all (DERMOVAL cream and gel, a syrup at two concentrations) is
 * named by its brand alone: the rules read the same thing whichever product
 * it is, and the name of one of them would be a product she did not choose.
 * Undefined otherwise.
 */
function formsOnlyName(pack: Pack, product: Product, lang: Lang): string | undefined {
  const { familyOf, members } = indexedOf(pack);
  const family = familyOf.get(product.id);
  const brand = product.brands[0];
  if (family === undefined || family.startsWith(GENERIC_FAMILY) || brand === undefined) {
    return undefined;
  }
  const others = (members.get(family) ?? []).filter((id) => id !== product.id);
  const key = strengthsKey(product);
  const sameStrengths = others.every((id) => {
    const other = productOf(pack, id);
    return other !== undefined && strengthsKey(other) === key;
  });
  const strengths = product.components
    .flatMap((c) => (c.strengthMg === undefined ? [] : [c.strengthMg]))
    .sort((a, b) => b - a);
  if (others.length === 0 || !sameStrengths) return undefined;
  if (strengths.length === 0) return brand;
  return `${brand} ${strengths.map((mg) => milligrams(mg, lang)).join('/')}`;
}

/** Whether the confirm screen asks for units per day: a product holding a max-dose substance. */
export function needsUnitsPerDay(pack: Pack, ref: ItemRef): boolean {
  if (ref.kind !== 'product') return false;
  const maxDose = indexedOf(pack).maxDose;
  return productOf(pack, ref.id)?.components.some((c) => maxDose.has(c.substance)) ?? false;
}

export interface ItemDisplay {
  name: string;
  /** Substances and strengths of a product, the Latin name of a plant. */
  detail: string | undefined;
  /** The language of the detail when it is not the interface's: Latin for a plant's name. */
  detailLang?: 'la';
}

/** A number, then a unit of a strength or a volume, as product names write them. */
const NUMBER_THEN_UNIT =
  /(\d)\s+(mg|g|µg|mcg|microgrammes?|milligrammes?|ml|UI|%|pour\s+cent)(?![\p{L}\d])/giu;

/**
 * A product name as shown: each number held to its unit by a no-break space
 * ("1000 mg", "2,4 POUR CENT"), so a name never splits between them across
 * two lines ("DOLIPRANE 1000" then "mg, comprimé" reads as another product).
 */
export function unitsHeld(name: string): string {
  return name.replace(
    NUMBER_THEN_UNIT,
    (_match, digit: string, unit: string) => `${digit}\u00a0${unit.replace(/\s+/g, '\u00a0')}`,
  );
}

/**
 * A strength as the language writes it ("0,5" in French), digits never
 * grouped ("1000"), held to its unit by a no-break space ("500 mg" never
 * splits across two lines).
 */
function milligrams(mg: number, lang: Lang): string {
  const number = new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 3 });
  return `${number.format(mg)}\u00a0mg`;
}

/** "Paracétamol 500 mg, Codéine 30 mg": each substance in the language, with its strength when known. */
function productDetail(pack: Pack, product: Product, lang: Lang): string {
  return product.components
    .map((component) => {
      const substance = pack.substances.find((s) => s.id === component.substance);
      const name = substance ? substance.names[lang] : component.substance;
      return component.strengthMg === undefined
        ? name
        : `${name} ${milligrams(component.strengthMg, lang)}`;
    })
    .join(', ');
}

/**
 * How an item is shown: a product or a plant by its name in the language,
 * with its detail; an unrecognised item by the text typed; an id the pack no
 * longer has by the id itself (never an empty line). A product whose strength
 * the user does not know (`strengthUnknown`) is shown without any strength:
 * by its family (familyDisplayOf), never by the name of one strength.
 */
export function displayOf(
  pack: Pack,
  ref: ItemRef,
  lang: Lang,
  strengthUnknown = false,
): ItemDisplay {
  if (ref.kind === 'unrecognised') return { name: ref.text, detail: undefined };
  if (ref.kind === 'product') {
    const product = productOf(pack, ref.id);
    if (product === undefined) return { name: ref.id, detail: undefined };
    if (strengthUnknown) return familyDisplayOf(pack, product, lang);
    return {
      name: unitsHeld(formsOnlyName(pack, product, lang) ?? product.names[lang]),
      detail: productDetail(pack, product, lang),
    };
  }
  const plant = pack.plants.find((p) => p.id === ref.id);
  return plant
    ? { name: plant.names[lang], detail: plant.latinName, detailLang: 'la' }
    : { name: ref.id, detail: undefined };
}

/** The local name a match came from, or undefined when the match was on another name. */
export function localNameOf(
  pack: Pack,
  ref: { kind: 'product' | 'plant'; id: string },
  matched: string,
): LocalName | undefined {
  const entries: readonly { id: string; localNames: LocalName[] }[] =
    ref.kind === 'product' ? pack.products : pack.plants;
  return entries.find((e) => e.id === ref.id)?.localNames.find((local) => local.text === matched);
}

/**
 * The name she typed, when the product or remedy is shown under a name that
 * does not say it ("cytotec" for "Misoprostol (générique)", "nebeday" for
 * "Moringa"), so she still recognises what she entered: the text typed,
 * trimmed, its spaces collapsed. Undefined when the name shown already holds
 * it, as the resolver reads names (accents, doubled letters, a strength and
 * form words aside), and for a query with no name in it.
 */
export function writtenNameOf(
  pack: Pack,
  ref: { kind: 'product' | 'plant'; id: string },
  query: string,
  lang: Lang,
): string | undefined {
  const typed = query.trim().replace(/\s+/g, ' ');
  const name = withoutStopWords(normalize(parseStrength(typed).text));
  if (name === '') return undefined;
  return normalize(displayOf(pack, ref, lang).name).includes(name) ? undefined : typed;
}

/**
 * The substances a query names that the product lacks, in the language
 * ("efferalgan codéine" for a paracetamol-only EFFERALGAN: Codéine), for the
 * confirm screen to say so. Empty when it lacks none, or is not in the pack.
 */
export function missingSubstancesOf(
  pack: Pack,
  productId: string,
  query: string,
  lang: Lang,
): string[] {
  const product = productOf(pack, productId);
  if (product === undefined) return [];
  const held = new Set(product.components.map((c) => c.substance));
  return namedSubstances(indexedOf(pack).index, query)
    .filter((id) => !held.has(id))
    .map((id) => pack.substances.find((s) => s.id === id)?.names[lang] ?? id);
}

/** What the confirm screen needs of a candidate: who it is and the other products of its family. */
export type ConfirmCandidate = Pick<Candidate, 'id' | 'kind' | 'family' | 'variants'>;

/**
 * A product or plant of the pack as the resolver would propose it: its
 * family and the other products of the family (strength ascending, then id),
 * for a confirm screen opened without a search (a link, a reload). Undefined
 * when the pack does not have it.
 */
export function candidateOf(
  pack: Pack,
  ref: { kind: 'product' | 'plant'; id: string },
): ConfirmCandidate | undefined {
  if (ref.kind === 'plant') {
    return pack.plants.some((plant) => plant.id === ref.id)
      ? { id: ref.id, kind: 'plant', family: ref.id, variants: [] }
      : undefined;
  }
  const { familyOf, members } = indexedOf(pack);
  const family = familyOf.get(ref.id);
  if (family === undefined) return undefined;
  const variants = (members.get(family) ?? []).filter((id) => id !== ref.id);
  return { id: ref.id, kind: 'product', family, variants };
}

function hasNoStrength(product: Product): boolean {
  return product.components.every((component) => component.strengthMg === undefined);
}

/** The strengths of a product, whatever the order of its components: "500+30", "" for none. */
function strengthsKey(product: Product): string {
  return product.components
    .map((c) => (c.strengthMg === undefined ? '-' : String(c.strengthMg)))
    .sort()
    .join('+');
}

/** The substances of a product in the language, without strengths. */
function substanceNames(pack: Pack, product: Product, lang: Lang): string {
  return [...new Set(product.components.map((c) => c.substance))]
    .map((id) => pack.substances.find((s) => s.id === id)?.names[lang] ?? id)
    .join(', ');
}

/**
 * A product shown without any of its strengths: a brand by the brand alone
 * (DOLIPRANE), a generic by its product without strength when the family has
 * one (Paracétamol (générique)), else by its substances; the substances as
 * detail. For a family whose strength is not chosen, or not known.
 */
function familyDisplayOf(pack: Pack, product: Product, lang: Lang): ItemDisplay {
  const family = indexedOf(pack).familyOf.get(product.id) ?? '';
  const substances = substanceNames(pack, product, lang);
  if (!family.startsWith(GENERIC_FAMILY)) {
    return { name: unitsHeld(product.brands[0] ?? substances), detail: substances };
  }
  const plain = (indexedOf(pack).members.get(family) ?? [])
    .map((id) => productOf(pack, id))
    .find((p): p is Product => p !== undefined && hasNoStrength(p));
  return { name: unitsHeld(plain?.names[lang] ?? substances), detail: substances };
}

export interface StrengthChoice {
  /**
   * The products to choose from, strength ascending then id. In a family of
   * generics, its product without strength is not listed: "I do not know"
   * stands for it. "I do not know" is always offered: it keeps the candidate
   * with its strength unknown (CheckedItem.strengthUnknown).
   */
  options: string[];
  /**
   * The answer chosen at first: the candidate when the query gave its
   * strength, or gave the form of the only product of the family that has it
   * when that product has no strength in mg (a syrup); null otherwise, for a
   * generic as for a brand: a strength the user did not give is never chosen
   * for her (the lowest strength of a brand would hide a daily maximum), and
   * "I do not know" is her own answer too.
   */
  preselected: 'candidate' | null;
}

/** The form words of a product: of its French name and of its form ("comprimé", "sirop"). */
function productForms(product: Product): Set<string> {
  return new Set(formWords(`${product.names.fr} ${product.form}`));
}

/**
 * The strength question of the confirm screen, for a candidate whose family
 * has other products of other strengths; null when it has none, or when its
 * products differ only by their form (the candidate is kept: the rules read
 * strengths, which are then the same whatever the form).
 */
export function strengthChoiceOf(
  pack: Pack,
  candidate: ConfirmCandidate,
  query: string,
): StrengthChoice | null {
  if (candidate.kind !== 'product' || candidate.variants.length === 0) return null;
  const product = productOf(pack, candidate.id);
  if (product === undefined) return null;
  const members = [candidate.id, ...candidate.variants]
    .map((id) => productOf(pack, id))
    .filter((p): p is Product => p !== undefined);
  const strengths = strengthsKey(product);
  if (members.every((p) => strengthsKey(p) === strengths)) return null;

  const generic = candidate.family.startsWith(GENERIC_FAMILY);
  const options = members
    .filter((p) => !(generic && hasNoStrength(p)))
    .sort(byStrengthThenName)
    .map((p) => p.id);

  const typed = parseStrength(query).strengthMg;
  const forms = formWords(query);
  let preselected: StrengthChoice['preselected'] = null;
  if (
    typed !== undefined &&
    product.components.some(
      (c) => c.strengthMg !== undefined && Math.abs(c.strengthMg - typed) < 1e-6,
    )
  ) {
    preselected = 'candidate';
  } else if (typed === undefined && forms.length > 0 && hasNoStrength(product)) {
    // "Néo-Codion sirop": the only product of the family in that form, and no strength chosen.
    const inForm = members.filter((p) => {
      const own = productForms(p);
      return forms.every((form) => own.has(form));
    });
    if (inForm.length === 1 && inForm[0]?.id === product.id && options.includes(product.id)) {
      preselected = 'candidate';
    }
  }
  return { options, preselected };
}

/**
 * How a candidate is shown on the search screen, and on the confirm screen
 * until a strength is chosen. The product itself when its strength is chosen
 * (typed in the query, or none to choose). Otherwise the family, never one of
 * its strengths picked for the user (familyDisplayOf).
 */
export function candidateDisplayOf(
  pack: Pack,
  candidate: ConfirmCandidate,
  query: string,
  lang: Lang,
): ItemDisplay {
  const own = displayOf(pack, { kind: candidate.kind, id: candidate.id }, lang);
  const choice = strengthChoiceOf(pack, candidate, query);
  const product = productOf(pack, candidate.id);
  if (choice === null || choice.preselected !== null || product === undefined) return own;
  return familyDisplayOf(pack, product, lang);
}

/**
 * The answer for one product in the strength question. In a brand family,
 * the brand every answer shares is said once, above the question, so each
 * answer starts with what differs and what the box shows: "1000 mg,
 * comprimé" for "DOLIPRANE 1000 mg, comprimé", "comprimé pelliculé" for
 * "DAFALGAN CODEINE, comprimé pelliculé". A generic product reads the same
 * way, its strengths then its form ("500 mg, comprimé"). A name that does not
 * start with the brand as a whole word keeps the whole name.
 */
export function strengthOptionLabel(
  pack: Pack,
  candidate: ConfirmCandidate,
  id: string,
  lang: Lang,
): string {
  const product = productOf(pack, id);
  if (candidate.family.startsWith(GENERIC_FAMILY) && product !== undefined) {
    // Written as the names of the brand products are ("1000 mg, comprimé").
    const number = new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 3 });
    const strengths = product.components.flatMap((c) =>
      c.strengthMg === undefined ? [] : [`${number.format(c.strengthMg)}\u00a0mg`],
    );
    if (strengths.length > 0) return `${strengths.join('/')}, ${product.form}`;
  }
  // The product's own name, form included: the forms are what the answers tell apart.
  const name = product?.names[lang] ?? id;
  const brand = candidate.family.startsWith(GENERIC_FAMILY)
    ? undefined
    : productOf(pack, candidate.id)?.brands[0];
  if (brand === undefined || !name.toLowerCase().startsWith(brand.toLowerCase())) {
    return unitsHeld(name);
  }
  const after = name.charAt(brand.length);
  if (after !== ' ' && after !== ',') return unitsHeld(name);
  const rest = name.slice(brand.length).replace(/^[\s,]+/, '');
  return unitsHeld(rest === '' ? name : rest);
}
