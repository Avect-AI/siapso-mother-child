// SPDX-License-Identifier: MIT
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OfflineBadge } from './OfflineBadge.js';

it('says "offline" in words when the phone has no connection', () => {
  render(<OfflineBadge online={false} label="Hors ligne" />);
  expect(screen.getByRole('status')).toHaveTextContent('Hors ligne');
});

it('shows nothing when online, but keeps its live region so a change is announced', () => {
  const { rerender } = render(<OfflineBadge online label="Hors ligne" />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();

  rerender(<OfflineBadge online={false} label="Hors ligne" />);
  expect(screen.getByRole('status')).toHaveTextContent('Hors ligne');
});
