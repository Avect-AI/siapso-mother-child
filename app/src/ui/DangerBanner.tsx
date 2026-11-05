// SPDX-License-Identifier: MIT
import { Button } from './Button.js';
import { LevelIcon } from './LevelIcon.js';
import type { HeadingLevel } from './ResultCard.js';

/**
 * An instruction longer than this many characters takes the title size, not
 * the headline size: "Allez au poste de santé maintenant." stays a headline, a
 * rule's two-sentence instruction stays readable (and is still the banner's
 * largest line).
 */
const LONG_INSTRUCTION = 40;

/**
 * A danger is present: the danger field across the screen. The level is named
 * in text beside its octagon, then the instruction (`title`, the banner's
 * largest line), then one action. When the banner shows, its action is the
 * screen's only primary action; every other button on the screen is secondary.
 * Without `action` and `onAction` (who to call: the call buttons above it are
 * the actions) the banner says the level and the instruction only.
 *
 * The level and the instruction are an alert region: screen readers say them
 * when the banner appears, in the words shown (so a change of language says
 * the new words), and read them once when going through the page, since no
 * hidden copy sits beside them and no group around them is named by the same
 * words (its heading already names the instruction). The button stays outside
 * the region.
 */
export function DangerBanner({
  levelLabel,
  title,
  action,
  headingLevel,
  onAction,
}: {
  levelLabel: string;
  title: string;
  /** The instruction's heading level, from the page outline. */
  headingLevel: HeadingLevel;
} & ({ action: string; onAction: () => void } | { action?: undefined; onAction?: undefined })) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  const titleClass =
    title.length > LONG_INSTRUCTION
      ? 'danger-banner__title danger-banner__title--long'
      : 'danger-banner__title';
  return (
    <div className="danger-banner">
      <div className="danger-banner__head" role="alert">
        <p className="danger-banner__level">
          <LevelIcon level="danger" size={48} />
          <span>{levelLabel}</span>
        </p>{' '}
        <Heading className={titleClass}>{title}</Heading>
      </div>
      {action === undefined ? null : (
        <Button variant="secondary" className="danger-banner__action" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}
