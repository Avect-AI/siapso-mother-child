// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { buildPack, generateNotice } from '../src/index.js';
import type { RawContent } from '../src/index.js';
import { copyOf, dict, list, loadValid, patch, patchEntry } from './helpers.js';

const NSAID = 'nsaid-pregnancy-from-20-weeks';

let valid: RawContent | undefined;

async function fresh(): Promise<RawContent> {
  valid ??= await loadValid();
  return copyOf(valid);
}

function ref(source: string): Record<string, string> {
  return { source, locator: 'Fixture locator', accessed: '2026-11-04' };
}

describe('generateNotice', () => {
  it('starts with the project name, the copyright line and the licences', async () => {
    const notice = generateNotice(await fresh());
    expect(notice.startsWith('SIAPSO Mother-Child\nCopyright 2026 AVECT AI SARL\n')).toBe(true);
    expect(notice).toMatch(/Code: MIT/);
    expect(notice).toMatch(/Content \(knowledge\/ and registry\/\): CC BY 4\.0/);
    expect(notice.endsWith('\n')).toBe(true);
    expect(notice.endsWith('\n\n')).toBe(false);
  });

  it('has one block per allowed source actually cited, in id order', async () => {
    const notice = generateNotice(await fresh());
    // The fixture cites lactmed, openfda and literature (rules, danger signs, plants).
    const names = [
      'Drugs and Lactation Database (LactMed)',
      'openFDA drug labels',
      'Peer-reviewed literature',
    ];
    const positions = names.map((n) => notice.indexOf(n));
    expect(positions.every((p) => p > 0)).toBe(true);
    // id order: lactmed, literature, openfda
    expect(notice.indexOf(names[0] ?? '')).toBeLessThan(notice.indexOf(names[2] ?? ''));
    expect(notice.indexOf(names[2] ?? '')).toBeLessThan(notice.indexOf(names[1] ?? ''));
    expect(notice).not.toMatch(/Thésaurus/);
    expect(notice).not.toMatch(/Base de données publique/);
    expect(notice).toMatch(/Publisher: US National Library of Medicine/);
    expect(notice).toMatch(/Licence: Public domain/);
    expect(notice).toMatch(/Version: Record date or bulk archive date/);
    expect(notice).toContain('LactMed, US National Library of Medicine, public domain.');
  });

  it('lists the fact-only sources cited after the allowed ones', async () => {
    const raw = await fresh();
    patch(raw, 'plants', 'moringa', (d) => {
      d.sources = [ref('who'), ref('literature')];
    });
    const notice = generateNotice(raw);
    const who = notice.indexOf('World Health Organization guidelines and lists');
    expect(who).toBeGreaterThan(notice.indexOf('openFDA drug labels'));
    expect(notice).toMatch(/Facts only/);
    expect(notice).toContain('Licence: CC BY-NC-SA 3.0 IGO');
  });

  it('leaves out the fact-only section when none is cited', async () => {
    const raw = await fresh();
    patchEntry(raw, 'dangerSigns', 'fever', (d) => {
      d.sources = [ref('literature')];
    });
    expect(generateNotice(raw)).not.toMatch(/Facts only/);
  });

  it('lists a source once however often it is cited', async () => {
    const raw = await fresh();
    patch(raw, 'rules', NSAID, (d) => {
      d.sources = [ref('lactmed'), ref('lactmed')];
    });
    const notice = generateNotice(raw);
    expect(notice.split('Drugs and Lactation Database (LactMed)')).toHaveLength(2);
  });

  it('uses the access date when a source has no version', async () => {
    const raw = await fresh();
    const lactmed = dict(list(dict(raw.sources?.data).allowed)[0]);
    delete lactmed.version;
    lactmed.accessed = '2026-10-31';
    expect(generateNotice(raw)).toContain('Accessed: 2026-10-31');
  });

  it('is deterministic and carries no date of generation', async () => {
    const raw = await fresh();
    const first = generateNotice(raw);
    expect(generateNotice(copyOf(raw))).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(first).not.toContain('\r');
  });

  it('does not depend on the order the sources are cited in', async () => {
    const a = await fresh();
    const b = await fresh();
    patch(a, 'rules', NSAID, (d) => {
      d.sources = [ref('openfda'), ref('bdpm')];
    });
    patch(b, 'rules', NSAID, (d) => {
      d.sources = [ref('bdpm'), ref('openfda')];
    });
    expect(generateNotice(a)).toBe(generateNotice(b));
  });
});

describe('pack sources', () => {
  it('holds the cited allowed and fact-only sources, sorted by id', async () => {
    const raw = await fresh();
    patchEntry(raw, 'dangerSigns', 'bleeding', (d) => {
      d.sources = [ref('who')];
    });
    // Their French words and the language of their documents too (build.test.ts).
    expect(buildPack(raw).sources).toMatchObject([
      {
        id: 'lactmed',
        name: 'Drugs and Lactation Database (LactMed)',
        licence: 'Public domain',
        url: 'https://www.ncbi.nlm.nih.gov/books/NBK501922/',
        version: 'Record date or bulk archive date, given in each citation',
      },
      {
        id: 'literature',
        name: 'Peer-reviewed literature',
        licence: 'Cited by reference; summarised in our own words',
        url: 'https://pubmed.ncbi.nlm.nih.gov/',
        version: 'Reference given in each citation',
      },
      {
        id: 'openfda',
        name: 'openFDA drug labels',
        licence: 'CC0 1.0 / public domain',
        url: 'https://open.fda.gov/',
        version: 'Label version or access date, given in each citation',
      },
      {
        id: 'who',
        name: 'World Health Organization guidelines and lists',
        licence: 'CC BY-NC-SA 3.0 IGO',
        url: 'https://www.who.int/',
        version: 'Edition given in each citation',
      },
    ]);
  });
});
