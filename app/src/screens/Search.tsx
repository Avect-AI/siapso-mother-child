// SPDX-License-Identifier: MIT
import {
  normalize,
  search,
  type Candidate,
  type EntryKind,
  type ResolverIndex,
} from '@siapso/resolver';
import { useEffect, useId, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { useLocation } from 'wouter';
import { candidateDisplayOf, localNameOf } from '../domain/search-index.js';
import { useLang, useT, useTNodes } from '../i18n/index.js';
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

/** The longest name the field takes; free text is kept as typed, so the limit is shown near it. */
export const SEARCH_MAX_LENGTH = 80;
/** From this length on, the field says how long the name is. */
const LIMIT_SHOWN_FROM = 60;
/** At most this many lookalikes, both lists together. */
const LOOKALIKES_MAX = 4;

const OTHER: Record<EntryKind, EntryKind> = { product: 'plant', plant: 'product' };

/**
 * The products and remedies a name looks like, in both lists, as the search
 * proposes them (at the resolver's threshold), best first, the list searched
 * first on equal scores.
 */
function lookalikesOf(index: ResolverIndex, text: string, kind: EntryKind): Candidate[] {
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

function CandidateButton({
  candidate,
  query,
  showKind = false,
  onChoose,
}: {
  candidate: Candidate;
  query: string;
  /** Say which list it is from (medicine or remedy): the lookalikes mix both. */
  showKind?: boolean;
  onChoose: () => void;
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
      <button type="button" className="candidate" onClick={onChoose}>
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
              {tNodes('search.localName', {
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
        <Chevron />
      </button>
    </li>
  );
}

/**
 * Search: one large field, which takes the focus when the screen opens; the
 * resolver proposes at most three candidates as the user types (after a short
 * pause), each with its name in the interface language, its substances and
 * strengths, and the local name it was found by. Choosing one opens the
 * confirm screen: nothing is added from here, except, as the last option, the
 * text typed as a product the app does not know. When that text looks like a
 * product or a remedy of either list, "not found" first asks whether it is one
 * of them ("Ce nom ressemble à :"), each one opening its confirm screen, and
 * adds the text only on "Non, aucun de ces ..." (named after the lists shown). `kind` is the list
 * searched (medicines or remedies); a name found only in the other list
 * offers to look there. Near its limit of 80 characters, the field says how
 * long the name is.
 */
export function Search({ kind }: { kind: EntryKind }) {
  const t = useT();
  const lang = useLang();
  const { pack, packError } = useApp();
  const index = useSearchIndex();
  const notFoundHintId = useId();
  const limitId = useId();
  const lookalikeId = useId();
  const noneHintId = useId();
  const lookalikeHeading = useRef<HTMLHeadingElement>(null);
  const check = useCheck();
  const [, navigate] = useLocation();
  // Read once: the state of this history entry (the way back, the text typed before).
  const [entry] = useState(flowState);
  const [text, setText] = useState(entry.query ?? '');
  const [query, setQuery] = useState(text);
  const [leaving, setLeaving] = useState(false);
  // The products and remedies the text looks like, asked about before it is added as typed.
  const [lookalikes, setLookalikes] = useState<Candidate[] | null>(null);

  useEffect(() => {
    if (lookalikes !== null) lookalikeHeading.current?.focus();
  }, [lookalikes]);

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

  /**
   * Adds the text as typed, as a product or remedy the app does not know;
   * `declined` when she said it is none of the products proposed.
   */
  const addAsTyped = (declined = false) => {
    if (leaving || typed === '') return;
    setLeaving(true);
    check.add(
      { ref: { kind: 'unrecognised', text: typed } },
      { list: kind, ...(declined ? { declined: true } : {}) },
    );
    backToCheck(navigate, entry.stepsToCheck);
  };

  // "Not found": first, whether it is one of the products or remedies the text looks like.
  const notFound = () => {
    if (leaving || typed === '') return;
    const found = index === null ? [] : lookalikesOf(index, typed, kind);
    if (found.length > 0) setLookalikes(found);
    else addAsTyped();
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
  // The question names what the lookalikes are: medicines, remedies, or both.
  const lookalikeKinds = new Set((lookalikes ?? []).map((candidate) => candidate.kind));
  const lookalikeLists =
    lookalikeKinds.size > 1 ? 'Both' : lookalikeKinds.has('plant') ? 'Plant' : 'Product';
  const limitShown = text.length >= LIMIT_SHOWN_FROM;
  const limitReached = text.length >= SEARCH_MAX_LENGTH;

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
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          // The screen exists to type a name: the field takes the focus when it opens (App.tsx).
          data-autofocus=""
          aria-describedby={limitShown ? limitId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setLookalikes(null);
          }}
        />
        {limitShown ? (
          <p id={limitId} className="search__limit">
            {limitReached
              ? t('search.limitReached', { max: SEARCH_MAX_LENGTH })
              : t('search.limit', { count: text.length, max: SEARCH_MAX_LENGTH })}
          </p>
        ) : null}
        {/* Said once the limit is reached, while typing; the count above is only read with the field. */}
        <p className="sr-only search__limit-said" aria-live="polite">
          {limitReached ? t('search.limitReached', { max: SEARCH_MAX_LENGTH }) : ''}
        </p>
      </form>

      {lookalikes === null ? null : (
        <section className="search__lookalikes" aria-labelledby={lookalikeId}>
          <h2 id={lookalikeId} ref={lookalikeHeading} tabIndex={-1}>
            {t('search.lookalikeTitle')}
          </h2>
          <p>{t(`search.lookalikeAsk${lookalikeLists}`)}</p>
          <ul className="candidates" aria-labelledby={lookalikeId}>
            {lookalikes.map((candidate) => (
              <CandidateButton
                key={`${candidate.kind}:${candidate.id}`}
                candidate={candidate}
                query={typed}
                showKind
                onChoose={() => {
                  choose(candidate, typed);
                }}
              />
            ))}
          </ul>
          <Button
            variant="secondary"
            className="search__none-of-these"
            aria-describedby={noneHintId}
            onClick={() => {
              addAsTyped(true);
            }}
          >
            {t(`search.noneOfThese${lookalikeLists}`)}
          </Button>
          <p id={noneHintId} className="meta">
            {t('search.noneOfTheseHint')}
          </p>
        </section>
      )}

      <div className="search__results" hidden={lookalikes !== null}>
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
