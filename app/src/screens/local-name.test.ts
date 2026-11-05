// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import { translate, type MessageKey, type Vars } from '../i18n/translate.js';
import { localNameText } from './local-name.js';

/** French puts a no-break space before a colon. */
const NBSP = '\u00a0';
const tOf = (lang: Lang) => (key: MessageKey, vars?: Vars) => translate(lang, key, vars);

describe('localNameText', () => {
  it('calls a Wolof name a local name, with its language', () => {
    const nebeday = { text: 'nebeday', lang: 'wo', checked: false } as const;
    expect(localNameText(nebeday, 'fr', tOf('fr'))).toBe(`Nom local${NBSP}: nebeday (wolof)`);
    expect(localNameText(nebeday, 'en', tOf('en'))).toBe('Local name: nebeday (Wolof)');
  });

  it('calls a French name another name, never a local name, and gives its language only on a screen in another', () => {
    const argile = { text: 'argile', lang: 'fr', checked: false } as const;
    expect(localNameText(argile, 'fr', tOf('fr'))).toBe(`Autre nom${NBSP}: argile`);
    expect(localNameText(argile, 'en', tOf('en'))).toBe('Other name: argile (French)');
  });
});
