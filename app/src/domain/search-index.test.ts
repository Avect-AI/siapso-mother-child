// SPDX-License-Identifier: MIT
import type { Pack, Rule } from '@siapso/engine';
import { normalize, plainText, search } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import {
  browseEntriesOf,
  boxNameOf,
  browseGroupsOf,
  candidateDisplayOf,
  candidateOf,
  displayOf,
  entriesNamedWith,
  filterBrowseEntries,
  localNameOf,
  missingBrandSubstancesOf,
  missingSubstancesOf,
  needsUnitsPerDay,
  productFamilyOf,
  searchIndexOf,
  strengthChoiceOf,
  strengthOptionLabel,
  strengthQuestionOf,
  substancesWithMaxDose,
  unitsHeld,
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
      name: 'Paracétamol 500 mg (générique)',
      detail: 'Paracétamol 500 mg',
    });
    expect(displayOf(pack, { kind: 'product', id: 'paracetamol-500-generic' }, 'en')).toEqual({
      name: 'Paracetamol 500 mg (generic)',
      detail: 'Paracetamol 500 mg',
    });
    expect(
      displayOf(pack, { kind: 'product', id: 'codoliprane-500-mg-30-mg-60904643' }, 'fr').detail,
    ).toBe('Paracétamol 500 mg, Codéine 30 mg');
  });

  it('gives a plant its Latin name as detail, marked as Latin', () => {
    expect(displayOf(pack, { kind: 'plant', id: 'moringa' }, 'en')).toEqual({
      name: 'Moringa',
      detail: 'Moringa oleifera',
      detailLang: 'la',
    });
  });

  it('holds every number of a product name to its unit, so "1000 mg" never splits', () => {
    expect(displayOf(pack, { kind: 'product', id: 'doliprane-1000-mg-60234100' }, 'fr').name).toBe(
      'DOLIPRANE 1000 mg, comprimé',
    );
    // Any number then a unit, joined by an ordinary space: none left in any name.
    const split = /\d (?:mg|g|ml|mL|microgrammes|%|pour cent)(?!\p{L})/iu;
    for (const product of pack.products) {
      for (const lang of ['fr', 'en'] as const) {
        expect(displayOf(pack, { kind: 'product', id: product.id }, lang).name).not.toMatch(split);
      }
    }
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
    // The number held to its unit by a no-break space.
    expect(strengthOptionLabel(pack, candidate, 'doliprane-1000-mg-60234100', 'fr')).toBe(
      '1000 mg, comprimé',
    );
    expect(strengthOptionLabel(pack, candidate, 'doliprane-2-4-pour-cent-66477582', 'fr')).toBe(
      '2,4 %, suspension buvable',
    );
  });

  it('writes the database capitals as a woman reads them', () => {
    const candidate = first('doliprane', 'product');
    expect(strengthOptionLabel(pack, candidate, 'doliprane-adultes-1000-mg-67488731', 'fr')).toBe(
      'adultes 1000 mg, suppositoire',
    );
  });
});

describe('strengthQuestionOf', () => {
  it('asks the strength when every answer has a number', () => {
    expect(strengthQuestionOf(['500 mg, comprimé', '1000 mg, comprimé'])).toBe('strength');
  });

  it('asks the form when no answer has a number (Néo-Codion: a coated tablet or a syrup)', () => {
    expect(strengthQuestionOf(['comprimé enrobé', 'sirop'])).toBe('form');
  });

  it('asks both when some answers have a number and some do not', () => {
    expect(strengthQuestionOf(['500 mg, comprimé', 'sirop'])).toBe('both');
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
      detailLang: 'la',
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
    ).toBe('CODOLIPRANE 500 mg/30 mg, gélule');
  });

  it('keeps the whole name in a family of several strengths', () => {
    expect(displayOf(pack, { kind: 'product', id: 'efferalgan-500-mg-67326925' }, 'fr').name).toBe(
      'EFFERALGAN 500 mg, comprimé',
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
    expect(displayOf(pack, { kind: 'product', id: alone.id }, 'fr').name).toBe(
      unitsHeld(alone.names.fr),
    );
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
      matching: [],
    });
  });

  it('names the products of the strength typed, so a long list can show them first', () => {
    const query = 'Doliprane 1000 mg';
    const candidate = first(query, 'product');
    const choice = strengthChoiceOf(pack, candidate, query);
    expect(choice?.preselected).toBe('candidate');
    expect(choice?.matching).toContain(candidate.id);
    for (const id of choice?.matching ?? []) {
      const product = pack.products.find((p) => p.id === id);
      expect(
        product?.components.some((c) => c.strengthMg === 1000),
        id,
      ).toBe(true);
    }
    // In the order of the list, the children's strengths left out.
    expect(choice?.matching).toEqual(choice?.options.filter((id) => choice.matching.includes(id)));
    expect(choice?.matching.length).toBeLessThan(choice?.options.length ?? 0);
    // No strength typed: none.
    expect(strengthChoiceOf(pack, first('doliprane', 'product'), 'doliprane')?.matching).toEqual(
      [],
    );
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

  it('never preselects a count or a volume as a strength (DOLIPRANE has a 100 mg box)', () => {
    for (const query of [
      'doliprane boîte de 100',
      'doliprane boîte de cent',
      'doliprane 100 comprimés',
      'doliprane cent comprimés',
      'doliprane 100 ml',
      'doliprane deux fois cent',
    ]) {
      const candidate = first(query, 'product');
      expect(strengthChoiceOf(pack, candidate, query)?.preselected, query).toBeNull();
    }
  });

  it('preselects a strength said or typed in words, as if typed in digits', () => {
    for (const query of ['Doliprane mille', 'doliprane un gramme']) {
      const candidate = first(query, 'product');
      expect(candidate.id).toBe(first('doliprane 1000', 'product').id);
      expect(strengthChoiceOf(pack, candidate, query)?.preselected).toBe('candidate');
    }
    const advil = 'Advil quatre cents milligrammes, boîte de vingt';
    const candidate = first(advil, 'product');
    expect(candidate.id).toBe(first('advil 400', 'product').id);
    expect(strengthChoiceOf(pack, candidate, advil)?.preselected).toBe('candidate');
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
      '2,5 mg, comprimé pelliculé',
    );
  });

  it('starts a generic strength with what the box shows, as for a brand', () => {
    const candidate = first('paracetamol', 'product');
    expect(strengthOptionLabel(pack, candidate, 'paracetamol-500-generic', 'fr')).toBe(
      '500 mg, comprimé',
    );
    expect(strengthOptionLabel(pack, candidate, 'paracetamol-1000-generic', 'en')).toBe(
      '1000 mg, comprimé',
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

describe('boxNameOf', () => {
  it('gives the name on the box a product was found by, when the name shown does not say it', () => {
    const ibuprofen = { kind: 'product', id: 'ibuprofen-generic' } as const;
    expect(boxNameOf(pack, ibuprofen, 'Brufen', 'fr')).toBe('Brufen');
    // Not a brand of the product: a local name, the name itself, another product's brand.
    expect(boxNameOf(pack, ibuprofen, 'Ibuprofène', 'fr')).toBeUndefined();
    expect(boxNameOf(pack, ibuprofen, 'Cytotec', 'fr')).toBeUndefined();
    expect(boxNameOf(pack, { kind: 'plant', id: 'moringa' }, 'nebeday', 'fr')).toBeUndefined();
    // A brand product shows its brand already.
    const doliprane = { kind: 'product', id: 'doliprane-1000-mg-60234100' } as const;
    expect(boxNameOf(pack, doliprane, 'DOLIPRANE', 'fr')).toBeUndefined();
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

describe('missingBrandSubstancesOf', () => {
  it('names each brand of the query whose substances the product lacks, with them', () => {
    expect(missingBrandSubstancesOf(pack, 'codeine-generic', 'Advil codéine', 'fr')).toEqual([
      { brand: 'ADVIL', substances: ['Ibuprofène'] },
    ]);
    expect(missingBrandSubstancesOf(pack, 'codeine-generic', 'Advil codéine', 'en')).toEqual([
      { brand: 'ADVIL', substances: ['Ibuprofen'] },
    ]);
  });

  it('names none when the product holds them, nor for a substance named, nor a product gone', () => {
    const antarene = 'antarene-codeine-200-mg-30-mg-63755329';
    expect(missingBrandSubstancesOf(pack, antarene, 'Advil codéine', 'fr')).toEqual([]);
    // The codeine an ADVIL lacks is named, not implied: missingSubstancesOf says it.
    expect(missingBrandSubstancesOf(pack, 'advil-200-mg-68634000', 'Advil codéine', 'fr')).toEqual(
      [],
    );
    expect(missingBrandSubstancesOf(pack, 'gone', 'Advil codéine', 'fr')).toEqual([]);
  });
});

describe('browseEntriesOf', () => {
  it('lists every remedy once, by its name in the language, in alphabetical order', () => {
    const entries = browseEntriesOf(pack, 'plant', 'fr');
    expect(entries.map((entry) => entry.id).sort()).toEqual(pack.plants.map((p) => p.id).sort());
    const moringa = entries.find((entry) => entry.id === 'moringa');
    expect(moringa).toMatchObject({ kind: 'plant', name: 'Moringa', detail: 'Moringa oleifera' });
    const names = entries.map((entry) => entry.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })),
    );
    expect(browseEntriesOf(pack, 'plant', 'en').find((e) => e.id === 'moringa')?.name).toBe(
      pack.plants.find((p) => p.id === 'moringa')?.names.en,
    );
  });

  it('lists the medicines one per family, by the family name, never one strength chosen for her', () => {
    const all = browseEntriesOf(pack, 'product', 'fr');
    const entries = all.filter((entry) => entry.brandOf === undefined);
    const families = new Set(entries.map((entry) => productFamilyOf(pack, entry.id)));
    expect(families.size).toBe(entries.length);
    expect(entries.length).toBeGreaterThan(10);
    const doliprane = entries.filter((entry) => entry.name === 'DOLIPRANE');
    expect(doliprane).toHaveLength(1);
    // Its confirm screen asks the strength (no strength chosen from a list).
    const candidate = candidateOf(pack, { kind: 'product', id: doliprane[0]?.id ?? '' });
    expect(candidate && strengthChoiceOf(pack, candidate, '')?.preselected).toBeNull();
    // A generic family stands for itself by its plain product when it has one.
    const paracetamol = entries.find((entry) => entry.name === 'Paracétamol (générique)');
    expect(paracetamol?.id).toBe('paracetamol-generic');
  });

  it('keeps the local names, by language: a Wolof name that was said is found again', () => {
    const moringa = browseEntriesOf(pack, 'plant', 'fr').find((entry) => entry.id === 'moringa');
    expect(moringa?.local).toEqual([{ lang: 'wo', names: ['nebeday', 'nebedaay'] }]);
  });

  it('lists the name on the box of a generic as an entry of its own, pointing to the generic', () => {
    const entries = browseEntriesOf(pack, 'product', 'fr');
    const cytotec = entries.find((entry) => entry.name === 'Cytotec');
    expect(cytotec).toMatchObject({
      kind: 'product',
      id: 'misoprostol-generic',
      brandOf: 'Misoprostol (générique)',
    });
    // In alphabetical order with the others: under C.
    const groups = browseGroupsOf(entries);
    expect(groups.find((group) => group.letter === 'C')?.entries).toContain(cytotec);
    for (const brand of ['Brufen', 'Nivaquine', 'Coartem', 'Fansidar']) {
      expect(entries.some((entry) => entry.name === brand && entry.brandOf !== undefined)).toBe(
        true,
      );
    }
    // A brand that is the family's own name is not listed twice.
    expect(entries.filter((entry) => entry.name === 'DOLIPRANE')).toHaveLength(1);
    expect(
      entries.filter((entry) => normalize(entry.name).startsWith(normalize('Néo-Codion'))),
    ).toHaveLength(1);
  });
});

describe('filterBrowseEntries', () => {
  it('keeps the entries whose name, box name or local name holds the text, accents aside', () => {
    const entries = browseEntriesOf(pack, 'product', 'fr');
    expect(filterBrowseEntries(entries, 'cyto').map((entry) => entry.name)).toEqual(['Cytotec']);
    // As written while she types it ("c", "cy"), or as it sounds ("sito").
    for (const text of ['c', 'cy', 'cyt', 'sito']) {
      expect(
        filterBrowseEntries(entries, text).map((entry) => entry.name),
        text,
      ).toContain('Cytotec');
    }
    expect(filterBrowseEntries(entries, '  ').length).toBe(entries.length);
    const plants = browseEntriesOf(pack, 'plant', 'fr');
    expect(filterBrowseEntries(plants, 'NEBEDAY').map((entry) => entry.id)).toEqual(['moringa']);
    expect(filterBrowseEntries(plants, 'zzqxw')).toEqual([]);
  });
});

describe('entriesNamedWith', () => {
  const ids = (query: string, kind: 'product' | 'plant' = 'plant') =>
    entriesNamedWith(pack, kind, query, 'fr').map((entry) => entry.id);

  it('lists the remedies with a carrier word of the query in one of their names', () => {
    expect(ids('huile')).toEqual(['castor-oil']);
    expect(ids('Huiles')).toEqual(['castor-oil']);
    expect(ids('feuille')).toEqual(['bitter-leaf']);
    expect(ids('feuilles')).toEqual(['bitter-leaf']);
    expect(ids('une feuille')).toEqual([]);
  });

  it('lists nothing for a query that names something, a form word or a word in no name', () => {
    expect(ids('huile de ricin')).toEqual([]);
    expect(ids('sirop')).toEqual([]);
    expect(ids('comprimé', 'product')).toEqual([]);
    expect(ids('tisane')).toEqual([]);
    expect(ids('')).toEqual([]);
  });
});

describe('browseGroupsOf', () => {
  it('groups the list by first letter, accents aside, in order', () => {
    const groups = browseGroupsOf(browseEntriesOf(pack, 'plant', 'fr'));
    const letters = groups.map((group) => group.letter);
    expect(letters).toEqual([...new Set(letters)]);
    expect(letters).toEqual([...letters].sort());
    for (const group of groups) {
      for (const entry of group.entries) {
        expect(plainText(entry.name).charAt(0).toUpperCase()).toBe(group.letter);
      }
    }
    expect(groups.flatMap((group) => group.entries)).toHaveLength(pack.plants.length);
  });

  it('files a name under the letter it is written with, not the sound the search reads', () => {
    const groups = browseGroupsOf(browseEntriesOf(pack, 'plant', 'fr'));
    const letterOf = (name: string) =>
      groups.find((group) => group.entries.some((entry) => entry.name === name))?.letter;
    expect(letterOf('Huile de ricin')).toBe('H');
    expect(letterOf('Kinkéliba')).toBe('K');
    const products = browseGroupsOf(browseEntriesOf(pack, 'product', 'fr'));
    const codoliprane = products.find((group) =>
      group.entries.some((entry) => entry.name.startsWith('CODOLIPRANE')),
    );
    expect(codoliprane?.letter).toBe('C');
  });

  it('puts a name that starts with a digit or a sign under #', () => {
    const groups = browseGroupsOf([
      { kind: 'product', id: 'a', name: '5-FU', detail: undefined, local: [] },
      { kind: 'product', id: 'b', name: 'Ébène', detail: undefined, local: [] },
    ]);
    expect(groups.map((group) => [group.letter, group.entries.map((e) => e.id)])).toEqual([
      ['#', ['a']],
      ['E', ['b']],
    ]);
  });
});
