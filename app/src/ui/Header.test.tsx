// SPDX-License-Identifier: MIT
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './Header.js';

const labels = {
  appName: 'Carnet',
  dangerLabel: 'Signes de danger',
  offlineLabel: 'Hors ligne',
  quickExit: null,
};

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

  it('holds the name and the danger shortcut alone on the first row, whatever else the band shows', async () => {
    const onExit = vi.fn();
    const { container, rerender } = render(<Header {...labels} online current="home" />);
    expect(screen.queryByRole('button', { name: 'Quitter' })).toBeNull();
    const danger = screen.getByRole('link', { name: 'Signes de danger' });
    const name = screen.getByRole('link', { name: 'Carnet' });
    const bar = container.querySelector('.header__bar');
    // The shortcut ends the first row: nothing else is ever on it, so it keeps
    // its place with or without the badge and the quick exit, at any width.
    expect([...(bar?.children ?? [])]).toEqual([name, danger]);

    rerender(
      <Header {...labels} online={false} current="home" quickExit={{ label: 'Quitter', onExit }} />,
    );
    expect([...(bar?.children ?? [])]).toEqual([name, danger]);
    // The badge, then the quick exit, on the second row.
    const more = container.querySelector('.header__more');
    const badge = within(screen.getByRole('banner')).getByText('Hors ligne');
    const exit = within(screen.getByRole('banner')).getByRole('button', { name: 'Quitter' });
    expect(more?.contains(badge)).toBe(true);
    expect(more?.contains(exit)).toBe(true);
    expect(badge.compareDocumentPosition(exit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(danger.compareDocumentPosition(exit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.setup().click(exit);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('keeps the app name as the way home even when only the mark shows (a narrow phone)', () => {
    render(<Header {...labels} online current="home" />);
    // The name is in the link, so it stays its accessible name when hidden from view (base.css).
    expect(
      screen.getByRole('link', { name: 'Carnet' }).querySelector('.header__name-text'),
    ).toHaveTextContent('Carnet');
  });

  it("shows only the mark in the name's place on the welcome, never the danger shortcut elsewhere", () => {
    const { container } = render(<Header {...labels} appName={null} online current={null} />);
    const banner = screen.getByRole('banner');
    // The welcome shows the name itself: no way home to itself, only the mark,
    // which keeps the shortcut where it is on every other screen.
    expect(within(banner).queryByRole('link', { name: 'Carnet' })).toBeNull();
    const bar = container.querySelector('.header__bar');
    const mark = bar?.children[0];
    expect(mark).toHaveClass('header__name');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(bar?.children[1]).toBe(within(banner).getByRole('link', { name: 'Signes de danger' }));
  });
});
