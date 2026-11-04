// SPDX-License-Identifier: MIT
import type { Level } from '@siapso/engine';
import { useId, type ReactNode } from 'react';
import { LevelIcon } from './LevelIcon.js';

/**
 * One finding, framed in its level: the level's field carries the pictogram
 * and the level name as a caption, and wraps a white reserve with the product
 * name and the content. Children are the fields, always in the same order:
 * risk, who to show and when, then source, evidence and version.
 *
 * The card is a size container (it trims its padding when narrow), so give it
 * a width from its parent: a block, a grid track or a stretched flex item. In
 * a parent that sizes to its content it would collapse.
 */
export function ResultCard({
  level,
  levelLabel,
  title,
  children,
}: {
  level: Level;
  levelLabel: string;
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  const levelId = `${id}level`;
  const titleId = `${id}title`;
  return (
    <article className={`result-card level--${level}`} aria-labelledby={`${levelId} ${titleId}`}>
      <p className="result-card__level">
        <LevelIcon level={level} size={32} />
        <span id={levelId}>{levelLabel}</span>
      </p>
      <div className="result-card__body">
        <h2 id={titleId} className="result-card__title">
          {title}
        </h2>
        {children}
      </div>
    </article>
  );
}
