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
 * The name on the box a product was found by (`matched`, "Brufen" for
 * "Ibuprofène (générique)"), so the confirm screen still says what she holds;
 * undefined when `matched` is not a brand of the product, or when the name
 * shown already says it.
 */
export function boxNameOf(
  pack: Pack,
  ref: { kind: 'product' | 'plant'; id: string },
  matched: string,
  lang: Lang,
): string | undefined {
  if (ref.kind !== 'product') return undefined;
  const key = normalize(matched);
  const brand = productOf(pack, ref.id)?.brands.find((name) => normalize(name) === key);
  if (brand === undefined || key === '') return undefined;
  return normalize(displayOf(pack, ref, lang).name).includes(key) ? undefined : brand;
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

export interface BrowseEntry {
  kind: 'product' | 'plant';
  /** The product the confirm screen opens on (a family's plain product), or the plant. */
  id: string;
  name: string;
  detail: string | undefined;
  /** The local names, by language, in the order the pack gives them. */
  local: { lang: LocalName['lang']; names: string[] }[];
  /**
   * For a name on the box of a generic listed on its own ("Cytotec"), the
   * name of the generic it opens ("Misoprostol (générique)").
   */
  brandOf?: string;
}

/** Local names grouped by language, in the order the pack gives them. */
function localGroups(names: readonly LocalName[]): BrowseEntry['local'] {
  const groups: BrowseEntry['local'] = [];
  for (const { text, lang } of names) {
    const group = groups.find((candidate) => candidate.lang === lang);
    if (group === undefined) groups.push({ lang, names: [text] });
    else if (!group.names.includes(text)) group.names.push(text);
  }
  return groups;
}

/**
 * The names on the box of a family that its name does not already say: the
 * brands people use for a generic ("Cytotec" for "Misoprostol (générique)"),
 * each once, in the order the pack gives them. Never a brand family's own
 * brand (DOLIPRANE).
 */
function boxNamesOf(products: readonly Product[], name: string): string[] {
  const shown = normalize(name);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const brand of products.flatMap((product) => product.brands)) {
    const key = normalize(brand);
    if (key === '' || shown.startsWith(key) || seen.has(key)) continue;
    seen.add(key);
    names.push(brand);
  }
  return names;
}

/**
 * Every remedy, or every medicine family once, by its name in the language,
 * in alphabetical order: the list to choose from when a name said or typed
 * finds nothing. A family is named as the search names it when no strength
 * is typed, and opens on its plain product, so the confirm screen asks the
 * strength: none is chosen for her. A name on the box of a generic (Cytotec,
 * Brufen, Nivaquine) is an entry of its own, in its letter, that opens the
 * generic (`brandOf`): a woman holding the box finds it by what she reads.
 */
export function browseEntriesOf(pack: Pack, kind: 'product' | 'plant', lang: Lang): BrowseEntry[] {
  const collator = new Intl.Collator(lang, { sensitivity: 'base' });
  let entries: BrowseEntry[];
  if (kind === 'plant') {
    entries = pack.plants.map((plant) => ({
      kind: 'plant',
      id: plant.id,
      name: plant.names[lang],
      detail: plant.latinName,
      local: localGroups(plant.localNames),
    }));
  } else {
    entries = [...indexedOf(pack).members.values()].flatMap((ids) => {
      const products = ids
        .map((id) => productOf(pack, id))
        .filter((product): product is Product => product !== undefined);
      const plain = products.find(hasNoStrength) ?? products[0];
      if (plain === undefined) return [];
      const shown =
        products.length > 1
          ? familyDisplayOf(pack, plain, lang)
          : displayOf(pack, { kind: 'product', id: plain.id }, lang);
      const family: BrowseEntry = {
        kind: 'product',
        id: plain.id,
        name: shown.name,
        detail: shown.detail,
        local: localGroups(products.flatMap((product) => product.localNames)),
      };
      const boxNames = boxNamesOf(products, shown.name).map((brand): BrowseEntry => ({
        kind: 'product',
        id: plain.id,
        name: brand,
        detail: shown.detail,
        local: [],
        brandOf: shown.name,
      }));
      return [family, ...boxNames];
    });
  }
  return entries.sort((a, b) => collator.compare(a.name, b.name) || compareText(a.id, b.id));
}

/**
 * The entries whose name, the generic a box name opens, or a local name holds
 * `text`, as the resolver reads names (case and accents aside), in their
 * order; every entry for a text with nothing to look for.
 */
export function filterBrowseEntries(entries: readonly BrowseEntry[], text: string): BrowseEntry[] {
  const wanted = normalize(text);
  if (wanted === '') return [...entries];
  return entries.filter((entry) =>
    [entry.name, entry.brandOf ?? '', ...entry.local.flatMap((local) => local.names)].some((name) =>
      normalize(name).includes(wanted),
    ),
  );
}

/**
 * The list cut by first letter (accents aside; a digit or a sign under "#"),
 * so a long list can be gone through by its letters, and by heading with a
 * screen reader. Keeps the order it is given.
 */
export function browseGroupsOf(
  entries: readonly BrowseEntry[],
): { letter: string; entries: BrowseEntry[] }[] {
  const groups: { letter: string; entries: BrowseEntry[] }[] = [];
  for (const entry of entries) {
    const first = normalize(entry.name).charAt(0).toUpperCase();
    const letter = /^[A-Z]$/.test(first) ? first : '#';
    const group = groups.find((candidate) => candidate.letter === letter);
    if (group === undefined) groups.push({ letter, entries: [entry] });
    else group.entries.push(entry);
  }
  return groups.sort((a, b) =>
    a.letter === '#' ? -1 : b.letter === '#' ? 1 : compareText(a.letter, b.letter),
  );
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
  /**
   * The options with the strength typed in the query, in the order of
   * `options` (the candidate among them); empty when no strength is typed. A
   * long list shows them first, the others one tap away: the strength she
   * read on the box stays in view with "yes".
   */
  matching: string[];
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
  const hasTyped = (p: Product) =>
    typed !== undefined &&
    p.components.some((c) => c.strengthMg !== undefined && Math.abs(c.strengthMg - typed) < 1e-6);
  const matching = options.filter((id) => {
    const option = members.find((p) => p.id === id);
    return option !== undefined && hasTyped(option);
  });
  let preselected: StrengthChoice['preselected'] = null;
  if (hasTyped(product)) {
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
  return { options, preselected, matching };
}

/** Two strengths in mg the same, whatever the rounding of a decimal. */
function sameMg(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/**
 * The strength typed in the query, in mg, when no box of the candidate's
 * family is known at it ("clamoxyl 3g"): neither a component of that strength
 * nor that strength in its name (a syrup's "125 mg/5 ml" holds no strength in
 * mg). Undefined when none is typed, when a box has it, or for a remedy. The
 * confirm screen then says so and asks: the number is never dropped silently.
 */
export function strengthNotFoundOf(
  pack: Pack,
  candidate: ConfirmCandidate,
  query: string,
): number | undefined {
  const typed = parseStrength(query).strengthMg;
  if (typed === undefined || candidate.kind !== 'product') return undefined;
  const members = [candidate.id, ...candidate.variants]
    .map((id) => productOf(pack, id))
    .filter((p): p is Product => p !== undefined);
  const known = members.some(
    (p) =>
      p.components.some((c) => c.strengthMg !== undefined && sameMg(c.strengthMg, typed)) ||
      [p.names.fr, p.names.en].some((name) => {
        const named = parseStrength(name).strengthMg;
        return named !== undefined && sameMg(named, typed);
      }),
  );
  return known ? undefined : typed;
}

/**
 * The dose question of a box the pack has no strength for, which a strength
 * threshold reads (generic aspirin, SCRUM-56): the threshold in mg, asked as
 * "100 mg ou moins / Plus de 100 mg / Je ne sais pas" (CheckedItem.strengthAtMostMg).
 * Undefined for a remedy, a box whose components all have a strength or more
 * than one has none, a substance no threshold reads, or a family with a box
 * at or below the threshold (the strength question offers that box). The
 * lowest threshold of the substance: at most it keeps every threshold rule
 * off, and above it reads as not known, which every one of them reads.
 */
export function doseRangeOf(
  pack: Pack,
  candidate: ConfirmCandidate,
  productId: string,
): number | undefined {
  const product = candidate.kind === 'product' ? productOf(pack, productId) : undefined;
  const unknown = product?.components.filter((c) => c.strengthMg === undefined) ?? [];
  const [only] = unknown;
  if (only === undefined || unknown.length > 1) return undefined;
  const thresholds = pack.rules.flatMap(({ when: { subject, strengthAboveMg } }) =>
    strengthAboveMg !== undefined &&
    subject !== undefined &&
    'substance' in subject &&
    subject.substance === only.substance
      ? [strengthAboveMg]
      : [],
  );
  if (thresholds.length === 0) return undefined;
  const threshold = Math.min(...thresholds);
  const offered = [candidate.id, ...candidate.variants].some((id) =>
    productOf(pack, id)?.components.some(
      (c) =>
        c.substance === only.substance && c.strengthMg !== undefined && c.strengthMg <= threshold,
    ),
  );
  return offered ? undefined : threshold;
}

/** A strength in mg as the language writes it ("3000 mg", "0,4 mg"). */
export function strengthText(mg: number, lang: Lang): string {
  return milligrams(mg, lang);
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
    return unitsHeld(readable(name));
  }
  const after = name.charAt(brand.length);
  if (after !== ' ' && after !== ',') return unitsHeld(readable(name));
  const rest = name.slice(brand.length).replace(/^[\s,]+/, '');
  return unitsHeld(rest === '' ? name : readable(rest));
}

/** A word of capitals (hyphens joining them), as the database writes words. */
const CAPITALS = /(?<![\p{L}\d])\p{Lu}+(?:-\p{Lu}+)*(?![\p{L}\d])/gu;

/**
 * What follows the brand in an answer, as a woman reads it: "POUR CENT" as
 * "%", and a word the database writes in capitals in small letters ("ADULTES
 * 1000 mg, suppositoire" reads "adultes 1000 mg, suppositoire"). Capitals of
 * one or two letters are signs, not words ("LP", "UI"): they are kept.
 */
function readable(text: string): string {
  return text
    .replace(/(\d)\s*pour\s+cent(?![\p{L}\d])/giu, '$1 %')
    .replace(CAPITALS, (word) =>
      word.replace(/-/g, '').length >= 3 ? word.toLocaleLowerCase('fr') : word,
    );
}

/**
 * What the strength question asks, from its answers (without "I do not
 * know"): the strength when each answer has a number ("500 mg, comprimé"),
 * the form when none has ("comprimé enrobé", "sirop": Néo-Codion), both when
 * some have one and some do not.
 */
export function strengthQuestionOf(labels: readonly string[]): 'strength' | 'form' | 'both' {
  const withNumber = labels.filter((label) => /\d/.test(label)).length;
  if (withNumber === labels.length) return 'strength';
  return withNumber === 0 ? 'form' : 'both';
}
