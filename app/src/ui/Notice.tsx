// SPDX-License-Identifier: MIT
import type { ReactNode } from 'react';
import { WarningMark } from './WarningMark.js';

/** Something the user should know (missing data, storage trouble): ink with the triangle, never red. */
export function Notice({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p className="notice" id={id}>
      <WarningMark />
      <span>{children}</span>
    </p>
  );
}
