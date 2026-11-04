// SPDX-License-Identifier: MIT
import { evaluate, parsePack } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/index.js';
import { copyOf, dict, list, loadValid, patch, sub } from './helpers.js';

describe('buildPack', () => {
  it('maps the kebab-case authoring format to the engine camelCase format', async () => {
    const pack = buildPack(await loadValid());
    expect(pack.schema).toBe(1);
    expect(pack.version).toBe('0.0.1');
    expect(pack.date).toBe('2026-11-04');
    expect(pack.clinicallyValidated).toBe(false);

    const nsaid = pack.rules.find((r) => r.id === 'nsaid-pregnancy-from-20-weeks');
    expect(nsaid).toStrictEqual({
      id: 'nsaid-pregnancy-from-20-weeks',
      kind: 'pregnancy',
      when: { subject: { class: 'nsaid' }, pregnancyWindows: ['20-29', '30-plus'] },
      level: 'before-next-dose',
      evidence: 'A',
      message: 'nsaid-pregnancy-from-20-weeks',
      sources: [
        {
          source: 'openfda',
          locator: 'Fixture label, section 8.1 Pregnancy',
          url: 'https://example.org/fixture',
          accessed: '2026-11-04',
          quote: 'Fixture quote.',
        },
      ],
      review: { status: 'draft', reviewers: [] },
    });

    const toxic = pack.rules.find((r) => r.id === 'moringa-toxic');
    expect(toxic?.dangerRationale).toMatch(/^Fixture rationale/);
    expect(toxic?.when.breastfeeding).toEqual({ babyAgeWeeksMax: 6, premature: true });

    const herb = pack.rules.find((r) => r.id === 'moringa-paracetamol');
    expect(herb?.when.unlessConditions).toEqual(['sickle-cell']);
    expect(herb?.when.unlessWith).toEqual([{ substance: 'ibuprofen' }]);
    const strong = pack.rules.find((r) => r.id === 'paracetamol-strong-pregnancy');
    expect(strong?.when.strengthAboveMg).toBe(500);
    const dose = pack.rules.find((r) => r.id === 'paracetamol-max-dose');
    expect(dose?.when.maxMgPerDay).toBe(4000);
    expect(dose?.review.reviewedOn).toBe('2026-11-04');
  });

  it('maps products, plants, registry lists and danger signs', async () => {
    const pack = buildPack(await loadValid());
    expect(pack.products.find((p) => p.id === 'ibuprofen-400')).toStrictEqual({
      id: 'ibuprofen-400',
      names: { fr: 'Ibuprofène 400 mg, comprimé', en: 'Ibuprofen 400 mg tablet' },
      brands: ['Fixture'],
      localNames: [],
      components: [{ substance: 'ibuprofen', strengthMg: 400 }],
      form: 'tablet',
      route: 'oral',
      demo: false,
    });
    expect(pack.plants).toStrictEqual([
      {
        id: 'moringa',
        latinName: 'Moringa oleifera',
        names: { fr: 'Moringa', en: 'Moringa' },
        localNames: [{ text: 'nebeday', lang: 'wo', checked: false }],
        evidence: 'B',
        message: 'evidence-0',
        sources: [{ source: 'literature', locator: 'Fixture reference', accessed: '2026-11-04' }],
      },
    ]);
    expect(pack.substances.find((s) => s.id === 'ibuprofen')).toStrictEqual({
      id: 'ibuprofen',
      names: { fr: 'Ibuprofène', en: 'Ibuprofen' },
      classes: ['nsaid'],
    });
    expect(pack.classes).toStrictEqual([
      { id: 'nsaid', names: { fr: 'AINS', en: 'NSAID' }, excludes: [] },
    ]);
    expect(pack.dangerSigns.map((s) => s.id)).toEqual(['bleeding', 'fever']);
    expect(pack.dangerSigns[0]?.message).toBe('bleeding-sign');
    expect(pack.dangerSigns[1]).not.toHaveProperty('message');
    expect(pack.sources.map((s) => s.id)).toEqual(['lactmed', 'literature', 'openfda', 'who']);
  });

  it('includes every product of a generated product list file, sorted with the others', async () => {
    const raw = copyOf(await loadValid());
    const one = dict(raw.products.find((f) => f.file.endsWith('/ibuprofen-400.yaml'))?.data);
    const listed = ['zz-listed', 'aa-listed'].map((id) => ({ ...structuredClone(one), id }));
    raw.products.push({ file: 'registry/products/bdpm.yaml', data: listed });
    const ids = buildPack(raw).products.map((p) => p.id);
    expect(ids).toEqual(['aa-listed', 'ibuprofen-400', 'paracetamol-1000', 'zz-listed']);
  });

  it('maps messages by language and id, with risk-detail as riskDetail', async () => {
    const pack = buildPack(await loadValid());
    expect(Object.keys(pack.messages.fr)).toEqual(Object.keys(pack.messages.fr).sort());
    expect(Object.keys(pack.messages.fr)).toEqual(Object.keys(pack.messages.en));
    expect(pack.messages.fr['nsaid-pregnancy-from-20-weeks']).toStrictEqual({
      fact: 'Ce médicament contient un anti-inflammatoire (AINS).',
      risk: 'À partir du cinquième mois, il peut abîmer les reins et le cœur du bébé.',
      riskDetail: 'Dès la 20e semaine, la fonction rénale du bébé peut être atteinte.',
      orientation: 'Parlez-en à votre sage-femme avant la prochaine prise.',
    });
    expect(pack.messages.en['nsaid-pregnancy-from-20-weeks']).toStrictEqual({
      fact: 'This medicine contains an anti-inflammatory (NSAID).',
      risk: "From the fifth month, it can harm the baby's kidneys and heart.",
    });
  });

  it('sorts every array by id, whatever the order of the files', async () => {
    const raw = copyOf(await loadValid());
    raw.rules.reverse();
    raw.products.reverse();
    list(raw.substances?.data).reverse();
    list(raw.dangerSigns?.data).reverse();
    const pack = buildPack(raw);
    for (const collection of [
      pack.rules,
      pack.products,
      pack.plants,
      pack.substances,
      pack.classes,
      pack.dangerSigns,
    ]) {
      const ids = collection.map((e) => e.id);
      expect(ids).toEqual([...ids].sort());
    }
    expect(pack.rules.map((r) => r.id)).toEqual([
      'moringa-paracetamol',
      'moringa-toxic',
      'nsaid-pregnancy-from-20-weeks',
      'paracetamol-max-dose',
      'paracetamol-strong-pregnancy',
    ]);
  });

  it('builds the same pack from the same content, and a pack that parsePack accepts', async () => {
    const first = buildPack(await loadValid());
    const second = buildPack(await loadValid());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(parsePack(JSON.parse(JSON.stringify(first)))).toStrictEqual(first);
  });

  it('builds a pack that the engine evaluates', async () => {
    const pack = buildPack(await loadValid());
    const result = evaluate(pack, {
      pregnancy: { weeksMin: 30, weeksMax: 30, precision: 'exact' },
      conditions: [],
      items: [{ ref: { kind: 'product', id: 'ibuprofen-400' } }],
      signs: ['bleeding'],
    });
    expect(result.findings.map((f) => [f.check, f.message])).toEqual([
      ['C11', 'bleeding-sign'],
      ['C1', 'nsaid-pregnancy-from-20-weeks'],
    ]);
  });

  it('throws, listing the problems, when the content is not valid', async () => {
    const raw = patch(copyOf(await loadValid()), 'rules', 'moringa-toxic', (d) => {
      delete d['danger-rationale'];
    });
    expect(() => buildPack(raw)).toThrow(/moringa-toxic\.yaml: danger-rationale/);
    try {
      buildPack(raw);
    } catch (error) {
      expect(error).toHaveProperty('problems');
    }
  });

  it('does not modify the raw content', async () => {
    const raw = await loadValid();
    const before = JSON.stringify(raw);
    buildPack(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(dict(raw.pack?.data)['clinically-validated']).toBe(false);
    expect(sub(dict(raw.rules[0]?.data), 'when')).toBeDefined();
  });
});
