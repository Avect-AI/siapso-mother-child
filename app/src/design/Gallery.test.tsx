// SPDX-License-Identifier: MIT
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { findForbiddenWording, LEVELS } from '@siapso/engine';
import { Gallery } from './Gallery.js';

it('shows every level and every component', () => {
  const { container } = render(<Gallery />);
  expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  for (const level of LEVELS) {
    expect(container.querySelector(`.result-card.level--${level}`)).not.toBeNull();
    expect(container.querySelector(`.level-badge.level--${level}`)).not.toBeNull();
  }
  expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  expect(container.querySelector('.button--primary')).not.toBeNull();
  expect(container.querySelector('.button--secondary')).not.toBeNull();
  expect(container.querySelector('.button--quiet')).not.toBeNull();
  expect(container.querySelector('.text-field')).not.toBeNull();
});

it('keeps the octagon for the danger level: the danger-signs shortcut carries no level pictogram', () => {
  const { container } = render(<Gallery />);
  const shortcuts = [...container.querySelectorAll('.app-bar__danger')];
  expect(shortcuts.length).toBeGreaterThan(0);
  for (const shortcut of shortcuts) {
    expect(shortcut.querySelector('.level-icon')).toBeNull();
    expect(shortcut).toHaveTextContent('Signes de danger');
  }
});

it('leads every summary row with the level name, the product second', () => {
  const { container } = render(<Gallery />);
  const rows = [...container.querySelectorAll('.result-summary__row')];
  expect(rows.length).toBe(3);
  const levels = [
    'À montrer avant la prochaine prise',
    'À signaler au prochain contact',
    'On ne sait pas',
  ];
  rows.forEach((row, i) => {
    const text = row.querySelector('.result-summary__text');
    expect(text?.firstElementChild?.tagName).toBe('STRONG');
    expect(text?.firstElementChild).toHaveTextContent(levels[i] ?? '');
  });
});

it('uses no forbidden wording in either language', () => {
  const { container } = render(<Gallery />);
  const french = [...container.querySelectorAll('[lang="fr"]')].map((el) => el.textContent);
  expect(french.length).toBeGreaterThan(0);
  for (const text of french) expect(findForbiddenWording(text, 'fr')).toEqual([]);
  const english = container.cloneNode(true) as HTMLElement;
  for (const el of english.querySelectorAll('[lang="fr"]')) el.remove();
  expect(findForbiddenWording(english.textContent, 'en')).toEqual([]);
});
