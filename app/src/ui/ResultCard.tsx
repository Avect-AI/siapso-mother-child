// SPDX-License-Identifier: MIT
import type { Level } from '@siapso/engine';
import { useId, type ReactNode } from 'react';
import { LevelIcon } from './LevelIcon.js';

/** A heading level below the screen's h1: the caller knows the page outline. */
export type HeadingLevel = 2 | 3 | 4;

/**
 * One finding, framed in its level: the level's field carries the pictogram
 * and the level name as a caption, and wraps a white reserve with the product
 * name and the fields, always in the same order: the reading fields
 * (children: the risk), then who to show and when (the clearest line of the
 * reserve), then the details for the health worker (`details`: the fact,
 * each detailed risk with its evidence level), then the source and rule
 * lines (`meta`). A danger card leaves out the orientation only when the
 * danger banner above says it (`orientation` null).
 *
 * The heading says the level before the product, so a screen reader that
 * jumps from heading to heading hears both; the caption, the same words, is
 * left to the eye. The card is named by its heading.
 *
 * The card is a size container (it trims its padding when narrow), so give it
 * a width from its parent: a block, a grid track or a stretched flex item. In
 * a parent that sizes to its content it would collapse.
 */
export function ResultCard({
  level,
  levelLabel,
  title,
  headingLevel,
  orientation,
  details,
  meta,
  children,
}: {
  level: Level;
  levelLabel: string;
  /** The product names, as confirmed (text, or names set on their own lines). */
  title: ReactNode;
  /** The product name's heading level, from the page outline. */
  headingLevel: HeadingLevel;
  /**
   * Who to show and when; null only for a danger card whose orientation is
   * the instruction of the danger banner above it (said once, there).
   */
  orientation: string | null;
  /** More for the health worker (fact, detailed risk and its evidence level), after the orientation. */
  details?: ReactNode;
  /** Source and rule lines, last. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  return (
    <article className={`result-card level--${level}`} aria-labelledby={titleId}>
      <p className="result-card__level" aria-hidden="true">
        <LevelIcon level={level} size={32} />
        <span>{levelLabel}</span>
      </p>
      <div className="result-card__body">
        <Heading id={titleId} className="result-card__title">
          <span className="sr-only">{levelLabel}.</span> {title}
        </Heading>
        {children}
        {orientation === null ? null : <p className="result-card__orientation">{orientation}</p>}
        {details === undefined ? null : <div className="result-card__details">{details}</div>}
        {meta === undefined ? null : <div className="result-card__meta">{meta}</div>}
      </div>
    </article>
  );
}
