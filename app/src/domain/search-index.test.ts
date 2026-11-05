// SPDX-License-Identifier: MIT
import type { Pack, Rule } from '@siapso/engine';
import { search } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import {
  candidateDisplayOf,
  candidateOf,
  displayOf,
  localNameOf,
  missingSubstancesOf,
  needsUnitsPerDay,
  productFamilyOf,
  searchIndexOf,
  strengthChoiceOf,
  strengthOptionLabel,
  substancesWithMaxDose,
  writtenNameOf,
} from './search-index.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

function first(query: string, kind: 'product' | 'plant') {
  const [candidate] = search(searchIndexOf(pack), query, { kinds: [kind] });
  if (!candidate) throw new Error(`no candidate for ${query}`);
  return candidate;
}

describe('searchIndexOf', () => {
  it('builds the index of a pack once', () => {
    expect(searchIndexOf(pack)).toBe(searchIndexOf(pack));
    expect(searchIndexOf(pack).size).toBeGreaterThan(pack.products.length);
  });

  it('finds Moringa first from its Wolof name, and Doliprane misspelled', () => {
    expect(first('nebeday', 'plant').id).toBe('moringa');
    expect(first('doliprann', 'product').id).toMatch(/^doliprane-/);
  });
});

describe('substancesWithMaxDose', () => {
  it('lists the substances of the max-dose rules of the pack', () => {
    const substances = substancesWithMaxDose(pack);
    expect(substances.has('paracetamol')).toBe(true);
    expect(substances.has('ibuprofen')).toBe(false);
  });

  it('reads a class subject as every substance of the class but its exclusions', () => {
    const rule = {
      id: 'nsaid-max',
      kind: 'max-dose',
      when: { subject: { class: 'nsaid' }, maxMgPerDay: 1200 },
    } as Rule;
    const withClassRule: Pack = { ...pack, rules: [...pack.rules, rule] };
    const substances = substancesWithMaxDose(withClassRule);
    expect(substances.has('ibuprofen')).toBe(true);
    expect(substances.has('paracetamol')).toBe(true);
    const excluded = {
      ...withClassRule,
      classes: withClassRule.classes.map((c) =>
        c.id === 'nsaid' ? { ...c, excludes: ['ibuprofen'] } : c,
      ),
    };
    expect(substancesWithMaxDose(excluded).has('ibuprofen')).toBe(false);
  });
});

describe('needsUnitsPerDay', () => {
  it('asks for units only for a product holding a max-dose substance', () => {
    expect(needsUnitsPerDay(pack, { kind: 'product', id: 'paracetamol-generic' })).toBe(true);
    expect(needsUnitsPerDay(pack, { kind: 'product', id: 'doliprane-1000-mg-60234100' })).toBe(
      true,
    );
    expect(needsUnitsPerDay(pack, { kind: 'product', id: 'ibuprofen-generic' })).toBe(false);
    expect(needsUnitsPerDay(pack, { kind: 'plant', id: 'moringa' })).toBe(false);
    expect(needsUnitsPerDay(pack, { kind: 'unrecognised', text: 'doliprane' })).toBe(false);
    expect(needsUnitsPerDay(pack, { kind: 'product', id: 'not-in-the-pack' })).toBe(false);
  });
});

describe('displayOf', () => {
  it('names a product in the interface language, with its substances and strengths', () => {
    // The strength keeps to its unit with a no-break space.
    expect(displayOf(pack, { kind: 'product', id: 'paracetamol-500-generic' }, 'fr')).toEqual({
      name: 'Paracétamol 500 mg (générique)',
      detail: 'Paracétamol 500 mg',
    });
    expect(displayOf(pack, { kind: 'product', id: 'paracetamol-500-generic' }, 'en')).toEqual({
      name: 'Paracetamol 500 mg (generic)',
      detail: 'Paracetamol 500 mg',
    });
    expect(
      displayOf(pack, { kind: 'product', id: 'codoliprane-500-mg-30-mg-60904643' }, 'fr').detail,
    ).toBe('Paracétamol 500 mg, Codéine 30 mg');
  });

  it('gives a plant its Latin name as detail', () => {
    expect(displayOf(pack, { kind: 'plant', id: 'moringa' }, 'en')).toEqual({
      name: 'Moringa',
      detail: 'Moringa oleifera',
    });
  });

  it('keeps the text of an unrecognised item, and the id of an item the pack lost', () => {
    expect(displayOf(pack, { kind: 'unrecognised', text: 'poudre du marché' }, 'fr')).toEqual({
      name: 'poudre du marché',
      detail: undefined,
    });
    expect(displayOf(pack, { kind: 'plant', id: 'gone' }, 'fr')).toEqual({
      name: 'gone',
      detail: undefined,
    });
  });

  it('writes a decimal strength the way the language does, never grouping digits', () => {
    const decimal: Pack = {
      ...pack,
      products: [
        {
          id: 'demo',
          names: { fr: 'Démo', en: 'Demo' },
          brands: [],
          localNames: [],
          components: [
            { substance: 'paracetamol', strengthMg: 0.5 },
            { substance: 'codeine', strengthMg: 1000 },
          ],
          form: 'comprimé',
          route: 'oral',
          demo: true,
        },
      ],
    };
    expect(displayOf(decimal, { kind: 'product', id: 'demo' }, 'fr').detail).toBe(
      'Paracétamol 0,5 mg, Codéine 1000 mg',
    );
    expect(displayOf(decimal, { kind: 'product', id: 'demo' }, 'en').detail).toBe(
      'Paracetamol 0.5 mg, Codeine 1000 mg',
    );
  });
});

describe('strengthOptionLabel', () => {
  it('says the brand once: each answer starts with what differs', () => {
    const candidate = first('doliprane', 'product');
    expect(strengthOptionLabel(pack, candidate, 'doliprane-1000-mg-60234100', 'fr')).toBe(
      '1000 mg, comprimé',
    );
    expect(strengthOptionLabel(pack, candidate, 'doliprane-2-4-pour-cent-66477582', 'fr')).toBe(
      '2,4 POUR CENT, suspension buvable',
    );
  });
});

describe('localNameOf', () => {
  it('finds the local name a match came from, with its language', () => {
    expect(localNameOf(pack, { kind: 'plant', id: 'moringa' }, 'nebeday')).toMatchObject({
      text: 'nebeday',
      lang: 'wo',
    });
  });

  it('says nothing for a match on the name itself', () => {
    expect(localNameOf(pack, { kind: 'plant', id: 'moringa' }, 'Moringa')).toBeUndefined();
    expect(
      localNameOf(pack, { kind: 'product', id: 'paracetamol-generic' }, 'Paracétamol'),
    ).toBeUndefined();
  });
});

describe('candidateOf', () => {
  it('gives a product the other products of its family, as the resolver does', () => {
    const found = first('doliprane', 'product');
    const known = candidateOf(pack, { kind: 'product', id: found.id });
    expect(known).toEqual({
      id: found.id,
      kind: 'product',
      family: found.family,
      variants: found.variants,
    });
  });

  it('gives a plant no variant, and an id missing from the pack nothing', () => {
    expect(candidateOf(pack, { kind: 'plant', id: 'moringa' })).toEqual({
      id: 'moringa',
      kind: 'plant',
      family: 'moringa',
      variants: [],
    });
    expect(candidateOf(pack, { kind: 'product', id: 'gone' })).toBeUndefined();
    expect(candidateOf(pack, { kind: 'plant', id: 'gone' })).toBeUndefined();
  });
});

describe('candidateDisplayOf', () => {
  it('names a brand by the brand alone, with its substances, until a strength is chosen', () => {
    expect(candidateDisplayOf(pack, first('doliprane', 'product'), 'doliprane', 'fr')).toEqual({
      name: 'DOLIPRANE',
      detail: 'Paracétamol',
    });
  });

  it('names the product itself when its strength is typed, or when it has no other', () => {
    const typed = first('doliprane 1000', 'product');
    expect(candidateDisplayOf(pack, typed, 'doliprane 1000', 'fr')).toEqual(
      displayOf(pack, { kind: 'product', id: typed.id }, 'fr'),
    );
    expect(candidateDisplayOf(pack, first('paracetamol', 'product'), 'paracetamol', 'en')).toEqual({
      name: 'Paracetamol (generic)',
      detail: 'Paracetamol',
    });
    expect(candidateDisplayOf(pack, first('nebeday', 'plant'), 'nebeday', 'fr')).toEqual({
      name: 'Moringa',
      detail: 'Moringa oleifera',
    });
  });

  it('names a generic by its product without strength when the strength typed is not one of its own', () => {
    const candidate = first('paracetamol 750', 'product');
    expect(candidateDisplayOf(pack, candidate, 'paracetamol 750', 'fr')).toEqual({
      name: 'Paracétamol (générique)',
      detail: 'Paracétamol',
    });
  });
});

describe('displayOf a product of a family that differs only by its forms', () => {
  it('names it by its brand and its strengths, without the form the user did not choose', () => {
    const NB = ' ';
    // Strongest first, whatever the order of the components.
    expect(displayOf(pack, { kind: 'product', id: 'dafalgan-codeine-66003374' }, 'fr')).toEqual({
      name: `DAFALGAN CODEINE 500${NB}mg/30${NB}mg`,
      detail: `Paracétamol 500${NB}mg, Codéine 30${NB}mg`,
    });
    expect(displayOf(pack, { kind: 'product', id: 'dafalgan-codeine-61109911' }, 'fr').name).toBe(
      `DAFALGAN CODEINE 500${NB}mg/30${NB}mg`,
    );
    const candidate = first('dafalgan codeine', 'product');
    expect(candidateDisplayOf(pack, candidate, 'dafalgan codeine', 'fr')).toEqual(
      displayOf(pack, { kind: 'product', id: candidate.id }, 'fr'),
    );
  });

  it('keeps the whole name when an age variant of the brand has other strengths', () => {
    // CODOLIPRANE ADULTES 400 mg/20 mg is a variant of CODOLIPRANE 500 mg/30 mg.
    expect(
      displayOf(pack, { kind: 'product', id: 'codoliprane-500-mg-30-mg-62049552' }, 'fr').name,
    ).toBe('CODOLIPRANE 500 mg/30 mg, gélule');
  });

  it('keeps the whole name in a family of several strengths', () => {
    expect(displayOf(pack, { kind: 'product', id: 'efferalgan-500-mg-67326925' }, 'fr').name).toBe(
      'EFFERALGAN 500 mg, comprimé',
    );
  });
});

describe('displayOf a product of a family without any strength in mg', () => {
  it('names it by its brand alone, never by the name of one product she did not choose', () => {
    // DERMOVAL cream and gel; AMOXICILLINE ARROW 125 and 250 mg/5 mL: no strength in mg to ask.
    for (const ids of [
      ['dermoval-0-05-61777782', 'dermoval-60097833'],
      ['amoxicilline-arrow-125-mg-5-ml-61771313', 'amoxicilline-arrow-250-mg-5-ml-66773446'],
    ]) {
      const names = ids.map((id) => displayOf(pack, { kind: 'product', id }, 'fr').name);
      const brand = pack.products.find((p) => p.id === ids[0])?.brands[0];
      expect(names).toEqual([brand, brand]);
      const candidate = candidateOf(pack, { kind: 'product', id: ids[0] ?? '' });
      if (candidate === undefined) throw new Error(`no candidate for ${ids[0] ?? ''}`);
      expect(strengthChoiceOf(pack, candidate, '')).toBeNull();
      expect(candidateDisplayOf(pack, candidate, '', 'fr').name).toBe(brand);
    }
    expect(displayOf(pack, { kind: 'product', id: 'dermoval-60097833' }, 'fr').detail).toBe(
      'Clobétasol',
    );
  });

  it('keeps the whole name of a product alone in its family', () => {
    const alone = pack.products.find(
      (p) =>
        p.components.every((c) => c.strengthMg === undefined) &&
        candidateOf(pack, { kind: 'product', id: p.id })?.variants.length === 0 &&
        p.brands.length > 0,
    );
    if (alone === undefined) throw new Error('no product alone in its family without a strength');
    expect(displayOf(pack, { kind: 'product', id: alone.id }, 'fr').name).toBe(alone.names.fr);
  });
});

describe('productFamilyOf', () => {
  it('gives the resolver family of a product, and nothing for an id missing from the pack', () => {
    expect(productFamilyOf(pack, 'efferalgan-1000-mg-60025403')).toBe(
      productFamilyOf(pack, 'efferalgan-500-mg-67326925'),
    );
    expect(productFamilyOf(pack, 'efferalgan-1000-mg-60025403')).not.toBe(
      productFamilyOf(pack, 'doliprane-1000-mg-60234100'),
    );
    expect(productFamilyOf(pack, 'gone')).toBeUndefined();
  });
});

describe('displayOf an item whose strength is not known', () => {
  it('names a brand product by its brand and its substances, no strength', () => {
    expect(
      displayOf(pack, { kind: 'product', id: 'doliprane-100-mg-66057393' }, 'fr', true),
    ).toEqual({ name: 'DOLIPRANE', detail: 'Paracétamol' });
    expect(displayOf(pack, { kind: 'product', id: 'coversyl-5-mg-63849839' }, 'en', true)).toEqual({
      name: 'COVERSYL',
      detail: 'Perindopril',
    });
  });

  it('names a generic by its product without strength', () => {
    expect(
      displayOf(pack, { kind: 'product', id: 'paracetamol-1000-generic' }, 'fr', true),
    ).toEqual({ name: 'Paracétamol (générique)', detail: 'Paracétamol' });
  });

  it('changes nothing for a plant', () => {
    expect(displayOf(pack, { kind: 'plant', id: 'moringa' }, 'fr', true)).toEqual(
      displayOf(pack, { kind: 'plant', id: 'moringa' }, 'fr'),
    );
  });
});

describe('strengthChoiceOf', () => {
  it('offers nothing for a product or plant without variants', () => {
    expect(strengthChoiceOf(pack, first('nebeday', 'plant'), 'nebeday')).toBeNull();
  });

  it('asks nothing when every product of the family has the same strengths (forms only)', () => {
    const candidate = first('dafalgan codeine', 'product');
    expect(candidate.variants.length).toBeGreaterThan(0);
    expect(strengthChoiceOf(pack, candidate, 'dafalgan codeine')).toBeNull();
  });

  it('offers the strengths of a generic with nothing chosen, as for a brand', () => {
    // "I do not know" stands for its product without strength, but she says it herself.
    const candidate = first('paracetamol', 'product');
    expect(candidate.id).toBe('paracetamol-generic');
    expect(strengthChoiceOf(pack, candidate, 'paracetamol')).toEqual({
      options: ['paracetamol-500-generic', 'paracetamol-1000-generic'],
      preselected: null,
    });
  });

  it('preselects the form typed in the query when one product of the family has it', () => {
    const candidate = first('Neo-Codion sirop', 'product');
    expect(candidate.id).toBe('neo-codion-syrup');
    expect(strengthChoiceOf(pack, candidate, 'Neo-Codion sirop')?.preselected).toBe('candidate');
    // Several products of the family have it, of several strengths: none is chosen for her.
    const effervescent = first('doliprane effervescent', 'product');
    expect(strengthChoiceOf(pack, effervescent, 'doliprane effervescent')?.preselected).toBeNull();
  });

  it('preselects the strength and the form typed together', () => {
    const query = 'Doliprane 1000 comprimé effervescent';
    const candidate = first(query, 'product');
    expect(candidate.id).toBe('doliprane-1000-mg-66567738');
    expect(strengthChoiceOf(pack, candidate, query)?.preselected).toBe('candidate');
  });

  it('preselects the strength typed in the query', () => {
    const candidate = first('paracetamol 1 g', 'product');
    expect(candidate.id).toBe('paracetamol-1000-generic');
    expect(strengthChoiceOf(pack, candidate, 'paracetamol 1 g')).toMatchObject({
      preselected: 'candidate',
    });
  });

  it('never preselects a strength of a brand the query did not give', () => {
    const candidate = first('doliprane', 'product');
    const choice = strengthChoiceOf(pack, candidate, 'doliprane');
    expect(choice?.preselected).toBeNull();
    // Strength ascending, then id; the liquid without a strength in mg is a product of its own, last.
    expect(choice?.options[0]).toBe('doliprane-100-mg-66057393');
    expect(choice?.options.at(-1)).toBe('doliprane-2-4-pour-cent-66477582');
    expect(choice?.options).toContain(candidate.id);
    expect(choice?.options).toHaveLength(candidate.variants.length + 1);
  });

  it('preselects the brand strength typed in the query', () => {
    const candidate = first('doliprane 1000', 'product');
    expect(strengthChoiceOf(pack, candidate, 'doliprane 1000')?.preselected).toBe('candidate');
  });

  it('asks for a brand with no generic of its substance (COVERSYL), with nothing preselected', () => {
    const candidate = first('coversyl', 'product');
    expect(pack.products.some((p) => p.id === 'perindopril-generic')).toBe(false);
    const choice = strengthChoiceOf(pack, candidate, 'coversyl');
    expect(choice?.preselected).toBeNull();
    expect(choice?.options).toEqual([
      'coversyl-2-5-mg-69475939',
      'coversyl-5-mg-63849839',
      'coversyl-10-mg-68391071',
    ]);
  });
});

describe('strengthOptionLabel', () => {
  it('drops the brand followed by a comma too', () => {
    const candidate = first('dafalgan codeine', 'product');
    expect(strengthOptionLabel(pack, candidate, 'dafalgan-codeine-61109911', 'fr')).toBe(
      'comprimé effervescent sécable',
    );
  });

  it('drops the brand of a COVERSYL strength', () => {
    const candidate = first('coversyl', 'product');
    expect(strengthOptionLabel(pack, candidate, 'coversyl-2-5-mg-69475939', 'fr')).toBe(
      '2,5 mg, comprimé pelliculé',
    );
  });

  it('starts a generic strength with what the box shows, as for a brand', () => {
    const candidate = first('paracetamol', 'product');
    expect(strengthOptionLabel(pack, candidate, 'paracetamol-500-generic', 'fr')).toBe(
      '500 mg, comprimé',
    );
    expect(strengthOptionLabel(pack, candidate, 'paracetamol-1000-generic', 'en')).toBe(
      '1000 mg, comprimé',
    );
  });
});

describe('writtenNameOf', () => {
  it('gives the name typed when the product is shown under another name', () => {
    const cytotec = { kind: 'product', id: 'misoprostol-generic' } as const;
    expect(writtenNameOf(pack, cytotec, 'cytotec', 'fr')).toBe('cytotec');
    expect(writtenNameOf(pack, cytotec, '  Cytotec   200 ', 'fr')).toBe('Cytotec 200');
    expect(writtenNameOf(pack, { kind: 'plant', id: 'moringa' }, 'nebeday', 'fr')).toBe('nebeday');
  });

  it('gives nothing when the name shown already says what was typed', () => {
    const doliprane = { kind: 'product', id: 'doliprane-1000-mg-60234100' } as const;
    expect(writtenNameOf(pack, doliprane, 'Doliprane 1000', 'fr')).toBeUndefined();
    // A spelling the name shown reads the same way (accents, doubled letters).
    expect(writtenNameOf(pack, doliprane, 'doliprann', 'fr')).toBeUndefined();
    const generic = { kind: 'product', id: 'paracetamol-generic' } as const;
    expect(writtenNameOf(pack, generic, 'paracétamol', 'fr')).toBeUndefined();
    expect(writtenNameOf(pack, generic, 'paracetamol comprimé', 'en')).toBeUndefined();
    expect(writtenNameOf(pack, generic, '', 'fr')).toBeUndefined();
    expect(writtenNameOf(pack, generic, '500 mg', 'fr')).toBeUndefined();
  });
});

describe('missingSubstancesOf', () => {
  it('names the substances the query names that the product lacks', () => {
    expect(
      missingSubstancesOf(pack, 'efferalgan-500-mg-67326925', 'efferalgan codeine', 'fr'),
    ).toEqual(['Codéine']);
    expect(missingSubstancesOf(pack, 'efferalgan-codeine', 'efferalgan codeine', 'en')).toEqual([]);
    expect(missingSubstancesOf(pack, 'efferalgan-500-mg-67326925', 'efferalgan', 'fr')).toEqual([]);
    expect(missingSubstancesOf(pack, 'gone', 'codeine', 'fr')).toEqual([]);
  });
});
