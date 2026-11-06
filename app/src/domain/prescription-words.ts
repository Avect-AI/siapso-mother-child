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
 * Short names prescribers write for a combination, by the substances they
 * stand for: "SP" for sulfadoxine and pyrimethamine, "FAF" for iron and
 * folic acid. Read only in capitals, as a whole word, on a line that says
 * nothing else but a strength, a form or a posology ("1. SP", "TPI : SP",
 * "S.P", "FAF 1 cp/j"), and only as the generic product of exactly these
 * substances when the pack has one; never pre-ticked (a strong match).
 */
export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  SP: ['pyrimethamine', 'sulfadoxine'],
  FAF: ['folic-acid', 'iron'],
  ASAQ: ['amodiaquine', 'artesunate'],
  AL: ['artemether', 'lumefantrine'],
  CTX: ['sulfamethoxazole', 'trimethoprim'],
};

/**
 * Words of substance names that name no substance by themselves: "vitamine"
 * belongs to vitamin C's name in the base, yet "vitamine B9" is folic acid.
 * Normalised as the resolver reads words.
 */
export const QUALIFIER_SUBSTANCE_WORDS: ReadonlySet<string> = new Set(['vitamin', 'vitamine']);

/**
 * Words of product names that say which box of a brand, or who made it, and
 * never which medicine: a laboratory, a pharmacy, an age group, a strength
 * or release qualifier. A window of a line made only of them proposes
 * nothing ("Pédiatre" is not EFFERALGAN PEDIATRIQUE, "Pharmacie Guigon" not
 * DOXYCYCLINE PHARMACIE CENTRALE DES ARMEES). As written; the reading
 * compares them as the resolver reads words.
 */
export const QUALIFIER_WORDS: readonly string[] = [
  'pédiatrique',
  'pédiatriques',
  'pédiatre',
  'pédiatrie',
  'pharmacie',
  'pharmacien',
  'centrale',
  'armées',
  'forte',
  'fort',
  'lp',
  'enfant',
  'enfants',
  'nourrisson',
  'nourrissons',
  'adulte',
  'adultes',
  'bébé',
  'junior',
  'retard',
  'laboratoire',
  'laboratoires',
  'lab',
  'pharma',
  'biogaran',
  'arrow',
  'teva',
  'sandoz',
  'viatris',
  'zentiva',
  'mylan',
  'almus',
  'zydus',
  'upsa',
  'ratiopharm',
  'cristers',
];

/**
 * Words of the header, the patient line, the prescriber, the pharmacy and
 * the stamp (accents aside, lowercase): a line is read only up to the first
 * of them. As the OCR reads them too: a digit for a letter ("SENEGA1") or
 * one slip in a long word ("REPUBLIOUE") is still the word.
 */
export const HEADER_WORDS: readonly string[] = [
  'republique',
  'senegal',
  'peuple',
  'ministere',
  'region',
  'district',
  'sante',
  'service',
  'maternite',
  'cabinet',
  'clinique',
  'polyclinique',
  'hopital',
  'chu',
  'medecine',
  'medecin',
  'docteur',
  'dr',
  'icp',
  'infirmier',
  'infirmiere',
  'pediatre',
  'pediatrie',
  'gynecologue',
  'gynecologie',
  'obstetrique',
  'obstetricien',
  'pharmacie',
  'pharmacien',
  'pharmacienne',
  'prescripteur',
  'visa',
  'tel',
  'ordonnance',
  'nom',
  'prenom',
  'age',
  'terme',
  'date',
  'signature',
  'cachet',
  'patiente',
  'patient',
  'mme',
  'ans',
  'medicament',
  'medicaments',
  'posologie',
];

/** Header phrases of several words (accents aside, lowercase). */
export const HEADER_PHRASES: readonly string[] = [
  'sage femme',
  'poste de sante',
  'centre de sante',
];

/**
 * Places a prescription names in its header, its address or its date line
 * ("Dakar, le 06/11/2026", "BP 5035 Dakar Fann"): never a product, never a
 * remedy, even when the resolver hears a local name in one ("Dakar" sounds
 * like "dakhar", tamarind). The regions of Senegal and their capitals, the
 * districts of Dakar and the towns of the synthetic prescriptions, and the
 * capitals of the countries of use of the app. That last list is written
 * here by hand (the emergency numbers by country, SCRUM-55, are not on this
 * branch): keep it in line with them. No place may be a word of a name of
 * the base (a test checks it).
 */
export const PLACE_NAMES: readonly string[] = [
  // Regions of Senegal (each capital has the region's name).
  'Dakar',
  'Diourbel',
  'Fatick',
  'Kaffrine',
  'Kaolack',
  'Kédougou',
  'Kolda',
  'Louga',
  'Matam',
  'Saint-Louis',
  'Sédhiou',
  'Tambacounda',
  'Thiès',
  'Ziguinchor',
  // Districts and communes of Dakar.
  'Fann',
  'Point E',
  'Médina',
  'Mermoz',
  'Sacré-Coeur',
  'Ouakam',
  'Yoff',
  'Ngor',
  'Grand Yoff',
  'Parcelles Assainies',
  'HLM',
  'Sicap',
  'Pikine',
  'Guédiawaye',
  'Rufisque',
  'Keur Massar',
  'Thiaroye',
  'Colobane',
  'Gueule Tapée',
  'Almadies',
  'Dieuppeul',
  'Grand Dakar',
  'Biscuiterie',
  'Derklé',
  'Gorée',
  'Bargny',
  'Diamniadio',
  'Yeumbeul',
  // Towns and health districts of the synthetic prescriptions, and others.
  'Nioro du Rip',
  'Keur Madiabel',
  'Mbour',
  'Ngaparou',
  'Vélingara',
  'Kandia',
  'Kébémer',
  'Ndande',
  'Foundiougne',
  'Sokone',
  'Bambey',
  'Ngoye',
  'Podor',
  'Ndioum',
  'Koumpentoum',
  'Malem Niani',
  'Touba',
  'Tivaouane',
  'Mbacké',
  'Richard-Toll',
  'Joal',
  'Bignona',
  'Linguère',
  'Dagana',
  // Capitals (and main cities) of the countries of use.
  'Bamako',
  'Nouakchott',
  'Banjul',
  'Conakry',
  'Bissau',
  'Praia',
  'Yamoussoukro',
  'Abidjan',
  'Ouagadougou',
  'Niamey',
  'Lomé',
  'Porto-Novo',
  'Cotonou',
  'Accra',
  'Abuja',
  'Lagos',
  'Yaoundé',
  'Douala',
  "N'Djamena",
  'Bangui',
  'Libreville',
  'Brazzaville',
  'Kinshasa',
  'Antananarivo',
  'Rabat',
  'Casablanca',
  'Alger',
  'Tunis',
  'Paris',
];
