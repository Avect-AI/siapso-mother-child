// SPDX-License-Identifier: MIT
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Header } from './Header.js';

const labels = { appName: 'Carnet', dangerLabel: 'Signes de danger', offlineLabel: 'Hors ligne' };

describe('Header', () => {
  it('links the app name home and the danger signs to #/danger', () => {
    render(<Header {...labels} online current="home" />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Carnet' })).toHaveAttribute('href', '#/');
    expect(within(banner).getByRole('link', { name: 'Signes de danger' })).toHaveAttribute(
      'href',
      '#/danger',
    );
  });

  it('marks the danger shortcut with a chevron, never with the danger octagon', () => {
    const { container } = render(<Header {...labels} online current="home" />);
    const danger = screen.getByRole('link', { name: 'Signes de danger' });
    expect(danger.querySelector('svg.chevron')).not.toBeNull();
    expect(container.querySelector('.level-icon')).toBeNull();
  });

  it('shows the offline badge only when offline', () => {
    const { rerender } = render(<Header {...labels} online current="home" />);
    expect(screen.queryByText('Hors ligne')).toBeNull();

    rerender(<Header {...labels} online={false} current="home" />);
    expect(within(screen.getByRole('banner')).getByText('Hors ligne')).toBeVisible();
  });

  it('tells assistive technology which page is open', () => {
    const { rerender } = render(<Header {...labels} online current="home" />);
    expect(screen.getByRole('link', { name: 'Carnet' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Signes de danger' })).not.toHaveAttribute(
      'aria-current',
    );

    rerender(<Header {...labels} online current="danger" />);
    expect(screen.getByRole('link', { name: 'Carnet' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Signes de danger' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
