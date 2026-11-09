// SPDX-License-Identifier: MIT
import type { Mode } from '../domain/types.js';
import { useT } from '../i18n/index.js';
import { Notice } from '../ui/Notice.js';
import { CALL_PATH } from './Referral.js';

/**
 * Past 42 weeks and still pregnant: she is to be seen at the health post
 * today, said with who to call. Shown where the term is given (her profile, a
 * passer-by's questions), on the check and on the result. The check goes on:
 * the rules read the term as 42 weeks and over (domain/term.ts). Never red: it
 * is not a danger sign; the danger signs stay in the band.
 */
export function PostTermAdvice({ mode }: { mode: Mode }) {
  const t = useT();
  return (
    <div className="post-term">
      <Notice>
        {t(mode === 'accompanied' ? 'postTerm.adviceAccompanied' : 'postTerm.adviceWoman')}
      </Notice>
      <a className="button button--secondary post-term__call" href={`#${CALL_PATH}`}>
        {t('postTerm.call')}
      </a>
    </div>
  );
}
