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
  names: { text: string; lang: NameLang }[];
  /** Higher first on ties: brand products 3, generic products 2, plants 2, INN-only matches 1. */
  priority: number;
  /** For display: substances and strengths, for example "paracétamol 1000 mg". */
  detail: string;
  /** Strengths of the components in mg, used to match a strength typed in the query. */
  strengths?: number[];
  /** Number of components (1 when absent): single-substance products rank before combinations. */
  componentCount?: number;
}

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
  /** The other product ids of the family, strength ascending then id, for the confirm screen. */
  variants: string[];
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
