// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { assemble } from './assemble.js';
import type { AuthoredMeta, Problem, RawContent } from './types.js';
import { formatProblem, typedContent, validateContent } from './validate.js';

/** Thrown by buildPack when the content has problems. */
export class PackBuildError extends Error {
  override name = 'PackBuildError';
  readonly problems: Problem[];

  constructor(problems: Problem[]) {
    super(
      `The content has ${String(problems.length)} problem(s):\n${problems.map(formatProblem).join('\n')}`,
    );
    this.problems = problems;
  }
}

/**
 * Builds the runtime pack from the content: kebab-case keys become the
 * engine's camelCase, every array is sorted by id, and nothing depends on the
 * clock. Throws a PackBuildError if validateContent finds any problem.
 */
export function buildPack(raw: RawContent): Pack {
  const problems = validateContent(raw);
  if (problems.length > 0) throw new PackBuildError(problems);
  return assemble(typedContent(raw));
}

/**
 * The minimum safe version of knowledge/pack.yaml, when set. It goes into the
 * manifest (signed with it), not into the engine's pack. Call after buildPack,
 * which validated pack.yaml: this only reads the field, without collecting
 * the whole content again.
 */
export function minimumSafeVersionOf(raw: RawContent): string | undefined {
  const data = raw.pack?.data as Partial<AuthoredMeta> | null | undefined;
  const minimum = data?.['minimum-safe-version'];
  return typeof minimum === 'string' ? minimum : undefined;
}
