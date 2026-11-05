// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { en } from './en.js';
import { fr, type Dictionary } from './fr.js';

/** The dotted paths to every string of a dictionary, such as "home.check". */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** A key of the French dictionary; a typo is a type error. */
export type MessageKey = Leaves<Dictionary>;

export type Vars = Record<string, string | number>;

const DICTIONARIES: Readonly<Record<Lang, Dictionary>> = { fr, en };

/** Fills each `{name}` with its value; a placeholder without a value stays visible. */
export function interpolate(text: string, vars: Vars = {}): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = vars[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** A word starting with a vowel sound that French elides before ("Aminata", "Éva", "ADVIL"). */
const VOWEL_START = /^[aeiouàâäéèêëîïôöùûü]/i;

/**
 * French elides "de" and "que" before a value that starts with a vowel ("le
 * profil d'Aminata", "la même qu'ADVIL"); a number or a consonant keeps them.
 */
function elide(text: string, vars: Vars | undefined): string {
  return text.replace(/(?<![\p{L}])(de|que) \{(\w+)\}/gu, (whole, word: string, name: string) => {
    const value = vars?.[name];
    if (typeof value !== 'string' || !VOWEL_START.test(value)) return whole;
    return `${word === 'de' ? 'd' : 'qu'}'{${name}}`;
  });
}

/** The string of `key` in `lang`, with its placeholders filled. */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  let node: unknown = DICTIONARIES[lang];
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown>)[part];
  }
  const text = node as string;
  return interpolate(lang === 'fr' ? elide(text, vars) : text, vars);
}
