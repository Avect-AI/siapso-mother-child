// SPDX-License-Identifier: MIT
// The steps are faked: no build runs, no key is read or written here.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInfoProblems, parseArguments, releaseBuild } from './release-build.mjs';

const RELEASE_INFO = {
  mode: 'production',
  acceptsUnsignedPack: false,
  packVersion: '0.2.0',
  packMinimumSafeVersion: null,
  packKeyId: 'siapso-2026-11',
};

/** Runs releaseBuild with fakes; `fail` makes the step at that index exit 1. */
async function run(argv, { info = RELEASE_INFO, fail = -1, size = 0 } = {}) {
  const steps = [];
  const out = [];
  const err = [];
  const code = await releaseBuild(argv, {
    run: (args) => {
      steps.push(args);
      return steps.length - 1 === fail ? 1 : 0;
    },
    readInfo: () => Promise.resolve(info),
    checkSize: () => Promise.resolve(size),
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, steps, out, err };
}

describe('parseArguments', () => {
  it('takes the private key file given by --key', () => {
    expect(parseArguments(['--key', 'release.json'], '/work')).toEqual({
      key: path.resolve('/work', 'release.json'),
    });
  });

  it('needs --key and nothing else', () => {
    expect(parseArguments([], '/work')).toMatch(/--key <file>/);
    expect(parseArguments(['--key'], '/work')).toMatch(/--key <file>/);
    expect(parseArguments(['--key', 'k.json', '--other', 'x'], '/work')).toMatch(/unknown/);
  });
});

describe('buildInfoProblems', () => {
  it('accepts the marker of a release build', () => {
    expect(buildInfoProblems(RELEASE_INFO)).toEqual([]);
  });

  it('names a demo build, a build that accepts unsigned packs, or an unsigned pack', () => {
    expect(buildInfoProblems({ ...RELEASE_INFO, mode: 'demo' })).toEqual([
      expect.stringMatching(/mode "demo"/),
    ]);
    expect(buildInfoProblems({ ...RELEASE_INFO, acceptsUnsignedPack: true })).toEqual([
      expect.stringMatching(/accepts unsigned packs/),
    ]);
    expect(buildInfoProblems({ ...RELEASE_INFO, packKeyId: null })).toEqual([
      expect.stringMatching(/not signed/),
    ]);
    expect(buildInfoProblems(null)).toEqual([expect.stringMatching(/build-info\.json/)]);
  });
});

describe('releaseBuild', () => {
  it('builds the pack, signs it with the key, builds the app, then checks the marker and the size', async () => {
    const result = await run(['--key', '/offline/release.json']);

    expect(result.code).toBe(0);
    expect(result.steps).toEqual([
      ['knowledge:build'],
      ['knowledge:sign', '--key', path.resolve('/offline/release.json')],
      ['--filter', '@siapso/app', 'build'],
    ]);
    expect(result.out.join('\n')).toMatch(
      /release build ready in app\/dist: pack 0\.2\.0, key siapso-2026-11/,
    );
  });

  it('stops at the first step that fails', async () => {
    const result = await run(['--key', 'k.json'], { fail: 1 });

    expect(result.code).toBe(1);
    expect(result.steps).toHaveLength(2);
    expect(result.err.join('\n')).toMatch(/knowledge:sign failed/);
  });

  it('fails when the marker is not the one of a release', async () => {
    const result = await run(['--key', 'k.json'], {
      info: { ...RELEASE_INFO, mode: 'demo', acceptsUnsignedPack: true },
    });

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/not a release.*mode "demo"/s);
  });

  it('fails when the app is over its size budget', async () => {
    expect((await run(['--key', 'k.json'], { size: 1 })).code).toBe(1);
  });

  it('resolves a relative --key from the folder where the command was typed (INIT_CWD)', async () => {
    const steps = [];
    const code = await releaseBuild(['--key', 'keys/release.json'], {
      run: (args) => {
        steps.push(args);
        return 0;
      },
      readInfo: () => Promise.resolve(RELEASE_INFO),
      checkSize: () => Promise.resolve(0),
      log: () => undefined,
      error: () => undefined,
      env: { INIT_CWD: path.resolve('/home/maintainer') },
    });

    expect(code).toBe(0);
    expect(steps[1]).toEqual([
      'knowledge:sign',
      '--key',
      path.resolve('/home/maintainer', 'keys/release.json'),
    ]);
  });

  it('resolves it from the current folder when INIT_CWD is not set', async () => {
    const steps = [];
    await releaseBuild(['--key', 'release.json'], {
      run: (args) => {
        steps.push(args);
        return 0;
      },
      readInfo: () => Promise.resolve(RELEASE_INFO),
      checkSize: () => Promise.resolve(0),
      log: () => undefined,
      error: () => undefined,
      env: {},
    });

    expect(steps[1]?.[2]).toBe(path.resolve(process.cwd(), 'release.json'));
  });

  it('exits 2 without --key, and runs nothing', async () => {
    const result = await run([]);

    expect(result.code).toBe(2);
    expect(result.steps).toEqual([]);
  });
});
