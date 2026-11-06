// SPDX-License-Identifier: MIT
import type { CheckedItem } from '@siapso/engine';
import type { Candidate, EntryKind } from '@siapso/resolver';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SubmitEvent,
} from 'react';
import { useLocation } from 'wouter';
import { oneTapItem } from '../domain/one-tap.js';
import {
  candidateDisplayOf,
  candidateOf,
  searchIndexOf,
  writtenNameOf,
} from '../domain/search-index.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { inSession } from '../state/entry-state.js';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { useVoiceInput } from '../voice/use-voice-input.js';
import { flowEntry, flowState, keepOnEntry, searchPath } from './check-flow.js';
import { ConfirmForm } from './Confirm.js';
import {
  CandidateButton,
  checkCandidatesOf,
  LIMIT_SHOWN_FROM,
  lookalikesOf,
  SEARCH_MAX_LENGTH,
  SearchLimit,
  useSearchedText,
} from './search-parts.js';
import { MicButton, VoicePanel } from './SearchVoice.js';
import { VOICE_PATH } from './VoicePack.js';

/** A candidate whose question is open under its row: the text it was found by, and whether the voice heard it. */
interface Asked {
  candidate: Candidate;
  foundBy: string;
  heard: boolean;
}

/** One row per product family or remedy. */
function rowKey(candidate: Candidate): string {
  return `${candidate.kind}:${candidate.id}`;
}

/**
 * The question under a row (SCRUM-56, S11), in place of the confirm screen:
 * "Est-ce bien <nom> ?", then what the confirm screen said and asked
 * (ConfirmForm), "yes" an answer among the others (the check keeps no primary
 * action of its own for it).
 */
function RowQuestion({
  asked,
  headingRef,
  onNo,
  onDone,
}: {
  asked: Asked;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onNo: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const { pack } = useApp();
  const id = useId();
  if (pack === null) return null;
  const confirmable = candidateOf(pack, { kind: asked.candidate.kind, id: asked.candidate.id });
  if (confirmable === undefined) return null;
  const name = candidateDisplayOf(pack, asked.candidate, asked.foundBy, lang).name;
  return (
    <section className="check__question" aria-labelledby={id}>
      <h2 id={id} ref={headingRef} tabIndex={-1}>
        {t('check.confirmNamed', { name })}
      </h2>
      <ConfirmForm
        inline
        pack={pack}
        candidate={confirmable}
        entry={{
          query: asked.foundBy,
          matched: asked.candidate.matched,
          ...(asked.heard ? { heard: true } : {}),
        }}
        onSearchAgain={onNo}
        onDone={onDone}
      />
    </section>
  );
}

/**
 * The search of the check screen (SCRUM-56, S12): one field for medicines and
 * remedies (the microphone beside it where the browser can record), the
 * candidates of both lists under it as she types (at most four, each saying
 * "Médicament" or "Remède"), then "Je ne trouve pas ce produit".
 *
 * A tap on a row adds it at once only when nothing must be asked or said
 * first (domain/one-tap.ts): the row then ends in "Ajouter", the field is
 * cleared and keeps the focus, and the check says the product is added.
 * Every other tap opens "Est-ce bien <nom> ?" under its row with what the
 * confirm screen said and asked; only its "yes" adds. Enter opens the
 * question of the best row, never adds. A name the voice heard is searched
 * as if typed ("Vous avez dit"), its rows confirmed the same way. Nothing is
 * added from the text alone: "Je ne trouve pas ce produit" adds it as typed
 * when it looks like nothing, and otherwise opens the search screen, which
 * asks "Ce nom ressemble à :" first. The text is kept on the check's history
 * entry, so the voice screen or the search screen comes back to it.
 */
export function CheckSearch({
  field,
  autoFocus,
  startEmpty,
}: {
  /** The field, which takes the focus again after an add. */
  field: RefObject<HTMLInputElement | null>;
  /** The field takes the focus when the check opens (App.tsx reads data-autofocus). */
  autoFocus: boolean;
  /** An item was just added on another screen (the search screen): the text kept is not given back. */
  startEmpty: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const { pack } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  const limitId = useId();
  const notFoundHintId = useId();
  const questionHeading = useRef<HTMLHeadingElement>(null);
  // Read once: what this entry kept (the text typed before the voice or the search screen opened).
  const [entry] = useState(flowState);
  const [text, setText] = useState(startEmpty ? '' : (entry.query ?? ''));
  const [query, setQuery] = useSearchedText(text);
  // The text is what the voice heard, not edited since.
  const [fromVoice, setFromVoice] = useState(!startEmpty && entry.heard === true);
  const [asked, setAsked] = useState<Asked | null>(null);
  // Set at once by an add or a move away: a second click in the same task does nothing.
  const busy = useRef(false);

  // Built once per pack (the check warms it while her profile is read).
  const indexNow = () => (pack === null ? null : searchIndexOf(pack));
  const candidates = useMemo(
    () =>
      pack === null || query.trim() === '' ? [] : checkCandidatesOf(searchIndexOf(pack), query),
    [pack, query],
  );

  /** Another screen opens from here, the text kept on the check's entry for the way back. */
  const leaveFor = (path: string, state: Record<string, unknown>) => {
    if (busy.current) return;
    busy.current = true;
    keepOnEntry({ query: text, heard: fromVoice });
    navigate(path, { state });
  };

  const toVoiceScreen = () => {
    leaveFor(VOICE_PATH, inSession({ fromSearch: true }));
  };

  const voice = useVoiceInput({
    maxLength: SEARCH_MAX_LENGTH,
    // What was heard goes in the field and is searched at once, as if typed.
    onHeard: (heard) => {
      setText(heard);
      setQuery(heard);
      setFromVoice(true);
      setAsked(null);
    },
    countCandidates: (heard) => {
      const index = indexNow();
      return index === null ? 0 : checkCandidatesOf(index, heard).length;
    },
    onNeedPack: toVoiceScreen,
  });

  useEffect(() => {
    keepOnEntry({ query, heard: fromVoice });
  }, [query, fromVoice]);

  // A new text: what a tap did is over.
  useEffect(() => {
    busy.current = false;
  }, [text]);

  // The question opened by a tap takes the focus (a button press: WCAG 3.2.2)
  // and comes wholly into view when it fits, its "yes" with it.
  useEffect(() => {
    const heading = questionHeading.current;
    if (asked === null || heading === null) return;
    heading.focus({ preventScroll: true });
    const section = heading.closest('section') ?? heading;
    if (typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'nearest' });
  }, [asked]);

  const typed = text.trim();

  /** After an add: the field empty and focused for the next name. */
  const cleared = () => {
    setText('');
    setQuery('');
    setFromVoice(false);
    setAsked(null);
    voice.reset();
    field.current?.focus();
  };

  /**
   * What a tap on `candidate` adds at once, or null when its question must ask
   * first. Never while the rows trail the field (found for an older text, the
   * search waiting a moment after each key): what she typed since may change
   * the answer ("ibuprofene" then " codeine").
   */
  const atOnce = (candidate: Candidate, foundBy: string): CheckedItem | null =>
    pack === null || text.trim() !== foundBy.trim()
      ? null
      : oneTapItem(pack, candidate, foundBy, { heard: fromVoice, items: check.items });

  /**
   * A tap on a row: the tap is the confirmation when nothing must be asked or
   * said first, and the product goes to the list; otherwise its question
   * opens under it (a second tap on it closes it).
   */
  const tap = (candidate: Candidate, foundBy: string) => {
    if (busy.current) return;
    const item = atOnce(candidate, foundBy);
    if (item === null || pack === null) {
      // From the state of this render: two clicks in one task both open it.
      const open = asked !== null && rowKey(asked.candidate) === rowKey(candidate);
      // Asked for what the field says now, not the older text the row was found by.
      setAsked(open ? null : { candidate, foundBy: text, heard: fromVoice });
      return;
    }
    busy.current = true;
    // The name she typed, when the product is shown under another one ("cytotec").
    const written = writtenNameOf(pack, candidate, foundBy, lang);
    check.add(item, {
      ...(candidate.kind === 'product' ? { family: candidate.family } : {}),
      ...(written === undefined ? {} : { written }),
      ...(written !== undefined && fromVoice ? { said: true } : {}),
    });
    cleared();
  };

  // Enter opens the question of the best row for what is typed now: it picks no row by name.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const index = indexNow();
    if (index === null || typed === '') return;
    const [best] = checkCandidatesOf(index, text);
    if (best === undefined) return;
    setQuery(text);
    setAsked({ candidate: best, foundBy: text, heard: fromVoice });
  };

  /** The text as typed, a product the app does not know. */
  const addAsTyped = () => {
    if (typed === '' || busy.current) return;
    busy.current = true;
    check.add(
      { ref: { kind: 'unrecognised', text: typed } },
      // Kept as the voice heard it: "Vous avez dit".
      { list: 'product', ...(fromVoice ? { said: true } : {}) },
    );
    cleared();
  };

  // "Not found": added as typed when it looks like nothing; otherwise asked first on the search screen.
  const notFound = () => {
    if (busy.current || typed === '') return;
    const index = indexNow();
    const found = index === null ? [] : lookalikesOf(index, typed, 'product');
    if (found.length === 0) {
      addAsTyped();
      return;
    }
    leaveFor(
      searchPath('product'),
      flowEntry({ stepsToCheck: 1, query: text, heard: fromVoice || undefined, notFound: true }),
    );
  };

  // The whole list of a kind, after a name said found nothing: on the search screen.
  const browse = (kind: EntryKind) => {
    leaveFor(
      searchPath(kind),
      flowEntry({ stepsToCheck: 1, query: text, heard: fromVoice || undefined, browse: true }),
    );
  };

  // The field takes the focus, its text selected to be typed over.
  const backToKeyboard = () => {
    field.current?.focus();
    field.current?.select();
  };

  // What the rows now hold, said by the live region: how many and the first
  // one (read only by a screen reader: the rows show them), or that nothing
  // matches.
  let heard = '';
  let status = '';
  const best = candidates[0];
  if (pack !== null && query.trim() !== '') {
    if (best) {
      const name = candidateDisplayOf(pack, best, query, lang).name;
      heard =
        candidates.length === 1
          ? t('search.foundOne', { name })
          : t('search.foundMany', { count: candidates.length, name });
      status = t('search.found');
    } else if (voice.state.step !== 'heard-none') {
      // A name said that matches nothing: the voice panel says it, once.
      status = t('check.noneFound');
    }
  }
  // A name the voice heard is added as heard only when no row matches it.
  const heardByVoice =
    fromVoice || voice.state.step === 'heard' || voice.state.step === 'heard-none';
  const notFoundOffered = typed !== '' && !(heardByVoice && candidates.length > 0);

  return (
    <div className="check__search">
      <form role="search" className="search__form" noValidate onSubmit={submit}>
        <div className={voice.supported ? 'search__entry search__entry--voice' : 'search__entry'}>
          <TextField
            ref={field}
            type="search"
            className="search__field"
            label={t('check.field')}
            hint={t('check.fieldHint')}
            value={text}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            // She came to look up a product: the field takes the focus when the check opens.
            data-autofocus={autoFocus ? '' : undefined}
            aria-describedby={text.length >= LIMIT_SHOWN_FROM ? limitId : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setFromVoice(false);
              setAsked(null);
              // Typing takes over: a recording or a transcription is given up.
              voice.reset();
            }}
          />
          {voice.supported ? (
            <MicButton
              state={voice.state}
              onPress={() => {
                setAsked(null);
                voice.press();
              }}
            />
          ) : null}
        </div>
        <SearchLimit id={limitId} length={text.length} />
      </form>

      {voice.supported ? (
        <VoicePanel
          state={voice.state}
          kind="product"
          both
          language={voice.language}
          actions={{
            onCancel: voice.cancel,
            onType: backToKeyboard,
            onBrowse: browse,
            onInstall: toVoiceScreen,
          }}
        />
      ) : null}

      <div className="search__results">
        <p className="search__status" role="status">
          {heard === '' ? null : <span className="sr-only">{`${heard} `}</span>}
          {status}
        </p>
        {candidates.length === 0 ? null : (
          <ul className="candidates" aria-label={t('search.candidatesLabel')}>
            {candidates.map((candidate) => {
              const open = asked !== null && rowKey(asked.candidate) === rowKey(candidate);
              return (
                <CandidateButton
                  key={rowKey(candidate)}
                  candidate={candidate}
                  query={query}
                  showKind
                  addsAtOnce={atOnce(candidate, query) !== null}
                  expanded={open}
                  onChoose={() => {
                    tap(candidate, query);
                  }}
                >
                  {open ? (
                    <RowQuestion
                      key={asked.foundBy}
                      asked={asked}
                      headingRef={questionHeading}
                      onNo={() => {
                        setAsked(null);
                        backToKeyboard();
                      }}
                      onDone={cleared}
                    />
                  ) : null}
                </CandidateButton>
              );
            })}
          </ul>
        )}
        {notFoundOffered ? (
          <div className="search__not-found">
            <Button
              variant={candidates.length > 0 ? 'quiet' : 'secondary'}
              aria-describedby={notFoundHintId}
              onClick={notFound}
            >
              {t('search.notFound')}
            </Button>
            <p id={notFoundHintId} className="meta">
              {t('search.notFoundHint')}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
