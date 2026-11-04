// SPDX-License-Identifier: MIT
import type { ReactNode } from 'react';
import { WarningMark } from './WarningMark.js';

/** Something the user should know (missing data, storage trouble): ink with the triangle, never red. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice">
      <WarningMark />
      <span>{children}</span>
    </p>
  );
}
