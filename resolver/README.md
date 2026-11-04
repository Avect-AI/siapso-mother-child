<!-- SPDX-License-Identifier: MIT -->

# @siapso/resolver

Local name resolver of SIAPSO Mother-Child. It links a medicine or remedy name typed (or dictated) in French or Wolof, often misspelled, to the right product or plant of the knowledge pack. It only proposes candidates: the user confirms, and the engine decides the level. It never returns a level. No runtime dependency.

```ts
import { buildIndex, entriesFromPack, search } from '@siapso/resolver';

const index = buildIndex(entriesFromPack(pack));
search(index, 'doliprann'); // at most 3 candidates, best first
search(index, 'nebeday', { limit: 5, minScore: 0.6, kinds: ['plant'] });
```

## Normalisation

`normalize` lowercases, strips accents, turns every non-letter into a space, then applies to each word, on both sides of a match:

| Rule                                      | Example                       |
| ----------------------------------------- | ----------------------------- |
| `ph` becomes `f`                          | phenytoine, fenitoin          |
| `y` becomes `i`                           | nebeday, nebedai              |
| doubled consonant becomes single          | doliprann, dolipran           |
| trailing `e` dropped (words over 4 chars) | ibuprofene, ibuprofen         |
| `kh` is NOT mapped to `x`                 | dakhar stays dakhar (meaning) |

The spellings of the standard Wolof orthography (`x` for the sound written `kh` in French spelling, long vowels written doubled) are not produced by normalisation: they are registered as local names of the plant, next to the French-style spelling (`daxar` next to `dakhar`, `ngeer` next to `nguer`), so that each one is checked as a name.

## Stop-words

`STOP_WORDS` lists the words of pharmaceutical forms, packaging and age groups, in French and English (comprimé, pelliculé, sécable, effervescent, orodispersible, gélule, capsule, sirop, solution, suspension, buvable, poudre, sachet, granulés, crème, pommade, gel, collyre, suppositoire, injectable, ampoule, flacon, adultes, enfants, nourrissons, tablet, syrup, cream, ointment and the like, with their plurals). They say nothing about which medicine it is, so `withoutStopWords` removes them, after normalisation (accents and case do not matter), from every indexed name and from the query. A query made only of stop-words ("sirop", "comprimé") gets no candidate, and "comprimé blanc" is matched as "blanc", which names nothing. A name made only of stop-words is not indexed.

## Scoring

The query is first cleaned of a strength (see below). For each name of an entry: the whole normalised name equal to the query, 1.0; the query equal to a whole word of a multi-word name, 0.95; the query a prefix of a name or of one of its words (at least 3 characters), 0.9; otherwise `0.5 * jaccard(trigrams) + 0.5 * (1 - distance / max length)` with the Damerau-Levenshtein (optimal string alignment) distance. The same formula is applied to the query and name without spaces (words split or merged by a speech model) and to each word of a multi-word name, where it is capped at 0.85. A query of 1 or 2 characters matches only an exact whole name or a 2-letter whole word, scored 0.6 ("ne" does not reach "NOUVEAU-NE" through a prefix). Defaults: 3 candidates, minimum score 0.55 (`minScore`), and a relative cutoff of 0.8 (`relativeCutoff`): a candidate scoring below 0.8 times the best candidate's score is dropped, so a clear match is not followed by unrelated weak ones.

## Families and variants

Every entry has a `family`: the brand for a branded product, the sorted component substances for a generic or manual product, the id for a plant. A branded product is one whose French name starts with its first brand (every BDPM product, Néo-Codion). A generic may also list brands, the names people use for its substance (Coartem for artemether-lumefantrine, Fansidar for SP, Bactrim for co-trimoxazole): they are indexed as other names of the generic, which keeps its single entry at priority 2 and its family of substances, so an INN query still lists the generic first. `search` returns at most one candidate per family (the best one) and `limit` counts families, so the strengths of one brand never fill the list. When the query gives no strength, a product of the family without strength (the generic named by its substance only, such as `paracetamol-generic`) stands for the family, and its strengths (`paracetamol-500-generic`, `paracetamol-1000-generic`) are its variants. `variants` lists the other product ids of the family, strength ascending then id, for the confirm screen. Ranking: score, then a matching strength, then single-substance before combination products, then entry priority (brand products 3, generics and plants 2, INN-only matches 1), then id.

## Strength in the query

`parseStrength` reads a strength in the query ("1 g", "1000", "1000 mg", "0,5 g", "ibuprofene400"), converts it to mg and removes it from the name matching. A number glued to a letter counts only with a unit or 3 digits ("B9" stays part of the name). When a strength is given, the product whose component strength matches ranks first, and when the best family has a matching variant, that variant is the candidate.

`ResolverIndex.size` is the number of entries given to `buildIndex`; a branded product has two entries (its names, and its INN names), so it is not the number of products.

## Evaluation

See `eval/resolver/README.md`. Run `pnpm eval:resolver`.
