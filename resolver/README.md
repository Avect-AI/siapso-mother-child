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

`plainText` lowercases, strips accents and turns every non-letter into a space: the text as written, used to sort names and to file them by first letter. `normalize` then applies to each word of two letters or more, in this order and on both sides of a match, the spelling variants that make a name written as it sounds read as the name it writes (live test round 2, SCRUM-51: "sitotek" for Cytotec, "huile de rissin" for castor oil, "kodeyin" for codeine, from a woman, a relay or the Wolof voice, which writes French names phonetically):

| Rule                                                                   | Example                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| `ph` becomes `f`                                                       | phenytoine, fenitoin                             |
| `ck` and `qu` become `k`                                               | cytoteck, cytotek; quinqueliba, kinkeliba        |
| `c` before `e`, `i`, `y` becomes `s`; any other `c` (not `ch`) is `k`  | Cytotec, sitotek; ricin, risin; codéine, kodéine |
| silent `h` dropped: at the start, and after a consonant but c, s, p, k | huile, uile; thé, té                             |
| `y` becomes `i`                                                        | nebeday, nebedai; kodeyin, kodeiin               |
| `ou` becomes `u` (the Wolof spelling)                                  | Nourofen, Nurofen                                |
| doubled letter becomes single, vowels included (not digits)            | doliprann, dolipran; rissin; kodeiin, kodein     |
| trailing `e` dropped (words over 4 chars), so `-que` reads as `-k`     | ibuprofene, ibuprofen; méfénamique, mefenamik    |
| `ch`, `sh`, `kh` kept; `kh` is NOT mapped to `x`                       | chloroquine; dakhar stays dakhar (meaning)       |
| a word of one letter kept as it is                                     | vitamine C stays "vitamin c"                     |

So "sitotek", "cytotek", "cytoteck" and "sitotec" are Cytotec itself (an `exact` match), "huile de rissin", "huille de rissin" and "uile de risin" are "huile de ricin", and "kodeyin" is codeine. Over the repository registry (1073 names), these variants make no two whole names of different families read alike; the words they newly read alike are spellings of one substance in French and English ("acétylsalicylique" and "acetylsalicylic", "ascorbique" and "ascorbic", "folique" and "folic", "valproïque" and "valproic", "vitaminée" and "vitamin") and "cola" with "kola", which the English names "Kola nut" and "Bitter kola" already shared.

The spellings of the standard Wolof orthography (`x` for the sound written `kh` in French spelling) are not produced by normalisation: they are registered as local names of the plant, next to the French-style spelling (`daxar` next to `dakhar`), so that each one is checked as a name. Long vowels written doubled (`ngeer`, `nebedaay`) now read as the single vowel.

## Stop-words

`STOP_WORDS` lists the words of pharmaceutical forms and packaging, in French and English (comprimé, pelliculé, sécable, effervescent, orodispersible, gélule, capsule, sirop, solution, suspension, buvable, poudre, sachet, granulés, crème, pommade, gel, collyre, suppositoire, injectable, ampoule, flacon, tablet, syrup, cream, ointment and the like, with their plurals), and the generic words that name no medicine or remedy (médicament, médicaments, médicamenteux, emplâtre, emplâtres, remède, plante, racine, écorce, graine, tisane, with their plurals and unaccented forms). They say nothing about which medicine it is, so `withoutStopWords` removes them, after normalisation (accents and case do not matter), from every indexed name and from the query. A query made only of stop-words ("sirop", "comprimé", "racine") gets no candidate, and "comprimé blanc" is matched as "blanc", which names nothing. A name made only of stop-words is not indexed.

Carrier words name nothing either: huile, feuille, mousse, infusion, décoction, jus (with their plurals), and "générique". With a linking word (de, d', du, des) left alone at either end removed, "huile de nim" is read as "nim" (neem), "huile de ricin" as "ricin" and "huile de coco" as "coco", which names nothing of the base; "Moussa" no longer reaches a foam. Box abbreviations of forms are stop-words too: cp, cpr, cpe, cps, comp, eff, effer, efferv, pell, pellic, séc, sécab, gél, gélu, sach, susp, sol, buv, pdre, supp, suppo, amp, inj, orodisp, LP.

The form words still choose between the forms of one product (an abbreviation read as the forms it stands for: "cpr eff" is "comprimé effervescent", "gél" a gel or a "gélule"): `formWords(text)` gives the normalised form words of a text, and a query's form words rank first the products whose French name has them ("Doliprane 1000 comprimé effervescent", "Neo-Codion sirop").

## Salt words

`SALT_WORDS` lists the salts and hydrates a box or a composition names next to the substance (sodium, sodique, potassique, chlorhydrate, hyclate, phosphate, sulfate, fumarate, maléate, succinate, gluconate, hémihydraté, anhydre and the like). `withoutStopWords` removes them too, with the "de", "d'" or "du" that links them to the substance: "valproate de sodium", "valproate sodium" and "sodium valproate" are read as "valproate", "chlorhydrate de tramadol" as "tramadol". A "de" between two other words stays ("noix de cola"). A salt word stays when it is a substance of the index (a substance named "Calcium") and when it is the whole query ("sodium" alone), so that it can still be found. Magnesium is a salt word ("valproate de magnésium").

## Age words

`AGE_WORDS` (adulte, enfant, nourrisson, adult, child, infant and their plurals) are not stop-words, but they carry no match weight: `splitAgeWords` takes them out of the name before scoring, in names and in queries, and a query made only of age words ("enfants") gets no candidate. A product keeps the age groups its names mention, and the groups `ageMarkersOf` reads in its names without removing them (NOUVEAU-NE for infants, PEDIATRIQUE for children). The age words of a brand do not make another family: DOLIPRANE ADULTES and ASPEGIC ENFANTS are variants of the DOLIPRANE and ASPEGIC families. When the query holds an age word, the variant of that age wins the ties within its family: "doliprane enfant" returns a children's Doliprane first if the registry has one (the other variants stay in `variants`), after a typed strength and without changing any score. When the query names no age, a product only for newborns or children ranks after the others at an equal score: "fer" proposes the iron generic before FER AP-HP NOUVEAU-NE, a maternal tool's likelier answer.

## Substances named in the query

The index knows every substance name (the INN names of the products, each name also split around its brackets: "Acide ascorbique (vitamine C)" names ascorbic acid as "acide ascorbique" and as "vitamine C"; these parts are not names of their own, since "sels ferreux" is a description). `namedSubstances(index, query)` gives the substances a query names, longest name first, the words that join a combination (et, avec, plus, and, with) aside. A candidate that lacks one of them ranks after every candidate that holds them all, whatever its score, and is kept only when its score is at least that of the best candidate that lacks none; the relative cutoff is taken from that best candidate: "efferalgan codéine" never ranks a paracetamol-only EFFERALGAN first. A query made only of substance names finds the products that hold them all, at 0.95 when they hold exactly those substances and 0.9 when they hold others too: "paracétamol codéine" proposes CODOLIPRANE and DAFALGAN CODEINE, "tramadol paracétamol" IXPRIM.

A brand named in the query implies its substances: the index knows every brand of the products (normalised, its age words aside) with the substances that every product of that brand holds ("ADVIL": ibuprofen; none for a brand whose products share none). A brand is found in the query as its words one after the other, the longest first ("ANTARENE CODEINE" before a brand of one word), and a brand without a word of 4 letters or more ("SP") only as the whole query. A candidate that lacks a substance a brand of the query implies ranks after the candidates that hold them all, exactly as for a substance named, and is kept on the same terms: "Advil codéine" proposes ANTARENE CODEINE (ibuprofen and codeine) first, then ADVIL and the codeine products (live test round 2, SCRUM-51, depot-keeper#1). The brand words stay words of the name: a query with a brand is never a query made only of substance names. `queryMentions(index, query)` gives the brands and substances a query names, in its order, each with the substances it stands for (`{ name: 'ADVIL', kind: 'brand', substances: ['ibuprofen'] }`), for the confirm screen ("ADVIL : ibuprofène, pas dans ce produit") and for the possible matches of a name kept as typed (one for each brand or substance the first one lacks).

## Scoring

The query is first cleaned of a strength (see below). For each name of an entry: the whole normalised name equal to the query, 1.0; the query equal to a whole word of a multi-word name, 0.95; the query a prefix of the whole name (at least 3 characters) or of one of the words of a multi-word name (at least 4 characters, so that "sel" does not reach a product through the start of a longer word), 0.9; otherwise `0.5 * jaccard(trigrams) + 0.5 * (1 - distance / max length)` with the Damerau-Levenshtein (optimal string alignment) distance. The same formula is applied to the query and name without spaces (words split or merged by a speech model) and to each word of a multi-word name (for a query of at least 4 characters), where it is capped at 0.85. A query of 1 or 2 characters matches only an exact whole name or a 2-letter whole word, scored 0.6 ("ne" does not reach "NOUVEAU-NE" through a prefix). Defaults: 3 candidates, minimum score 0.55 (`minScore`), and a relative cutoff of 0.8 (`relativeCutoff`): a candidate scoring below 0.8 times the best candidate's score is dropped, so a clear match is not followed by unrelated weak ones.

## A name contained in a longer text

A box or a sale says more than the name: "Advil 400 mg boîte de 20", "Advil pour les douleurs", "cytotec de la pharmacie", "aspirine du Rhône", "huile de ricin du marché". The whole name, its words one after the other, inside the cleaned query, whatever the words around it ("mon cytotec", "un advil", "huile de ricin bio", "cytotec x 4"), makes the name contained in it, scored 0.9, when the name has a word of 4 letters or more (digits aside): a short name ("fer", "nim") is never found inside another text. A name merged as it is said, carrier words included ("huiledericin"), is also compared with a query of one word.

## How a candidate matched

Every candidate says how its best name matched (`match`): `exact` (the whole name), `word` (a whole word of it), `prefix`, `near` (the whole name of 6 letters or more spelt within one edit: "cytotel", "misopristol"), `fuzzy` (a spelling close to the whole name), `fuzzy-word` (close to one word of a longer name, at most 0.85), `substances` (a query made only of substance names) or `contained`, and `queryLength`, the length of the cleaned query without spaces. A `word` match also says when the word alone names none of the products (`weakWord`): `shared` when the names of several families have it (a laboratory such as "biogaran", "gastro" of "gastro-résistant"), `inner` when it leads none of the names of the product, coming after its brand word (a qualifier such as "chrono" of "DEPAKINE CHRONO" or "emulgel" of "VOLTARENE EMULGEL", a word of a description such as "cutanée"); a word after only substance names or a prefix of 3 letters or fewer is the brand ("acnetrait" of "ISOTRETINOINE ACNETRAIT", "codion" of "Néo-Codion", "profenid" of "BI PROFENID LP"), each word of a substance name of several words names it ("méfénamique" of "Acide méfénamique", said alone; live test round 2, SCRUM-51), and the first word of a name in brackets leads it ("oseille" of "Bissap (oseille de Guinée)"); the score and the order stay the same. The resolver never decides with them; the app weighs a resemblance by them (a prefix of 4 letters such as a first name, a close word such as "vitamines" for "VITAMINEE C", or a weak word, is weak).

## Families and variants

Every entry has a `family`: the brand for a branded product, the sorted component substances for a generic or manual product, the id for a plant. A branded product is one whose French name starts with its first brand (every BDPM product, Néo-Codion). A generic may also list brands, the names people use for its substance (Coartem for artemether-lumefantrine, Fansidar for SP, Bactrim for co-trimoxazole): they are indexed as other names of the generic, which keeps its single entry at priority 2 and its family of substances, so an INN query still lists the generic first. `search` returns at most one candidate per family (the best one) and `limit` counts families, so the strengths of one brand never fill the list. When the query gives no strength, a product of the family without strength (the generic named by its substance only, such as `paracetamol-generic`) stands for the family, and its strengths (`paracetamol-500-generic`, `paracetamol-1000-generic`) are its variants. Otherwise, at equal ranks, the plainest French name of the family stands for it: "Dafalgan 500" gives "DAFALGAN 500 mg, comprimé" before its effervescent tablet and its capsule. `variants` lists the other product ids of the family, strength ascending, then French name (normalised, so the plainest form comes first), then id, the same order for every brand, for the confirm screen. Ranking: fewer substances named in the query and missing from the product, then score, then a matching strength, then the form words of the query, then a matching age word, then a product not only for children, then single-substance before combination products, then entry priority (brand products 3, generics and plants 2, INN-only matches 1), then (within a family) the French name, then id.

## Strength in the query

`parseStrength` reads a strength in the query ("1 g", "1000", "1000 mg", "0,5 g", "ibuprofene400"), converts it to mg and removes it from the name matching. A number glued to a letter counts only with a unit or 3 digits ("B9" stays part of the name). When a strength is given, the product whose component strength matches ranks first, and when the best family has a matching variant, that variant is the candidate. A product without a strength in mg matches the strength its French name writes: "aspegic 1000" gives ASPEGIC ADULTES 1000 mg, whose BDPM composition gives no strength per sachet.

`ResolverIndex.size` is the number of entries given to `buildIndex`; a branded product has two entries (its names, and its INN names), so it is not the number of products.

## Evaluation

See `eval/resolver/README.md`. Run `pnpm eval:resolver`.
