// SPDX-License-Identifier: MIT
// French number words a strength is said or typed with ("Doliprane mille",
// "Advil quatre cents", "deux cent cinquante"), written as digits so that
// parseStrength reads them as it reads "1000" or "400".

const VALUES: Readonly<Record<string, number>> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  vingt: 20,
  vingts: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
  septante: 70,
  huitante: 80,
  octante: 80,
  nonante: 90,
  cent: 100,
  cents: 100,
  mille: 1000,
};

/** A strength unit written after a number ("quatre-vingt-dix mg", "un gramme"). */
const UNIT = /^(?:mg|g|µg|mcg|grammes?|milligrammes?|microgrammes?)$/u;

interface Token {
  /** The letters and hyphens of the token, lower case: the word itself. */
  word: string;
  /** What follows the word in the token (a comma, a full stop). */
  tail: string;
  /** The number words of the token ("quatre-vingt-dix": three), empty when it is not a number. */
  numbers: string[];
}

function tokenOf(raw: string): Token {
  const [, word = '', tail = ''] = /^([\p{L}-]*)(.*)$/u.exec(raw) ?? [];
  const parts = word.split('-');
  const numbers = word !== '' && parts.every((part) => part in VALUES) ? parts : [];
  return { word, tail, numbers };
}

/** The value of number words in a row: "deux cent cinquante" is 250, "quatre-vingt-dix" 90. */
function valueOf(words: readonly string[]): number {
  let total = 0;
  let current = 0;
  let previous = '';
  for (const word of words) {
    if (word === 'mille') {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
    } else if (word === 'cent' || word === 'cents') {
      current = (current === 0 ? 1 : current) * 100;
    } else if ((word === 'vingt' || word === 'vingts') && previous === 'quatre') {
      // "quatre-vingts": four twenties, the four already counted.
      current += 80 - 4;
    } else {
      current += VALUES[word] ?? 0;
    }
    previous = word;
  }
  return total + current;
}

/**
 * The text with the French number words of a strength written as digits:
 * a number of at least 100 ("mille", "cinq cents"), or any number followed
 * by a unit ("un gramme", "quatre-vingt-dix mg"). A smaller number without a
 * unit is a count ("un comprimé", "boîte de vingt"), "pour cent" is a
 * percentage, and a word that only starts like a number ("millepertuis",
 * "mille-feuille") is a name: they are kept. The text is returned unchanged
 * when there is nothing to write as digits; otherwise its spaces are
 * collapsed. Whether a number written so is a strength or a count ("cent
 * comprimés", "boîte de cent") is parseStrength's to say, as for digits.
 */
export function numberWordsToDigits(text: string): string {
  const raw = text.split(/\s+/u).filter((token) => token !== '');
  const tokens = raw.map(tokenOf);
  const out: string[] = [];
  let changed = false;
  let at = 0;
  while (at < tokens.length) {
    const first = tokens[at];
    if (first === undefined || first.numbers.length === 0 || first.word === 'et') {
      out.push(raw[at] ?? '');
      at += 1;
      continue;
    }
    // The run of number words: "deux cent cinquante", "vingt et un", up to a comma.
    let end = at;
    while ((tokens[end]?.tail ?? '') === '') {
      const next = tokens[end + 1];
      const after = tokens[end + 2];
      if (next !== undefined && next.numbers.length > 0 && next.word !== 'et') {
        end += 1;
      } else if (next?.word === 'et' && next.tail === '' && (after?.numbers.length ?? 0) > 0) {
        end += 2;
      } else {
        break;
      }
    }
    const run = tokens.slice(at, end + 1);
    const words = run.flatMap((token) => (token.word === 'et' ? [] : token.numbers));
    const value = valueOf(words);
    const last = run[run.length - 1];
    const unitAfter = last?.tail === '' && UNIT.test(tokens[end + 1]?.word ?? '');
    const percent =
      tokens[at - 1]?.word === 'pour' && (words[0] === 'cent' || words[0] === 'cents');
    if (!percent && (value >= 100 || unitAfter)) {
      out.push(`${String(value)}${last?.tail ?? ''}`);
      changed = true;
    } else {
      out.push(...raw.slice(at, end + 1));
    }
    at = end + 1;
  }
  return changed ? out.join(' ') : text;
}
