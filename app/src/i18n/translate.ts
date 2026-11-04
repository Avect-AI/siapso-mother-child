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

/** The string of `key` in `lang`, with its placeholders filled. */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  let node: unknown = DICTIONARIES[lang];
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown>)[part];
  }
  return interpolate(node as string, vars);
}
