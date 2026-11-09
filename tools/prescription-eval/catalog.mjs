// SPDX-License-Identifier: MIT
// Content of the synthetic prescriptions (SCRUM-57 spike). No real patient
// data: patient names are random pairs of common first names and family
// names, places are district names used as layout props only, phone numbers
// are zeros. Never add a real prescription or a real person here.

/**
 * Products of the knowledge pack, written as a prescriber writes them. `product`
 * is a pack product id: a reading is right when it proposes a product with the
 * same substances. `strengthMg`: the strength the line gives (none: undefined).
 * `pos`: the posologies it may be given, each with the units per day it says
 * (undefined when it is not a daily count).
 */
export const IN_BASE = [
  {
    written: 'Fer + Acide folique cp',
    product: 'fer-acide-folique',
    pos: [
      ['1 cp/jour pendant 3 mois', 1],
      ['1 cp le matin QSP 3 mois', 1],
    ],
  },
  {
    written: 'Fer acide folique (FAF)',
    product: 'fer-acide-folique',
    pos: [["1 cp par jour jusqu'à l'accouchement", 1]],
  },
  {
    written: 'Fansidar cp',
    product: 'sp',
    pos: [["3 cp en prise unique (TPI) devant l'agent", 3]],
  },
  {
    written: 'SP (Sulfadoxine Pyriméthamine)',
    product: 'sp',
    pos: [['3 cp en une prise, TPI 2', 3]],
  },
  {
    written: 'Doliprane 1000 mg cp',
    product: 'doliprane-1000-mg-60234100',
    strengthMg: 1000,
    pos: [
      ['1 cp x 3/jour si douleur', 3],
      ['1 cp matin, midi et soir pendant 3 jours', 3],
    ],
  },
  {
    written: 'Doliprane 500 mg',
    product: 'doliprane-500-mg-63368332',
    strengthMg: 500,
    pos: [['2 cp x 3/j pendant 5 jours', 6]],
  },
  {
    written: 'Paracétamol 500 mg cp',
    product: 'paracetamol-500-generic',
    strengthMg: 500,
    pos: [
      ['1 cp x 3/j si fièvre', 3],
      ['2 cp matin et soir', 4],
    ],
  },
  {
    written: 'Efferalgan 1 g cp eff',
    product: 'efferalgan-1000-mg-67058605',
    strengthMg: 1000,
    pos: [["1 cp dans un verre d'eau x 3/j", 3]],
  },
  {
    written: 'Amoxicilline 500 mg gél',
    product: 'amoxicilline-almus-pharma-500-mg-68695334',
    strengthMg: 500,
    pos: [['2 gél x 3/j pendant 7 jours', 6]],
  },
  {
    written: 'Clamoxyl 1 g',
    product: 'clamoxyl-1-g-64539416',
    strengthMg: 1000,
    pos: [['1 cp matin et soir x 7 jours', 2]],
  },
  {
    written: 'Flagyl 500 mg cp',
    product: 'flagyl-500-mg-61659061',
    strengthMg: 500,
    pos: [['1 cp x 2/j pendant 7 jours', 2]],
  },
  {
    written: 'Métronidazole 250 mg',
    product: 'metronidazole-generic',
    strengthMg: 250,
    pos: [['2 cp x 3/j pendant 7 jours', 6]],
  },
  {
    written: 'Coartem 20/120 mg',
    product: 'artemether-lumefantrine-generic',
    pos: [['4 cp x 2/j pendant 3 jours', 8]],
  },
  {
    written: 'ASAQ (Artésunate + Amodiaquine)',
    product: 'asaq',
    pos: [['2 cp/j pendant 3 jours', 2]],
  },
  {
    written: 'Bactrim Forte cp',
    product: 'bactrim-forte-64121235',
    pos: [['1 cp par jour (prophylaxie)', 1]],
  },
  {
    written: 'Cotrimoxazole 960 mg',
    product: 'cotrimoxazole-generic',
    strengthMg: 960,
    pos: [['1 cp/j', 1]],
  },
  {
    written: 'Laroscorbine 1 g',
    product: 'laroscorbine-1-g-69435752',
    strengthMg: 1000,
    pos: [['1 cp effervescent le matin x 10 jours', 1]],
  },
  {
    written: 'Tardyféron B9',
    product: 'tardyferon-b9-64875192',
    pos: [['1 cp/jour QSP 1 mois', 1]],
  },
  {
    written: 'Fumafer 66 mg',
    product: 'fumafer-66-mg-64404201',
    strengthMg: 66,
    pos: [['1 cp x 2/j au milieu du repas', 2]],
  },
  {
    written: 'Spéciafoldine 5 mg',
    product: 'speciafoldine-5-mg-69630186',
    strengthMg: 5,
    pos: [['1 cp/j pendant 1 mois', 1]],
  },
  {
    written: 'Acide folique 5 mg',
    product: 'acide-folique-ccd-5-mg-69448600',
    strengthMg: 5,
    pos: [['1 cp le soir', 1]],
  },
  {
    written: 'Advil 400 mg',
    product: 'advil-400-mg-63646874',
    strengthMg: 400,
    pos: [['1 cp x 3/j après le repas', 3]],
  },
  {
    written: 'Brufen 400',
    product: 'ibuprofen-generic',
    strengthMg: 400,
    pos: [['1 cp matin et soir pendant 5 jours', 2]],
  },
  {
    written: 'Ibuprofène 400 mg',
    product: 'ibuprofen-generic',
    strengthMg: 400,
    pos: [['1 cp x 2/j si douleur', 2]],
  },
  {
    written: 'Voltarène 50 mg',
    product: 'voltarene-50-mg-62431527',
    strengthMg: 50,
    pos: [['1 cp x 2/j pendant 5 jours', 2]],
  },
  {
    written: 'Ponstan 500 mg',
    product: 'mefenamic-acid-generic',
    strengthMg: 500,
    pos: [['1 cp x 3/j pendant les règles', 3]],
  },
  {
    written: 'Nivaquine 100 mg',
    product: 'chloroquine-generic',
    strengthMg: 100,
    pos: [['2 cp par semaine', undefined]],
  },
  {
    written: 'Quinine 300 mg cp',
    product: 'quinine-generic',
    strengthMg: 300,
    pos: [['2 cp x 3/j pendant 7 jours', 6]],
  },
  {
    written: 'Aspégic 500',
    product: 'aspegic-500-mg-61162942',
    strengthMg: 500,
    pos: [['1 sachet x 3/j', 3]],
  },
  {
    written: 'Kardégic 75 mg',
    product: 'kardegic-75-mg-64755969',
    strengthMg: 75,
    pos: [['1 sachet le midi', 1]],
  },
  { written: 'Néo-Codion sirop', product: 'neo-codion-syrup', pos: [['1 c. à soupe x 3/j', 3]] },
  {
    written: 'Tramadol 50 mg gél',
    product: 'tramadol-generic',
    strengthMg: 50,
    pos: [['1 gél x 2/j si douleur forte', 2]],
  },
  {
    written: 'Doxycycline 100 mg',
    product: 'doxycycline-generic',
    strengthMg: 100,
    pos: [['1 cp/j pendant 10 jours', 1]],
  },
  { written: 'Cytotec 200 µg', product: 'misoprostol-generic', pos: [['1 cp le soir', 1]] },
  {
    written: 'Fluconazole 150 mg gél',
    product: 'fluconazole-arrow-lab-150-mg-67860651',
    strengthMg: 150,
    pos: [['1 gél en prise unique', 1]],
  },
  {
    written: 'Captopril 25 mg',
    product: 'captopril-biogaran-25-mg-64801263',
    strengthMg: 25,
    pos: [['1 cp x 2/j', 2]],
  },
  {
    written: 'Codoliprane cp',
    product: 'codoliprane-500-mg-30-mg-60904643',
    pos: [['1 cp x 3/j si douleur', 3]],
  },
  {
    written: 'Tégrétol 200 mg',
    product: 'tegretol-200-mg-61009918',
    strengthMg: 200,
    pos: [['1 cp matin et soir, ne pas arrêter', 2]],
  },
  {
    written: 'Dépakine 500 mg',
    product: 'depakine-500-mg-60184188',
    strengthMg: 500,
    pos: [['1 cp x 2/j', 2]],
  },
];

/**
 * Common on antenatal and general prescriptions in Senegal, absent from the
 * pack: a right reading proposes no product of the base for them, and keeps
 * the line so that it can be added as typed.
 */
export const OUT_OF_BASE = [
  { written: 'Spasfon Lyoc 80 mg', pos: ['1 lyoc x 3/j si douleur'] },
  { written: 'Mébendazole 500 mg', pos: ['1 cp en prise unique'] },
  { written: 'Albendazole 400 mg', pos: ['1 cp en prise unique au 2e trimestre'] },
  { written: 'Magné B6 cp', pos: ['2 cp matin et soir'] },
  { written: 'Calcium 500 mg', pos: ['1 cp/j au repas'] },
  { written: 'Gaviscon suspension', pos: ['1 sachet après les repas'] },
  { written: 'Primpéran 10 mg', pos: ['1 cp avant les repas'] },
  { written: 'Duphaston 10 mg', pos: ['1 cp x 2/j pendant 10 jours'] },
  { written: 'Aldomet 250 mg', pos: ['1 cp x 3/j'] },
  { written: 'Adalate LP 20 mg', pos: ['1 cp matin et soir'] },
  { written: 'Augmentin 1 g', pos: ['1 cp x 2/j pendant 8 jours'] },
  { written: 'Oméprazole 20 mg', pos: ['1 gél le matin à jeun'] },
  { written: 'Smecta sachet', pos: ['1 sachet x 3/j'] },
  { written: 'Vogalène 7,5 mg', pos: ['1 lyoc avant les repas'] },
  { written: 'Polygynax ovule', pos: ['1 ovule le soir pendant 6 jours'] },
  { written: 'Céfixime 200 mg', pos: ['1 cp x 2/j pendant 5 jours'] },
  { written: 'Moustiquaire imprégnée (MILDA)', pos: ['dormir sous moustiquaire'] },
  { written: 'Vitamine B complexe', pos: ['1 cp/j'] },
];

export const FIRST = [
  'Fatou',
  'Awa',
  'Aminata',
  'Mariama',
  'Khady',
  'Coumba',
  'Ndèye',
  'Astou',
  'Bineta',
  'Rokhaya',
  'Seynabou',
  'Adja',
  'Dieynaba',
  'Penda',
  'Yacine',
  'Maimouna',
];
export const LAST = [
  'Ndiaye',
  'Diop',
  'Fall',
  'Sow',
  'Ba',
  'Sarr',
  'Gueye',
  'Faye',
  'Diallo',
  'Mbaye',
  'Ndao',
  'Cissé',
  'Thiam',
  'Seck',
  'Kane',
  'Niang',
];
export const PRESCRIBER = [
  'Dr Moussa Diop',
  'Dr Ibrahima Fall',
  "Mme Aminata Sarr, sage-femme d'État",
  'M. Cheikh Ndao, ICP',
  'Dr Oumar Ba',
  'Mme Ndèye Gueye, sage-femme',
];
export const PLACES = [
  ['Kaolack', 'Nioro du Rip', 'Keur Madiabel'],
  ['Thiès', 'Mbour', 'Ngaparou'],
  ['Kolda', 'Vélingara', 'Kandia'],
  ['Louga', 'Kébémer', 'Ndande'],
  ['Fatick', 'Foundiougne', 'Sokone'],
  ['Diourbel', 'Bambey', 'Ngoye'],
  ['Saint-Louis', 'Podor', 'Ndioum'],
  ['Tambacounda', 'Koumpentoum', 'Malem Niani'],
];
export const CABINETS = [
  'Cabinet médical Al Amine',
  'Clinique de la Paix',
  'Cabinet médical Keur Yaay',
  'Cabinet Sopé Nabi',
  'Clinique Baobab',
];

/** A small seeded generator (mulberry32): the same seed gives the same prescription. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** One element of the list, drawn with the generator. */
export const pick = (r, list) => list[Math.floor(r() * list.length)];
