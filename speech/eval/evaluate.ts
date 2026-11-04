// SPDX-License-Identifier: MIT
// Evaluation loops that do not depend on the model runtime, so they can be
// tested with a fake transcriber.
import type { ManifestEntry } from './manifest.js';
import { summariseSet } from './report.js';
import type { NameSummary, SetSummary, UtteranceResult } from './report.js';
import { wordErrors } from './wer.js';

export interface Item {
  id: string;
  text: string;
  samples: Float32Array;
}

export type Transcribe = (samples: Float32Array) => Promise<string>;

/** Transcribes every item in order, timing each one. */
export async function transcribeAll(
  transcribe: Transcribe,
  items: readonly Item[],
  onProgress?: (done: number, total: number) => void,
): Promise<UtteranceResult[]> {
  const results: UtteranceResult[] = [];
  for (const item of items) {
    const started = performance.now();
    const hypothesis = await transcribe(item.samples);
    const ms = Math.round(performance.now() - started);
    results.push({
      id: item.id,
      reference: item.text,
      hypothesis,
      errors: wordErrors(item.text, hypothesis),
      audioSeconds: Math.round((item.samples.length / 16000) * 100) / 100,
      ms,
    });
    onProgress?.(results.length, items.length);
  }
  return results;
}

export interface VolunteerSet {
  /** `volunteers-<lang>` for the pack's language, `volunteers-mix` for mixed utterances. */
  set: string;
  summary: SetSummary;
  name: NameSummary;
  results: UtteranceResult[];
}

/**
 * Runs the volunteer recordings on one pack. Entries in the pack's language
 * and mixed entries (`mix`) are two separate sets, never pooled; entries in
 * the other language are not run. Name accuracy counts the entries that have
 * an `expect` id: top-1 when it is the first candidate for the transcription,
 * top-3 when it is among the first three.
 */
export async function evaluateVolunteers(options: {
  entries: readonly ManifestEntry[];
  packLanguage: string;
  load: (file: string) => Float32Array;
  transcribe: Transcribe;
  /** Candidate ids for a transcription, best first (the resolver). */
  lookup: (text: string) => string[];
  onProgress?: (set: string, done: number, total: number) => void;
}): Promise<VolunteerSet[]> {
  const out: VolunteerSet[] = [];
  for (const lang of [options.packLanguage, 'mix']) {
    const own = options.entries.filter((e) => e.lang === lang);
    if (own.length === 0) continue;
    const set = `volunteers-${lang}`;
    const results = await transcribeAll(
      options.transcribe,
      own.map((e) => ({ id: e.file, text: e.text, samples: options.load(e.file) })),
      (done, total) => options.onProgress?.(set, done, total),
    );
    const name: NameSummary = { count: 0, top1: 0, top3: 0 };
    results.forEach((result, i) => {
      const expected = own[i]?.expect;
      if (expected === undefined) return;
      const ids = options.lookup(result.hypothesis);
      name.count += 1;
      if (ids[0] === expected) name.top1 += 1;
      if (ids.slice(0, 3).includes(expected)) name.top3 += 1;
    });
    out.push({ set, summary: summariseSet(results), name, results });
  }
  return out;
}
