// SPDX-License-Identifier: MIT
import { render, screen } from '@testing-library/react';
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
