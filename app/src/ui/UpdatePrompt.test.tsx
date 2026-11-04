// SPDX-License-Identifier: MIT
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdatePrompt } from './UpdatePrompt.js';

const texts = { message: 'Une nouvelle version est prête.', action: 'Recharger' };

it('says a new version is ready and reloads only when asked', async () => {
  const onReload = vi.fn();
  render(<UpdatePrompt open {...texts} onReload={onReload} />);

  expect(screen.getByRole('status')).toHaveTextContent('Une nouvelle version est prête.');
  expect(onReload).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Recharger' }));
  expect(onReload).toHaveBeenCalledTimes(1);
});

it('stays an empty live region until a version is ready, so its arrival is announced', () => {
  const { rerender } = render(<UpdatePrompt open={false} {...texts} onReload={vi.fn()} />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();

  rerender(<UpdatePrompt open {...texts} onReload={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Une nouvelle version est prête.');
});

describe('scroll padding (a focused control never hides under the band)', () => {
  const height = () => document.documentElement.style.getPropertyValue('--update-band-height');

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reserves the band height at the bottom of the page while it is open, and frees it after', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
    const { rerender } = render(<UpdatePrompt open {...texts} onReload={vi.fn()} />);
    expect(height()).toBe('120px');

    rerender(<UpdatePrompt open={false} {...texts} onReload={vi.fn()} />);
    expect(height()).toBe('');
  });

  it('follows the band when it changes size (larger text, a turned phone)', () => {
    let resized: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(120);
    render(<UpdatePrompt open {...texts} onReload={vi.fn()} />);

    offsetHeight.mockReturnValue(230);
    resized();
    expect(height()).toBe('230px');
  });
});

it('uses a secondary button, so the screen keeps its one primary action', () => {
  render(<UpdatePrompt open {...texts} onReload={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Recharger' })).toHaveClass('button--secondary');
});
