// SPDX-License-Identifier: MIT
import type { CheckedItem, Pack, Product } from '@siapso/engine';
import { normalize, type EntryKind } from '@siapso/resolver';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { joinNames } from '../domain/result-view.js';
import {
  boxNameOf,
  candidateDisplayOf,
  candidateOf,
  displayOf,
  doseRangeOf,
  localNameOf,
  missingSubstancesOf,
  needsUnitsPerDay,
  productFamilyOf,
  strengthChoiceOf,
  strengthNotFoundOf,
  strengthOptionLabel,
  strengthQuestionOf,
  strengthText,
  writtenNameOf,
  type ConfirmCandidate,
} from '../domain/search-index.js';
import { strengthNeed, type StrengthNeed } from '../domain/strength-need.js';
import { parseUnits, stepUnits } from '../domain/units.js';
import { useLang, useT, useTNodes, type MessageKey } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { StickyAction } from '../ui/StickyAction.js';
import { WarningMark } from '../ui/WarningMark.js';
import { backToCheck, flowState, searchPath, type FlowState } from './check-flow.js';
import { localNameKey } from './local-name.js';
import { Typed } from './Typed.js';

/** The radio value of "I do not know"; never a product id (ids have no colon). */
const DONT_KNOW = ':dont-know';

/**
 * The radio values of the dose question of a box with no strength (generic
 * aspirin): at most the threshold, above it; "I do not know" is DONT_KNOW.
 */
const AT_MOST = ':at-most';
const ABOVE = ':above';

/** The units typed while the strength waits for a count (a daily maximum, no strength typed). */
const FIRST_UNITS = 'first';

/** The products of the candidate's family, the boxes the strength question would offer. */
function membersOf(pack: Pack, candidate: ConfirmCandidate): Product[] {
  return [candidate.id, ...candidate.variants].flatMap((id) => {
    const product = pack.products.find((p) => p.id === id);
    return product === undefined ? [] : [product];
  });
}

/**
 * Units per day: a field with a step down and a step up on each side, for a
 * thumb; blank means not known. The label, hint and error read as in a text
 * field; the steps say what they do in words for a screen reader.
 */
function UnitsField({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // The count after a step, said aloud: focus stays on the step button, so the field is not read.
  const [spoken, setSpoken] = useState('');
  const step = (by: 1 | -1) => {
    const next = stepUnits(value, by);
    const parsed = parseUnits(next);
    const units = parsed.ok ? parsed.units : undefined;
    if (units === undefined) setSpoken(t('confirm.unitsBlank'));
    else setSpoken(units === 1 ? t('check.unitsOne') : t('check.unitsMany', { units }));
    onChange(next);
  };
  return (
    <div className={error ? 'text-field text-field--invalid units' : 'text-field units'}>
      <label className="text-field__label" htmlFor={id}>
        {t('confirm.units')}
      </label>
      <p id={hintId} className="text-field__hint">
        {t('confirm.unitsHint')}
      </p>
      {error ? (
        <p id={errorId} className="text-field__error">
          <WarningMark />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="units__row">
        <Button
          variant="secondary"
          className="units__step"
          aria-label={t('confirm.unitsLess')}
          onClick={() => {
            step(-1);
          }}
        >
          <span aria-hidden="true">{'−'}</span>
        </Button>
        <input
          id={id}
          className="text-field__input units__input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          autoComplete="off"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <Button
          variant="secondary"
          className="units__step"
          aria-label={t('confirm.unitsMore')}
          onClick={() => {
            step(1);
          }}
        >
          <span aria-hidden="true">+</span>
        </Button>
      </div>
      <p className="sr-only" role="status">
        {spoken}
      </p>
    </div>
  );
}

/** How long the chosen product waits before it is said, so moving through the answers says it once. */
const ANNOUNCE_DELAY_MS = 700;

/** The radio value of "it is another box", in the same-box question. */
const OTHER_BOX = ':other-box';

/** The words of the strength question, by what its answers are (strengthQuestionOf). */
const QUESTION: Record<
  'strength' | 'form' | 'both',
  { legend: MessageKey; hint: MessageKey; error: MessageKey }
> = {
  strength: {
    legend: 'confirm.strength',
    hint: 'confirm.strengthHint',
    error: 'confirm.chooseStrength',
  },
  form: { legend: 'confirm.form', hint: 'confirm.formHint', error: 'confirm.chooseForm' },
  both: {
    legend: 'confirm.strengthOrForm',
    hint: 'confirm.strengthOrFormHint',
    error: 'confirm.chooseStrengthOrForm',
  },
};

/**
 * More strengths than this is a long list (DOLIPRANE has 15): the strength
 * typed is shown first with the others one tap away, and "yes" is held in
 * reach while the list scrolls.
 */
const LONG_LIST = 5;

/** The held "yes" of a long list takes at most a third of the screen's height. */
const STICKY_SHARE = 1 / 3;

/** A substance name inside a list: "codéine", "acide ascorbique (vitamine C)". */
function lowerFirst(name: string): string {
  return name.charAt(0).toLocaleLowerCase() + name.slice(1);
}

/** The list at the start of the sentence: "Codéine et vitamine C". */
function upperFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * The product "yes" is about: an id, with its strength unknown when she said
 * "I do not know", or at most a value when she answered the dose by a range.
 */
interface Chosen {
  id: string;
  strengthUnknown: boolean;
  atMostMg?: number;
}

/** An item of the check, with its place in the list. */
interface Listed {
  index: number;
  item: CheckedItem;
}

/**
 * What "yes" does with the product chosen, given the check:
 * - new: lists it;
 * - listed: it is already there (the same product, or the same family with
 *   its strength unknown): only its units per day may change;
 * - askReplace: a known strength while the family is listed with its
 *   strength unknown: is it the same box (the known strength takes its place:
 *   more information, never less) or another one (listed apart)?
 * - ask: "I do not know" while the family is listed with known strengths: is
 *   it the same box (keep that product and its strength) or another one?
 */
type Plan =
  | { kind: 'new' }
  | ({ kind: 'listed' } & Listed)
  | ({ kind: 'askReplace' } & Listed)
  | { kind: 'ask'; known: Listed[] };

function planOf(
  pack: Pack,
  candidate: ConfirmCandidate,
  chosen: Chosen,
  items: readonly CheckedItem[],
): Plan {
  const listed = items.map((item, index) => ({ index, item }));
  if (candidate.kind === 'plant') {
    const same = listed.find(({ item }) => item.ref.kind === 'plant' && item.ref.id === chosen.id);
    return same ? { kind: 'listed', ...same } : { kind: 'new' };
  }
  const family = listed.filter(
    ({ item }) =>
      item.ref.kind === 'product' && productFamilyOf(pack, item.ref.id) === candidate.family,
  );
  const unknown = family.find(({ item }) => item.strengthUnknown === true);
  if (chosen.strengthUnknown) {
    if (unknown) return { kind: 'listed', ...unknown };
    const known = family.filter(({ item }) => item.strengthUnknown !== true);
    return known.length > 0 ? { kind: 'ask', known } : { kind: 'new' };
  }
  // The same box with another dose range is written again: never kept at the one listed.
  const same = family.find(
    ({ item }) =>
      item.strengthUnknown !== true &&
      item.ref.kind === 'product' &&
      item.ref.id === chosen.id &&
      item.strengthAtMostMg === chosen.atMostMg,
  );
  if (same) return { kind: 'listed', ...same };
  return unknown ? { kind: 'askReplace', ...unknown } : { kind: 'new' };
}

function ConfirmForm({
  pack,
  candidate,
  entry,
  onSearchAgain,
}: {
  pack: Pack;
  candidate: ConfirmCandidate;
  entry: FlowState;
  onSearchAgain: () => void;
}) {
  const t = useT();
  const tNodes = useTNodes();
  const lang = useLang();
  const check = useCheck();
  const [, navigate] = useLocation();
  const query = entry.query ?? '';
  // Read once: the pack and the candidate do not change while the screen is open.
  const [choice] = useState(() => strengthChoiceOf(pack, candidate, query));
  // A strength typed that no box of the family has ("clamoxyl 3g"): said, and the question asked.
  const [notFound] = useState(() => strengthNotFoundOf(pack, candidate, query));
  // A box with no strength that a threshold reads (generic aspirin): its dose
  // is asked by a range, the one of a strength typed chosen as a strength is.
  const [startRange] = useState(() => doseRangeOf(pack, candidate, candidate.id));
  const [band, setBand] = useState<string | null>(() => {
    if (startRange === undefined || notFound === undefined) return null;
    return notFound <= startRange ? AT_MOST : ABOVE;
  });
  // Nothing chosen for her, generic or brand, unless she typed the strength or the form.
  const [selected, setSelected] = useState<string | null>(() =>
    choice?.preselected === 'candidate' ? candidate.id : null,
  );
  // A long list shows the strength typed first; every strength once she asks.
  const [allShown, setAllShown] = useState(false);
  // The first strength shown by "see all", which takes the focus once it is there.
  const focusOption = useRef<string | null>(null);
  // The answer to "is it the same box?": an index of the check, OTHER_BOX, or none yet.
  const [sameBox, setSameBox] = useState<string | null>(null);
  // What is typed in the units field, per target; a listed item starts from its count.
  const [unitsTyped, setUnitsTyped] = useState<Record<string, string>>({});
  // Each refused confirmation; from the first one, a missing answer is said.
  const [attempts, setAttempts] = useState(0);
  // A ref, not state: two taps in the same task both see it at once (one way back, not two).
  const leaving = useRef(false);
  const [announced, setAnnounced] = useState('');
  const answered = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const family = candidate.kind === 'product' ? candidate.family : undefined;

  // The strength is asked only when a rule reads it (SCRUM-56, S10): always
  // for aspirin, once a daily count is given for paracetamol, never else.
  // A strength typed in the name is chosen as before, and one that no box
  // has is asked (notFound). Otherwise the product is kept with its strength
  // not given, said on screen: never a silent strength.
  const [need] = useState<StrengthNeed>(() =>
    choice === null ? 'never' : strengthNeed(pack, membersOf(pack, candidate)),
  );
  const deferred =
    choice !== null && choice.preselected === null && need !== 'always' && notFound === undefined;
  // A daily maximum: the count comes first, in sight, and asks the strength once given.
  const unitsFirst = deferred && need === 'with-count';
  const notGiven: Chosen = { id: candidate.id, strengthUnknown: true };
  // Only for a box that will be listed apart: a count changed on a listed one asks nothing.
  const apart = (() => {
    if (!unitsFirst) return false;
    const kind = planOf(pack, candidate, notGiven, check.items).kind;
    return kind === 'new' || (kind === 'ask' && sameBox === OTHER_BOX);
  })();
  const firstCount = parseUnits(unitsTyped[FIRST_UNITS] ?? '');
  const countGiven = apart && firstCount.ok && firstCount.units !== undefined;
  const asked = choice !== null && (!deferred || countGiven);

  // The box chosen, or null while the strength question is not answered.
  let picked: Chosen | null = { id: candidate.id, strengthUnknown: false };
  if (choice !== null) {
    if (!asked) picked = notGiven;
    else if (selected === DONT_KNOW) picked = notGiven;
    else picked = selected === null ? null : { id: selected, strengthUnknown: false };
  }
  // Its dose by a range, when it has no strength a threshold reads (generic aspirin).
  const range = picked === null ? undefined : doseRangeOf(pack, candidate, picked.id);
  // The product "yes" is about, or null while a question is not answered.
  let chosen: Chosen | null = picked;
  if (picked !== null && range !== undefined) {
    if (band === AT_MOST) chosen = { id: picked.id, strengthUnknown: false, atMostMg: range };
    else if (band === ABOVE) chosen = { id: picked.id, strengthUnknown: false };
    else if (band === DONT_KNOW) chosen = { id: picked.id, strengthUnknown: true };
    else chosen = null;
  }
  const plan = chosen === null ? null : planOf(pack, candidate, chosen, check.items);

  // The item "yes" writes: the product chosen, or the listed one it keeps or changes.
  let target: Listed | null = null;
  if (plan?.kind === 'listed') target = plan;
  if (plan?.kind === 'ask' && sameBox !== null && sameBox !== OTHER_BOX) {
    target = plan.known.find((known) => String(known.index) === sameBox) ?? null;
  }
  const writes: CheckedItem | null =
    chosen === null
      ? null
      : target !== null
        ? target.item
        : {
            ref: { kind: candidate.kind, id: chosen.id },
            ...(chosen.strengthUnknown ? { strengthUnknown: true } : {}),
            ...(chosen.atMostMg === undefined ? {} : { strengthAtMostMg: chosen.atMostMg }),
          };
  const waitsForSameBox = (plan?.kind === 'ask' || plan?.kind === 'askReplace') && sameBox === null;
  // The box listed with its strength unknown, when she said this one is the same box.
  const replaced =
    plan?.kind === 'askReplace' && sameBox !== null && sameBox !== OTHER_BOX ? plan : null;
  const anotherBox = plan?.kind === 'askReplace' && sameBox === OTHER_BOX;

  const nameOf = (item: CheckedItem) =>
    displayOf(pack, item.ref, lang, item.strengthUnknown === true).name;
  const shown =
    chosen === null
      ? candidateDisplayOf(pack, candidate, query, lang)
      : displayOf(pack, { kind: candidate.kind, id: chosen.id }, lang, chosen.strengthUnknown);
  const local =
    entry.matched === undefined ? undefined : localNameOf(pack, candidate, entry.matched);
  // The name she typed, when the product is shown under another one (a local name says it already).
  const written = local === undefined ? writtenNameOf(pack, candidate, query, lang) : undefined;
  // The voice heard it: "Vous avez dit", never "Vous avez écrit".
  const said = entry.heard === true;
  // The name on the box it was found by ("Brufen"), unless what she typed says it already.
  const foundBox =
    entry.matched === undefined ? undefined : boxNameOf(pack, candidate, entry.matched, lang);
  const boxName =
    foundBox !== undefined && (written === undefined || normalize(written) !== normalize(foundBox))
      ? foundBox
      : undefined;
  // A substance the name typed names that the product "yes" is about lacks ("efferalgan codéine").
  const missing =
    candidate.kind === 'product'
      ? missingSubstancesOf(pack, chosen?.id ?? candidate.id, query, lang).map(lowerFirst)
      : [];
  // Asked once the product is known: the strength first, then how many a day;
  // under a daily maximum with no strength typed, the count first (above).
  const askUnits = unitsFirst
    ? !waitsForSameBox
    : writes !== null && !waitsForSameBox && needsUnitsPerDay(pack, writes.ref);
  let unitsKey = '';
  if (unitsFirst) unitsKey = FIRST_UNITS;
  else if (target !== null) unitsKey = `listed:${String(target.index)}`;
  else if (replaced !== null) unitsKey = `replaces:${String(replaced.index)}:${chosen?.id ?? ''}`;
  else if (chosen !== null) unitsKey = `new:${chosen.id}:${String(chosen.strengthUnknown)}`;
  // A box taking the place of the one listed without strength starts from its count.
  const startsFrom = target?.item ?? replaced?.item;
  const unitsText =
    unitsTyped[unitsKey] ??
    (startsFrom?.unitsPerDay === undefined ? '' : String(startsFrom.unitsPerDay));
  const units = parseUnits(unitsText);
  const unitsError = askUnits && !units.ok ? t('confirm.unitsError') : undefined;
  // The question says what its answers are: strengths, forms (Néo-Codion), or both.
  const asks =
    QUESTION[
      choice === null
        ? 'strength'
        : strengthQuestionOf(
            choice.options.map((id) => strengthOptionLabel(pack, candidate, id, lang)),
          )
    ];
  const strengthError = attempts > 0 && picked === null ? t(asks.error) : undefined;
  const rangeError =
    attempts > 0 && range !== undefined && chosen === null
      ? t('confirm.chooseStrength')
      : undefined;
  const sameBoxError = attempts > 0 && waitsForSameBox ? t('confirm.sameBoxError') : undefined;

  // What "yes" does, said where it is decided.
  let readback = '';
  if (target !== null) readback = t('confirm.alreadyNamed', { name: nameOf(target.item) });
  else if (replaced !== null)
    readback = t('confirm.takesPlace', { name: nameOf(replaced.item), product: shown.name });
  else if (chosen !== null && choice !== null && !waitsForSameBox) {
    readback = t('confirm.adding', { name: shown.name });
  }

  // A refused confirmation moves focus to the first answer to fix.
  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  // Every strength now shown: the focus goes to the first one that was not.
  useEffect(() => {
    const id = focusOption.current;
    if (id === null) return;
    focusOption.current = null;
    [...(formRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])]
      .find((radio) => radio.value === id)
      ?.focus();
  }, [allShown]);

  // The product chosen is said once she settles on an answer, not at every move
  // through the answers (each answer is read as it is reached).
  useEffect(() => {
    if (!answered.current || readback === '') return;
    const timer = setTimeout(() => {
      setAnnounced(readback);
    }, ANNOUNCE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [readback]);

  const confirm = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (leaving.current) return;
    if (writes === null || waitsForSameBox || (askUnits && !units.ok)) {
      setAttempts((n) => n + 1);
      return;
    }
    const unitsPerDay = askUnits && units.ok ? units.units : writes.unitsPerDay;
    const item: CheckedItem = {
      ref: writes.ref,
      ...(unitsPerDay === undefined ? {} : { unitsPerDay }),
      ...(writes.strengthUnknown === true ? { strengthUnknown: true } : {}),
      ...(writes.strengthAtMostMg === undefined
        ? {}
        : { strengthAtMostMg: writes.strengthAtMostMg }),
    };
    check.add(item, {
      ...(family === undefined ? {} : { family }),
      ...(anotherBox ? { anotherBox: true } : {}),
      ...(written === undefined ? {} : { written }),
      ...(written !== undefined && said ? { said: true } : {}),
    });
    leaving.current = true;
    backToCheck(navigate, entry.stepsToCheck);
  };

  // A long list with the strength typed: those boxes first, the others on demand.
  const collapsed =
    choice !== null &&
    asked &&
    !allShown &&
    choice.options.length > LONG_LIST &&
    choice.matching.length > 0 &&
    choice.matching.length < choice.options.length;
  const listed = choice === null ? [] : collapsed ? choice.matching : choice.options;
  // A product of a long family: "yes" held at the bottom of the screen while
  // the question (even shortened) and the units scroll.
  const longList = asked && choice.options.length > LONG_LIST;
  const options =
    choice === null
      ? []
      : [
          ...listed.map((id) => ({
            value: id,
            label: strengthOptionLabel(pack, candidate, id, lang),
          })),
          // Always offered: the product is kept with its strength unknown.
          { value: DONT_KNOW, label: t('confirm.dontKnow'), apart: true },
        ];

  const onSameBox = (value: string) => {
    answered.current = true;
    setSameBox(value);
  };
  let sameBoxQuestion = null;
  if (plan?.kind === 'askReplace') {
    sameBoxQuestion = (
      <RadioGroup
        question
        legend={t('confirm.sameBox', { name: nameOf(plan.item) })}
        error={sameBoxError}
        options={[
          { value: String(plan.index), label: t('confirm.sameBoxYes') },
          { value: OTHER_BOX, label: t('confirm.sameBoxNo') },
        ]}
        value={sameBox}
        onChange={onSameBox}
      />
    );
  } else if (plan?.kind === 'ask') {
    const [only] = plan.known;
    const single = plan.known.length === 1 && only !== undefined;
    sameBoxQuestion = (
      <RadioGroup
        question
        legend={
          single ? t('confirm.sameBox', { name: nameOf(only.item) }) : t('confirm.sameBoxMany')
        }
        error={sameBoxError}
        options={[
          ...plan.known.map((known) => ({
            value: String(known.index),
            label: single
              ? t('confirm.sameBoxYes')
              : t('confirm.sameBoxYesNamed', { name: nameOf(known.item) }),
          })),
          { value: OTHER_BOX, label: t('confirm.sameBoxNo') },
        ]}
        value={sameBox}
        onChange={onSameBox}
      />
    );
  }

  const unitsField = (
    <UnitsField
      value={unitsText}
      error={unitsError}
      onChange={(value) => {
        setUnitsTyped((typed) => ({ ...typed, [unitsKey]: value }));
      }}
    />
  );

  let yes: MessageKey = candidate.kind === 'product' ? 'confirm.yesProduct' : 'confirm.yesPlant';
  if (target !== null) yes = askUnits ? 'confirm.changeUnits' : 'confirm.backToList';
  const adding = readback === '' ? null : <p className="confirm__adding">{readback}</p>;
  const yesButton = (
    <Button variant="primary" type="submit" className="confirm__yes">
      {t(yes)}
    </Button>
  );
  const no = (
    <Button variant="secondary" className="confirm__no" onClick={onSearchAgain}>
      {t('confirm.no')}
    </Button>
  );

  return (
    <form
      ref={formRef}
      className="confirm__form"
      noValidate
      onSubmit={confirm}
      onFocus={(event) => {
        // With "yes" held over a long list, a keyboard focus brings the whole
        // answer (its words too, not only its control) clear of it; the page
        // keeps the bar's room (base.css). A tap leaves the page where it is.
        const answer = event.target.closest<HTMLElement>('label, .text-field');
        if (
          longList &&
          answer !== null &&
          event.target.matches(':focus-visible') &&
          typeof answer.scrollIntoView === 'function'
        ) {
          // After the choice it makes is drawn: the product shown above it
          // changes with the strength chosen, and moves the answer.
          requestAnimationFrame(() => {
            answer.scrollIntoView({ block: 'nearest' });
          });
        }
      }}
    >
      <div className="confirm__product">
        <p className="confirm__name">{shown.name}</p>
        {shown.detail === undefined ? null : (
          // A Latin name is read with Latin rules (WCAG 3.1.2).
          <p className="confirm__detail" lang={shown.detailLang}>
            {shown.detail}
          </p>
        )}
        {chosen?.strengthUnknown === true ? (
          <p className="confirm__detail">{t('check.strengthUnknown')}</p>
        ) : null}
        {chosen?.atMostMg === undefined ? null : (
          <p className="confirm__detail">
            {t('check.strengthAtMost', { strength: strengthText(chosen.atMostMg, lang) })}
          </p>
        )}
        {local === undefined ? null : (
          <p className="meta">
            {tNodes(localNameKey(local, lang), {
              name: <span lang={local.lang}>{local.text}</span>,
              lang: t(`nameLang.${local.lang}`),
            })}
          </p>
        )}
        {written === undefined ? null : (
          <p className="meta">
            <Typed text={written} label="shown" said={said} />
          </p>
        )}
        {boxName === undefined ? null : (
          <p className="meta">{t('search.boxName', { name: boxName })}</p>
        )}
      </div>

      {missing.length === 0 ? null : (
        <Notice>
          {t('confirm.missingSubstances', { substances: upperFirst(joinNames(missing, lang)) })}
        </Notice>
      )}

      {notFound === undefined || startRange !== undefined ? null : (
        <Notice>{t('confirm.strengthNotFound', { strength: strengthText(notFound, lang) })}</Notice>
      )}

      {unitsFirst && askUnits ? unitsField : null}

      {choice === null || !asked ? null : (
        <RadioGroup
          question
          legend={t(asks.legend)}
          hint={t(asks.hint)}
          error={strengthError}
          options={options}
          value={selected}
          onChange={(value) => {
            answered.current = true;
            setSelected(value);
            setSameBox(null);
          }}
        />
      )}
      {collapsed ? (
        <Button
          variant="secondary"
          className="confirm__all"
          onClick={() => {
            focusOption.current =
              choice.options.find((id) => !choice.matching.includes(id)) ?? null;
            setAllShown(true);
          }}
        >
          {t('confirm.showAllStrengths', { count: choice.options.length })}
        </Button>
      ) : null}

      {range === undefined ? null : (
        <RadioGroup
          question
          legend={t('confirm.strength')}
          hint={t('confirm.strengthHint')}
          error={rangeError}
          options={[
            {
              value: AT_MOST,
              label: t('check.strengthAtMost', { strength: strengthText(range, lang) }),
            },
            {
              value: ABOVE,
              label: t('confirm.strengthAbove', { strength: strengthText(range, lang) }),
            },
            // "I do not know" reads as above it, as a box of unknown strength does.
            { value: DONT_KNOW, label: t('confirm.dontKnow'), apart: true },
          ]}
          value={band}
          onChange={(value) => {
            answered.current = true;
            setBand(value);
            setSameBox(null);
          }}
        />
      )}

      {sameBoxQuestion}

      {!unitsFirst && askUnits ? unitsField : null}

      <p className="sr-only confirm__announce" role="status">
        {announced}
      </p>
      {longList ? (
        <>
          {adding}
          {/* Under a long list "yes" alone stays in reach while it scrolls (a
              child of the form, so it is held over all of it), unless it would
              take more than a third of the screen. */}
          <StickyAction className="confirm__decide" maxShare={STICKY_SHARE}>
            {yesButton}
          </StickyAction>
          {no}
        </>
      ) : (
        <div className="confirm__actions">
          {adding}
          {yesButton}
          {no}
        </div>
      )}
    </form>
  );
}

/**
 * Confirm: the product or remedy chosen on the search screen, its details and
 * the local name it was found by. When its family has products of other
 * strengths, the strength written on the box (never one picked for the user
 * when she did not type it), with "I do not know", always offered, which keeps
 * the product with its strength unknown; for a product whose substance has a
 * daily maximum, the units per day (optional). A long list (more than 5
 * strengths) shows the boxes of the strength typed first, then "I do not
 * know", with "Voir tous les dosages" for the others, and holds "yes" at the
 * bottom of the screen while the question and the units scroll. Only "yes" adds a recognised
 * item to the check; a product already listed is not listed twice: "yes" then
 * changes its units per day, or goes back to the list. "No" goes back to the
 * search, with what was typed.
 *
 * The product is in the entry's state, never in the address (it can say what
 * she is treated for); an entry without it in this session (an old link, a
 * reload after a lock) goes to the check.
 */
export function Confirm({ kind }: { kind: EntryKind }) {
  const t = useT();
  const { pack, packError } = useApp();
  const [, navigate] = useLocation();
  // Read once: the state of this history entry (the product, the search behind it, the way back).
  const [entry] = useState(flowState);
  const id = entry.id;

  const searchAgain = () => {
    // Opened from the search screen (it leaves the query): back to that entry, with the text.
    if (entry.query !== undefined) window.history.back();
    else navigate(searchPath(kind), { replace: true });
  };

  if (id === undefined) return <Redirect to="/check" replace />;
  const candidate = pack === null ? undefined : candidateOf(pack, { kind, id });
  return (
    <main className="screen confirm">
      <h1 tabIndex={-1}>{t(kind === 'product' ? 'confirm.titleProduct' : 'confirm.titlePlant')}</h1>
      {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
      {pack !== null && candidate === undefined ? (
        <>
          <Notice>{t('confirm.missing')}</Notice>
          <Button variant="secondary" className="confirm__no" onClick={searchAgain}>
            {t('confirm.no')}
          </Button>
        </>
      ) : null}
      {pack !== null && candidate !== undefined ? (
        <ConfirmForm pack={pack} candidate={candidate} entry={entry} onSearchAgain={searchAgain} />
      ) : null}
    </main>
  );
}
