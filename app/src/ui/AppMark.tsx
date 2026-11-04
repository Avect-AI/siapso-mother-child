// SPDX-License-Identifier: MIT

/**
 * The app's mark, the same drawing as its home screen icon
 * (public/icons/icon.svg): a plain notebook, the "carnet". No cross, no
 * figure: on a shared phone it says nothing about health or pregnancy.
 * Decorative; colours come from the tokens through base.css.
 */
export function AppMark({ size = 96 }: { size?: number }) {
  const rem = `${String(size / 16)}rem`;
  return (
    <svg
      className="app-mark"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      style={{ width: rem, height: rem }}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="app-mark__ground" width="512" height="512" rx="112" />
      <rect className="app-mark__cover" x="148" y="100" width="224" height="312" rx="28" />
      <path
        className="app-mark__spine"
        d="M148 128a28 28 0 0 1 28-28h28v312h-28a28 28 0 0 1-28-28z"
      />
      <rect className="app-mark__line" x="240" y="164" width="96" height="16" rx="8" />
      <rect className="app-mark__line" x="240" y="212" width="96" height="16" rx="8" />
      <rect className="app-mark__line" x="240" y="260" width="64" height="16" rx="8" />
    </svg>
  );
}
