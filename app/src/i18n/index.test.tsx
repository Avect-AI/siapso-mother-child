// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { I18nProvider, useLang, useT, useTNodes } from './index.js';

function Probe() {
  const t = useT();
  return (
    <p>
      {useLang()}: {t('danger.orientation')}
    </p>
  );
}

afterEach(() => {
  document.documentElement.lang = '';
});

it('gives the strings of the chosen language and sets <html lang>', () => {
  const { rerender } = render(
    <I18nProvider lang="fr">
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByText('fr: Allez au poste de santé maintenant.')).toBeVisible();
  expect(document.documentElement.lang).toBe('fr');

  rerender(
    <I18nProvider lang="en">
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByText('en: Go to the health post now.')).toBeVisible();
  expect(document.documentElement.lang).toBe('en');
});

it('sets <html lang> in the same commit as the words, never a moment after them', async () => {
  // A language read from storage arrives outside any act(), as on the phone.
  function Switcher() {
    const [lang, setLang] = useState<Lang>('fr');
    useEffect(() => {
      const timer = setTimeout(() => {
        setLang('en');
      }, 0);
      return () => {
        clearTimeout(timer);
      };
    }, []);
    return (
      <I18nProvider lang={lang}>
        <Probe />
      </I18nProvider>
    );
  }
  // The switch lands outside act(), as on the phone: React then runs passive
  // effects a task after the commit, as it does in the browser.
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  render(<Switcher />);
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    // Read the moment the English words are in the page, before any later task.
    const lang = await new Promise<string>((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.body.textContent.includes('Go to the health post now.')) {
          observer.disconnect();
          resolve(document.documentElement.lang);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    expect(lang).toBe('en');
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

it('fills a placeholder with an element, so a name keeps its own language', () => {
  function LocalName() {
    const tNodes = useTNodes();
    return (
      <p data-testid="local">
        {tNodes('search.localName', { name: <span lang="wo">nebeday</span>, lang: 'wolof' })}
      </p>
    );
  }
  render(
    <I18nProvider lang="fr">
      <LocalName />
    </I18nProvider>,
  );
  const line = screen.getByTestId('local');
  expect(line).toHaveTextContent('Nom local : nebeday (wolof)');
  expect(screen.getByText('nebeday')).toHaveAttribute('lang', 'wo');
});

it('refuses to translate outside a provider', () => {
  expect(() => render(<Probe />)).toThrow(/I18nProvider/);
});
