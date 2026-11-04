// SPDX-License-Identifier: MIT
// Aggregation and Markdown rendering of the voice evaluation. Pure, tested.
import { addCounts, errorRate } from './wer.js';
import type { ErrorCounts } from './wer.js';

export interface UtteranceResult {
  id: string;
  reference: string;
  hypothesis: string;
  errors: ErrorCounts;
  audioSeconds: number;
  ms: number;
}

export interface SetSummary {
  utterances: number;
  words: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  /** Null when the references hold no word. */
  wer: number | null;
  audioSeconds: number;
  /** Time to transcribe one utterance, in this process (not a phone). */
  ms: { mean: number; median: number; p95: number };
}

export interface NameSummary {
  /** Entries with an expected id. */
  count: number;
  top1: number;
  top3: number;
}

/** Nearest-rank percentile of a list (0 for an empty list). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

export function summariseSet(results: readonly UtteranceResult[]): SetSummary {
  const total = addCounts(results.map((r) => r.errors));
  const times = results.map((r) => r.ms);
  return {
    utterances: results.length,
    words: total.referenceWords,
    substitutions: total.substitutions,
    deletions: total.deletions,
    insertions: total.insertions,
    wer: errorRate(total),
    audioSeconds: Math.round(results.reduce((s, r) => s + r.audioSeconds, 0) * 10) / 10,
    ms: {
      mean: times.length === 0 ? 0 : Math.round(times.reduce((s, t) => s + t, 0) / times.length),
      median: Math.round(percentile(times, 0.5)),
      p95: Math.round(percentile(times, 0.95)),
    },
  };
}

export function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(100 * value).toFixed(1)} %`;
}

export interface NameRow extends NameSummary {
  pack: string;
  set: string;
}

/** A result as committed for a third-party test set: no reference text. */
export type StoredResult = Omit<UtteranceResult, 'reference'>;

export function withoutReference(results: readonly UtteranceResult[]): StoredResult[] {
  return results.map((r) => ({
    id: r.id,
    hypothesis: r.hypothesis,
    errors: r.errors,
    audioSeconds: r.audioSeconds,
    ms: r.ms,
  }));
}

export interface SummaryRow {
  pack: string;
  set: string;
  summary: SetSummary;
  note?: string;
}

export interface MarkdownInput {
  date: string;
  rows: SummaryRow[];
  /** One row per pack and volunteer set; empty while there are no recordings. */
  names: NameRow[];
  environment: string[];
  datasets: string[];
}

export function renderMarkdown(input: MarkdownInput): string {
  const lines = [
    '<!-- SPDX-License-Identifier: CC-BY-4.0 -->',
    '',
    `# Voice evaluation, ${input.date}`,
    '',
    '## Word error rate',
    '',
    '| Pack | Test set | Utterances | Words | Substitutions | Deletions | Insertions | WER | Median time per utterance |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...input.rows.map(
      ({ pack, set, summary: s }) =>
        `| \`${pack}\` | ${set} | ${String(s.utterances)} | ${String(s.words)} | ${String(s.substitutions)} | ${String(s.deletions)} | ${String(s.insertions)} | **${percent(s.wer)}** | ${(s.ms.median / 1000).toFixed(1)} s |`,
    ),
    '',
    'Word error rate: lowercase, accents kept, punctuation removed; the rate of a set is the total of errors over the total of reference words.',
    '',
    '## Product and remedy name accuracy',
    '',
  ];
  const measured = input.names.filter((n) => n.count > 0);
  if (measured.length === 0) {
    lines.push(
      'Pending recordings. The manifest `eval/speech/manifest.yaml` holds no consented volunteer recording with an expected id yet, so top-1 and top-3 name accuracy after the resolver is not measured. The FLEURS figures above are read speech of general sentences, not names of medicines.',
    );
  } else {
    lines.push(
      '| Pack | Volunteer set | Entries with an expected id | Top-1 | Top-3 |',
      '| --- | --- | ---: | ---: | ---: |',
      ...measured.map(
        (n) =>
          `| \`${n.pack}\` | ${n.set} | ${String(n.count)} | ${percent(n.top1 / n.count)} | ${percent(n.top3 / n.count)} |`,
      ),
      '',
      'Mixed French and Wolof entries (`volunteers-mix`) are evaluated on each pack and reported apart, never pooled with a pack language.',
    );
  }
  lines.push('', '## Test sets', '', ...input.datasets.map((d) => `- ${d}`));
  lines.push('', '## Run', '', ...input.environment.map((e) => `- ${e}`), '');
  return lines.join('\n');
}
