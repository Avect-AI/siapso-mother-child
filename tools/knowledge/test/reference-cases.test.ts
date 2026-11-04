// SPDX-License-Identifier: MIT
// The blocking reference cases (eval/cases): any change in the engine output
// for one of them fails this test. A case changes only by editing its file in a
// reviewed pull request.
import { evaluate, findForbiddenWording } from '@siapso/engine';
import type { Lang, Message, Pack } from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPack, contextOf, loadCases, loadContent, projectOf } from '../src/index.js';
import type { ReferenceCase } from '../src/index.js';
import { REPO_ROOT } from './helpers.js';

const LANGS: readonly Lang[] = ['fr', 'en'];

let pack: Pack;
let cases: ReferenceCase[];

beforeAll(async () => {
  pack = buildPack(await loadContent(REPO_ROOT));
  const loaded = await loadCases(REPO_ROOT);
  expect(loaded.problems).toEqual([]);
  cases = loaded.cases;
});

function textsOf(message: Message): string[] {
  return [message.fact, message.risk, message.riskDetail, message.orientation].filter(
    (text): text is string => text !== undefined,
  );
}

describe('reference cases', () => {
  it('cover the 14 cases of the dossier, with the term variants of case 1', () => {
    const numbers = new Set(cases.map((c) => /^case-(\d\d)-/.exec(c.id)?.[1]));
    for (let n = 1; n <= 14; n += 1) expect(numbers.has(String(n).padStart(2, '0'))).toBe(true);
    expect(cases.filter((c) => c.id.startsWith('case-01-')).map((c) => c.id)).toEqual([
      'case-01-ibuprofen-10-weeks',
      'case-01-ibuprofen-30-weeks',
      'case-01-ibuprofen-5-months',
      'case-01-ibuprofen-term-unknown',
    ]);
  });

  it('use product and plant ids that exist in the registry', () => {
    const products = new Set(pack.products.map((p) => p.id));
    const plants = new Set(pack.plants.map((p) => p.id));
    for (const c of cases) {
      for (const item of c.context.items) {
        if (item.product !== undefined) {
          expect(products.has(item.product), `${c.id}: ${item.product}`).toBe(true);
        }
        if (item.plant !== undefined) {
          expect(plants.has(item.plant), `${c.id}: ${item.plant}`).toBe(true);
        }
      }
      for (const sign of c.context.signs ?? []) {
        expect(
          pack.dangerSigns.some((s) => s.id === sign),
          `${c.id}: ${sign}`,
        ).toBe(true);
      }
    }
  });

  it('give exactly the expected output, findings in engine order', () => {
    expect(cases.length).toBeGreaterThanOrEqual(14);
    for (const c of cases) {
      const evaluation = evaluate(pack, contextOf(c));
      expect(projectOf(evaluation), c.id).toStrictEqual(c.expect);
    }
  });

  it('give the same output when run twice', () => {
    for (const c of cases) {
      const context = contextOf(c);
      expect(JSON.stringify(evaluate(pack, context)), c.id).toBe(
        JSON.stringify(evaluate(pack, context)),
      );
    }
  });

  it('only output message ids that exist in both languages, without forbidden wording', () => {
    for (const c of cases) {
      const evaluation = evaluate(pack, contextOf(c));
      const ids = new Set([
        ...evaluation.findings.map((f) => f.message),
        ...evaluation.reminders.map((n) => n.message),
        ...evaluation.notes.map((n) => n.message),
      ]);
      for (const lang of LANGS) {
        for (const id of ids) {
          const message = pack.messages[lang][id];
          expect(message, `${c.id}: message ${id} in ${lang}`).toBeDefined();
          if (!message) continue;
          for (const text of textsOf(message)) {
            expect(findForbiddenWording(text, lang), `${c.id}: ${id} (${lang}): ${text}`).toEqual(
              [],
            );
          }
        }
      }
    }
  });
});

describe('every case', () => {
  it('has a title and an expected level equal to the highest finding level', () => {
    const rank = ['unknown', 'next-contact', 'before-next-dose', 'danger'];
    for (const c of cases) {
      expect(c.title.length, c.id).toBeGreaterThan(0);
      const top = Math.max(0, ...c.expect.findings.map((f) => rank.indexOf(f.level)));
      expect(rank.indexOf(c.expect.level), c.id).toBe(top);
    }
  });
});
