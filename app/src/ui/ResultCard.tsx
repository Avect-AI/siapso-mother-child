// SPDX-License-Identifier: MIT
import type { Level } from '@siapso/engine';
import { useId, type ReactNode } from 'react';
import { LevelIcon } from './LevelIcon.js';

/**
 * The state of the "Pourquoi ?" disclosure: a plus while it is closed, a minus
 * once open (the vertical stroke is hidden by the open state). A shape no level
 * uses, and not the chevron, which says "go there".
 */
function WhyMark() {
  return (
    <svg
      className="result-card__why-mark"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path
        className="result-card__why-mark-open"
        d="M12 5v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A heading level below the screen's h1: the caller knows the page outline. */
export type HeadingLevel = 2 | 3 | 4;

/**
 * One finding, framed in its level: the level's field carries the pictogram
 * and the level name as a caption, and wraps a white reserve with the product
 * name and the fields, always in the same order: the reading fields
 * (children: the risk), then who to show and when (the clearest line of the
 * reserve) and its action if any (a quiet "Voir qui appeler"), then the
 * details for the health worker (`details`: the fact, each detailed risk with
 * its evidence level), then the source and rule lines (`meta`). With
 * `whyLabel`, the details and the meta are kept behind one disclosure
 * ("Pourquoi ?"), closed, so the card stays short for a slow reader and the
 * health worker opens it with one tap. A danger card leaves out the
 * orientation only when the danger banner above says it (`orientation` null).
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
  action,
  details,
  meta,
  whyLabel,
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
  /** Under who to show and when: a quiet link, never a second primary action. */
  action?: ReactNode;
  /** More for the health worker (fact, detailed risk and its evidence level), after the orientation. */
  details?: ReactNode;
  /** Source and rule lines, last. */
  meta?: ReactNode;
  /** The words of the disclosure that keeps `details` and `meta` closed ("Pourquoi ?"). */
  whyLabel?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  const more = (
    <>
      {details === undefined ? null : <div className="result-card__details">{details}</div>}
      {meta === undefined ? null : <div className="result-card__meta">{meta}</div>}
    </>
  );
  const hasMore = details !== undefined || meta !== undefined;
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
        {action === undefined ? null : <div className="result-card__action">{action}</div>}
        {hasMore && whyLabel !== undefined ? (
          <details className="result-card__why">
            {/* Described by the card's heading: several "Pourquoi ?" are told apart. */}
            <summary aria-describedby={titleId}>
              <WhyMark />
              {whyLabel}
            </summary>
            {more}
          </details>
        ) : (
          more
        )}
      </div>
    </article>
  );
}
