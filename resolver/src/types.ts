// SPDX-License-Identifier: MIT
export type EntryKind = 'product' | 'plant';
export type NameLang = 'fr' | 'en' | 'wo' | 'latin' | 'brand' | 'inn';

export interface IndexEntry {
  id: string;
  kind: EntryKind;
  /**
   * The group the confirm screen shows as one line: the brand for a branded
   * product, the sorted component substances for a generic or manual product,
   * the id for a plant. Entries of one product share the family of the product.
   */
  family: string;
  display: { fr: string; en: string };
  /** Each name with its language; an INN name also says which substance it names. */
  names: { text: string; lang: NameLang; substance?: string }[];
  /** Higher first on ties: brand products 3, generic products 2, plants 2, INN-only matches 1. */
  priority: number;
  /** For display: substances and strengths, for example "paracétamol 1000 mg". */
  detail: string;
  /** Strengths of the components in mg, used to match a strength typed in the query. */
  strengths?: number[];
  /** Number of components (1 when absent): single-substance products rank before combinations. */
  componentCount?: number;
  /**
   * The substance ids of a product, sorted, without repetition: a query that
   * names a substance ranks the products without it after the others.
   */
  substances?: string[];
}

/**
 * How a candidate's best name matched the query: the whole name (`exact`), a
 * whole word of it (`word`), its start (`prefix`), a spelling of the whole
 * name within one edit when it has 6 letters or more (`near`: "misopristol"), a
 * spelling close to the whole name (`fuzzy`) or to one of its words
 * (`fuzzy-word`), the substances
 * of a query made only of substance names (`substances`), or the name inside
 * a longer text (`contained`). A caller weighs a match by it (a short prefix
 * or a close word is a weak resemblance).
 */
export type MatchKind =
  'exact' | 'word' | 'prefix' | 'near' | 'fuzzy' | 'fuzzy-word' | 'substances' | 'contained';

/** Why a whole word of a name may name none of its products (see Candidate.weakWord). */
export type WeakWord = 'shared' | 'inner';

export interface Candidate {
  id: string;
  kind: EntryKind;
  family: string;
  display: { fr: string; en: string };
  detail: string;
  matched: string;
  matchedLang: NameLang;
  /** In [0, 1]. The resolver proposes names; it never returns a level. */
  score: number;
  /** How the best name matched (see MatchKind). */
  match: MatchKind;
  /**
   * For a `word` match, why the word alone may name none of the products:
   * `shared` when the names of several families have it (a laboratory,
   * "biogaran"), `inner` when it leads no name of the product, coming after
   * its brand word (a qualifier, "chrono" of "DEPAKINE CHRONO", "emulgel" of
   * "VOLTARENE EMULGEL"). A word of how a medicine is taken or of the
   * description of a form ("prise", "cutanée") is never matched alone at all
   * (descriptionWordsOf). A word after only substance names or a short
   * prefix is the brand ("acnetrait" of "ISOTRETINOINE ACNETRAIT", "codion" of
   * "Néo-Codion", "profenid" of "BI PROFENID LP"), each word of a substance
   * name of several words names it ("méfénamique" of "Acide méfénamique"), and
   * the first word of a name in brackets leads it ("oseille" of "Bissap
   * (oseille de Guinée)"). A caller
   * weighs such a match as a weak resemblance; the score and the order are
   * not changed.
   */
  weakWord?: WeakWord;
  /** The length of the cleaned query without spaces: a prefix of 4 letters is a weak match. */
  queryLength: number;
  /** The other product ids of the family, strength ascending then id, for the confirm screen. */
  variants: string[];
}

/**
 * A brand or a substance a query names (queryMentions), with the substances
 * it stands for: "Advil codéine" names the brand ADVIL (ibuprofen) and the
 * substance codeine.
 */
export interface Mention {
  /** As the pack writes it: a brand ("ADVIL") or a substance name ("Codéine"). */
  name: string;
  kind: 'brand' | 'substance';
  /** The substance ids it names, or that every product of the brand holds, sorted. */
  substances: string[];
}

export interface ResolverIndex {
  /** The number of entries given to buildIndex (a product can have two: names and INN). */
  readonly size: number;
}

export interface SearchOptions {
  /** Maximum number of candidates, counted in families (default 3). */
  limit?: number;
  /** Candidates below this score are dropped (default 0.55). */
  minScore?: number;
  /** Candidates below this share of the best candidate's score are dropped (default 0.8). */
  relativeCutoff?: number;
  kinds?: EntryKind[];
}
