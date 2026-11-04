// SPDX-License-Identifier: MIT
import { CONDITION_IDS, LEVELS, RULE_KINDS, WINDOWS } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import { validateContent } from '../src/index.js';
import type { RawContent } from '../src/index.js';
import {
  copyOf,
  dict,
  expectProblem,
  fileOf,
  list,
  loadValid,
  patch,
  patchEntry,
  sub,
} from './helpers.js';
import type { Dict } from './helpers.js';

const RULE = 'knowledge/rules/nsaid-pregnancy-from-20-weeks.yaml';
const MESSAGE = 'knowledge/messages/nsaid-pregnancy-from-20-weeks.yaml';
const NSAID = 'nsaid-pregnancy-from-20-weeks';

let valid: RawContent | undefined;

async function fresh(): Promise<RawContent> {
  valid ??= await loadValid();
  return copyOf(valid);
}

describe('validateContent', () => {
  it('accepts the valid fixture tree', async () => {
    expect(validateContent(await fresh())).toEqual([]);
  });

  it('keeps the schema enums in step with the engine', async () => {
    const raw = await fresh();
    const rule = dict(raw.schemas.rule);
    const properties = sub(rule, 'properties');
    const enumOf = (value: unknown): unknown => dict(value).enum;
    expect(enumOf(properties.kind)).toEqual(RULE_KINDS);
    expect(enumOf(properties.level)).toEqual(LEVELS);
    expect(enumOf(sub(rule, '$defs').condition)).toEqual(CONDITION_IDS);
    const windows = sub(sub(sub(properties, 'when'), 'properties'), 'pregnancy-windows');
    expect(enumOf(sub(windows, 'items'))).toEqual(WINDOWS.map((w) => w.id));

    const evidence = ['A', 'B', 'C', 'D', 'E', '0'];
    expect(enumOf(properties.evidence)).toEqual(evidence);
    const plant = dict(raw.schemas.plant);
    expect(enumOf(sub(plant, 'properties').evidence)).toEqual(evidence);
    const sign = dict(raw.schemas['danger-sign']);
    expect(enumOf(sub(sign, 'properties').group)).toEqual(['pregnancy', 'postpartum', 'baby']);
    const languages = ['fr', 'wo', 'en'];
    const plantNames = sub(sub(plant, 'properties'), 'local-names');
    expect(enumOf(sub(sub(sub(plantNames, 'items'), 'properties'), 'lang'))).toEqual(languages);
    const product = dict(raw.schemas.product);
    expect(enumOf(sub(sub(sub(product, '$defs'), 'local-name'), 'properties').lang)).toEqual(
      languages,
    );
  });

  it('writes every schema in JSON Schema 2020-12', async () => {
    const raw = await fresh();
    for (const [name, schema] of Object.entries(raw.schemas)) {
      expect(dict(schema).$schema, name).toBe('https://json-schema.org/draft/2020-12/schema');
    }
  });

  it('hints to quote evidence 0, for a plant and a rule', async () => {
    const raw = patch(await fresh(), 'plants', 'moringa', (d) => {
      d.evidence = 0;
    });
    patch(raw, 'rules', NSAID, (d) => {
      d.evidence = 0;
    });
    const problems = validateContent(raw);
    expectProblem(problems, {
      file: 'registry/plants/moringa.yaml',
      path: 'evidence',
      message: /quote.*'0'/,
    });
    expectProblem(problems, { file: RULE, path: 'evidence', message: /quote.*'0'/ });
  });

  it('rejects forbidden wording, an em dash and an emoji in danger sign labels', async () => {
    const raw = patchEntry(await fresh(), 'dangerSigns', 'fever', (d) => {
      d.label = { fr: 'Fièvre, vous êtes sûr', en: `Fever ${String.fromCodePoint(0x2014)} stop` };
    });
    patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
      d.label = { fr: `Saignement ${String.fromCodePoint(0x1f600)}`, en: 'Bleeding' };
    });
    const problems = validateContent(raw);
    const file = 'knowledge/danger-signs.yaml';
    expectProblem(problems, { file, path: '[0].label.fr', message: /forbidden wording.*sûr/ });
    expectProblem(problems, { file, path: '[0].label.en', message: /em dash/ });
    expectProblem(problems, { file, path: '[0].label.en', message: /stop/ });
    expectProblem(problems, { file, path: '[1].label.fr', message: /emoji/ });
  });

  describe('1. JSON Schema', () => {
    it('rejects an unknown key in a rule and names the file and the key', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        d.extra = 1;
      });
      expectProblem(validateContent(raw), { file: RULE, path: 'extra', message: /unknown key/ });
    });

    it('rejects a misspelled key in a nested object', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        sub(d, 'when')['pregnancy-window'] = ['20-29'];
      });
      expectProblem(validateContent(raw), { file: RULE, path: 'when.pregnancy-window' });
    });

    it('rejects an engine camelCase key: authors write kebab-case', async () => {
      const raw = patch(await fresh(), 'rules', 'paracetamol-max-dose', (d) => {
        sub(d, 'when').maxMgPerDay = 1;
      });
      expectProblem(validateContent(raw), {
        file: 'knowledge/rules/paracetamol-max-dose.yaml',
        path: 'when.maxMgPerDay',
        message: /unknown key/,
      });
    });

    it('rejects a value outside an enum, with the allowed values', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        d.level = 'red';
      });
      expectProblem(validateContent(raw), { file: RULE, path: 'level', message: /allowed values/ });
    });

    it('rejects a missing required key', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        delete d.review;
      });
      expectProblem(validateContent(raw), { file: RULE, path: 'review', message: /required/ });
    });

    it('rejects a wrong type, with the index of a list item', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        sub(d, 'when')['pregnancy-windows'] = ['20-29', 30];
      });
      expectProblem(validateContent(raw), { file: RULE, path: 'when.pregnancy-windows[1]' });
    });

    it('rejects an empty requires or pregnancy-windows list', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        sub(d, 'when').requires = [];
        sub(d, 'when')['pregnancy-windows'] = [];
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: RULE, path: 'when.requires' });
      expectProblem(problems, { file: RULE, path: 'when.pregnancy-windows' });
    });

    it('rejects a requirement and a subject with several keys', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        sub(d, 'when').subject = { class: 'nsaid', substance: 'ibuprofen' };
        sub(d, 'when').requires = [{ condition: 'sickle-cell', with: { plant: 'moringa' } }];
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: RULE, path: 'when.subject' });
      expectProblem(problems, { file: RULE, path: 'when.requires[0]' });
    });

    it('rejects a source without accessed date or with a bad date', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        const source = dict(list(d.sources)[0]);
        source.accessed = '04/11/2026';
        delete source.locator;
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: RULE, path: 'sources[0].accessed', message: /date/ });
      expectProblem(problems, { file: RULE, path: 'sources[0].locator', message: /required/ });
    });

    it('rejects a message without fact, and an empty text', async () => {
      const raw = patch(await fresh(), 'messages', NSAID, (d) => {
        delete sub(d, 'fr').fact;
        sub(d, 'en').risk = '   ';
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: MESSAGE, path: 'fr.fact', message: /required/ });
      expectProblem(problems, { file: MESSAGE, path: 'en.risk' });
    });

    it('rejects a bad pack.yaml', async () => {
      const raw = await fresh();
      Object.assign(dict(raw.pack?.data), { version: '1.0', 'clinically-validated': 'no' });
      const problems = validateContent(raw);
      expectProblem(problems, { file: 'knowledge/pack.yaml', path: 'version' });
      expectProblem(problems, { file: 'knowledge/pack.yaml', path: 'clinically-validated' });
    });

    it('rejects bad registry entries: product, plant, substance, class, danger sign', async () => {
      const raw = patch(await fresh(), 'products', 'ibuprofen-400', (d) => {
        d.source = { bdpm: '60000001', 'demo-manual': true };
      });
      patch(raw, 'products', 'paracetamol-1000', (d) => {
        d.components = [];
        d.demo = 'yes';
      });
      patch(raw, 'plants', 'moringa', (d) => {
        d.evidence = 'F';
      });
      patchEntry(raw, 'substances', 'paracetamol', (d) => {
        delete d.names;
      });
      patchEntry(raw, 'classes', 'nsaid', (d) => {
        d.excluded = [];
      });
      patchEntry(raw, 'dangerSigns', 'fever', (d) => {
        d.group = 'adult';
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: 'registry/products/ibuprofen-400.yaml', path: 'source' });
      expectProblem(problems, {
        file: 'registry/products/paracetamol-1000.yaml',
        path: 'components',
      });
      expectProblem(problems, { file: 'registry/products/paracetamol-1000.yaml', path: 'demo' });
      expectProblem(problems, { file: 'registry/plants/moringa.yaml', path: 'evidence' });
      expectProblem(problems, {
        file: 'registry/substances.yaml',
        path: '[0].names',
        message: /required/,
      });
      expectProblem(problems, {
        file: 'registry/classes.yaml',
        path: '[0].excluded',
        message: /unknown key/,
      });
      expectProblem(problems, { file: 'knowledge/danger-signs.yaml', path: '[0].group' });
    });

    it('rejects a list file that is not a list, and a rule file that is not an object', async () => {
      const raw = await fresh();
      if (raw.substances) raw.substances.data = { id: 'x' };
      const rule = raw.rules[0];
      if (rule) rule.data = 'text';
      const problems = validateContent(raw);
      expectProblem(problems, { file: 'registry/substances.yaml', path: '', message: /list/ });
      expectProblem(problems, { file: rule?.file ?? '', path: '', message: /object/ });
    });

    it('does not crash on content that is badly broken', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        d.when = 5;
        d.message = 7;
        d.id = null;
      });
      expect(validateContent(raw).length).toBeGreaterThan(0);
    });
  });

  describe('2. ids', () => {
    it('rejects an id that is not kebab-case', async () => {
      const raw = patch(await fresh(), 'plants', 'moringa', (d) => {
        d.id = 'Moringa_Oleifera';
      });
      expectProblem(validateContent(raw), {
        file: 'registry/plants/moringa.yaml',
        path: 'id',
        message: /kebab-case/,
      });
    });

    it('rejects an id that differs from the file name', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        d.id = 'nsaid-pregnancy';
      });
      expectProblem(validateContent(raw), { file: RULE, path: 'id', message: /file name/ });
    });

    it('rejects the same check for messages, products and plants', async () => {
      const raw = patch(await fresh(), 'messages', 'evidence-0', (d) => {
        d.id = 'evidence-1';
      });
      patch(raw, 'products', 'ibuprofen-400', (d) => {
        d.id = 'ibuprofen-200';
      });
      patch(raw, 'plants', 'moringa', (d) => {
        d.id = 'moringa-2';
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: 'knowledge/messages/evidence-0.yaml', path: 'id' });
      expectProblem(problems, { file: 'registry/products/ibuprofen-400.yaml', path: 'id' });
      expectProblem(problems, { file: 'registry/plants/moringa.yaml', path: 'id' });
    });

    it('rejects a duplicate id in a list file, naming both positions', async () => {
      const raw = await fresh();
      const substances = list(raw.substances?.data);
      substances.push(structuredClone(substances[0]));
      const problems = validateContent(raw);
      expectProblem(problems, {
        file: 'registry/substances.yaml',
        path: '[2].id',
        message: /duplicate id "paracetamol".*\[0\]/,
      });
    });

    it('rejects a duplicate id across the files of a folder', async () => {
      const raw = await fresh();
      const copy = structuredClone(raw.plants[0]);
      if (!copy) throw new Error('No plant');
      copy.file = 'registry/plants/other.yaml';
      raw.plants.push(copy);
      expectProblem(validateContent(raw), {
        file: 'registry/plants/other.yaml',
        path: 'id',
        message: /duplicate id "moringa".*registry\/plants\/moringa\.yaml/,
      });
    });

    const LIST_FILE = 'registry/products/bdpm.yaml';

    /** A product like the ibuprofen fixture, with another id and substance. */
    function productLike(raw: RawContent, id: string, substance = 'ibuprofen'): Dict {
      const product = dict(structuredClone(fileOf(raw, 'products', 'ibuprofen-400').data));
      product.id = id;
      product.components = [{ substance, 'strength-mg': 200 }];
      return product;
    }

    /** Adds a generated product list file, like registry/products/bdpm.yaml. */
    function withProductList(raw: RawContent, items: Dict[]): RawContent {
      raw.products.push({ file: LIST_FILE, data: items });
      return raw;
    }

    it('accepts a product file holding a list of products named by their own ids', async () => {
      const raw = await fresh();
      withProductList(raw, [productLike(raw, 'advil-200-mg-68634000'), productLike(raw, 'other')]);
      expect(validateContent(raw)).toEqual([]);
    });

    it('checks each product of a list file on its own, with its position', async () => {
      const raw = await fresh();
      const broken = productLike(raw, 'broken');
      delete broken.route;
      withProductList(raw, [
        productLike(raw, 'fine'),
        productLike(raw, 'bad-product', 'unknown-substance'),
        broken,
      ]);
      const problems = validateContent(raw);
      expectProblem(problems, {
        file: LIST_FILE,
        path: '[1].components[0].substance',
        message: /unknown substance "unknown-substance"/,
      });
      expectProblem(problems, { file: LIST_FILE, path: '[2].route', message: /missing/ });
    });

    it('rejects a product id used both in a list file and in a one-product file', async () => {
      const raw = await fresh();
      withProductList(raw, [productLike(raw, 'ibuprofen-400')]);
      expectProblem(validateContent(raw), {
        file: LIST_FILE,
        path: '[0].id',
        message: /duplicate id "ibuprofen-400"/,
      });
    });
  });

  describe('3. references', () => {
    it('rejects a rule subject that names an unknown substance, class or plant', async () => {
      for (const [subject, name] of [
        [{ substance: 'paracetamole' }, 'substance'],
        [{ class: 'nsaids' }, 'class'],
        [{ plant: 'moringua' }, 'plant'],
      ] as const) {
        const raw = patch(await fresh(), 'rules', NSAID, (d) => {
          sub(d, 'when').subject = subject;
        });
        expectProblem(validateContent(raw), {
          file: RULE,
          path: `when.subject.${name}`,
          message: new RegExp(`unknown ${name}`),
        });
      }
    });

    it('rejects an unknown with partner, and an unknown message', async () => {
      const raw = patch(await fresh(), 'rules', 'moringa-paracetamol', (d) => {
        sub(d, 'when').requires = [{ with: { substance: 'paracetamol-x' } }];
        d.message = 'herb-drug-moringua';
      });
      const problems = validateContent(raw);
      const file = 'knowledge/rules/moringa-paracetamol.yaml';
      expectProblem(problems, {
        file,
        path: 'when.requires[0].with.substance',
        message: /unknown substance "paracetamol-x"/,
      });
      expectProblem(problems, { file, path: 'message', message: /unknown message/ });
    });

    it('rejects an unknown condition and an unknown window', async () => {
      const raw = patch(await fresh(), 'rules', 'moringa-paracetamol', (d) => {
        sub(d, 'when').requires = [{ condition: 'asthma' }];
        sub(d, 'when')['unless-conditions'] = ['malaria'];
      });
      patch(raw, 'rules', NSAID, (d) => {
        sub(d, 'when')['pregnancy-windows'] = ['40-plus'];
      });
      const problems = validateContent(raw);
      const file = 'knowledge/rules/moringa-paracetamol.yaml';
      expectProblem(problems, { file, path: 'when.requires[0].condition' });
      expectProblem(problems, { file, path: 'when.unless-conditions[0]' });
      expectProblem(problems, { file: RULE, path: 'when.pregnancy-windows[0]' });
    });

    it('rejects a plant message and a danger sign message that do not exist', async () => {
      const raw = patch(await fresh(), 'plants', 'moringa', (d) => {
        d.message = 'evidence-zero';
      });
      patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
        d.message = 'bleeding';
      });
      const problems = validateContent(raw);
      expectProblem(problems, {
        file: 'registry/plants/moringa.yaml',
        path: 'message',
        message: /unknown message "evidence-zero"/,
      });
      expectProblem(problems, {
        file: 'knowledge/danger-signs.yaml',
        path: '[1].message',
        message: /unknown message "bleeding"/,
      });
    });

    it('rejects an unknown substance in a product, an unknown class in a substance, an unknown exclusion', async () => {
      const raw = patch(await fresh(), 'products', 'ibuprofen-400', (d) => {
        dict(list(d.components)[0]).substance = 'ibuprofene';
      });
      patchEntry(raw, 'substances', 'ibuprofen', (d) => {
        d.classes = ['nsaids'];
      });
      patchEntry(raw, 'classes', 'nsaid', (d) => {
        d.excludes = ['aspirin'];
      });
      const problems = validateContent(raw);
      expectProblem(problems, {
        file: 'registry/products/ibuprofen-400.yaml',
        path: 'components[0].substance',
        message: /unknown substance "ibuprofene"/,
      });
      expectProblem(problems, {
        file: 'registry/substances.yaml',
        path: '[1].classes[0]',
        message: /unknown class "nsaids"/,
      });
      expectProblem(problems, {
        file: 'registry/classes.yaml',
        path: '[0].excludes[0]',
        message: /unknown substance "aspirin"/,
      });
    });
  });

  describe('4. danger rationale', () => {
    it('requires a rationale for a danger rule', async () => {
      const raw = patch(await fresh(), 'rules', 'moringa-toxic', (d) => {
        delete d['danger-rationale'];
      });
      expectProblem(validateContent(raw), {
        file: 'knowledge/rules/moringa-toxic.yaml',
        path: 'danger-rationale',
        message: /required.*danger/,
      });
    });

    it('rejects a blank rationale', async () => {
      const raw = patch(await fresh(), 'rules', 'moringa-toxic', (d) => {
        d['danger-rationale'] = '  ';
      });
      expectProblem(validateContent(raw), {
        file: 'knowledge/rules/moringa-toxic.yaml',
        path: 'danger-rationale',
      });
    });

    it('rejects a rationale on a rule that is not danger', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        d['danger-rationale'] = 'Because.';
      });
      expectProblem(validateContent(raw), {
        file: RULE,
        path: 'danger-rationale',
        message: /only.*danger/,
      });
    });
  });

  describe('5. evidence cap', () => {
    it('rejects a level above next-contact with evidence D, E or 0 (no silent capping)', async () => {
      for (const evidence of ['D', 'E', '0']) {
        const raw = patch(await fresh(), 'rules', NSAID, (d) => {
          d.evidence = evidence;
          d.level = 'before-next-dose';
        });
        expectProblem(validateContent(raw), { file: RULE, path: 'level', message: /evidence cap/ });
      }
    });

    it('rejects a danger rule with weak evidence unless it is a toxicity rule', async () => {
      const raw = patch(await fresh(), 'rules', 'moringa-toxic', (d) => {
        d.kind = 'condition';
      });
      expectProblem(validateContent(raw), {
        file: 'knowledge/rules/moringa-toxic.yaml',
        path: 'level',
        message: /evidence cap/,
      });
    });

    it('accepts weak evidence at next-contact, and strong evidence at any level', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        d.evidence = 'E';
        d.level = 'next-contact';
      });
      expect(validateContent(raw)).toEqual([]);
    });
  });

  describe('6. rule shape', () => {
    it('rejects strength-above-mg without a substance subject', async () => {
      for (const subject of [{ class: 'nsaid' }, { plant: 'moringa' }]) {
        const raw = patch(await fresh(), 'rules', NSAID, (d) => {
          sub(d, 'when').subject = subject;
          sub(d, 'when')['strength-above-mg'] = 100;
        });
        expectProblem(validateContent(raw), {
          file: RULE,
          path: 'when.strength-above-mg',
          message: /substance subject/,
        });
      }
    });

    it('rejects strength-above-mg on max-dose and duplicate rules (it would drop items from the sum or count)', async () => {
      for (const id of ['paracetamol-max-dose']) {
        const raw = patch(await fresh(), 'rules', id, (d) => {
          sub(d, 'when')['strength-above-mg'] = 100;
        });
        expectProblem(validateContent(raw), {
          file: `knowledge/rules/${id}.yaml`,
          path: 'when.strength-above-mg',
          message: /max-dose/,
        });
      }
      const raw = patch(await fresh(), 'rules', 'paracetamol-strong-pregnancy', (d) => {
        d.kind = 'duplicate';
      });
      expectProblem(validateContent(raw), {
        file: 'knowledge/rules/paracetamol-strong-pregnancy.yaml',
        path: 'when.strength-above-mg',
        message: /duplicate/,
      });
    });

    it('rejects max-mg-per-day on a rule that is not max-dose, and a max-dose rule without it', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        sub(d, 'when')['max-mg-per-day'] = 10;
      });
      patch(raw, 'rules', 'paracetamol-max-dose', (d) => {
        delete sub(d, 'when')['max-mg-per-day'];
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: RULE, path: 'when.max-mg-per-day', message: /max-dose/ });
      expectProblem(problems, {
        file: 'knowledge/rules/paracetamol-max-dose.yaml',
        path: 'when.max-mg-per-day',
        message: /required/,
      });
    });

    it('requires a subject except for a reminder', async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        delete sub(d, 'when').subject;
      });
      expectProblem(validateContent(raw), {
        file: RULE,
        path: 'when.subject',
        message: /required.*pregnancy/,
      });
      const reminder = patch(await fresh(), 'rules', NSAID, (d) => {
        d.kind = 'reminder';
        d.level = 'next-contact';
        delete sub(d, 'when').subject;
      });
      expect(validateContent(reminder)).toEqual([]);
    });
  });

  describe('7. messages', () => {
    it('rejects a digit in risk, in both languages, but accepts one in risk-detail', async () => {
      const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
        sub(d, 'fr').risk = 'Cela dure 3 jours.';
        sub(d, 'en').risk = 'It lasts 3 days.';
        sub(d, 'en')['risk-detail'] = 'Up to 3 days.';
      });
      const problems = validateContent(raw);
      const file = 'knowledge/messages/herb-drug-moringa.yaml';
      expectProblem(problems, { file, path: 'fr.risk', message: /digit/ });
      expectProblem(problems, { file, path: 'en.risk', message: /digit/ });
      expect(problems.filter((p) => p.path === 'en.risk-detail')).toEqual([]);
    });

    it('rejects a digit in orientation, in both languages', async () => {
      const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
        sub(d, 'fr').orientation = 'Appelez le 15.';
        sub(d, 'en').orientation = 'Go within 2 days.';
      });
      const problems = validateContent(raw);
      const file = 'knowledge/messages/herb-drug-moringa.yaml';
      expectProblem(problems, { file, path: 'fr.orientation', message: /digit/ });
      expectProblem(problems, { file, path: 'en.orientation', message: /digit/ });
    });

    it('accepts a number without a dose unit in fact and risk-detail', async () => {
      const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
        sub(d, 'fr').fact = 'Une étude chez 20 adultes.';
        sub(d, 'fr')['risk-detail'] = 'À partir de 24 semaines, près de 11 bébés sur 100.';
        sub(d, 'en').fact = 'From the 2nd trimester.';
        sub(d, 'en')['risk-detail'] = 'One or two days later, in 3 studies.';
      });
      expect(validateContent(raw)).toEqual([]);
    });

    it('rejects a dose (a number with a dose unit) in fact and risk-detail', async () => {
      const cases: [string, string, string][] = [
        ['fr', 'fact', 'Ce produit contient 500 mg de paracétamol.'],
        ['fr', 'risk-detail', 'Au-delà de 3 g par jour.'],
        ['en', 'fact', 'Take 2 tablets.'],
        ['en', 'risk-detail', 'Up to 4 times a day, 1,5 mL or 200 µg.'],
      ];
      for (const [lang, field, text] of cases) {
        const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
          sub(d, lang)[field] = text;
        });
        expectProblem(validateContent(raw), {
          file: 'knowledge/messages/herb-drug-moringa.yaml',
          path: `${lang}.${field}`,
          message: /dose/,
        });
      }
      for (const text of [
        '100mg',
        '2 comprimés',
        '1 gélule',
        '3 fois par jour',
        '2 cuillères',
        '10 UI',
        '5 ml',
        '1 dose',
        '2 per day',
        '50 mcg',
      ]) {
        const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
          sub(d, 'fr')['risk-detail'] = text;
        });
        const problems = validateContent(raw);
        expect(
          problems.some((p) => p.path === 'fr.risk-detail' && /dose/.test(p.message)),
          text,
        ).toBe(true);
      }
    });

    it('rejects forbidden wording in any field and language', async () => {
      const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
        sub(d, 'fr').fact = 'Ce produit est sûr.';
        sub(d, 'en').orientation = 'Stop taking it.';
        sub(d, 'en')['risk-detail'] = 'It is safe.';
        sub(d, 'fr')['risk-detail'] = 'Remplacez-le.';
      });
      const problems = validateContent(raw);
      const file = 'knowledge/messages/herb-drug-moringa.yaml';
      expectProblem(problems, { file, path: 'fr.fact', message: /forbidden wording.*sûr/ });
      expectProblem(problems, { file, path: 'en.orientation', message: /stop/ });
      expectProblem(problems, { file, path: 'en.risk-detail', message: /safe/ });
      expectProblem(problems, { file, path: 'fr.risk-detail', message: /remplacez/ });
    });

    it('rejects the English words the engine list blocks', async () => {
      for (const word of ['reduce', 'reduces', 'reduced', 'stop', 'stopped', 'replace']) {
        const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
          sub(d, 'en').fact = `It may ${word} the effect.`;
        });
        expectProblem(validateContent(raw), {
          file: 'knowledge/messages/herb-drug-moringa.yaml',
          path: 'en.fact',
          message: /forbidden wording.*(reduce|stop|replace)/,
        });
      }
    });

    it('rejects an em dash and an emoji', async () => {
      const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
        sub(d, 'fr').fact = `Prudence ${String.fromCodePoint(0x2014)} plante.`;
        sub(d, 'en').orientation = 'Ask the midwife \u{1F600}';
        sub(d, 'en')['risk-detail'] = `Warning ${String.fromCodePoint(0x26a0, 0xfe0f)}`;
      });
      const problems = validateContent(raw);
      const file = 'knowledge/messages/herb-drug-moringa.yaml';
      expectProblem(problems, { file, path: 'fr.fact', message: /em dash/ });
      expectProblem(problems, { file, path: 'en.orientation', message: /emoji/ });
      expectProblem(problems, { file, path: 'en.risk-detail', message: /emoji/ });
    });
  });

  describe('8. builtin messages', () => {
    it.each(['nothing-found', 'not-recognised', 'danger-sign', 'evidence-0'])(
      'rejects a pack without the %s message',
      async (id) => {
        const raw = await fresh();
        raw.messages = raw.messages.filter((f) => !f.file.endsWith(`/${id}.yaml`));
        // The plant message reference to evidence-0 also fails, which is fine.
        expectProblem(validateContent(raw), {
          file: `knowledge/messages/${id}.yaml`,
          path: '',
          message: /builtin message/,
        });
      },
    );
  });

  describe('9. engine validation', () => {
    it('runs parsePack on the built pack and maps the error to its file', async () => {
      // Schema-valid, but a herb-drug rule needs a with partner (engine rule).
      const raw = patch(await fresh(), 'rules', 'moringa-paracetamol', (d) => {
        sub(d, 'when').requires = [{ condition: 'hepatic-failure' }];
      });
      expectProblem(validateContent(raw), {
        file: 'knowledge/rules/moringa-paracetamol.yaml',
        path: '',
        message: /with partner/,
      });
    });
  });
});
