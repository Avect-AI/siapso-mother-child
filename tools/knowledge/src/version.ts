// SPDX-License-Identifier: MIT
// Pack versions (knowledge/schema/pack-meta.schema.json): MAJOR.MINOR.PATCH
// with an optional pre-release, compared in semantic version order. The app
// compares them the same way (app/src/data/pack-verify.ts).

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/;

export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

function compareNumbers(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareIdentifiers(a: string, b: string): number {
  const [x, y] = [a.split('.'), b.split('.')];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const [p, q] = [x[i] ?? '', y[i] ?? ''];
    const [pNumber, qNumber] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    const order =
      pNumber && qNumber
        ? compareNumbers(p, q)
        : pNumber !== qNumber
          ? pNumber
            ? -1
            : 1
          : p < q
            ? -1
            : p > q
              ? 1
              : 0;
    if (order !== 0) return order;
  }
  return x.length - y.length;
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [VERSION.exec(a), VERSION.exec(b)];
  if (x === null || y === null) throw new Error(`not a version: ${x === null ? a : b}`);
  for (let part = 1; part <= 3; part += 1) {
    const order = compareNumbers(x[part] ?? '0', y[part] ?? '0');
    if (order !== 0) return order;
  }
  const [preX, preY] = [x[4], y[4]];
  if (preX === undefined || preY === undefined) {
    return preX === preY ? 0 : preX === undefined ? 1 : -1;
  }
  return compareIdentifiers(preX, preY);
}
