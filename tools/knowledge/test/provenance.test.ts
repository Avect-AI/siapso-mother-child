// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { loadContent, validateContent } from '../src/index.js';
import type { RawContent, RawFile } from '../src/index.js';
import {
  REPO_ROOT,
  copyOf,
  dict,
  expectProblem,
  list,
  loadValid,
  patch,
  patchEntry,
  sub,
} from './helpers.js';

const RULE = 'knowledge/rules/nsaid-pregnancy-from-20-weeks.yaml';
const NSAID = 'nsaid-pregnancy-from-20-weeks';
const SOURCES = 'knowledge/sources.yaml';

let valid: RawContent | undefined;

async function fresh(): Promise<RawContent> {
  valid ??= await loadValid();
  return copyOf(valid);
}

function ref(source: string): Record<string, string> {
  return { source, locator: 'Fixture locator', accessed: '2026-11-04' };
}

function citing(raw: RawContent, ...sources: string[]): RawContent {
  return patch(raw, 'rules', NSAID, (d) => {
    d.sources = sources.map(ref);
  });
}

function sourcesFile(raw: RawContent): RawFile {
  if (!raw.sources) throw new Error('No sources file');
  return raw.sources;
}

describe('knowledge/sources.yaml', () => {
  it('declares the allowed, fact-only and forbidden sources of the policy', async () => {
    const raw = await loadContent(REPO_ROOT);
    const data = dict(sourcesFile(raw).data);
    const ids = (key: string): unknown[] => list(data[key]).map((e) => dict(e).id);
    expect(ids('allowed')).toEqual([
      'lactmed',
      'openfda',
      'fda-dsc',
      'bdpm',
      'ansm-thesaurus',
      'literature',
    ]);
    expect(ids('fact-only')).toEqual(['who']);
    expect(ids('forbidden')).toEqual([
      'ddinter',
      'lediam',
      'e-lactancia',
      'crat',
      'theriaque',
      'vidal',
      'drugbank-full',
    ]);
  });

  it('is reported as missing when absent', async () => {
    const raw = await fresh();
    delete raw.sources;
    expectProblem(validateContent(raw), { file: SOURCES, message: /missing/ });
  });

  it('is checked against its schema', async () => {
    const raw = await fresh();
    dict(list(dict(sourcesFile(raw).data).allowed)[0]).extra = 1;
    expectProblem(validateContent(raw), { file: SOURCES, path: 'allowed[0].extra' });
  });

  it('needs a version or an access date on every source', async () => {
    const raw = await fresh();
    delete dict(list(dict(sourcesFile(raw).data).allowed)[0]).version;
    expect(validateContent(raw).some((p) => p.file === SOURCES)).toBe(true);
  });

  it('refuses a source declared twice or both allowed and forbidden', async () => {
    const raw = await fresh();
    const data = dict(sourcesFile(raw).data);
    list(data['fact-only']).push({ ...dict(list(data.allowed)[0]) });
    list(data.forbidden).push({ id: 'openfda', reason: 'x', domains: [] });
    const problems = validateContent(raw);
    expectProblem(problems, { file: SOURCES, path: 'fact-only[1].id', message: /declared twice/ });
    expectProblem(problems, { file: SOURCES, path: 'forbidden[7].id', message: /declared twice/ });
  });
});

describe('provenance rule 1: a rule cites at least one allowed source', () => {
  it('accepts a rule citing an allowed source', async () => {
    expect(validateContent(citing(await fresh(), 'bdpm'))).toEqual([]);
  });

  it('refuses a rule without any source', async () => {
    const problems = validateContent(citing(await fresh()));
    expectProblem(problems, {
      file: RULE,
      path: 'sources',
      message: /at least one allowed source/,
    });
  });
});

describe('provenance rule 2: fact-only sources never stand alone', () => {
  it('accepts a rule citing a fact-only source next to an allowed one', async () => {
    expect(validateContent(citing(await fresh(), 'who', 'lactmed'))).toEqual([]);
  });

  it('refuses a rule citing only fact-only sources', async () => {
    const problems = validateContent(citing(await fresh(), 'who'));
    expectProblem(problems, { file: RULE, path: 'sources', message: /only fact-only/ });
  });
});

describe('provenance rule 3: forbidden sources', () => {
  it('refuses a reference to a forbidden source id, even next to an allowed one', async () => {
    const problems = validateContent(citing(await fresh(), 'lactmed', 'ddinter'));
    expectProblem(problems, { file: RULE, path: 'sources[1].source', message: /forbidden/ });
  });

  it('refuses every forbidden id', async () => {
    const ids = ['ddinter', 'lediam', 'e-lactancia', 'crat', 'theriaque', 'vidal', 'drugbank-full'];
    for (const id of ids) {
      const problems = validateContent(citing(await fresh(), 'lactmed', id));
      expectProblem(problems, { file: RULE, path: 'sources[1].source', message: /forbidden/ });
    }
  });

  it('refuses a forbidden id cited by a danger sign or a plant', async () => {
    const raw = await fresh();
    patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
      d.sources = [ref('vidal')];
    });
    patch(raw, 'plants', 'moringa', (d) => {
      d.sources = [ref('crat')];
    });
    const problems = validateContent(raw);
    expectProblem(problems, {
      file: 'knowledge/danger-signs.yaml',
      path: '[1].sources[0].source',
      message: /forbidden/,
    });
    expectProblem(problems, {
      file: 'registry/plants/moringa.yaml',
      path: 'sources[0].source',
      message: /forbidden/,
    });
  });

  it('refuses a URL under a forbidden domain, its subdomains included', async () => {
    const urls = [
      'https://ddinter.scbdd.com/search',
      'http://www.vidal.fr/medicaments',
      'https://go.drugbank.com/drugs/DB00316',
      'https://sub.domain.LECRAT.fr',
      'https://e-lactancia.org:443/breastfeeding/x',
      'https://user@theriaque.org/',
      'HTTPS://WWW.THERIAQUE.ORG',
    ];
    for (const url of urls) {
      const raw = await fresh();
      patch(raw, 'rules', NSAID, (d) => {
        d.sources = [{ ...ref('lactmed'), url }];
      });
      const problems = validateContent(raw);
      expectProblem(problems, { file: RULE, path: 'sources[0].url', message: /forbidden domain/ });
    }
  });

  it('finds a forbidden URL in any string value, not only in source urls', async () => {
    const raw = await fresh();
    patchEntry(raw, 'substances', 'paracetamol', (d) => {
      d.names = { fr: 'Voir https://www.vidal.fr/x', en: 'Paracetamol' };
    });
    expectProblem(validateContent(raw), {
      file: 'registry/substances.yaml',
      path: '[0].names.fr',
      message: /forbidden domain/,
    });
  });

  it('does not take a lookalike host for a forbidden domain', async () => {
    const raw = await fresh();
    patch(raw, 'rules', NSAID, (d) => {
      d.sources = [{ ...ref('lactmed'), url: 'https://notvidal.fr/' }];
    });
    expect(validateContent(raw)).toEqual([]);
  });

  it('checks the urls of the allowed sources against the forbidden domains', async () => {
    const raw = await fresh();
    dict(list(dict(sourcesFile(raw).data).allowed)[0]).url = 'https://vidal.fr/';
    expectProblem(validateContent(raw), {
      file: SOURCES,
      path: 'allowed[0].url',
      message: /forbidden domain/,
    });
  });

  it('refuses the forbidden names in a content file, whatever the case or accents', async () => {
    const names = [
      'DDInter',
      'ddinter',
      'LEDIAM',
      'e-lactancia',
      'E-Lactancia',
      'CRAT',
      'Crat',
      'Thériaque',
      'THÉRIAQUE',
      'Theriaque',
      'Thériáque',
      'Vidal',
      'VIDAL',
      'DrugBank',
      'drugbank',
      'Drug​Bank',
      'ｄｄｉｎｔｅｒ',
    ];
    for (const name of names) {
      const raw = await fresh();
      patchEntry(raw, 'substances', 'paracetamol', (d) => {
        d.names = { fr: `Selon ${name}`, en: 'Paracetamol' };
      });
      expectProblem(validateContent(raw), {
        file: 'registry/substances.yaml',
        path: '[0].names.fr',
        message: /forbidden source name/,
      });
    }
  });

  it('finds a forbidden name in a key, a message, a locator and a comment', async () => {
    const raw = await fresh();
    patch(raw, 'messages', NSAID, (d) => {
      sub(d, 'en').fact = 'Per Vidal.';
    });
    patch(raw, 'rules', NSAID, (d) => {
      d.sources = [{ ...ref('lactmed'), locator: 'DDInter, page 2' }];
    });
    patch(raw, 'plants', 'moringa', (d) => {
      d.Theriaque = 1;
    });
    const files = raw.rules.concat(raw.messages);
    const withText = files.find((f) => f.file === 'knowledge/rules/moringa-toxic.yaml');
    if (!withText) throw new Error('fixture missing');
    withText.text =
      '# SPDX-License-Identifier: CC-BY-4.0\n# copied from LEDIAM\nid: moringa-toxic\n';
    const problems = validateContent(raw);
    expectProblem(problems, {
      file: 'knowledge/messages/nsaid-pregnancy-from-20-weeks.yaml',
      path: 'en.fact',
      message: /forbidden source name/,
    });
    expectProblem(problems, { file: RULE, path: 'sources[0].locator', message: /forbidden/ });
    expectProblem(problems, {
      file: 'registry/plants/moringa.yaml',
      path: 'Theriaque',
      message: /forbidden source name/,
    });
    expectProblem(problems, {
      file: 'knowledge/rules/moringa-toxic.yaml',
      message: /comment.*forbidden source name/,
    });
  });

  it('does not take ordinary words for a forbidden name', async () => {
    const raw = await fresh();
    patchEntry(raw, 'substances', 'paracetamol', (d) => {
      d.names = { fr: 'Aristocrate et vidalement democratie', en: 'Paracetamol' };
    });
    expect(validateContent(raw)).toEqual([]);
  });

  it('allows the forbidden names in knowledge/sources.yaml forbidden list only', async () => {
    const raw = await fresh();
    // The valid fixture already names them all in the forbidden list.
    expect(JSON.stringify(sourcesFile(raw).data)).toMatch(/ddinter/);
    expect(validateContent(raw)).toEqual([]);
    dict(list(dict(sourcesFile(raw).data).allowed)[0]).notice = 'Copied from DDInter';
    expectProblem(validateContent(raw), {
      file: SOURCES,
      path: 'allowed[0].notice',
      message: /forbidden source name/,
    });
  });

  it('scans the extra content files too (eval)', async () => {
    const raw = await fresh();
    raw.extra.push({ file: 'eval/cases.yaml', data: [{ note: 'see https://vidal.fr/' }] });
    expectProblem(validateContent(raw), {
      file: 'eval/cases.yaml',
      path: '[0].note',
      message: /forbidden domain/,
    });
  });
});

describe('provenance rule 4: every cited source is declared', () => {
  it('refuses a source id missing from sources.yaml', async () => {
    const problems = validateContent(citing(await fresh(), 'lactmed', 'made-up'));
    expectProblem(problems, {
      file: RULE,
      path: 'sources[1].source',
      message: /not declared in knowledge\/sources\.yaml/,
    });
  });

  it('applies to danger signs and plants as well', async () => {
    const raw = await fresh();
    patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
      d.sources = [ref('nowhere')];
    });
    patch(raw, 'plants', 'moringa', (d) => {
      d.sources = [ref('nowhere')];
    });
    const problems = validateContent(raw);
    expectProblem(problems, { file: 'knowledge/danger-signs.yaml', message: /not declared/ });
    expectProblem(problems, { file: 'registry/plants/moringa.yaml', message: /not declared/ });
  });
});

describe('provenance: every danger sign cites a source', () => {
  it('refuses a danger sign without any source', async () => {
    const raw = await fresh();
    patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
      d.sources = [];
    });
    expectProblem(validateContent(raw), {
      file: 'knowledge/danger-signs.yaml',
      path: '[1].sources',
      message: /at least one allowed or fact-only source/,
    });
  });

  it('refuses a danger sign whose only source is forbidden or undeclared', async () => {
    const raw = await fresh();
    patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
      d.sources = [ref('vidal')];
    });
    patchEntry(raw, 'dangerSigns', 'fever', (d) => {
      d.sources = [ref('nowhere')];
    });
    const problems = validateContent(raw);
    expectProblem(problems, { file: 'knowledge/danger-signs.yaml', path: '[1].sources' });
    expectProblem(problems, { file: 'knowledge/danger-signs.yaml', path: '[0].sources' });
  });

  it('lets a plant keep empty sources', async () => {
    const raw = await fresh();
    patch(raw, 'plants', 'moringa', (d) => {
      d.sources = [];
    });
    expect(validateContent(raw)).toEqual([]);
  });
});

describe('forbidden names: tolerant patterns', () => {
  const hidden = [
    'DD Inter',
    'DD-Inter',
    'dd_inter',
    'D.D.Inter',
    'e lactancia',
    'E.Lactancia',
    'elactancia',
    'drug bank',
    'Drug-Bank',
    'Le CRAT',
    'le-crat',
    'Vidal2',
    '2Vidal',
    'Vidal_',
    'Le Diam',
    'LE-DIAM',
    'Theriaque3',
  ];
  const ordinary = [
    'Aristocrate',
    'vidalement',
    'democratie',
    'add interaction',
    'the lactancia',
    'le diamètre',
    'crate',
    'ordinary text',
  ];

  async function withName(name: string): Promise<RawContent> {
    const raw = await fresh();
    patchEntry(raw, 'substances', 'paracetamol', (d) => {
      d.names = { fr: `Selon ${name}`, en: 'Paracetamol' };
    });
    return raw;
  }

  it('refuses compound names written with a separator, and digit suffixes', async () => {
    for (const name of hidden) {
      expectProblem(validateContent(await withName(name)), {
        file: 'registry/substances.yaml',
        path: '[0].names.fr',
        message: /forbidden source name/,
      });
    }
  });

  it('does not take ordinary words for a forbidden name', async () => {
    for (const name of ordinary) {
      expect(validateContent(await withName(name)), name).toEqual([]);
    }
  });
});

describe('provenance rule 5: danger signs and plants', () => {
  it('may cite allowed or fact-only sources', async () => {
    const raw = await fresh();
    patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
      d.sources = [ref('who')];
    });
    patch(raw, 'plants', 'moringa', (d) => {
      d.sources = [ref('who'), ref('literature')];
    });
    expect(validateContent(raw)).toEqual([]);
  });

  it('may cite a fact-only source alone', async () => {
    const raw = await fresh();
    patch(raw, 'plants', 'moringa', (d) => {
      d.sources = [ref('who')];
    });
    expect(validateContent(raw)).toEqual([]);
  });
});
