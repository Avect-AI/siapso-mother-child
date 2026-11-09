// SPDX-License-Identifier: MIT
import { search, type Candidate, type EntryKind } from '@siapso/resolver';
import { useEffect, useId, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { useLocation } from 'wouter';
import type { CheckedItem } from '@siapso/engine';
import { oneTapItem } from '../domain/one-tap.js';
import { candidateDisplayOf, writtenNameOf, type BrowseEntry } from '../domain/search-index.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { inSession } from '../state/entry-state.js';
import { useSearchIndex } from '../state/search-index.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { useVoiceInput } from '../voice/use-voice-input.js';
import {
  backToCheck,
  confirmPath,
  flowEntry,
  flowState,
  keepOnEntry,
  oneMoreStep,
  searchPath,
} from './check-flow.js';
import {
  CandidateButton,
  LIMIT_SHOWN_FROM,
  lookalikesOf,
  OTHER,
  SEARCH_MAX_LENGTH,
  SearchLimit,
  useSearchedText,
} from './search-parts.js';
import { BrowseList, MicButton, VoicePanel } from './SearchVoice.js';
import { VOICE_PATH } from './VoicePack.js';

export { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from './search-parts.js';

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
 *
 * Beside the field, where the browser can record, a microphone: the name
 * said goes in the field as if typed ("J'ai entendu : ..."), so its
 * candidates are confirmed the same way; when none matches, the screen offers
 * to type the name or to choose it from the whole list. Without an installed
 * voice, the microphone opens the voice screen. The keyboard path is whole
 * without it.
 *
 * Since the check screen has its own field (SCRUM-56, S12), this screen opens
 * from it for "Je ne trouve pas ce produit" when the name looks like products
 * or remedies (the question "Ce nom ressemble à :" asked at once, its entry's
 * `notFound`) and for the whole list of a kind after the voice found nothing
 * (`browse`).
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
  const field = useRef<HTMLInputElement>(null);
  const check = useCheck();
  const [, navigate] = useLocation();
  // Read once: the state of this history entry (the way back, the text typed before).
  const [entry] = useState(flowState);
  const [text, setText] = useState(entry.query ?? '');
  const [query, setQuery] = useSearchedText(text);
  // Set by the first add or move away, at once: a second click in the same
  // task, before React renders again, must not add or go back twice.
  const leaving = useRef(false);
  const leave = (): boolean => {
    if (leaving.current) return false;
    leaving.current = true;
    return true;
  };
  // The products and remedies the text looks like, asked about before it is
  // added as typed; at once when "Je ne trouve pas ce produit" of the check
  // opened this screen (the pack is there: the check has shown its rows).
  const [lookalikes, setLookalikes] = useState<Candidate[] | null>(() => {
    const found =
      entry.notFound === true && index !== null ? lookalikesOf(index, text.trim(), kind) : [];
    return found.length > 0 ? found : null;
  });
  // The whole list of the kind, after a name said found nothing.
  const [browsing, setBrowsing] = useState(entry.browse === true);
  // The text in the field is what the voice heard, not edited since (kept on
  // the entry, so Back from a confirm screen finds it so too).
  const [fromVoice, setFromVoice] = useState(entry.heard === true);

  // The voice screen, the text in the field kept on this entry for the way
  // back (the letters typed just before the tap included).
  const toVoiceScreen = () => {
    if (!leave()) return;
    keepOnEntry({ query: text, heard: fromVoice });
    navigate(VOICE_PATH, { state: inSession({ fromSearch: true }) });
  };

  const voice = useVoiceInput({
    maxLength: SEARCH_MAX_LENGTH,
    // What was heard goes in the field and is searched at once, as if typed.
    onHeard: (heard) => {
      setText(heard);
      setQuery(heard);
      setFromVoice(true);
      setLookalikes(null);
      setBrowsing(false);
    },
    countCandidates: (heard) =>
      index === null ? 0 : search(index, heard, { kinds: [kind] }).length,
    onNeedPack: toVoiceScreen,
  });

  useEffect(() => {
    if (lookalikes !== null) lookalikeHeading.current?.focus();
  }, [lookalikes]);

  // The text is kept on this entry, so coming back from the confirm screen
  // finds it, with the question or the whole list it was on.
  useEffect(() => {
    keepOnEntry({
      query,
      heard: fromVoice,
      notFound: lookalikes === null ? undefined : true,
      browse: browsing ? true : undefined,
    });
  }, [query, fromVoice, lookalikes, browsing]);

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
    if (!leave()) return;
    keepOnEntry({ query: text, heard: fromVoice });
    // The product goes in the entry's state, never in the address.
    navigate(confirmPath(candidate.kind), {
      state: flowEntry({
        id: candidate.id,
        query: foundBy,
        matched: candidate.matched,
        stepsToCheck: oneMoreStep(entry.stepsToCheck),
        // The name was said, not written: "Vous avez dit".
        heard: fromVoice ? true : undefined,
      }),
    });
  };

  /** What a tap on `candidate` adds at once, or null when its confirm screen must ask first. */
  const atOnce = (candidate: Candidate, foundBy: string): CheckedItem | null =>
    pack === null
      ? null
      : oneTapItem(pack, candidate, foundBy, { heard: fromVoice, items: check.items });

  /**
   * A tap on a named row (SCRUM-56, S11): the tap is the confirmation when
   * nothing must be asked or said first (domain/one-tap.ts), and the product
   * goes to the list, the check saying it was added; otherwise its confirm
   * screen. Never from Enter, which picks no row by name.
   */
  const tap = (candidate: Candidate, foundBy: string) => {
    if (leaving.current) return;
    const item = atOnce(candidate, foundBy);
    if (item === null || pack === null) {
      choose(candidate, foundBy);
      return;
    }
    if (!leave()) return;
    keepOnEntry({ query: text, heard: fromVoice });
    // The name she typed, when the product is shown under another one ("cytotec").
    const written = writtenNameOf(pack, candidate, foundBy, lang);
    check.add(item, {
      ...(candidate.kind === 'product' ? { family: candidate.family } : {}),
      ...(written === undefined ? {} : { written }),
      ...(written !== undefined && fromVoice ? { said: true } : {}),
    });
    backToCheck(navigate, entry.stepsToCheck);
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
    if (typed === '' || !leave()) return;
    check.add(
      { ref: { kind: 'unrecognised', text: typed } },
      {
        list: kind,
        ...(declined ? { declined: true } : {}),
        // Kept as the voice heard it: "Vous avez dit".
        ...(fromVoice ? { said: true } : {}),
      },
    );
    backToCheck(navigate, entry.stepsToCheck);
  };

  // "Not found": first, whether it is one of the products or remedies the text looks like.
  const notFound = () => {
    if (leaving.current || typed === '') return;
    const found = index === null ? [] : lookalikesOf(index, typed, kind);
    if (found.length > 0) setLookalikes(found);
    else addAsTyped();
  };

  // A remedy or a medicine family from the whole list: its confirm screen, as a candidate.
  const chooseEntry = (chosen: BrowseEntry) => {
    if (!leave()) return;
    keepOnEntry({ query: text, heard: fromVoice });
    navigate(confirmPath(chosen.kind), {
      state: flowEntry({
        id: chosen.id,
        query: '',
        matched: chosen.name,
        stepsToCheck: oneMoreStep(entry.stepsToCheck),
      }),
    });
  };

  // The field takes the focus, its text selected to be typed over; what the
  // voice said stays until she types.
  const backToKeyboard = () => {
    setBrowsing(false);
    field.current?.focus();
    field.current?.select();
  };

  const lookInOtherList = () => {
    if (!leave()) return;
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
      // A name said that matches nothing: the voice panel says it, once.
      if (voice.state.step !== 'heard-none') {
        status = t(kind === 'product' ? 'search.noneFound' : 'search.noneFoundPlant');
      }
      if (inOtherList) {
        const other = t(kind === 'product' ? 'search.otherKindPlant' : 'search.otherKindProduct');
        status = status === '' ? other : `${status} ${other}`;
      }
    }
  }
  // "Not found" adds the text as it is: quiet while a candidate or the other
  // list is on offer, a plain secondary choice when nothing matches anywhere.
  const notFoundQuiet = candidates.length > 0 || inOtherList;
  // A name the voice heard is added as it was heard only when no candidate
  // matches it (through "Ce nom ressemble à", as a typed name): with
  // candidates on offer she chooses one, or types the name first.
  const heardByVoice =
    fromVoice || voice.state.step === 'heard' || voice.state.step === 'heard-none';
  const notFoundOffered = typed !== '' && !(heardByVoice && candidates.length > 0);
  // The question names what the lookalikes are: medicines, remedies, or both.
  const lookalikeKinds = new Set((lookalikes ?? []).map((candidate) => candidate.kind));
  const lookalikeLists =
    lookalikeKinds.size > 1 ? 'Both' : lookalikeKinds.has('plant') ? 'Plant' : 'Product';
  const limitShown = text.length >= LIMIT_SHOWN_FROM;

  return (
    <main className="screen search">
      <h1 tabIndex={-1}>{t(kind === 'product' ? 'search.titleProduct' : 'search.titlePlant')}</h1>
      {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
      <form role="search" className="search__form" noValidate onSubmit={submit}>
        <div className={voice.supported ? 'search__entry search__entry--voice' : 'search__entry'}>
          <TextField
            ref={field}
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
            // The screen exists to type a name: the field takes the focus when it opens
            // (App.tsx), unless it opens on the question or the whole list (SCRUM-56).
            data-autofocus={lookalikes === null && !browsing ? '' : undefined}
            aria-describedby={limitShown ? limitId : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setFromVoice(false);
              setLookalikes(null);
              setBrowsing(false);
              // Typing takes over: a recording or a transcription is given up.
              voice.reset();
            }}
          />
          {voice.supported ? (
            <MicButton
              state={voice.state}
              onPress={() => {
                setLookalikes(null);
                setBrowsing(false);
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
          kind={kind}
          language={voice.language}
          actions={{
            onCancel: voice.cancel,
            onType: backToKeyboard,
            onBrowse: () => {
              setBrowsing(true);
            },
            onInstall: toVoiceScreen,
          }}
        />
      ) : null}

      {browsing ? <BrowseList kind={kind} onChoose={chooseEntry} /> : null}

      {lookalikes === null ? null : (
        <section className="search__lookalikes" aria-labelledby={lookalikeId}>
          <h2 id={lookalikeId} ref={lookalikeHeading} tabIndex={-1} data-autofocus="">
            {t('search.lookalikeTitle')}
          </h2>
          <p>{t(`search.lookalikeAsk${lookalikeLists}`)}</p>
          <ul className="candidates" aria-labelledby={lookalikeId}>
            {lookalikes.map((candidate) => (
              // A resemblance after "not found" is never a whole name she gave: its
              // confirm screen always asks first (SCRUM-56, spec section 11).
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

      <div className="search__results" hidden={lookalikes !== null || browsing}>
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
                addsAtOnce={atOnce(candidate, query) !== null}
                onChoose={() => {
                  tap(candidate, query);
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
        {!notFoundOffered ? null : (
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
