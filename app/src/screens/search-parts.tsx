// SPDX-License-Identifier: MIT
// The pieces of a search, shared by the one field of the check screen
// (SCRUM-56, S12) and the search screen, which stays for the whole list and
// "Je ne trouve pas ce produit": the pause before the candidates follow the
// text, the limit of the field, which candidates are proposed, and the row of
// one candidate. A way of finding products (a sentence that names several,
// the scan of a prescription) plugs into the same rows: each is still added
// only by a tap on its row or the "Oui" of its question.
import {
  normalize,
  search,
  type Candidate,
  type EntryKind,
  type ResolverIndex,
} from '@siapso/resolver';
import { useEffect, useState, type ReactNode } from 'react';
import { candidateDisplayOf, localNameOf } from '../domain/search-index.js';
import { useLang, useT, useTNodes } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Chevron } from '../ui/Chevron.js';
import { localNameKey } from './local-name.js';

/** The pause after the last key before the candidates follow what is typed. */
export const SEARCH_DEBOUNCE_MS = 150;

/** The longest name the field takes; free text is kept as typed, so the limit is shown near it. */
export const SEARCH_MAX_LENGTH = 80;

/** From this length on, the field says how long the name is. */
export const LIMIT_SHOWN_FROM = 60;

/** At most this many lookalikes, both lists together. */
const LOOKALIKES_MAX = 4;

/**
 * At most this many candidates under the field of the check screen, both
 * lists together (eval/resolver measures them as top-4).
 */
export const CHECK_ROWS = 4;

export const OTHER: Record<EntryKind, EntryKind> = { product: 'plant', plant: 'product' };

/**
 * The products and remedies a name looks like, in both lists, as the search
 * proposes them (at the resolver's threshold), best first, the list searched
 * first on equal scores.
 */
export function lookalikesOf(index: ResolverIndex, text: string, kind: EntryKind): Candidate[] {
  const found = [
    ...search(index, text, { kinds: [kind] }),
    ...search(index, text, { kinds: [OTHER[kind]] }),
  ];
  return found
    .map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.order - b.order)
    .slice(0, LOOKALIKES_MAX)
    .map(({ candidate }) => candidate);
}

/**
 * The candidates of the check screen's field: medicines and remedies in one
 * search, so a remedy found by its whole name is not shown below weak
 * medicines (and the reverse), best first, at most CHECK_ROWS.
 */
export function checkCandidatesOf(index: ResolverIndex, text: string): Candidate[] {
  return text.trim() === '' ? [] : search(index, text, { limit: CHECK_ROWS });
}

/**
 * The text searched: what is typed, once typing pauses (SEARCH_DEBOUNCE_MS);
 * `setNow` searches a text at once (what the voice heard).
 */
export function useSearchedText(
  text: string,
  start: string = text,
): [string, (now: string) => void] {
  const [query, setQuery] = useState(start);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  return [query, setQuery];
}

/** The length of a long name under the field, near its limit, and said once the limit is reached. */
export function SearchLimit({ id, length }: { id: string; length: number }) {
  const t = useT();
  const shown = length >= LIMIT_SHOWN_FROM;
  const reached = length >= SEARCH_MAX_LENGTH;
  return (
    <>
      {shown ? (
        <p id={id} className="search__limit">
          {reached
            ? t('search.limitReached', { max: SEARCH_MAX_LENGTH })
            : t('search.limit', { count: length, max: SEARCH_MAX_LENGTH })}
        </p>
      ) : null}
      {/* Said once the limit is reached, while typing; the count above is only read with the field. */}
      <p className="sr-only search__limit-said" aria-live="polite">
        {reached ? t('search.limitReached', { max: SEARCH_MAX_LENGTH }) : ''}
      </p>
    </>
  );
}

/**
 * One candidate: its name in the interface language, its substances and
 * strengths, the local name or the name on the box it was found by, and its
 * list when `showKind`. A row a tap adds at once ends in "Ajouter"; any other
 * ends in the chevron of what it opens (the confirm screen, or the question
 * under it on the check screen, `expanded` saying whether it is open; its
 * question comes as `children`, under the row).
 */
export function CandidateButton({
  candidate,
  query,
  showKind = false,
  addsAtOnce = false,
  expanded,
  onChoose,
  children,
}: {
  candidate: Candidate;
  query: string;
  /** Say which list it is from (medicine or remedy): the lookalikes and the check mix both. */
  showKind?: boolean;
  /** A tap adds it at once (SCRUM-56): the row ends in "Ajouter", not the chevron of a screen. */
  addsAtOnce?: boolean;
  /** On the check screen: whether the question under the row is open. */
  expanded?: boolean | undefined;
  onChoose: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const tNodes = useTNodes();
  const lang = useLang();
  const { pack } = useApp();
  if (pack === null) return null;
  const shown = candidateDisplayOf(pack, candidate, query, lang);
  const local = localNameOf(pack, candidate, candidate.matched);
  // The brand a name was found by, when the name shown does not hold it ("cytotek": Cytotec).
  const boxName =
    candidate.matchedLang === 'brand' &&
    !normalize(shown.name).includes(normalize(candidate.matched))
      ? candidate.matched
      : undefined;
  return (
    <li>
      {/* The chevron says it opens (the confirm screen), unlike an answer that is ticked. */}
      <button
        type="button"
        className="candidate"
        aria-expanded={addsAtOnce ? undefined : expanded}
        onClick={onChoose}
      >
        <span className="candidate__text">
          <span className="candidate__name">{shown.name}</span>
          {shown.detail === undefined ? null : (
            // A Latin name is read with Latin rules (WCAG 3.1.2).
            <span className="candidate__detail" lang={shown.detailLang}>
              {shown.detail}
            </span>
          )}
          {local === undefined ? null : (
            <span className="candidate__local">
              {tNodes(localNameKey(local, lang), {
                name: <span lang={local.lang}>{local.text}</span>,
                lang: t(`nameLang.${local.lang}`),
              })}
            </span>
          )}
          {boxName === undefined ? null : (
            <span className="candidate__local">{t('search.boxName', { name: boxName })}</span>
          )}
          {showKind ? (
            <span className="candidate__kind">
              {t(candidate.kind === 'product' ? 'search.kindProduct' : 'search.kindPlant')}
            </span>
          ) : null}
        </span>
        {addsAtOnce ? <span className="candidate__add">{t('search.addAtOnce')}</span> : <Chevron />}
      </button>
      {children}
    </li>
  );
}
