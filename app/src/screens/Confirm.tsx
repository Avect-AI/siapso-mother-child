// SPDX-License-Identifier: MIT
import type { CheckedItem, Pack } from '@siapso/engine';
import type { EntryKind } from '@siapso/resolver';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { joinNames } from '../domain/result-view.js';
import {
  candidateDisplayOf,
  candidateOf,
  displayOf,
  localNameOf,
  missingSubstancesOf,
  needsUnitsPerDay,
  productFamilyOf,
  strengthChoiceOf,
  strengthOptionLabel,
  writtenNameOf,
  type ConfirmCandidate,
} from '../domain/search-index.js';
import { parseUnits, stepUnits } from '../domain/units.js';
import { useLang, useT, useTNodes, type MessageKey } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { WarningMark } from '../ui/WarningMark.js';
import { backToCheck, flowState, searchPath, type FlowState } from './check-flow.js';
import { localNameKey } from './local-name.js';
import { Typed } from './Typed.js';

/** The radio value of "I do not know"; never a product id (ids have no colon). */
const DONT_KNOW = ':dont-know';

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

/** A substance name inside a list: "codéine", "acide ascorbique (vitamine C)". */
function lowerFirst(name: string): string {
  return name.charAt(0).toLocaleLowerCase() + name.slice(1);
}

/** The list at the start of the sentence: "Codéine et vitamine C". */
function upperFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** The product "yes" is about: an id, with its strength unknown when she said "I do not know". */
interface Chosen {
  id: string;
  strengthUnknown: boolean;
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
  const same = family.find(
    ({ item }) =>
      item.strengthUnknown !== true && item.ref.kind === 'product' && item.ref.id === chosen.id,
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
  // Nothing chosen for her, generic or brand, unless she typed the strength or the form.
  const [selected, setSelected] = useState<string | null>(() =>
    choice?.preselected === 'candidate' ? candidate.id : null,
  );
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

  // The product "yes" is about, or null while the strength question is not answered.
  let chosen: Chosen | null = { id: candidate.id, strengthUnknown: false };
  if (choice !== null) {
    if (selected === DONT_KNOW) chosen = { id: candidate.id, strengthUnknown: true };
    else chosen = selected === null ? null : { id: selected, strengthUnknown: false };
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
  // A substance the name typed names that the product "yes" is about lacks ("efferalgan codéine").
  const missing =
    candidate.kind === 'product'
      ? missingSubstancesOf(pack, chosen?.id ?? candidate.id, query, lang).map(lowerFirst)
      : [];
  // Asked once the product is known: the strength first, then how many a day.
  const askUnits = writes !== null && !waitsForSameBox && needsUnitsPerDay(pack, writes.ref);
  let unitsKey = '';
  if (target !== null) unitsKey = `listed:${String(target.index)}`;
  else if (replaced !== null) unitsKey = `replaces:${String(replaced.index)}:${chosen?.id ?? ''}`;
  else if (chosen !== null) unitsKey = `new:${chosen.id}:${String(chosen.strengthUnknown)}`;
  // A box taking the place of the one listed without strength starts from its count.
  const startsFrom = target?.item ?? replaced?.item;
  const unitsText =
    unitsTyped[unitsKey] ??
    (startsFrom?.unitsPerDay === undefined ? '' : String(startsFrom.unitsPerDay));
  const units = parseUnits(unitsText);
  const unitsError = askUnits && !units.ok ? t('confirm.unitsError') : undefined;
  const strengthError = attempts > 0 && chosen === null ? t('confirm.chooseStrength') : undefined;
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
    };
    check.add(item, {
      ...(family === undefined ? {} : { family }),
      ...(anotherBox ? { anotherBox: true } : {}),
      ...(written === undefined ? {} : { written }),
    });
    leaving.current = true;
    backToCheck(navigate, entry.stepsToCheck);
  };

  const options =
    choice === null
      ? []
      : [
          ...choice.options.map((id) => ({
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

  let yes: MessageKey = candidate.kind === 'product' ? 'confirm.yesProduct' : 'confirm.yesPlant';
  if (target !== null) yes = askUnits ? 'confirm.changeUnits' : 'confirm.backToList';

  return (
    <form ref={formRef} className="confirm__form" noValidate onSubmit={confirm}>
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
            <Typed text={written} label="shown" />
          </p>
        )}
      </div>

      {missing.length === 0 ? null : (
        <Notice>
          {t('confirm.missingSubstances', { substances: upperFirst(joinNames(missing, lang)) })}
        </Notice>
      )}

      {choice === null ? null : (
        <RadioGroup
          question
          legend={t('confirm.strength')}
          hint={t('confirm.strengthHint')}
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

      {sameBoxQuestion}

      {askUnits ? (
        <UnitsField
          value={unitsText}
          error={unitsError}
          onChange={(value) => {
            setUnitsTyped((typed) => ({ ...typed, [unitsKey]: value }));
          }}
        />
      ) : null}

      <p className="sr-only confirm__announce" role="status">
        {announced}
      </p>
      <div className="confirm__actions">
        {readback === '' ? null : <p className="confirm__adding">{readback}</p>}
        <Button variant="primary" type="submit" className="confirm__yes">
          {t(yes)}
        </Button>
        <Button variant="secondary" className="confirm__no" onClick={onSearchAgain}>
          {t('confirm.no')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Confirm: the product or remedy chosen on the search screen, its details and
 * the local name it was found by. When its family has products of other
 * strengths, the strength written on the box (never one picked for the user
 * when she did not type it), with "I do not know", always offered, which keeps
 * the product with its strength unknown; for a product whose substance has a
 * daily maximum, the units per day (optional). Only "yes" adds a recognised
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
