// SPDX-License-Identifier: MIT
import type { Level } from '@siapso/engine';
import { LevelIcon } from './LevelIcon.js';

/** The level as a compact tag: its pictogram and its name, never one without the other. */
export function LevelBadge({ level, label }: { level: Level; label: string }) {
  return (
    <span className={`level-badge level--${level}`}>
      <LevelIcon level={level} size={24} />
      <span>{label}</span>
    </span>
  );
}
