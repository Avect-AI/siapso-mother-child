// SPDX-License-Identifier: MIT
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { loadContent } from '../src/index.js';
import { REPO_ROOT, tempCopy } from './helpers.js';

const YAML = '# SPDX-License-Identifier: CC-BY-4.0\n';

async function put(root: string, file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

async function check(root: string): Promise<{ code: number; err: string[] }> {
  const err: string[] = [];
  const code = await main(['check', '--root', root, '--schemas', REPO_ROOT], {
    cwd: root,
    out: () => undefined,
    err: (line) => err.push(line),
  });
  return { code, err };
}

describe('unexpected files in knowledge/ and registry/', () => {
  it('reports a file, a folder or a nested file the loader does not expect', async () => {
    const copy = await tempCopy();
    try {
      await put(copy.root, 'knowledge/notes.yaml', `${YAML}note: see DDInter\n`);
      await put(copy.root, 'registry/foo.yaml', `${YAML}a: 1\n`);
      await put(copy.root, 'knowledge/nested/deep.yaml', `${YAML}a: 1\n`);
      await put(copy.root, 'registry/products/sub/x.yaml', `${YAML}a: 1\n`);
      await put(copy.root, 'knowledge/rules/notes.txt', 'x');
      const raw = await loadContent(copy.root, REPO_ROOT);
      const files = raw.problems.filter((p) => /unexpected/.test(p.message)).map((p) => p.file);
      expect(files.sort()).toEqual([
        'knowledge/nested',
        'knowledge/notes.yaml',
        'knowledge/rules/notes.txt',
        'registry/foo.yaml',
        'registry/products/sub',
      ]);
      const result = await check(copy.root);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/knowledge\/notes\.yaml: \(file\): unexpected/);
    } finally {
      await copy.remove();
    }
  });

  it('keeps the README and the schema folders as known files', async () => {
    const copy = await tempCopy();
    try {
      await put(copy.root, 'knowledge/README.md', '# Notes\n');
      await put(copy.root, 'knowledge/schema/x.schema.json', '{}');
      await put(copy.root, 'registry/schema/y.schema.json', '{}');
      const raw = await loadContent(copy.root, REPO_ROOT);
      expect(raw.problems).toEqual([]);
    } finally {
      await copy.remove();
    }
  });
});

describe('eval/', () => {
  it('finds and scans a nested file', async () => {
    const copy = await tempCopy();
    try {
      await put(copy.root, 'eval/a/b/case.yaml', `${YAML}note: fine\n`);
      const raw = await loadContent(copy.root, REPO_ROOT);
      expect(raw.extra.map((f) => f.file)).toEqual(['eval/a/b/case.yaml']);
      expect((await check(copy.root)).code).toBe(0);

      await put(copy.root, 'eval/a/b/case.yaml', `${YAML}note: Per Theriaque\n`);
      const named = await check(copy.root);
      expect(named.code).toBe(1);
      expect(named.err.join('\n')).toMatch(/eval\/a\/b\/case\.yaml: note: .*forbidden source name/);

      await put(copy.root, 'eval/a/b/case.yaml', `${YAML}note: https://www.vidal.fr/x\n`);
      const url = await check(copy.root);
      expect(url.code).toBe(1);
      expect(url.err.join('\n')).toMatch(/eval\/a\/b\/case\.yaml: note: .*forbidden domain/);
    } finally {
      await copy.remove();
    }
  });

  it('reports any other file instead of ignoring it', async () => {
    const copy = await tempCopy();
    try {
      await put(copy.root, 'eval/cases.yml', 'a: 1\n');
      await put(copy.root, 'eval/deep/notes.txt', 'x');
      await put(copy.root, 'eval/deep/tool.js', 'x');
      const raw = await loadContent(copy.root, REPO_ROOT);
      const files = raw.problems.filter((p) => /unexpected/.test(p.message)).map((p) => p.file);
      expect(files.sort()).toEqual(['eval/cases.yml', 'eval/deep/notes.txt', 'eval/deep/tool.js']);
    } finally {
      await copy.remove();
    }
  });

  it('accepts clean .md and .json files and audio files', async () => {
    const copy = await tempCopy();
    try {
      await put(copy.root, 'eval/cases/README.md', '# Cases\n\nHow to write a case.\n');
      await put(copy.root, 'eval/schema/case.schema.json', '{ "type": "object" }\n');
      await put(copy.root, 'eval/resolver/baseline.json', '{ "top1": 0.9 }\n');
      for (const ext of ['wav', 'flac', 'ogg', 'opus', 'webm', 'mp3']) {
        await put(copy.root, `eval/speech/clip.${ext}`, 'DDInter vidal.fr (not text)');
      }
      const raw = await loadContent(copy.root, REPO_ROOT);
      expect(raw.problems).toEqual([]);
      expect((await check(copy.root)).code).toBe(0);
    } finally {
      await copy.remove();
    }
  });

  it('scans .md and .json files for forbidden names and URLs', async () => {
    const files: [string, string, RegExp][] = [
      ['eval/cases/README.md', 'Taken from Thériaque.', /forbidden source name/],
      [
        'eval/resolver/baseline.json',
        '{ "from": "https://go.drugbank.com/x" }',
        /forbidden domain/,
      ],
      ['eval/schema/case.schema.json', '{ "title": "DD-Inter" }', /forbidden source name/],
    ];
    for (const [file, text, message] of files) {
      const copy = await tempCopy();
      try {
        await put(copy.root, file, text);
        const result = await check(copy.root);
        expect(result.code, file).toBe(1);
        expect(result.err.join('\n'), file).toMatch(message);
        expect(result.err.join('\n'), file).toContain(`${file}: (file):`);
      } finally {
        await copy.remove();
      }
    }
  });
});

describe('README.md in knowledge/ and registry/', () => {
  it('is scanned as text', async () => {
    for (const file of ['knowledge/README.md', 'registry/README.md']) {
      const copy = await tempCopy();
      try {
        await put(copy.root, file, '# Notes\n\nCopied from e-lactancia and https://vidal.fr/x\n');
        const result = await check(copy.root);
        expect(result.code, file).toBe(1);
        expect(result.err.join('\n'), file).toContain(`${file}: (file):`);
      } finally {
        await copy.remove();
      }
    }
  });

  it('passes when clean', async () => {
    const copy = await tempCopy();
    try {
      await put(copy.root, 'knowledge/README.md', '# Notes\n');
      await put(copy.root, 'registry/README.md', '# Notes\n');
      expect((await check(copy.root)).code).toBe(0);
    } finally {
      await copy.remove();
    }
  });
});
