// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
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
