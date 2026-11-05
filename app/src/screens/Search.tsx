// SPDX-License-Identifier: MIT
import { search, type Candidate, type EntryKind } from '@siapso/resolver';
import { useEffect, useId, useMemo, useState, type SubmitEvent } from 'react';
import { useLocation } from 'wouter';
import { candidateDisplayOf, localNameOf } from '../domain/search-index.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { useSearchIndex } from '../state/search-index.js';
import { Button } from '../ui/Button.js';
import { Chevron } from '../ui/Chevron.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import {
  backToCheck,
  confirmPath,
  flowEntry,
  flowState,
  keepOnEntry,
  oneMoreStep,
  searchPath,
} from './check-flow.js';

/** The pause after the last key before the candidates follow what is typed. */
export const SEARCH_DEBOUNCE_MS = 150;

const OTHER: Record<EntryKind, EntryKind> = { product: 'plant', plant: 'product' };

function CandidateButton({
  candidate,
  query,
  onChoose,
}: {
  candidate: Candidate;
  query: string;
  onChoose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const { pack } = useApp();
  if (pack === null) return null;
  const shown = candidateDisplayOf(pack, candidate, query, lang);
  const local = localNameOf(pack, candidate, candidate.matched);
  return (
    <li>
      {/* The chevron says it opens (the confirm screen), unlike an answer that is ticked. */}
      <button type="button" className="candidate" onClick={onChoose}>
        <span className="candidate__text">
          <span className="candidate__name">{shown.name}</span>
          {shown.detail === undefined ? null : (
            <span className="candidate__detail">{shown.detail}</span>
          )}
          {local === undefined ? null : (
            <span className="candidate__local">
              {t('search.localName', { name: local.text, lang: t(`nameLang.${local.lang}`) })}
            </span>
          )}
        </span>
        <Chevron />
      </button>
    </li>
  );
}

/**
 * Search: one large field; the resolver proposes at most three candidates as
 * the user types (after a short pause), each with its name in the interface
 * language, its substances and strengths, and the local name it was found by.
 * Choosing one opens the confirm screen: nothing is added from here, except,
 * as the last option, the text typed as a product the app does not know.
 * `kind` is the list searched (medicines or remedies); a name found only in
 * the other list offers to look there.
 */
export function Search({ kind }: { kind: EntryKind }) {
  const t = useT();
  const lang = useLang();
  const { pack, packError } = useApp();
  const index = useSearchIndex();
  const notFoundHintId = useId();
  const check = useCheck();
  const [, navigate] = useLocation();
  // Read once: the state of this history entry (the way back, the text typed before).
  const [entry] = useState(flowState);
  const [text, setText] = useState(entry.query ?? '');
  const [query, setQuery] = useState(text);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  // The text is kept on this entry, so coming back from the confirm screen finds it.
  useEffect(() => {
    keepOnEntry({ query });
  }, [query]);

  const typed = text.trim();
  const candidates = useMemo(
    () => (index === null || query.trim() === '' ? [] : search(index, query, { kinds: [kind] })),
    [index, query, kind],
  );
  const inOtherList = useMemo(
    () =>
      index !== null &&
      candidates.length === 0 &&
      query.trim() !== '' &&
      search(index, query, { kinds: [OTHER[kind]], limit: 1 }).length > 0,
    [index, query, kind, candidates.length],
  );

  /**
   * Opens the confirm screen of a candidate. `foundBy` is the query the
   * candidate came from (a strength in it is preselected there); the text in
   * the field, perhaps typed since, is kept on this entry for the way back.
   */
  const choose = (candidate: Candidate, foundBy: string) => {
    if (leaving) return;
    setLeaving(true);
    keepOnEntry({ query: text });
    // The product goes in the entry's state, never in the address.
    navigate(confirmPath(candidate.kind), {
      state: flowEntry({
        id: candidate.id,
        query: foundBy,
        matched: candidate.matched,
        stepsToCheck: oneMoreStep(entry.stepsToCheck),
      }),
    });
  };

  // Enter in the field opens the best candidate for what is typed now, confirm screen first.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (index === null || typed === '') return;
    const [best] = search(index, text, { kinds: [kind] });
    if (best) choose(best, text);
  };

  const notFound = () => {
    if (leaving || typed === '') return;
    setLeaving(true);
    check.add({ ref: { kind: 'unrecognised', text: typed } }, { list: kind });
    backToCheck(navigate, entry.stepsToCheck);
  };

  const lookInOtherList = () => {
    navigate(searchPath(OTHER[kind]), {
      replace: true,
      state: flowEntry({ stepsToCheck: entry.stepsToCheck, query: text }),
    });
  };

  // What the list now holds, said by the live region: how many, and the first
  // one (read only by a screen reader: the list shows them), so a new list is
  // announced even when the instruction stays the same; with no match, where
  // else the name is found.
  let heard = '';
  let status = '';
  const best = candidates[0];
  if (index !== null && pack !== null && query.trim() !== '') {
    if (best) {
      const name = candidateDisplayOf(pack, best, query, lang).name;
      heard =
        candidates.length === 1
          ? t('search.foundOne', { name })
          : t('search.foundMany', { count: candidates.length, name });
      status = t('search.found');
    } else {
      status = t(kind === 'product' ? 'search.noneFound' : 'search.noneFoundPlant');
      if (inOtherList) {
        status += ` ${t(kind === 'product' ? 'search.otherKindPlant' : 'search.otherKindProduct')}`;
      }
    }
  }
  // "Not found" adds the text as it is: quiet while a candidate or the other
  // list is on offer, a plain secondary choice when nothing matches anywhere.
  const notFoundQuiet = candidates.length > 0 || inOtherList;

  return (
    <main className="screen search">
      <h1 tabIndex={-1}>{t(kind === 'product' ? 'search.titleProduct' : 'search.titlePlant')}</h1>
      {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
      <form role="search" className="search__form" noValidate onSubmit={submit}>
        <TextField
          type="search"
          className="search__field"
          label={t(kind === 'product' ? 'search.fieldProduct' : 'search.fieldPlant')}
          hint={t(kind === 'product' ? 'search.hintProduct' : 'search.hintPlant')}
          value={text}
          maxLength={80}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </form>

      <div className="search__results">
        <p className="search__status" role="status">
          {heard === '' ? null : <span className="sr-only">{`${heard} `}</span>}
          {status}
        </p>
        {candidates.length === 0 ? null : (
          <ul className="candidates" aria-label={t('search.candidatesLabel')}>
            {candidates.map((candidate) => (
              <CandidateButton
                key={candidate.id}
                candidate={candidate}
                query={query}
                onChoose={() => {
                  choose(candidate, query);
                }}
              />
            ))}
          </ul>
        )}
        {inOtherList ? (
          <Button variant="secondary" className="search__other" onClick={lookInOtherList}>
            {t(kind === 'product' ? 'search.searchPlants' : 'search.searchProducts')}
          </Button>
        ) : null}
        {typed === '' ? null : (
          <div className="search__not-found">
            <Button
              variant={notFoundQuiet ? 'quiet' : 'secondary'}
              aria-describedby={notFoundHintId}
              onClick={notFound}
            >
              {t(kind === 'product' ? 'search.notFound' : 'search.notFoundPlant')}
            </Button>
            <p id={notFoundHintId} className="meta">
              {t(kind === 'product' ? 'search.notFoundHint' : 'search.notFoundHintPlant')}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
