// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LEVELS, type Level } from '@siapso/engine';
import { Button, DangerBanner, LevelBadge, LevelIcon, ResultCard, TextField } from './index.js';
import { STICKY_HEIGHT, StickyAction } from './StickyAction.js';

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

/** Whether `a` comes before `b` in the document. */
function before(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('ResultCard', () => {
  it('names the level before the product and shows the content', () => {
    render(
      <ResultCard
        level="before-next-dose"
        levelLabel="À montrer avant la prochaine prise"
        title="Ibuprofène"
        headingLevel={2}
        orientation="Montrez ce produit à la sage-femme avant la prochaine prise."
      >
        <p>Ce médicament peut abîmer les reins du bébé.</p>
      </ResultCard>,
    );
    // The heading, and so the article, says the level before the product: a
    // screen reader landing on it, or jumping by heading, hears the level first.
    const name = 'À montrer avant la prochaine prise. Ibuprofène';
    const card = screen.getByRole('article', { name });
    expect(card).toHaveClass('result-card', 'level--before-next-dose');
    const heading = screen.getByRole('heading', { name });
    expect(heading).toBeVisible();
    // The caption shows the same words to the eye, before the product.
    const level = screen.getByText('À montrer avant la prochaine prise');
    expect(level).toBeVisible();
    expect(level.closest('[aria-hidden="true"]')).toHaveClass('result-card__level');
    expect(before(level, heading)).toBe(true);
    expect(screen.getByText(/Montrez ce produit/)).toBeVisible();
    expect(card.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('takes its heading level from the page outline', () => {
    render(
      <ResultCard
        level="unknown"
        levelLabel="On ne sait pas"
        title="Kinkéliba"
        headingLevel={3}
        orientation="Montrez-le à votre sage-femme ou au pharmacien."
      >
        <p>Nous n’avons pas d’information fiable.</p>
      </ResultCard>,
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'On ne sait pas. Kinkéliba' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('says who to show and when after the risk, then the details, then the source lines', () => {
    render(
      <ResultCard
        level="next-contact"
        levelLabel="À signaler au prochain contact"
        title="Moringa"
        headingLevel={2}
        orientation="Dites-le à la sage-femme à la prochaine visite."
        details={<p>Une étude chez des volontaires a montré un effet.</p>}
        meta={<p>Source : exemple.</p>}
      >
        <p>Le moringa peut changer l’effet d’un médicament.</p>
      </ResultCard>,
    );
    const risk = screen.getByText(/peut changer/);
    const orientation = screen.getByText('Dites-le à la sage-femme à la prochaine visite.');
    const details = screen.getByText(/volontaires/);
    const source = screen.getByText('Source : exemple.');
    expect(orientation).toHaveClass('result-card__orientation');
    expect(before(risk, orientation)).toBe(true);
    expect(before(orientation, details)).toBe(true);
    expect(before(details, source)).toBe(true);
    expect(details.closest('.result-card__details')).not.toBeNull();
    expect(source.closest('.result-card__meta')).not.toBeNull();
  });

  it('makes who to show and when the clearest line of the reserve, apart from the product name', () => {
    // Title size, down to the reading size in a card narrow for the text size, so its words stay whole.
    expect(rule('.result-card__orientation')).toMatch(
      /font-size:\s*clamp\(var\(--font-size-body\),[^;]*var\(--font-size-title\)\)/,
    );
    expect(rule('.result-card__orientation')).toMatch(
      /font-weight:\s*var\(--font-weight-heading\)/,
    );
    expect(rule('.result-card__title')).toMatch(/font-size:\s*var\(--font-size-body\)/);
    // Hairlines by role, not by position: before who and when, and before the sources.
    expect(rule('.result-card__orientation')).toMatch(/border-top:/);
    expect(rule('.result-card__meta')).toMatch(/border-top:/);
    expect(baseCss).not.toMatch(/\.result-card__body > \* \+ \*/);
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
    // Hyphens only for a reading word too wide for its line in a narrow card:
    // never the product names (the title, a possible match, the name typed in
    // a meta line, "Vous avez écrit : ..."), nor who and when, nor any meta
    // line (sources, evidence, the term note).
    const hyphenated = [...baseCss.matchAll(/([^{}]+)\{[^{}]*hyphens:\s*auto/g)].map((match) =>
      (match[1] ?? '').replace(/\/\*[^]*?\*\//g, '').trim(),
    );
    expect(hyphenated).toEqual([
      '.result-card__body > p:not(.result-card__possible, .result-card__orientation, .meta),\n  .result-card__details p:not(.meta)',
    ]);
    expect(baseCss).toMatch(/@container \(max-width: 18rem\) \{[^@]*hyphens:\s*auto/);
  });

  it('keeps form errors off the danger red', () => {
    expect(rule('.text-field__error')).toMatch(/color:\s*var\(--color-text\)/);
    expect(rule('.choice-group__error')).toMatch(/color:\s*var\(--color-text\)/);
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
  function banner(onAction = vi.fn(), headingLevel: 2 | 3 = 2) {
    return render(
      <DangerBanner
        levelLabel="Signe de danger"
        title="Allez au poste de santé maintenant."
        action="Voir qui appeler"
        headingLevel={headingLevel}
        onAction={onAction}
      />,
    );
  }

  it('announces the level and the instruction it shows, from a region that does not hold the button', () => {
    const { container, rerender } = banner();
    const alert = screen.getByRole('alert');
    // The visible words themselves: said when the banner appears, and only
    // once when read through, never a hidden copy beside them.
    expect(alert).toHaveTextContent('Signe de danger Allez au poste de santé maintenant.');
    expect(alert.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByText('Allez au poste de santé maintenant.')).toHaveLength(1);
    expect(container.querySelector('.danger-banner .sr-only')).toBeNull();
    // A change of language: the region says the new words.
    rerender(
      <DangerBanner
        levelLabel="Danger sign"
        title="Go to the health post now."
        action="See who to call"
        headingLevel={2}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Danger sign Go to the health post now.');
    expect(container.querySelector('.danger-banner svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('sets a long instruction at title size, still its largest line', () => {
    render(
      <DangerBanner
        levelLabel="Signe de danger"
        title="Montrez ce que vous prenez à la sage-femme aujourd'hui. En cas de saignement ou de douleur très forte, allez immédiatement au centre de santé."
        action="Voir qui appeler"
        headingLevel={2}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('danger-banner__title--long');
    // Title size at most, down to the reading size in a narrow banner at large text.
    expect(rule('.danger-banner__title--long')).toMatch(
      /font-size:\s*clamp\(var\(--font-size-body\),[^;]*var\(--font-size-title\)\)/,
    );
    expect(rule('.danger-banner')).toMatch(/container-type:\s*inline-size/);
    // At 200 percent text a long word ("immédiatement") breaks instead of widening the banner.
    expect(rule('.danger-banner__head')).toMatch(/min-width:\s*0/);
    expect(rule('.danger-banner__head')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    // The level line stays smaller than the title size.
    expect(rule('.danger-banner__level')).toMatch(/font-size:\s*var\(--font-size-body\)/);
  });

  it('says its instruction once: no group around it is named by the same words', () => {
    const { container } = banner();
    // A group named by its own heading made screen readers say the instruction
    // twice: as the group's name, then as the heading in the alert.
    expect(screen.queryByRole('group')).toBeNull();
    expect(container.querySelector('[aria-labelledby]')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Allez au poste de santé maintenant.');
  });

  it('runs its action', async () => {
    const onAction = vi.fn();
    banner(onAction);
    const action = screen.getByRole('button', { name: 'Voir qui appeler' });
    expect(action).toHaveClass('button');
    await userEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('can stand without an action, when the actions follow it (who to call)', () => {
    render(
      <DangerBanner
        levelLabel="Signe de danger"
        title="Allez au poste de santé maintenant."
        headingLevel={2}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Signe de danger Allez au poste de santé maintenant.',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the level in text before the instruction, which is its largest line', () => {
    banner(vi.fn(), 3);
    const level = screen.getByText('Signe de danger');
    expect(level).toBeVisible();
    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'Allez au poste de santé maintenant.',
    });
    expect(before(level, heading)).toBe(true);
    expect(heading).not.toHaveClass('danger-banner__title--long');
    expect(rule('.danger-banner__title')).toMatch(/font-size:[^;]*var\(--font-size-headline\)/);
    expect(rule('.danger-banner__level')).toMatch(/font-size:\s*var\(--font-size-body\)/);
  });
});

describe('StickyAction', () => {
  it('gives the page its height as the room to keep under a focused element, while it shows', () => {
    const { unmount } = render(
      <StickyAction>
        <Button variant="primary">C'est grave maintenant</Button>
      </StickyAction>,
    );
    expect(screen.getByRole('button').parentElement).toHaveClass('sticky-action');
    expect(document.documentElement.style.getPropertyValue(STICKY_HEIGHT)).toMatch(
      /^\d+(\.\d+)?px$/,
    );
    // The page's scroll padding is the measured height, not a fixed guess.
    expect(baseCss).toMatch(
      /html:has\(\.sticky-action\) \{\s*scroll-padding-block-end: calc\([^;]*var\(--sticky-action-height/,
    );
    unmount();
    expect(document.documentElement.style.getPropertyValue(STICKY_HEIGHT)).toBe('');
  });
});
