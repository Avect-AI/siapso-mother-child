// SPDX-License-Identifier: MIT
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { I18nProvider, useLang, useT } from './index.js';

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

it('refuses to translate outside a provider', () => {
  expect(() => render(<Probe />)).toThrow(/I18nProvider/);
});
