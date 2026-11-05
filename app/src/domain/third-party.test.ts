// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APACHE_2_0, MIT_TEXT, VOICE_DATA, VOICE_MODELS, VOICE_SOFTWARE } from './third-party.js';

const speechPackage = fileURLToPath(new URL('../../../speech/package.json', import.meta.url));

/** The package.json of `name` as the speech worker bundles it. */
function installed(name: string, from = speechPackage): { version: string; license: string } {
  const require = createRequire(from);
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        version: string;
        license: string;
      };
      if (pkg.name === name) return pkg;
    } catch {
      // Not the package root yet.
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No package.json for ${name}`);
    dir = parent;
  }
}

describe('third-party software of the voice', () => {
  it('names the versions and licences the speech worker bundles', () => {
    const transformers = installed('@huggingface/transformers');
    const transformersEntry = createRequire(speechPackage).resolve('@huggingface/transformers');
    const expected = {
      transformers,
      tokenizers: installed('@huggingface/tokenizers', transformersEntry),
      jinja: installed('@huggingface/jinja', transformersEntry),
      onnxruntime: installed('onnxruntime-web', transformersEntry),
    };
    for (const [id, pkg] of Object.entries(expected)) {
      const entry = VOICE_SOFTWARE.find((software) => software.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.version, id).toBe(pkg.version);
      expect(entry?.licence, id).toBe(pkg.license);
    }
  });

  it('gives each MIT component its copyright line, and the models and data their licence', () => {
    for (const entry of [...VOICE_SOFTWARE, ...VOICE_MODELS]) {
      // The Wolof fine-tune declares MIT on its card, with no copyright line: none is made up.
      if (entry.licence === 'MIT' && entry.note !== 'declared') {
        expect(entry.copyright, entry.id).toMatch(/^Copyright \(c\) /);
      }
    }
    expect(VOICE_MODELS.find((model) => model.id === 'wolof')?.copyright).toBeUndefined();
    expect(VOICE_MODELS.map((model) => [model.id, model.licence])).toEqual([
      ['whisper', 'MIT'],
      ['wolof', 'MIT'],
    ]);
    expect(VOICE_DATA.map((data) => [data.id, data.licence])).toEqual([
      ['fleurs', 'CC-BY-4.0'],
      ['tts', 'CC-BY-4.0'],
      ['waxal', 'CC-BY-SA-4.0'],
      ['alffa', null],
    ]);
  });

  it('carries the full licence texts, from LICENSES/', () => {
    expect(APACHE_2_0).toMatch(/^Apache License\s+Version 2\.0, January 2004/);
    expect(APACHE_2_0).toMatch(/END OF TERMS AND CONDITIONS/);
    expect(MIT_TEXT).toMatch(/^MIT License\n\nPermission is hereby granted, free of charge/);
    // The placeholder line is replaced by each component's own copyright.
    expect(MIT_TEXT).not.toMatch(/<copyright holders>/);
  });
});
