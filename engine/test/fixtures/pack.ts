// SPDX-License-Identifier: MIT
// Test-only data. This is NOT clinical content: substances, rules, levels,
// thresholds and messages exist only to exercise the engine.
import type {
  Component,
  Evidence,
  Level,
  Message,
  Pack,
  Plant,
  Product,
  Rule,
  RuleKind,
  RuleWhen,
  SourceRef,
  Substance,
} from '../../src/types.js';

const SOURCE_ID = 'fixture-source';

function ref(locator: string): SourceRef {
  return { source: SOURCE_ID, locator, accessed: '2026-11-03' };
}

function substance(id: string, classes: string[] = []): Substance {
  return { id, names: { fr: `${id} (fr)`, en: `${id} (en)` }, classes };
}

function product(id: string, components: Component[]): Product {
  return {
    id,
    names: { fr: `${id} (fr)`, en: `${id} (en)` },
    brands: [`Fixture ${id}`],
    localNames: [],
    components,
    form: 'tablet',
    route: 'oral',
    demo: true,
  };
}

function plant(id: string, latinName: string, evidence: Evidence): Plant {
  return {
    id,
    latinName,
    names: { fr: `${id} (fr)`, en: `${id} (en)` },
    localNames: [{ text: id, lang: 'fr', checked: false }],
    evidence,
    message: `fixture-plant-${id}`,
    sources: [ref(`Fixture plant record ${id}`)],
  };
}

function rule(
  id: string,
  kind: RuleKind,
  when: RuleWhen,
  level: Level,
  evidence: Evidence,
  extra: Partial<Pick<Rule, 'dangerRationale'>> = {},
): Rule {
  return {
    id,
    kind,
    when,
    level,
    evidence,
    ...extra,
    message: id,
    sources: [ref(`Fixture rule record ${id}`)],
    review: { status: 'draft', reviewers: [] },
  };
}

function fixtureMessages(lang: 'fr' | 'en', ids: string[]): Record<string, Message> {
  const messages: Record<string, Message> = {
    'nothing-found':
      lang === 'fr'
        ? {
            fact: "Rien n'a été trouvé dans notre base.",
            risk: "Cela ne veut pas dire que c'est sans risque.",
            orientation: 'Montrez cet écran à votre sage-femme ou à votre pharmacien.',
          }
        : {
            fact: 'Nothing was found in our knowledge base.',
            risk: 'This does not mean it is risk-free.',
            orientation: 'Show this screen to your midwife or pharmacist.',
          },
    'nothing-applies':
      lang === 'fr'
        ? {
            fact: 'Notre base ne contient rien sur ce produit pour cette situation (test).',
            risk: "Cela ne veut pas dire qu'il est sans risque.",
          }
        : {
            fact: 'Our knowledge base holds nothing on this product for this situation (fixture).',
            risk: 'This does not mean it is risk-free.',
          },
    'not-recognised':
      lang === 'fr'
        ? { fact: "Ce nom n'a pas été reconnu.", risk: "Nous n'avons pas d'information." }
        : { fact: 'This name was not recognised.', risk: 'We have no information.' },
    'danger-sign':
      lang === 'fr'
        ? { fact: 'Signe de danger.', risk: 'Signe de danger.' }
        : { fact: 'Danger sign.', risk: 'Danger sign.' },
    'max-dose-not-computable':
      lang === 'fr'
        ? { fact: 'Quantité totale inconnue (test).', risk: 'Risque de test.' }
        : { fact: 'Total amount unknown (fixture).', risk: 'Fixture risk.' },
    'max-dose-may-exceed':
      lang === 'fr'
        ? { fact: 'Selon la boîte (test).', risk: 'Risque de test.' }
        : { fact: 'Depends on the box (fixture).', risk: 'Fixture risk.' },
  };
  for (const id of ids) {
    messages[id] =
      lang === 'fr'
        ? { fact: `Fait de test pour ${id}.`, risk: `Risque de test pour ${id}.` }
        : { fact: `Fixture fact for ${id}.`, risk: `Fixture risk for ${id}.` };
  }
  return messages;
}

/** A fresh fixture pack on every call, so tests may derive variants freely. */
export function fixturePack(): Pack {
  const substances: Substance[] = [
    substance('ibuprofen', ['nsaid']),
    substance('paracetamol'),
    substance('codeine'),
    substance('amodiaquine', ['antimalarial']),
    substance('artesunate', ['antimalarial']),
    substance('quinine', ['antimalarial']),
    substance('sulfadoxine'),
    substance('pyrimethamine'),
    substance('sulfamethoxazole'),
    substance('trimethoprim'),
    // Read by no rule of the fixture: "nothing found".
    substance('amoxicillin'),
  ];
  const products: Product[] = [
    product('ibuprofen-400', [{ substance: 'ibuprofen', strengthMg: 400 }]),
    product('paracetamol-1000', [{ substance: 'paracetamol', strengthMg: 1000 }]),
    product('paracetamol-500', [{ substance: 'paracetamol', strengthMg: 500 }]),
    product('sp', [
      { substance: 'sulfadoxine', strengthMg: 500 },
      { substance: 'pyrimethamine', strengthMg: 25 },
    ]),
    product('cotrimoxazole', [
      { substance: 'sulfamethoxazole', strengthMg: 800 },
      { substance: 'trimethoprim', strengthMg: 160 },
    ]),
    product('codeine-syrup', [{ substance: 'codeine' }]),
    product('asaq', [
      { substance: 'artesunate', strengthMg: 100 },
      { substance: 'amodiaquine', strengthMg: 270 },
    ]),
    product('quinine-300', [{ substance: 'quinine', strengthMg: 300 }]),
    product('amoxicillin-500', [{ substance: 'amoxicillin', strengthMg: 500 }]),
  ];
  const plants: Plant[] = [
    plant('moringa', 'Moringa oleifera', 'B'),
    plant('kinkeliba', 'Combretum micranthum', '0'),
    plant('clay', 'Kaolin clay (not a plant)', 'C'),
    plant('castor-oil', 'Ricinus communis', 'C'),
  ];
  const rules: Rule[] = [
    rule(
      'fixture-pregnancy-nsaid-20-plus',
      'pregnancy',
      { subject: { class: 'nsaid' }, pregnancyWindows: ['20-29', '30-plus'] },
      'before-next-dose',
      'A',
    ),
    rule(
      'fixture-breastfeeding-codeine',
      'breastfeeding',
      { subject: { substance: 'codeine' }, breastfeeding: { babyAgeWeeksMax: 26 } },
      'before-next-dose',
      'B',
    ),
    rule(
      'fixture-breastfeeding-quinine-premature',
      'breastfeeding',
      { subject: { substance: 'quinine' }, breastfeeding: { premature: true } },
      'next-contact',
      'C',
    ),
    rule(
      'fixture-interaction-quinine-antimalarial',
      'interaction',
      { subject: { substance: 'quinine' }, requires: [{ with: { class: 'antimalarial' } }] },
      'before-next-dose',
      'B',
    ),
    // Declared above its evidence cap on purpose: the engine must cap it.
    rule(
      'fixture-herb-drug-moringa-sp',
      'herb-drug',
      { subject: { plant: 'moringa' }, requires: [{ with: { substance: 'sulfadoxine' } }] },
      'before-next-dose',
      'D',
    ),
    // Toxicity is never capped by evidence.
    rule(
      'fixture-toxicity-clay',
      'toxicity',
      { subject: { plant: 'clay' } },
      'before-next-dose',
      'D',
    ),
    rule(
      'fixture-toxicity-castor-oil-term-scar',
      'toxicity',
      {
        subject: { plant: 'castor-oil' },
        requires: [{ condition: 'uterine-scar' }],
        pregnancyWindows: ['30-plus'],
      },
      'danger',
      'C',
      { dangerRationale: 'Fixture rationale: immediate vital risk.' },
    ),
    rule(
      'fixture-duplicate-paracetamol',
      'duplicate',
      { subject: { substance: 'paracetamol' } },
      'before-next-dose',
      'A',
    ),
    rule(
      'fixture-max-dose-paracetamol',
      'max-dose',
      { subject: { substance: 'paracetamol' }, maxMgPerDay: 4000 },
      'before-next-dose',
      'A',
    ),
    rule(
      'fixture-condition-sp-cotrimoxazole',
      'condition',
      {
        subject: { substance: 'sulfadoxine' },
        requires: [{ condition: 'hiv-cotrimoxazole' }, { with: { substance: 'sulfamethoxazole' } }],
      },
      'before-next-dose',
      'B',
    ),
    rule(
      'fixture-contraception-info-artesunate',
      'contraception-info',
      { subject: { substance: 'artesunate' } },
      'next-contact',
      'E',
    ),
    rule(
      'fixture-reminder-iptp',
      'reminder',
      {
        pregnancyWindows: ['12-19', '20-29', '30-plus'],
        unlessConditions: ['hiv-cotrimoxazole'],
        unlessWith: [{ substance: 'sulfamethoxazole' }],
      },
      'next-contact',
      'A',
    ),
  ];
  const messageIds = [...rules.map((r) => r.message), ...plants.map((p) => p.message)];
  return {
    schema: 1,
    version: '0.0.0-fixture',
    date: '2026-11-03',
    clinicallyValidated: false,
    substances,
    classes: [
      { id: 'nsaid', names: { fr: 'AINS (test)', en: 'NSAID (fixture)' }, excludes: [] },
      {
        id: 'antimalarial',
        names: { fr: 'Antipaludique (test)', en: 'Antimalarial (fixture)' },
        excludes: [],
      },
    ],
    products,
    plants,
    rules,
    dangerSigns: [
      {
        id: 'fever',
        group: 'pregnancy',
        label: { fr: 'Fièvre', en: 'Fever' },
        sources: [ref('Fixture danger sign fever')],
      },
      {
        id: 'bleeding',
        group: 'pregnancy',
        label: { fr: 'Saignement', en: 'Bleeding' },
        sources: [ref('Fixture danger sign bleeding')],
      },
    ],
    sources: [
      {
        id: SOURCE_ID,
        name: 'Fixture source (test data, not clinical content)',
        licence: 'CC-BY-4.0',
        url: 'https://example.org/fixture',
      },
    ],
    messages: { fr: fixtureMessages('fr', messageIds), en: fixtureMessages('en', messageIds) },
  };
}
