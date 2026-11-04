// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { formatProblem } from '../src/index.js';
import { FIXTURE_ROOT, REPO_ROOT, tempCopy } from './helpers.js';

interface Result {
  code: number;
  out: string[];
  err: string[];
}

async function run(args: string[], cwd = REPO_ROOT): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    cwd,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

describe('formatProblem', () => {
  it('prints file: path: message', () => {
    expect(formatProblem({ file: 'a/b.yaml', path: 'when.subject', message: 'bad' })).toBe(
      'a/b.yaml: when.subject: bad',
    );
  });

  it('prints (file) for a problem about the whole file', () => {
    expect(formatProblem({ file: 'a/b.yaml', path: '', message: 'bad' })).toBe(
      'a/b.yaml: (file): bad',
    );
  });
});

describe('siapso-pack check', () => {
  it('exits 0 on valid content and summarises it', async () => {
    const result = await run(['check', '--root', FIXTURE_ROOT, '--schemas', REPO_ROOT]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toMatch(/5 rules/);
  });

  it('checks the repository content by default', async () => {
    const result = await run(['check']);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
  });

  it('prints one problem per line as file: path: message and exits 1', async () => {
    const copy = await tempCopy();
    try {
      await writeFile(
        path.join(copy.root, 'knowledge/rules/moringa-toxic.yaml'),
        [
          '# SPDX-License-Identifier: CC-BY-4.0',
          'id: moringa-toxic',
          'kind: toxicity',
          'when: { subject: { plant: moringa } }',
          'level: danger',
          'evidence: D',
          'message: herb-drug-moringa',
          'sources: []',
          'review: { status: draft, reviewers: [] }',
          'extra: 1',
          '',
        ].join('\n'),
      );
      const result = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        'knowledge/rules/moringa-toxic.yaml: extra: unknown key "extra"',
      );
      expect(
        result.err.some((l) => l.startsWith('knowledge/rules/moringa-toxic.yaml: level:')),
      ).toBe(false);
      // The file with the schema fault gets no further check: one problem, then the count.
      expect(result.err).toHaveLength(2);
      expect(result.err[1]).toBe('1 problem(s) found');
    } finally {
      await copy.remove();
    }
  });

  it('exits 2 with a usage message for an unknown command or option', async () => {
    for (const args of [[], ['frobnicate'], ['check', '--nope'], ['check', '--root']]) {
      const result = await run(args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.err.join('\n')).toMatch(/usage/i);
    }
  });
});

describe('NOTICE', () => {
  it('is out of date when it differs from the generated one: check fails', async () => {
    const copy = await tempCopy();
    try {
      const file = path.join(copy.root, 'NOTICE');
      await writeFile(file, `${await readFile(file, 'utf8')}Extra line.\n`);
      const result = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        'NOTICE: (file): out of date: run "pnpm knowledge:build" to regenerate it',
      );
    } finally {
      await copy.remove();
    }
  });

  it('is required: check fails when it is missing', async () => {
    const copy = await tempCopy();
    try {
      await rm(path.join(copy.root, 'NOTICE'));
      const result = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/^NOTICE: \(file\): missing/m);
    } finally {
      await copy.remove();
    }
  });

  it('is out of date when a new source is cited', async () => {
    const copy = await tempCopy();
    try {
      const file = path.join(copy.root, 'registry/plants/moringa.yaml');
      const text = await readFile(file, 'utf8');
      await writeFile(
        file,
        `${text}  - { source: bdpm, locator: 'Fixture', accessed: 2026-11-04 }\n`,
      );
      const result = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/NOTICE: \(file\): out of date/);
    } finally {
      await copy.remove();
    }
  });

  it('is written by build, which makes check pass again', async () => {
    const copy = await tempCopy();
    try {
      const file = path.join(copy.root, 'NOTICE');
      await writeFile(file, 'stale\n');
      const built = await run(['build', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(built.err).toEqual([]);
      expect(built.code).toBe(0);
      const notice = await readFile(file, 'utf8');
      expect(notice.startsWith('SIAPSO Mother-Child\n')).toBe(true);
      const checked = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(checked.err).toEqual([]);
      expect(checked.code).toBe(0);
    } finally {
      await copy.remove();
    }
  });

  it('is not written when the content has problems', async () => {
    const copy = await tempCopy();
    try {
      const file = path.join(copy.root, 'NOTICE');
      await writeFile(file, 'stale\n');
      await rm(path.join(copy.root, 'knowledge/messages/danger-sign.yaml'));
      const result = await run(['build', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(await readFile(file, 'utf8')).toBe('stale\n');
    } finally {
      await copy.remove();
    }
  });

  it('reports a forbidden source as a problem on the command line', async () => {
    const copy = await tempCopy();
    try {
      const file = path.join(copy.root, 'registry/plants/moringa.yaml');
      const text = await readFile(file, 'utf8');
      await writeFile(file, text.replace('literature', 'ddinter'));
      const result = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(
        /registry\/plants\/moringa\.yaml: sources\[0\]\.source: .*forbidden/,
      );
    } finally {
      await copy.remove();
    }
  });
});

describe('siapso-pack build', () => {
  it('writes the pack to --out and exits 0', async () => {
    const copy = await tempCopy();
    try {
      const out = path.join(copy.root, 'out');
      const result = await run([
        'build',
        '--root',
        copy.root,
        '--schemas',
        REPO_ROOT,
        '--out',
        out,
      ]);
      expect(result.err).toEqual([]);
      expect(result.code).toBe(0);
      expect(await readdir(out)).toContain('manifest.json');
    } finally {
      await copy.remove();
    }
  });

  it('writes to app/public/pack of the root by default', async () => {
    const copy = await tempCopy();
    try {
      const result = await run(['build', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(0);
      expect(await readdir(path.join(copy.root, 'app/public/pack'))).toContain('pack.json');
    } finally {
      await copy.remove();
    }
  });

  it('prints the problems, writes nothing and exits 1 on invalid content', async () => {
    const copy = await tempCopy();
    try {
      await rm(path.join(copy.root, 'knowledge/messages/danger-sign.yaml'));
      const result = await run(['build', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/danger-sign\.yaml: \(file\): builtin message/);
      await expect(readdir(path.join(copy.root, 'app/public/pack'))).rejects.toThrow();
    } finally {
      await copy.remove();
    }
  });

  it('exits 1 with the message when the pack is over the size budget', async () => {
    // Covered through writePack; here a content tree whose message is huge.
    const copy = await tempCopy();
    try {
      const { randomBytes } = await import('node:crypto');
      await writeFile(
        path.join(copy.root, 'knowledge/messages/herb-drug-moringa.yaml'),
        [
          '# SPDX-License-Identifier: CC-BY-4.0',
          'id: herb-drug-moringa',
          'fr:',
          '  fact: "Fait."',
          '  risk: "Risque."',
          `  risk-detail: "${randomBytes(4_200_000).toString('hex')}"`,
          'en:',
          '  fact: "Fact."',
          '  risk: "Risk."',
          '',
        ].join('\n'),
      );
      const result = await run(['build', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/size budget/);
    } finally {
      await copy.remove();
    }
  });
});

describe('siapso-pack import-bdpm', () => {
  /** Synthetic BDPM-format lines (test data, see fixtures/bdpm/README.md). */
  const BDPM = path.join(path.dirname(FIXTURE_ROOT), 'bdpm');

  it('writes registry/products/bdpm.yaml from the BDPM files, and the content stays valid', async () => {
    const copy = await tempCopy();
    try {
      const args = ['import-bdpm', BDPM, '--root', copy.root, '--schemas', REPO_ROOT];
      const result = await run(args);
      expect(result.err).toEqual([]);
      expect(result.code).toBe(0);
      // The input files are identified by size and sha256, to be recorded in
      // the bdpm entry of knowledge/sources.yaml.
      const inputs = await Promise.all(
        ['CIS_bdpm.txt', 'CIS_COMPO_bdpm.txt'].map(async (name) => {
          const bytes = await readFile(path.join(BDPM, name));
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          return `input: ${name}, ${String(bytes.length)} bytes, sha256 ${sha256}`;
        }),
      );
      // The fixture registry lists paracetamol and ibuprofen only.
      expect(result.out).toEqual([
        ...inputs,
        'imported: 4 products into registry/products/bdpm.yaml',
        '  paracetamol: 4',
      ]);
      const text = await readFile(path.join(copy.root, 'registry/products/bdpm.yaml'), 'utf8');
      expect(text).toMatch(/^# SPDX-License-Identifier: CC-BY-4\.0\n/);
      expect(text).toMatch(/bdpm: '99000001'/);
      const check = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);
      expect(check.err).toEqual([]);
      expect(check.out.join('\n')).toMatch(/6 products/);
    } finally {
      await copy.remove();
    }
  });

  it('needs the folder of the BDPM files', async () => {
    for (const args of [['import-bdpm'], ['import-bdpm', '--root', REPO_ROOT]]) {
      const result = await run(args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.err.join('\n')).toMatch(/import-bdpm needs the folder/);
    }
  });

  it('exits 1 and names the file when a BDPM file is missing', async () => {
    const copy = await tempCopy();
    try {
      const args = ['import-bdpm', copy.root, '--root', copy.root, '--schemas', REPO_ROOT];
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/CIS_bdpm\.txt/);
    } finally {
      await copy.remove();
    }
  });

  it('exits 1 when the registry lists no substance', async () => {
    const copy = await tempCopy();
    try {
      await writeFile(
        path.join(copy.root, 'registry/substances.yaml'),
        '# SPDX-License-Identifier: CC-BY-4.0\n[]\n',
      );
      const args = ['import-bdpm', BDPM, '--root', copy.root, '--schemas', REPO_ROOT];
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/no substance/);
    } finally {
      await copy.remove();
    }
  });
});
