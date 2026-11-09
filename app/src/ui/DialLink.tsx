// SPDX-License-Identifier: MIT

/**
 * A call link: opens the phone's dialler with `href` (a tel: link); the app
 * sends nothing. A thumb-sized box, the only boxed buttons of who to call.
 * `name`, when the visible words are not enough, is its accessible name and
 * starts with them ("Appeler Awa (Relais), 000 000 001"); `describedBy` names
 * what to know before calling ("Ce numéro peut ne pas marcher ...").
 */
export function DialLink({
  href,
  label,
  name,
  primary,
  describedBy,
}: {
  href: string;
  label: string;
  name?: string;
  primary: boolean;
  describedBy?: string;
}) {
  return (
    <a
      className={`button button--${primary ? 'primary' : 'secondary'} dial-link`}
      href={href}
      aria-label={name}
      aria-describedby={describedBy}
    >
      {label}
    </a>
  );
}
