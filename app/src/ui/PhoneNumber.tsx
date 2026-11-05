// SPDX-License-Identifier: MIT
import { Fragment } from 'react';

/**
 * A phone number as text, group by group (domain/contacts.ts phoneGroups):
 * each group stays on one line, so the number wraps only between groups and
 * is read out or typed on another phone group by group. Plain spaces between
 * the groups, so it reads and copies as written.
 */
export function PhoneNumber({
  groups,
  className,
}: {
  groups: readonly string[];
  className: string;
}) {
  return (
    <p className={className}>
      {groups.map((group, index) => (
        <Fragment key={`${String(index)}:${group}`}>
          {index === 0 ? null : ' '}
          <span className="phone__group">{group}</span>
        </Fragment>
      ))}
    </p>
  );
}
