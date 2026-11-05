// SPDX-License-Identifier: MIT
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContent, validateContent } from '../src/index.js';
import { expectProblem, FIXTURE_ROOT, loadValid, REPO_ROOT, tempCopy } from './helpers.js';

describe('loadContent', () => {
  it('parses every YAML file and keeps its path relative to the root', async () => {
    const raw = await loadValid();
    expect(raw.problems).toEqual([]);
    expect(raw.pack?.file).toBe('knowledge/pack.yaml');
    expect(raw.pack?.data).toEqual({
      version: '0.0.1',
      date: '2026-11-04',
      'clinically-validated': false,
    });
    expect(raw.rules.map((f) => f.file)).toEqual([
      'knowledge/rules/iptp-reminder.yaml',
      'knowledge/rules/moringa-paracetamol.yaml',
      'knowledge/rules/moringa-toxic.yaml',
      'knowledge/rules/nsaid-pregnancy-from-20-weeks.yaml',
      'knowledge/rules/paracetamol-max-dose.yaml',
      'knowledge/rules/paracetamol-strong-pregnancy.yaml',
    ]);
    expect(raw.messages).toHaveLength(12);
    expect(raw.products.map((f) => f.file)).toEqual([
      'registry/products/ibuprofen-400.yaml',
      'registry/products/paracetamol-1000.yaml',
    ]);
    expect(raw.plants.map((f) => f.file)).toEqual(['registry/plants/moringa.yaml']);
    expect(raw.substances?.file).toBe('registry/substances.yaml');
    expect(raw.classes?.file).toBe('registry/classes.yaml');
    expect(raw.dangerSigns?.file).toBe('knowledge/danger-signs.yaml');
  });

  it('keeps dates as text, not as date objects', async () => {
    const raw = await loadValid();
    const rule = raw.rules.find((f) => f.file.endsWith('nsaid-pregnancy-from-20-weeks.yaml'));
    expect(JSON.stringify(rule?.data)).toContain('"accessed":"2026-11-04"');
  });

  it('loads the schemas from the repository', async () => {
    const raw = await loadValid();
    expect(Object.keys(raw.schemas).sort()).toEqual([
      'class',
      'danger-sign',
      'message',
      'pack-meta',
      'plant',
      'product',
      'rule',
      'sources',
      'substance',
    ]);
  });

  it('loads the schemas from the content root by default', async () => {
    const raw = await loadContent(REPO_ROOT);
    expect(raw.problems).toEqual([]);
    expect(Object.keys(raw.schemas)).toHaveLength(9);
  });

  it('reports YAML syntax errors with the file', async () => {
    const copy = await tempCopy();
    try {
      await writeFile(
        path.join(copy.root, 'knowledge/rules/moringa-toxic.yaml'),
        '# SPDX-License-Identifier: CC-BY-4.0\nid: [unclosed\n',
      );
      const raw = await loadContent(copy.root, REPO_ROOT);
      expectProblem(raw.problems, { file: 'knowledge/rules/moringa-toxic.yaml', message: /YAML/ });
      expect(raw.rules.map((f) => f.file)).not.toContain('knowledge/rules/moringa-toxic.yaml');
    } finally {
      await copy.remove();
    }
  });

  it('reports a duplicate key', async () => {
    const copy = await tempCopy();
    try {
      await writeFile(
        path.join(copy.root, 'knowledge/pack.yaml'),
        '# SPDX-License-Identifier: CC-BY-4.0\nversion: 0.0.1\nversion: 0.0.2\ndate: 2026-11-04\nclinically-validated: false\n',
      );
      const raw = await loadContent(copy.root, REPO_ROOT);
      expectProblem(raw.problems, { file: 'knowledge/pack.yaml', message: /YAML/ });
    } finally {
      await copy.remove();
    }
  });

  it('requires the SPDX licence line first in every YAML file', async () => {
    const copy = await tempCopy();
    try {
      await writeFile(
        path.join(copy.root, 'registry/classes.yaml'),
        '- id: nsaid\n  names: { fr: AINS, en: NSAID }\n  excludes: []\n',
      );
      const raw = await loadContent(copy.root, REPO_ROOT);
      expectProblem(raw.problems, {
        file: 'registry/classes.yaml',
        path: '',
        message: /SPDX-License-Identifier: CC-BY-4\.0/,
      });
    } finally {
      await copy.remove();
    }
  });

  it('refuses a file that is not YAML in a content folder, but ignores .gitkeep', async () => {
    const copy = await tempCopy();
    try {
      await writeFile(path.join(copy.root, 'knowledge/rules/.gitkeep'), '');
      await writeFile(path.join(copy.root, 'knowledge/rules/notes.txt'), 'x');
      const raw = await loadContent(copy.root, REPO_ROOT);
      expect(raw.problems).toHaveLength(1);
      expectProblem(raw.problems, {
        file: 'knowledge/rules/notes.txt',
        message: /\.yaml/,
      });
    } finally {
      await copy.remove();
    }
  });

  it('accepts missing optional folders and reports missing required files when validating', async () => {
    const copy = await tempCopy();
    try {
      await rm(path.join(copy.root, 'registry/plants'), { recursive: true });
      await rm(path.join(copy.root, 'knowledge/pack.yaml'));
      const raw = await loadContent(copy.root, REPO_ROOT);
      expect(raw.plants).toEqual([]);
      expect(raw.pack).toBeUndefined();
      expectProblem(validateContent(raw), {
        file: 'knowledge/pack.yaml',
        message: /missing/,
      });
    } finally {
      await copy.remove();
    }
  });

  it('fails when the schema directory is missing', async () => {
    // The fixture tree holds no schema: they are looked up in the content root by default.
    await expect(loadContent(FIXTURE_ROOT)).rejects.toThrow(/rule\.schema\.json/);
  });
});
