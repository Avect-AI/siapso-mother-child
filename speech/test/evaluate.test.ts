// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateVolunteers, transcribeAll } from '../eval/evaluate.js';
import { cachedSubsetUsable, FLEURS_REVISION } from '../eval/fleurs.js';
import type { ManifestEntry } from '../eval/manifest.js';

const entry = (
  file: string,
  text: string,
  lang: ManifestEntry['lang'],
  expectId?: string,
): ManifestEntry => ({
  file,
  text,
  lang,
  ...(expectId === undefined ? {} : { expect: expectId }),
  speaker: 'spk-001',
  consent: 'C-1',
  licence: 'CC-BY-4.0',
});

// A fake transcriber: the "audio" of a file is one sample that indexes a transcript.
const transcripts = ['paracetamol', 'kinkeliba', 'nothing useful'];
const load = (file: string): Float32Array => new Float32Array([Number(file.slice(0, 1))]);
const transcribe = (samples: Float32Array): Promise<string> =>
  Promise.resolve(transcripts[samples[0] ?? 0] ?? '');
const lookup = (text: string): string[] =>
  ({
    paracetamol: ['paracetamol-1000', 'ibuprofen-400'],
    kinkeliba: ['moringa', 'kinkeliba', 'bissap'],
  })[text] ?? [];

describe('transcribeAll', () => {
  it('scores each utterance and reports progress', async () => {
    const seen: number[] = [];
    const results = await transcribeAll(
      transcribe,
      [{ id: 'a', text: 'paracetamol', samples: new Float32Array([0]) }],
      (done) => seen.push(done),
    );
    expect(results[0]?.errors.referenceWords).toBe(1);
    expect(results[0]?.errors.substitutions).toBe(0);
    expect(seen).toEqual([1]);
  });
});

describe('evaluateVolunteers', () => {
  const entries = [
    entry('0.wav', 'paracetamol', 'wo', 'paracetamol-1000'),
    entry('1.wav', 'kinkeliba', 'wo', 'kinkeliba'),
    entry('2.wav', 'quelque chose', 'wo'),
    entry('1b.wav', 'kinkeliba', 'mix', 'kinkeliba'),
    entry('0b.wav', 'paracetamol', 'fr', 'paracetamol-1000'),
  ];

  it('counts top-1 and top-3 on entries that have an expected id', async () => {
    const sets = await evaluateVolunteers({
      entries,
      packLanguage: 'wo',
      load,
      transcribe,
      lookup,
    });
    const wo = sets.find((s) => s.set === 'volunteers-wo');
    // paracetamol: top-1; kinkeliba: rank 2 so top-3 only; the entry without expect is skipped.
    expect(wo?.name).toEqual({ count: 2, top1: 1, top3: 2 });
    expect(wo?.summary.utterances).toBe(3);
  });

  it('keeps mixed entries apart from the pack language, never pooled', async () => {
    const sets = await evaluateVolunteers({
      entries,
      packLanguage: 'wo',
      load,
      transcribe,
      lookup,
    });
    expect(sets.map((s) => s.set)).toEqual(['volunteers-wo', 'volunteers-mix']);
    const mix = sets.find((s) => s.set === 'volunteers-mix');
    expect(mix?.name).toEqual({ count: 1, top1: 0, top3: 1 });
    expect(mix?.summary.utterances).toBe(1);
  });

  it('does not run entries of the other language', async () => {
    const sets = await evaluateVolunteers({
      entries,
      packLanguage: 'wo',
      load,
      transcribe,
      lookup,
    });
    const files = sets.flatMap((s) => s.results.map((r) => r.id));
    expect(files).not.toContain('0b.wav');
  });

  it('returns no set for an empty manifest', async () => {
    expect(
      await evaluateVolunteers({ entries: [], packLanguage: 'fr', load, transcribe, lookup }),
    ).toEqual([]);
  });
});

describe('cachedSubsetUsable', () => {
  const subset = (revision: string | undefined, n: number) => ({
    ...(revision === undefined ? {} : { revision }),
    utterances: new Array<unknown>(n).fill(0),
  });
  it('accepts the pinned revision with enough sentences', () => {
    expect(cachedSubsetUsable(subset(FLEURS_REVISION, 100), 100)).toBe(true);
  });
  it('rejects another or missing revision, too few sentences, or no cache', () => {
    expect(cachedSubsetUsable(subset('0000', 100), 100)).toBe(false);
    expect(cachedSubsetUsable(subset(undefined, 100), 100)).toBe(false);
    expect(cachedSubsetUsable(subset(FLEURS_REVISION, 99), 100)).toBe(false);
    expect(cachedSubsetUsable(undefined, 1)).toBe(false);
  });
  it('uses the revision that quick_check.py pins', () => {
    const python = readFileSync(new URL('../convert/quick_check.py', import.meta.url), 'utf8');
    expect(python).toContain(`FLEURS_REVISION = "${FLEURS_REVISION}"`);
  });
});
