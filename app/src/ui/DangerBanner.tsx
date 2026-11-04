// SPDX-License-Identifier: MIT
import { Button } from './Button.js';
import { LevelIcon } from './LevelIcon.js';

/**
 * A danger sign is present: the danger field across the screen, announced to
 * screen readers. The level is named in text beside its octagon, then the
 * sentence, then one action. When the banner shows, its action is the
 * screen's only primary action; every other button on the screen is secondary.
 */
export function DangerBanner({
  levelLabel,
  title,
  action,
  onAction,
}: {
  levelLabel: string;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="danger-banner" role="alert">
      <div className="danger-banner__head">
        <p className="danger-banner__level">
          <LevelIcon level="danger" size={48} />
          <span>{levelLabel}</span>
        </p>
        <h2 className="danger-banner__title">{title}</h2>
      </div>
      <Button variant="secondary" className="danger-banner__action" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}
