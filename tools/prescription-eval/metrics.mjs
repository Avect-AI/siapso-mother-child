// SPDX-License-Identifier: MIT
// How well a reading of a synthetic prescription names its products
// (SCRUM-57 spike). Pure. A proposal is right when its substances are those of
// a product of the prescription that the pack has; every other proposal is a
// false product, the measure that matters most (a product she does not take).

/** An empty score, to add others to. */
export function emptyScore() {
  return {
    expected: 0,
    found: 0,
    falseProducts: 0,
    /** False products that are a part of a combination of the prescription ("Fer" for "Fer + Acide folique"). */
    falsePartial: 0,
    /** False products read on the line of a product outside the pack. */
    falseFromOutOfBase: 0,
    strength: { expected: 0, right: 0, wrong: 0 },
    units: { expected: 0, right: 0, wrong: 0 },
    outOfBase: { items: 0, kept: 0 },
  };
}

/**
 * Scores one reading. `reading.proposals`: { substances, strengthMg,
 * unitsPerDay, line }, one per product proposed; `reading.leftovers`: the
 * lines kept to be added as typed. `substancesOf(productId)` gives the sorted
 * substances of a pack product, `normalize(text)` the resolver's normal form.
 * A strength or a unit count proposed but different is `wrong`; none
 * proposed is neither right nor wrong (she gives it). An item outside the
 * pack is `kept` when a leftover line starts the same way as its name.
 */
export function scoreReading(rx, reading, substancesOf, normalize) {
  const score = emptyScore();
  const expected = rx.items.filter((it) => it.inBase);
  const outside = rx.items.filter((it) => !it.inBase);
  const head = (text) => normalize(text).split(' ')[0].slice(0, 4);
  score.expected = expected.length;
  const matched = new Set();
  for (const proposal of reading.proposals) {
    const k = expected.findIndex(
      (it, i) => !matched.has(i) && substancesOf(it.product) === proposal.substances,
    );
    if (k >= 0) {
      matched.add(k);
      score.found += 1;
      const it = expected[k];
      for (const [key, want, got] of [
        ['strength', it.strengthMg, proposal.strengthMg],
        ['units', it.upd, proposal.unitsPerDay],
      ]) {
        if (want === undefined) continue;
        score[key].expected += 1;
        if (got === want) score[key].right += 1;
        else if (got !== undefined) score[key].wrong += 1;
      }
    } else if (!expected.some((it) => substancesOf(it.product) === proposal.substances)) {
      // A second proposal of a product already found is not a new product.
      score.falseProducts += 1;
      const got = proposal.substances.split('+');
      const partOf = (it) => {
        const want = substancesOf(it.product).split('+');
        return got.length < want.length && got.every((s) => want.includes(s));
      };
      if (expected.some(partOf)) score.falsePartial += 1;
      else if (outside.some((it) => normalize(proposal.line).includes(head(it.written))))
        score.falseFromOutOfBase += 1;
    }
  }
  score.outOfBase.items = outside.length;
  score.outOfBase.kept = outside.filter((it) =>
    reading.leftovers.some((l) => normalize(l).includes(head(it.written))),
  ).length;
  return score;
}

/** The sum of two scores. */
export function addScores(a, b) {
  const sum = emptyScore();
  for (const key of ['expected', 'found', 'falseProducts', 'falsePartial', 'falseFromOutOfBase'])
    sum[key] = a[key] + b[key];
  for (const key of ['strength', 'units']) {
    for (const part of ['expected', 'right', 'wrong']) sum[key][part] = a[key][part] + b[key][part];
  }
  sum.outOfBase.items = a.outOfBase.items + b.outOfBase.items;
  sum.outOfBase.kept = a.outOfBase.kept + b.outOfBase.kept;
  return sum;
}

/** Recall (products found among those expected) and precision (right among proposed); 0 when nothing to divide. */
export function rates(score) {
  const proposed = score.found + score.falseProducts;
  return {
    recall: score.expected === 0 ? 0 : score.found / score.expected,
    precision: proposed === 0 ? 0 : score.found / proposed,
  };
}
