// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LEVELS, type Level } from '@siapso/engine';
import { Button, DangerBanner, LevelBadge, LevelIcon, ResultCard, TextField } from './index.js';

const baseCss = readFileSync(join(import.meta.dirname, '../styles/base.css'), 'utf8');
const tokensCss = readFileSync(join(import.meta.dirname, '../styles/tokens.css'), 'utf8');

/** The value, or a test failure when the element is missing. */
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected element is missing');
  return value;
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(baseCss);
  return match?.[1] ?? '';
}

describe('Button', () => {
  it('Button meets the 48 px touch target through its class', () => {
    render(<Button variant="primary">Voir le résultat</Button>);
    expect(screen.getByRole('button', { name: 'Voir le résultat' })).toHaveClass('button');
    expect(rule('.button')).toMatch(/min-height:\s*var\(--touch-target\)/);
    expect(rule('.button')).toMatch(/min-width:\s*var\(--touch-target\)/);
    expect(tokensCss).toMatch(/--touch-target:\s*48px/);
  });

  it('takes the variant it is given', () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="quiet">Quiet</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('button--primary');
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass('button--secondary');
    expect(screen.getByRole('button', { name: 'Quiet' })).toHaveClass('button--quiet');
    for (const variant of ['primary', 'secondary', 'quiet']) {
      expect(rule(`.button--${variant}`)).not.toBe('');
    }
  });

  it('has no default variant, so no screen gets an accidental extra primary', () => {
    // The type check is the guard: a Button without a variant does not compile.
    // @ts-expect-error variant is required
    render(<Button>No variant</Button>);
    expect(screen.getByRole('button', { name: 'No variant' })).not.toHaveClass('button--primary');
  });

  it('never submits a form unless asked, and passes attributes and handlers through', async () => {
    const onClick = vi.fn();
    render(
      <>
        <Button variant="primary" onClick={onClick} className="extra" aria-describedby="note">
          Go
        </Button>
        <Button variant="secondary" type="submit">
          Send
        </Button>
      </>,
    );
    const go = screen.getByRole('button', { name: 'Go' });
    expect(go).toHaveAttribute('type', 'button');
    expect(go).toHaveClass('button', 'button--primary', 'extra');
    expect(go).toHaveAttribute('aria-describedby', 'note');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
    await userEvent.click(go);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not react when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="secondary" disabled onClick={onClick}>
        Later
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Later' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('ties a visible label to its input', async () => {
    render(<TextField label="Nom du produit" name="product" />);
    const input = screen.getByLabelText('Nom du produit');
    expect(input.tagName).toBe('INPUT');
    expect(screen.getByText('Nom du produit')).toBeVisible();
    await userEvent.type(input, 'Doliprane');
    expect(input).toHaveValue('Doliprane');
  });

  it('describes the input with its hint', () => {
    render(<TextField label="Semaines" hint="Semaines depuis les dernières règles" />);
    expect(screen.getByLabelText('Semaines')).toHaveAccessibleDescription(
      'Semaines depuis les dernières règles',
    );
    expect(screen.getByLabelText('Semaines')).not.toHaveAttribute('aria-invalid');
  });

  it('marks the input invalid and reads the error with the hint', () => {
    render(<TextField label="Code" hint="4 à 6 chiffres" error="Le code a 4 à 6 chiffres." />);
    const input = screen.getByLabelText('Code');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('4 à 6 chiffres Le code a 4 à 6 chiffres.');
    expect(screen.getByText('Le code a 4 à 6 chiffres.')).toBeVisible();
  });

  it('keeps an id given by the caller and the 48 px target', () => {
    render(<TextField label="Ville" id="city" />);
    expect(screen.getByLabelText('Ville')).toHaveAttribute('id', 'city');
    expect(rule('.text-field__input')).toMatch(/min-height:\s*var\(--touch-target\)/);
  });
});

/**
 * The drawn geometry of a LevelIcon: its markup with the per-instance mask id
 * (from useId) removed, so two drawings compare equal only if they are the
 * same shape.
 */
function shape(level: Level): string {
  const { container, unmount } = render(<LevelIcon level={level} />);
  const html = present(container.querySelector('svg')).innerHTML.replace(/level-icon-[\w-]+/g, '');
  unmount();
  return html;
}

describe('LevelIcon', () => {
  it('each level has a different icon shape', () => {
    const shapes = (['danger', 'before-next-dose', 'next-contact', 'unknown'] as const).map(shape);
    expect(new Set(shapes).size).toBe(4);
  });

  it('draws the same shape every time for one level, so the test above can fail', () => {
    const drawings = [1, 2, 3, 4].map(() => shape('danger'));
    expect(new Set(drawings).size).toBe(1);
  });

  it('is hidden from assistive technology and sized by its prop', () => {
    const { container } = render(<LevelIcon level="danger" size={48} />);
    const svg = present(container.querySelector('svg'));
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('width', '48');
    expect(svg).toHaveAttribute('height', '48');
  });

  it('grows with the user font size, like the text beside it', () => {
    const { container } = render(<LevelIcon level="next-contact" size={48} />);
    const svg = present(container.querySelector('svg'));
    expect([svg.style.width, svg.style.height]).toEqual(['3rem', '3rem']);
  });

  it('defaults to the 24 px inline size', () => {
    const { container } = render(<LevelIcon level="unknown" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '24');
  });
});

describe('LevelBadge', () => {
  it('LevelBadge always shows the level name as text', () => {
    render(<LevelBadge level="unknown" label="On ne sait pas" />);
    expect(screen.getByText('On ne sait pas')).toBeVisible();
  });

  it('pairs the pictogram with the name for every level', () => {
    for (const level of LEVELS) {
      const { container, unmount } = render(<LevelBadge level={level} label={`Name ${level}`} />);
      const badge = present(container.firstElementChild);
      expect(badge).toHaveClass('level-badge', `level--${level}`);
      expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(badge).toHaveTextContent(`Name ${level}`);
      unmount();
    }
  });
});

describe('ResultCard', () => {
  it('names the level before the product and shows the content', () => {
    render(
      <ResultCard
        level="before-next-dose"
        levelLabel="À montrer avant la prochaine prise"
        title="Ibuprofène"
      >
        <p>Montrez ce produit à la sage-femme avant la prochaine prise.</p>
      </ResultCard>,
    );
    // The article is named by its level, then its product, so a screen reader
    // landing on it hears the level first.
    const card = screen.getByRole('article', {
      name: 'À montrer avant la prochaine prise Ibuprofène',
    });
    expect(card).toHaveClass('result-card', 'level--before-next-dose');
    expect(screen.getByRole('heading', { name: 'Ibuprofène' })).toBeVisible();
    const level = screen.getByText('À montrer avant la prochaine prise');
    expect(level).toBeVisible();
    expect(
      level.compareDocumentPosition(screen.getByRole('heading', { name: 'Ibuprofène' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/Montrez ce produit/)).toBeVisible();
    expect(card.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('frames every level', () => {
    for (const level of LEVELS) {
      expect(rule(`.level--${level}`)).toMatch(/--level-bg:\s*var\(--level-/);
      expect(rule(`.level--${level}`)).toMatch(/--level-fill:/);
    }
    expect(rule('.result-card')).toMatch(/background:\s*var\(--level-fill\)/);
    expect(rule('.level-badge')).toMatch(/background:\s*var\(--level-fill\)/);
  });

  it('sets the white reserve into the field, not as a card inside a card', () => {
    const reserve = rule('.result-card__body');
    expect(reserve).toMatch(/background:\s*var\(--color-surface\)/);
    expect(reserve).not.toMatch(/border(-width)?:/);
    expect(reserve).not.toMatch(/border-radius:/);
  });

  it('makes the level name the stronger line, and never hyphenates a product name', () => {
    expect(rule('.result-card__level')).toMatch(/font-size:\s*var\(--font-size-title\)/);
    expect(rule('.result-card__level')).toMatch(/font-weight:\s*var\(--font-weight-heading\)/);
    expect(rule('.result-card__title')).toMatch(/font-size:\s*var\(--font-size-body\)/);
    expect(baseCss).not.toMatch(/hyphens:\s*auto/);
  });

  it('keeps form errors off the danger red', () => {
    expect(rule('.text-field__error')).toMatch(/color:\s*var\(--color-text\)/);
    expect(baseCss).not.toMatch(/--color-error/);
  });

  it('hatches the unknown field, so grey never reads as a flat, disabled or reassuring state', () => {
    expect(rule('.level--unknown')).toMatch(
      /--level-fill:\s*repeating-linear-gradient\([^;]*var\(--level-unknown-hatch\)/,
    );
    for (const level of ['danger', 'before-next-dose', 'next-contact']) {
      expect(rule(`.level--${level}`)).toMatch(/--level-fill:\s*var\(--level-[a-z-]+-bg\);/);
    }
  });
});

describe('DangerBanner', () => {
  it('announces the danger and runs its action', async () => {
    const onAction = vi.fn();
    render(
      <DangerBanner
        levelLabel="Signe de danger"
        title="Fièvre. Allez au poste de santé maintenant."
        action="Appeler le poste de santé"
        onAction={onAction}
      />,
    );
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Fièvre. Allez au poste de santé maintenant.');
    expect(banner.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const action = screen.getByRole('button', { name: 'Appeler le poste de santé' });
    expect(action).toHaveClass('button');
    await userEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('always names the level in text, not only with the octagon, before the sentence', () => {
    render(
      <DangerBanner
        levelLabel="Signe de danger"
        title="Fièvre. Allez au poste de santé maintenant."
        action="Appeler le poste de santé"
        onAction={vi.fn()}
      />,
    );
    const level = screen.getByText('Signe de danger');
    expect(level).toBeVisible();
    const heading = screen.getByRole('heading', {
      name: 'Fièvre. Allez au poste de santé maintenant.',
    });
    expect(level.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
