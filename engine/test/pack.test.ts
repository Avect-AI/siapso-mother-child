// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { PackError, parsePack } from '../src/index.js';
import type { Pack, Rule } from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

/** A fixture pack changed by `change`, as untyped JSON. */
function broken(change: (pack: Pack) => void): unknown {
  const pack = fixturePack();
  change(pack);
  return pack;
}

/** Writes a value that the Pack type would not allow. */
function set(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`No fixture entry at ${String(index)}`);
  return value;
}

function rule(pack: Pack, id: string): Rule {
  const found = pack.rules.find((r) => r.id === id);
  if (!found) throw new Error(`No fixture rule ${id}`);
  return found;
}

function errorOf(json: unknown): PackError {
  try {
    parsePack(json);
  } catch (error) {
    if (error instanceof PackError) return error;
    throw error;
  }
  throw new Error('parsePack did not throw');
}

describe('parsePack', () => {
  it('accepts the fixture pack and returns it typed, without modifying it', () => {
    const json = deepFreeze(fixturePack());
    expect(parsePack(json)).toBe(json);
    expect(json).toStrictEqual(fixturePack());
  });

  it('accepts the fixture pack after a JSON round trip', () => {
    const json: unknown = JSON.parse(JSON.stringify(fixturePack()));
    expect(parsePack(json)).toStrictEqual(fixturePack());
  });

  it('throws a PackError, which is an Error with its own name', () => {
    const error = errorOf(null);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PackError');
  });

  it('refuses a value that is not a pack object', () => {
    for (const json of [null, undefined, 'pack', 1, []]) {
      expect(() => parsePack(json)).toThrow(PackError);
    }
  });

  it('refuses another schema', () => {
    const error = errorOf(
      broken((p) => {
        set(p, 'schema', 2);
      }),
    );
    expect(error.message).toMatch(/schema/);
    expect(error.message).toMatch(/2/);
  });

  it('refuses invalid pack identity fields', () => {
    expect(
      errorOf(
        broken((p) => {
          set(p, 'version', 3);
        }),
      ).message,
    ).toMatch(/version/);
    expect(
      errorOf(
        broken((p) => {
          set(p, 'date', '');
        }),
      ).message,
    ).toMatch(/date/);
    expect(
      errorOf(
        broken((p) => {
          set(p, 'clinicallyValidated', 'no');
        }),
      ).message,
    ).toMatch(/clinicallyValidated/);
  });

  it('refuses a collection that is not an array', () => {
    for (const name of [
      'substances',
      'classes',
      'products',
      'plants',
      'rules',
      'dangerSigns',
      'sources',
    ]) {
      const error = errorOf(
        broken((p) => {
          set(p, name, {});
        }),
      );
      expect(error.message, name).toMatch(new RegExp(name));
    }
  });

  it('refuses an entry without an id, naming its position', () => {
    const error = errorOf(
      broken((p) => {
        set(at(p.products, 2), 'id', '');
      }),
    );
    expect(error.message).toMatch(/products\[2\]/);
    expect(
      errorOf(
        broken((p) => {
          set(p.rules, '0', 'rule');
        }),
      ).message,
    ).toMatch(/rules\[0\]/);
  });

  it('refuses a duplicate id, naming the collection and the id', () => {
    const error = errorOf(
      broken((p) => {
        p.products.push({ ...at(p.products, 2), brands: [] });
      }),
    );
    expect(error.message).toMatch(/products/);
    expect(error.message).toMatch(/paracetamol-500/);
    expect(error.message).toMatch(/duplicate/);
  });

  it('refuses a missing rule message, naming the rule, the message and the language', () => {
    const error = errorOf(
      broken((p) => {
        rule(p, 'fixture-toxicity-clay').message = 'fixture-missing-message';
      }),
    );
    expect(error.message).toMatch(/fixture-toxicity-clay/);
    expect(error.message).toMatch(/fixture-missing-message/);
    const english = errorOf(
      broken((p) => {
        delete p.messages.en['fixture-duplicate-paracetamol'];
      }),
    );
    expect(english.message).toMatch(/fixture-duplicate-paracetamol/);
    expect(english.message).toMatch(/messages\.en/);
  });

  it('refuses a missing plant message', () => {
    const error = errorOf(
      broken((p) => {
        delete p.messages.fr['fixture-plant-kinkeliba'];
      }),
    );
    expect(error.message).toMatch(/plants "kinkeliba"/);
    expect(error.message).toMatch(/messages\.fr/);
  });

  it('refuses a missing builtin message', () => {
    for (const id of [
      'nothing-found',
      'nothing-applies',
      'not-recognised',
      'danger-sign',
      'max-dose-not-computable',
    ]) {
      const error = errorOf(
        broken((p) => {
          Reflect.deleteProperty(p.messages.en, id);
        }),
      );
      expect(error.message, id).toMatch(new RegExp(id));
      expect(error.message, id).toMatch(/messages\.en/);
    }
  });

  it('refuses an unknown substance, class or plant reference, naming the faulty id', () => {
    const cases: [(p: Pack) => void, RegExp[]][] = [
      [
        (p) => {
          at(at(p.products, 3).components, 0).substance = 'sulfadoxin';
        },
        [/products "sp"/, /sulfadoxin/],
      ],
      [
        (p) => {
          at(p.substances, 0).classes = ['nsaids'];
        },
        [/substances "ibuprofen"/, /nsaids/],
      ],
      [
        (p) => {
          at(p.classes, 0).excludes = ['aspirin'];
        },
        [/classes "nsaid"/, /aspirin/],
      ],
      [
        (p) => {
          rule(p, 'fixture-pregnancy-nsaid-20-plus').when.subject = { class: 'nsaids' };
        },
        [/fixture-pregnancy-nsaid-20-plus/, /nsaids/],
      ],
      [
        (p) => {
          rule(p, 'fixture-toxicity-clay').when.subject = { plant: 'kaolin' };
        },
        [/fixture-toxicity-clay/, /kaolin/],
      ],
      [
        (p) => {
          rule(p, 'fixture-condition-sp-cotrimoxazole').when.requires = [
            { with: { substance: 'cotrimoxazol' } },
          ];
        },
        [/fixture-condition-sp-cotrimoxazole/, /cotrimoxazol/],
      ],
    ];
    for (const [change, patterns] of cases) {
      const error = errorOf(broken(change));
      for (const pattern of patterns) expect(error.message).toMatch(pattern);
    }
  });

  it('refuses a rule level, evidence or kind outside the allowed values', () => {
    const level = errorOf(
      broken((p) => {
        set(rule(p, 'fixture-toxicity-clay'), 'level', 'safe');
      }),
    );
    expect(level.message).toMatch(/fixture-toxicity-clay/);
    expect(level.message).toMatch(/level/);
    const evidence = errorOf(
      broken((p) => {
        set(rule(p, 'fixture-herb-drug-moringa-sp'), 'evidence', 'd');
      }),
    );
    expect(evidence.message).toMatch(/fixture-herb-drug-moringa-sp/);
    expect(evidence.message).toMatch(/evidence/);
    const kind = errorOf(
      broken((p) => {
        set(rule(p, 'fixture-toxicity-clay'), 'kind', 'poison');
      }),
    );
    expect(kind.message).toMatch(/kind/);
    const plantEvidence = errorOf(
      broken((p) => {
        set(at(p.plants, 0), 'evidence', 'F');
      }),
    );
    expect(plantEvidence.message).toMatch(/plants "moringa"/);
  });

  it('refuses rule conditions that could silently never apply', () => {
    const subject = errorOf(
      broken((p) => {
        delete rule(p, 'fixture-toxicity-clay').when.subject;
      }),
    );
    expect(subject.message).toMatch(/fixture-toxicity-clay/);
    expect(subject.message).toMatch(/subject/);
    expect(
      errorOf(
        broken((p) => {
          delete rule(p, 'fixture-max-dose-paracetamol').when.maxMgPerDay;
        }),
      ).message,
    ).toMatch(/maxMgPerDay/);
    expect(
      errorOf(
        broken((p) => {
          rule(p, 'fixture-max-dose-paracetamol').when.maxMgPerDay = 0;
        }),
      ).message,
    ).toMatch(/maxMgPerDay/);
    expect(
      errorOf(
        broken((p) => {
          rule(p, 'fixture-pregnancy-nsaid-20-plus').when.pregnancyWindows = [];
        }),
      ).message,
    ).toMatch(/pregnancyWindows/);
  });

  it('refuses an interaction or herb-drug rule without a with partner', () => {
    const cases: [(p: Pack) => void, string][] = [
      [
        (p) => {
          delete rule(p, 'fixture-interaction-quinine-antimalarial').when.requires;
        },
        'fixture-interaction-quinine-antimalarial',
      ],
      [
        (p) => {
          rule(p, 'fixture-interaction-quinine-antimalarial').when.requires = [
            { condition: 'renal-failure' },
          ];
        },
        'fixture-interaction-quinine-antimalarial',
      ],
      [
        (p) => {
          delete rule(p, 'fixture-herb-drug-moringa-sp').when.requires;
        },
        'fixture-herb-drug-moringa-sp',
      ],
      [
        (p) => {
          rule(p, 'fixture-herb-drug-moringa-sp').when.requires = [
            { condition: 'hiv-cotrimoxazole' },
          ];
        },
        'fixture-herb-drug-moringa-sp',
      ],
    ];
    for (const [change, ruleId] of cases) {
      const error = errorOf(broken(change));
      expect(error.message).toContain(`rules "${ruleId}"`);
      expect(error.message).toMatch(/with/);
    }
  });

  it('refuses a herb-drug rule that is not a plant plus a medicine', () => {
    const subject = errorOf(
      broken((p) => {
        rule(p, 'fixture-herb-drug-moringa-sp').when.subject = { substance: 'quinine' };
      }),
    );
    expect(subject.message).toContain('rules "fixture-herb-drug-moringa-sp"');
    expect(subject.message).toMatch(/subject/);
    expect(subject.message).toMatch(/plant/);
    const partner = errorOf(
      broken((p) => {
        rule(p, 'fixture-herb-drug-moringa-sp').when.requires = [
          { with: { substance: 'sulfadoxine' } },
          { with: { plant: 'kinkeliba' } },
        ];
      }),
    );
    expect(partner.message).toContain('rules "fixture-herb-drug-moringa-sp"');
    expect(partner.message).toMatch(/requires\[1\]\.with/);
    // A class partner is a medicine too.
    expect(() =>
      parsePack(
        broken((p) => {
          rule(p, 'fixture-herb-drug-moringa-sp').when.requires = [
            { with: { class: 'antimalarial' } },
          ];
        }),
      ),
    ).not.toThrow();
  });

  it('refuses unknown keys in rule conditions, naming the rule and the key', () => {
    const cases: [(p: Pack) => void, string, string][] = [
      [
        (p) => {
          const when = rule(p, 'fixture-pregnancy-nsaid-20-plus').when;
          set(when, 'pregnancyWindow', when.pregnancyWindows);
          delete when.pregnancyWindows;
        },
        'fixture-pregnancy-nsaid-20-plus',
        'pregnancyWindow',
      ],
      [
        (p) => {
          set(rule(p, 'fixture-pregnancy-nsaid-20-plus').when, 'pregnancyWindow', ['lt12']);
        },
        'fixture-pregnancy-nsaid-20-plus',
        'pregnancyWindow',
      ],
      [
        (p) => {
          set(rule(p, 'fixture-breastfeeding-codeine').when, 'breastfeeding', {
            babyAgeWeekMax: 26,
          });
        },
        'fixture-breastfeeding-codeine',
        'babyAgeWeekMax',
      ],
      [
        (p) => {
          set(rule(p, 'fixture-condition-sp-cotrimoxazole').when, 'requires', [
            { condition: 'hiv-cotrimoxazole', longTerm: true },
          ]);
        },
        'fixture-condition-sp-cotrimoxazole',
        'longTerm',
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay').when, 'subject', { plant: 'clay', form: 'powder' });
        },
        'fixture-toxicity-clay',
        'form',
      ],
      [
        (p) => {
          set(rule(p, 'fixture-interaction-quinine-antimalarial').when, 'requires', [
            { with: { class: 'antimalarial', excludes: [] } },
          ]);
        },
        'fixture-interaction-quinine-antimalarial',
        'excludes',
      ],
    ];
    for (const [change, ruleId, key] of cases) {
      const error = errorOf(broken(change));
      expect(error.message, key).toContain(`rules "${ruleId}"`);
      expect(error.message, key).toContain(`unknown key "${key}"`);
    }
  });

  it('refuses an empty requirement list', () => {
    const error = errorOf(
      broken((p) => {
        rule(p, 'fixture-toxicity-clay').when.requires = [];
      }),
    );
    expect(error.message).toContain('rules "fixture-toxicity-clay"');
    expect(error.message).toMatch(/requires/);
  });

  it('requires a danger rationale on a danger rule, and only there', () => {
    for (const rationale of [undefined, '', '   ']) {
      const error = errorOf(
        broken((p) => {
          const castor = rule(p, 'fixture-toxicity-castor-oil-term-scar');
          if (rationale === undefined) delete castor.dangerRationale;
          else castor.dangerRationale = rationale;
        }),
      );
      expect(error.message, String(rationale)).toContain(
        'rules "fixture-toxicity-castor-oil-term-scar"',
      );
      expect(error.message, String(rationale)).toMatch(/dangerRationale/);
    }
    const danger = errorOf(
      broken((p) => {
        rule(p, 'fixture-toxicity-clay').level = 'danger';
      }),
    );
    expect(danger.message).toContain('rules "fixture-toxicity-clay"');
    expect(danger.message).toMatch(/dangerRationale/);
    const notDanger = errorOf(
      broken((p) => {
        rule(p, 'fixture-toxicity-clay').dangerRationale = 'Fixture rationale.';
      }),
    );
    expect(notDanger.message).toContain('rules "fixture-toxicity-clay"');
    expect(notDanger.message).toMatch(/dangerRationale/);
    expect(notDanger.message).toMatch(/before-next-dose/);
  });

  it('refuses malformed rule conditions', () => {
    const changes: [(p: Pack) => void, RegExp][] = [
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay'), 'when', []);
        },
        /when/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay').when, 'subject', { plant: 'clay', class: 'x' });
        },
        /subject/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay').when, 'subject', { plant: '' });
        },
        /plant/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay').when, 'requires', [{ condition: 'flu' }]);
        },
        /condition/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay').when, 'requires', [
            { condition: 'uterine-scar', with: { plant: 'clay' } },
          ]);
        },
        /requires\[0\]/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay').when, 'requires', {});
        },
        /requires/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-reminder-iptp').when, 'unlessConditions', ['hiv']);
        },
        /unlessConditions/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-pregnancy-nsaid-20-plus').when, 'pregnancyWindows', ['20-30']);
        },
        /pregnancyWindows/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-breastfeeding-codeine').when, 'breastfeeding', {
            babyAgeWeeksMax: -1,
          });
        },
        /babyAgeWeeksMax/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-breastfeeding-codeine').when, 'breastfeeding', { premature: 1 });
        },
        /premature/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay'), 'dangerRationale', 3);
        },
        /dangerRationale/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay'), 'review', { status: 'ok' });
        },
        /review/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay'), 'review', {
            status: 'validated',
            reviewers: [{ name: 'A' }],
          });
        },
        /role/,
      ],
      [
        (p) => {
          set(rule(p, 'fixture-toxicity-clay'), 'sources', [{ source: 'x' }]);
        },
        /locator/,
      ],
    ];
    for (const [change, pattern] of changes) {
      const error = errorOf(broken(change));
      expect(error.message).toMatch(/fixture-/);
      expect(error.message).toMatch(pattern);
    }
  });

  it('refuses malformed registry entries', () => {
    const changes: [(p: Pack) => void, RegExp][] = [
      [
        (p) => {
          set(at(p.substances, 0), 'names', { fr: 'x' });
        },
        /substances "ibuprofen".*en/,
      ],
      [
        (p) => {
          set(at(p.classes, 0), 'excludes', 'none');
        },
        /classes "nsaid".*excludes/,
      ],
      [
        (p) => {
          set(at(p.products, 0), 'demo', 'yes');
        },
        /products "ibuprofen-400".*demo/,
      ],
      [
        (p) => {
          set(at(p.products, 0), 'brands', [1]);
        },
        /products "ibuprofen-400".*brands/,
      ],
      [
        (p) => {
          set(at(p.products, 0), 'components', [{ substance: 'ibuprofen', strengthMg: -4 }]);
        },
        /strengthMg/,
      ],
      [
        (p) => {
          set(at(p.products, 0), 'localNames', [{ text: 'x', lang: 'de', checked: true }]);
        },
        /lang/,
      ],
      [
        (p) => {
          set(at(p.plants, 1), 'localNames', [{ text: 'x', lang: 'wo', checked: 'no' }]);
        },
        /checked/,
      ],
      [
        (p) => {
          set(at(p.plants, 1), 'latinName', null);
        },
        /plants "kinkeliba".*latinName/,
      ],
      [
        (p) => {
          set(at(p.dangerSigns, 0), 'group', 'adult');
        },
        /dangerSigns "fever".*group/,
      ],
      [
        (p) => {
          set(at(p.sources, 0), 'version', 2);
        },
        /sources "fixture-source".*version/,
      ],
    ];
    for (const [change, pattern] of changes) {
      expect(errorOf(broken(change)).message).toMatch(pattern);
    }
  });

  it('refuses malformed messages', () => {
    expect(
      errorOf(
        broken((p) => {
          set(p, 'messages', []);
        }),
      ).message,
    ).toMatch(/messages/);
    expect(
      errorOf(
        broken((p) => {
          set(p.messages, 'en', null);
        }),
      ).message,
    ).toMatch(/messages\.en/);
    expect(
      errorOf(
        broken((p) => {
          set(p.messages.fr, 'nothing-found', { fact: 'x' });
        }),
      ).message,
    ).toMatch(/messages\.fr "nothing-found".*risk/);
    expect(
      errorOf(
        broken((p) => {
          set(p.messages.en, 'danger-sign', { fact: 'x', risk: 'y', orientation: false });
        }),
      ).message,
    ).toMatch(/orientation/);
  });
});

describe('parsePack references and formats', () => {
  it('refuses a product without any component', () => {
    const error = errorOf(
      broken((p) => {
        at(p.products, 0).components = [];
      }),
    );
    expect(error.message).toMatch(/products "ibuprofen-400"\.components/);
    expect(error.message).toMatch(/must not be empty/);
  });

  it('refuses a pack date that is not an ISO calendar date (YYYY-MM-DD)', () => {
    for (const date of [
      '2026-11-3',
      '03/11/2026',
      '2026-11-03T00:00:00Z',
      '2026-02-30',
      '2026-13-01',
    ]) {
      const error = errorOf(
        broken((p) => {
          p.date = date;
        }),
      );
      expect(error.message, date).toMatch(/pack\.date/);
      expect(error.message, date).toMatch(/YYYY-MM-DD/);
    }
    expect(() =>
      parsePack(
        broken((p) => {
          p.date = '2028-02-29';
        }),
      ),
    ).not.toThrow();
  });

  it('refuses a cited source id that pack.sources does not list', () => {
    const changes: [(pack: Pack) => void, RegExp][] = [
      [
        (p) => {
          at(rule(p, 'fixture-toxicity-clay').sources, 0).source = 'not-listed';
        },
        /rules "fixture-toxicity-clay".*unknown source "not-listed"/,
      ],
      [
        (p) => {
          at(at(p.plants, 0).sources, 0).source = 'not-listed';
        },
        /plants "moringa".*unknown source "not-listed"/,
      ],
      [
        (p) => {
          at(at(p.dangerSigns, 0).sources, 0).source = 'not-listed';
        },
        /dangerSigns "fever".*unknown source "not-listed"/,
      ],
      [
        (p) => {
          p.sources = [];
        },
        /unknown source "fixture-source"/,
      ],
    ];
    for (const [change, pattern] of changes) {
      expect(errorOf(broken(change)).message).toMatch(pattern);
    }
  });
});
