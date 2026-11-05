// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { createContext, Fragment, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { translate, type MessageKey, type Vars } from './translate.js';

export type { MessageKey, Vars } from './translate.js';
export { translate } from './translate.js';

const LangContext = createContext<Lang | null>(null);

/** Provides the interface language and keeps `<html lang>` in step with it. */
export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return <LangContext value={lang}>{children}</LangContext>;
}

/** The current interface language. */
export function useLang(): Lang {
  const lang = useContext(LangContext);
  if (lang === null) throw new Error('useLang and useT need an I18nProvider');
  return lang;
}

/** A translation function for the current language. */
export function useT(): (key: MessageKey, vars?: Vars) => string {
  const lang = useLang();
  return useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang]);
}

/**
 * A translation function whose placeholders take elements as well as text,
 * for a word that must carry its own language (a Wolof name, lang="wo") in a
 * sentence of the interface. A placeholder without a value stays visible.
 */
export function useTNodes(): (key: MessageKey, vars: Record<string, ReactNode>) => ReactNode {
  const lang = useLang();
  return useCallback(
    (key: MessageKey, vars: Record<string, ReactNode>) =>
      // The template itself (no values given), split around its placeholders:
      // even parts are text, odd parts are placeholder names.
      translate(lang, key)
        .split(/\{(\w+)\}/)
        .map((part, index) =>
          index % 2 === 0 ? (
            part
          ) : (
            <Fragment key={`${part}:${String(index)}`}>{vars[part] ?? `{${part}}`}</Fragment>
          ),
        ),
    [lang],
  );
}
