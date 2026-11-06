// SPDX-License-Identifier: MIT
// The words the reading of a prescription knows besides the names of the
// base (prescription-reading.ts): the short ways prescribers write a
// substance or a combination. Each list says where it may be used: an
// abbreviation never proposes a product by itself, it only says that a line
// names more than the product read (a combination read in part).

/**
 * A short word for one or more substances (substance ids of the pack), as
 * prescribers write them in a combination: "Paracétamol + Cod", "Fer + AF",
 * "TDF/3TC/DTG". `upper`: only as written in capitals ("AS" is artesunate,
 * "as" is no word of a prescription). Read only for a substance that a
 * combination of the pack would add to what the line already names, so it
 * never brings in a substance the pack does not hold.
 */
export interface Abbreviation {
  substances: readonly string[];
  upper?: boolean;
}

/** By the word in lowercase, accents aside ("codé" is "code", "Art." is "art"). */
export const ABBREVIATIONS: Readonly<Record<string, Abbreviation>> = {
  cod: { substances: ['codeine'] },
  code: { substances: ['codeine'] },
  as: { substances: ['artesunate'], upper: true },
  art: { substances: ['artesunate'] },
  aq: { substances: ['amodiaquine'], upper: true },
  af: { substances: ['folic-acid'], upper: true },
  b9: { substances: ['folic-acid'] },
  smx: { substances: ['sulfamethoxazole'] },
  sulfa: { substances: ['sulfamethoxazole'] },
  tmp: { substances: ['trimethoprim'] },
  ctx: { substances: ['sulfamethoxazole', 'trimethoprim'] },
  al: { substances: ['artemether', 'lumefantrine'], upper: true },
  tram: { substances: ['tramadol'] },
  '3tc': { substances: ['lamivudine'] },
  tdf: { substances: ['tenofovir'] },
  dtg: { substances: ['dolutegravir'] },
  efv: { substances: ['efavirenz'] },
};

/**
 * Words of substance names that name no substance by themselves: "vitamine"
 * belongs to vitamin C's name in the base, yet "vitamine B9" is folic acid.
 * Normalised as the resolver reads words.
 */
export const QUALIFIER_SUBSTANCE_WORDS: ReadonlySet<string> = new Set(['vitamin', 'vitamine']);
