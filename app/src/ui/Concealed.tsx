// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Words that can say a secret to whoever sees the screen (a note on
 * contraception, an HIV-related situation): a button with words that say
 * nothing of them stands in their place until an explicit tap, which shows
 * them and hands them the focus. They are hidden again whenever the screen
 * is shown anew (after a lock, on another visit).
 */
export function Concealed({ label, children }: { label: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shown) content.current?.focus();
  }, [shown]);

  if (!shown) {
    return (
      <button
        type="button"
        className="option option--concealed"
        onClick={() => {
          setShown(true);
        }}
      >
        <span>{label}</span>
      </button>
    );
  }
  return (
    <div ref={content} tabIndex={-1} className="concealed">
      {children}
    </div>
  );
}
