// SPDX-License-Identifier: MIT

export interface Region {
  /** Stable ASCII id used in events and in the published CSV. */
  id: string;
  /** Official name, kept for display and for the field dictionary. */
  name: string;
}

/** The 14 regions of Senegal, in alphabetical order of the official name. */
export const REGIONS: readonly Region[] = [
  { id: 'dakar', name: 'Dakar' },
  { id: 'diourbel', name: 'Diourbel' },
  { id: 'fatick', name: 'Fatick' },
  { id: 'kaffrine', name: 'Kaffrine' },
  { id: 'kaolack', name: 'Kaolack' },
  { id: 'kedougou', name: 'Kédougou' },
  { id: 'kolda', name: 'Kolda' },
  { id: 'louga', name: 'Louga' },
  { id: 'matam', name: 'Matam' },
  { id: 'saint-louis', name: 'Saint-Louis' },
  { id: 'sedhiou', name: 'Sédhiou' },
  { id: 'tambacounda', name: 'Tambacounda' },
  { id: 'thies', name: 'Thiès' },
  { id: 'ziguinchor', name: 'Ziguinchor' },
];

export const REGION_IDS: readonly string[] = REGIONS.map((region) => region.id);
