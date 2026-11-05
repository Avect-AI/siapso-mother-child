// SPDX-License-Identifier: MIT
// The resolver on the repository pack: noise gets no candidate, the common
// brands of the generics are found, and an INN query still lists the generic
// first.
import type { Pack } from '@siapso/engine';
import { buildIndex, entriesFromPack, search } from '@siapso/resolver';
import type { ResolverIndex } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPack, loadContent } from '../src/index.js';
import type { RawContent } from '../src/index.js';
import { REPO_ROOT } from './helpers.js';

let raw: RawContent;
let pack: Pack;
let index: ResolverIndex;

beforeAll(async () => {
  raw = await loadContent(REPO_ROOT);
  pack = buildPack(raw);
  index = buildIndex(entriesFromPack(pack));
});

const first = (query: string): string | undefined => search(index, query)[0]?.id;

describe('the resolver on the repository pack', () => {
  it('proposes nothing for a form or a colour alone', () => {
    for (const query of ['comprimé blanc', 'sirop', 'comprimé', 'gélule', 'pommade', 'crème']) {
      expect(search(index, query), query).toEqual([]);
    }
  });

  it('finds the generic of each common brand', () => {
    const brands: Record<string, string> = {
      coartem: 'artemether-lumefantrine-generic',
      fansidar: 'sp',
      brufen: 'ibuprofen-generic',
      feldene: 'piroxicam-generic',
      ponstan: 'mefenamic-acid-generic',
      indocid: 'indometacin-generic',
      roaccutane: 'isotretinoin-generic',
      cytotec: 'misoprostol-generic',
    };
    for (const [query, id] of Object.entries(brands)) {
      expect(search(index, query)[0], query).toMatchObject({ id, score: 1, matchedLang: 'brand' });
    }
  });

  // Live test round 2 (midwife#5, safety-auditor#14, woman-literate#9): the
  // brands on the boxes of the substances the rules read, and a cough syrup.
  it('finds the brands of the live test round 2, each holding its substances', () => {
    const brands: Record<string, { id: RegExp; substances: string[] }> = {
      triflucan: { id: /^triflucan-/, substances: ['fluconazole'] },
      diflucan: { id: /^fluconazole-generic$/, substances: ['fluconazole'] },
      imeth: { id: /^methotrexate-generic$/, substances: ['methotrexate'] },
      ledertrexate: { id: /^methotrexate-generic$/, substances: ['methotrexate'] },
      aspro: { id: /^aspro-/, substances: ['aspirin'] },
      artotec: { id: /^artotec$/, substances: ['diclofenac', 'misoprostol'] },
      granudoxy: { id: /^granudoxy-/, substances: ['doxycycline'] },
      toplexil: { id: /^toplexil-/, substances: ['oxomemazine'] },
    };
    for (const [query, { id, substances }] of Object.entries(brands)) {
      const [best] = search(index, query);
      expect(best?.id, query).toMatch(id);
      expect(best?.score, query).toBe(1);
      const product = pack.products.find((p) => p.id === best?.id);
      expect(product?.components.map((c) => c.substance).sort(), query).toEqual(substances);
    }
  });

  // Review of SCRUM-51: a short word or a first name close to a name only
  // once read as it sounds proposes nothing; real spellings still do.
  it('proposes no lookalike that only the folding of a short word makes', () => {
    for (const [query, id] of [
      ['raisin', 'castor-oil'],
      ['huile de raisin', 'castor-oil'],
      ['résine', 'castor-oil'],
      ['Coura', 'curacne-10-mg-62318935'],
      ['coura', 'curacne-10-mg-62318935'],
    ] as const) {
      const found = search(index, query, { limit: 10 }).map((c) => c.id);
      expect(found, query).not.toContain(id);
    }
    expect(first('rissin')).toBe('castor-oil');
    expect(first('risin')).toBe('castor-oil');
    expect(first('ngeur')).toBe('guiera');
    expect(first('cotrim')).toMatch(/^cotrimoxazole-/);
  });

  it('finds the plants by their names in the standard Wolof orthography', () => {
    const wolof: Record<string, string> = {
      dakhar: 'tamarind',
      daxar: 'tamarind',
      nguer: 'guiera',
      ngeer: 'guiera',
      nger: 'guiera',
      nebeday: 'moringa',
      nebedaay: 'moringa',
      bissap: 'bissap',
      bisaab: 'bissap',
    };
    for (const [query, id] of Object.entries(wolof)) {
      expect(search(index, query)[0], query).toMatchObject({ id, score: 1, matchedLang: 'wo' });
    }
    // Misspellings of these names reach the plant above the minimum score.
    for (const [query, id] of [
      ['ngeur', 'guiera'],
      ['daxaar', 'tamarind'],
    ] as const) {
      expect(first(query), query).toBe(id);
    }
  });

  it('keeps the generic first for an INN query, even with a brand alias', () => {
    expect(first('ibuprofène')).toBe('ibuprofen-generic');
    expect(first('piroxicam')).toBe('piroxicam-generic');
    expect(first('misoprostol')).toBe('misoprostol-generic');
    expect(first('isotrétinoïne')).toBe('isotretinoin-generic');
    expect(first('artéméther luméfantrine')).toBe('artemether-lumefantrine-generic');
  });

  it('keeps every BDPM product a brand product, in the family of its first brand', () => {
    const file = raw.products.find((f) => f.file === 'registry/products/bdpm.yaml');
    const ids = new Set((file?.data as { id: string }[]).map((p) => p.id));
    expect(ids.size).toBeGreaterThan(200);
    const entries = entriesFromPack(pack).filter((e) => ids.has(e.id) && e.priority !== 1);
    expect(new Set(entries.map((e) => e.id))).toEqual(ids);
    for (const entry of entries) {
      expect(entry.priority, entry.id).toBe(3);
      expect(entry.family, entry.id).toMatch(/^brand:/);
    }
  });
});
