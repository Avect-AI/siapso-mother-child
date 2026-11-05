// SPDX-License-Identifier: MIT
import type { ConditionId } from '@siapso/engine';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { useLocation } from 'wouter';
import { deleteProfile, listProfiles, ProfileGoneError, saveProfile } from '../data/profiles.js';
import { addDays, todayIso } from '../domain/dates.js';
import {
  afterBirth,
  answerPastNine,
  babyAgeFromForm,
  conditionsShown,
  emptyForm,
  formFromProfile,
  isConcealedCondition,
  monthsAsWeeks,
  monthsLookLikeWeeks,
  monthsNearTerm,
  monthsPastNine,
  postTermForm,
  profileFromForm,
  pseudonymKey,
  pseudonymWarning,
  reenterTerm,
  termFromForm,
  typedWeeks,
  validateForm,
  weeksReadback,
  type BabyAgeKind,
  type FieldName,
  type FormErrors,
  type PregnantAnswer,
  type PrematureAnswer,
  type ProfileForm,
  type WeeksDay,
} from '../domain/profile-form.js';
import {
  localDateOf,
  MAX_TERM_WEEKS,
  profileTermStatus,
  termDisplay,
  weeksLabel,
  type TermDisplay,
} from '../domain/term.js';
import type { Mode, Profile, TermInput } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { ownProfile, useCheck } from '../state/check-state.js';
import { useDraft } from '../state/draft.js';
import { inSession, sessionState } from '../state/entry-state.js';
import { useLeaveWhenDeleted } from '../state/profile-gone.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { CheckboxGroup, RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { BirthQuestion, stillPregnantUpdate, type ProfileUpdate } from './OutdatedTerm.js';
import { PostTermAdvice } from './PostTermAdvice.js';

/** Which profile the screen opens: hers (woman mode), a new one, or one by its id. */
export type ProfileTarget = { kind: 'mine' } | { kind: 'new' } | { kind: 'edit'; id: string };

/** A name for the profile screen of `target`: a change of profile is a new screen, and its own answers. */
export function profileScreenKey(target: ProfileTarget): string {
  return target.kind === 'edit' ? `profile:${target.id}` : `profile:${target.kind}`;
}

/**
 * Fields whose error shows as soon as something is typed in them, before any
 * save: a number out of range, a date that cannot be used or a pseudonym too
 * long or already used is said at once. A question not answered yet is only
 * marked once a save was tried.
 */
const TYPED_FIELDS = [
  'pseudonym',
  'lmpDate',
  'weeks',
  'weeksGivenOn',
  'months',
  'babyBirthDate',
  'babyWeeks',
  'babyMonths',
] as const;

function typedErrors(form: ProfileForm, all: FormErrors): FormErrors {
  const errors: FormErrors = {};
  for (const field of TYPED_FIELDS) {
    const error = all[field];
    if (error && form[field].trim() !== '') errors[field] = error;
  }
  return errors;
}

/**
 * The oldest last period offered: 44 weeks and 6 days (past 42 weeks she is
 * past term; from 45 weeks the date is looked at again, domain/term.ts).
 */
const LMP_MAX_DAYS = 45 * 7 - 1;
/** The oldest day weeks can be dated: 42 weeks and 0 days. */
const WEEKS_GIVEN_MAX_DAYS = MAX_TERM_WEEKS * 7;
/** The oldest birth date accepted: 104 weeks and 6 days. */
const BIRTH_MAX_DAYS = 104 * 7 + 6;

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; today: string; base: Profile; form: ProfileForm; taken: string[] }
  /** A new profile: `number` is the count of profiles plus one, for its default pseudonym. */
  | {
      status: 'ready';
      today: string;
      base: undefined;
      form: null;
      number: number;
      taken: string[];
    }
  | { status: 'missing' }
  | { status: 'failed' };

const TITLES: Record<ProfileTarget['kind'], MessageKey> = {
  mine: 'profile.titleMine',
  new: 'profile.titleNew',
  edit: 'profile.titleEdit',
};

type YesNo = 'yes' | 'no';

function yesNo(value: boolean | null): YesNo | null {
  if (value === null) return null;
  return value ? 'yes' : 'no';
}

/** The term in words, or undefined while what is typed cannot give one. */
function shownTerm(form: ProfileForm, today: string): TermDisplay | undefined {
  const term: TermInput | undefined = termFromForm(form, today);
  if (term === undefined) return undefined;
  try {
    return termDisplay(term, today);
  } catch {
    return undefined;
  }
}

/** What the history entry of this screen asks: where a save goes, and what to update. */
interface EntryAsk {
  /**
   * Where a save goes when the screen was opened on the way to another one:
   * the check opens it when there is no profile yet or her term is outdated,
   * and leaves `next: '/check'`. Null: home, which says it was saved.
   */
  next: string | null;
  /**
   * The question "Le bébé est-il né ?" answered, or to ask first ('ask', from
   * "Mettre à jour"): the baby is born, or she is still pregnant (the term
   * again, or past 42 weeks).
   */
  update: ProfileUpdate | null;
}

const UPDATES: readonly ProfileUpdate[] = ['born', 'term', 'post-term', 'ask'];

function entryAsk(): EntryAsk {
  // The outdated-term step leaves both in memory, behind marks (entry-state.ts);
  // the check leaves `next` alone in clear, which says nothing of her.
  const kept = sessionState();
  const state: unknown = window.history.state;
  const plainNext =
    typeof state === 'object' && state !== null && 'next' in state && state.next === '/check';
  const next = kept['next'] === '/check' || plainNext ? '/check' : null;
  const asked = kept['update'];
  const update = UPDATES.includes(asked as ProfileUpdate) ? (asked as ProfileUpdate) : null;
  return { next, update };
}

/** Why the screen opened from the question "Le bébé est-il né ?", in words (past 42 weeks: the advice says it). */
function updateLead(update: ProfileUpdate, mode: Mode): MessageKey | null {
  if (update === 'term') return 'profile.leadTerm';
  if (update === 'born') {
    return mode === 'accompanied' ? 'profile.leadBornAccompanied' : 'profile.leadBornWoman';
  }
  return null;
}

/** The answers a screen opened to update a term starts from. */
function updatedForm(form: ProfileForm, update: ProfileUpdate | null): ProfileForm {
  if (update === 'born') return afterBirth(form);
  if (update === 'term') return reenterTerm(form);
  if (update === 'post-term') return postTermForm(form);
  return form;
}

/**
 * Digits only, for the numeric keypad; the value stays text until validation.
 * Never kept in the browser's form history: on a shared phone it would offer
 * her term to whoever fills the next profile, even after the erase.
 */
const NUMBER_INPUT = {
  inputMode: 'numeric',
  pattern: '[0-9]*',
  maxLength: 3,
  autoComplete: 'off',
} as const;

/**
 * What the app retains from what was typed, in words, right under it. A live
 * region, kept in the accessibility tree while empty, so the first value is
 * announced too.
 */
function Readback({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="profile__readback" aria-live="polite">
      {value === undefined ? null : (
        <p>
          <span className="profile__readback-label">{label}</span>{' '}
          <strong className="profile__readback-value">{value}</strong>
        </p>
      )}
    </div>
  );
}

/** A day without the year, as the language writes it: "24/09", "24 Sept". */
function shortDate(iso: string, lang: 'fr' | 'en'): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions =
    lang === 'fr'
      ? { day: '2-digit', month: '2-digit', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', options).format(date);
}

/**
 * The questions of a profile: its pseudonym, the pregnancy and its term,
 * breastfeeding with the baby's age, the situations. Saved on the phone, then
 * `onSaved`. For a passer-by (`quick`, "Regarder sans enregistrer") the same
 * questions and the same checks, without a pseudonym, and nothing is stored:
 * `onSaved` gets the answers as a profile kept in memory only.
 */
export function ProfileQuestions({
  mode,
  today,
  base,
  self,
  draftKey,
  initial,
  taken,
  onSaved,
  onDelete,
  quick = false,
}: {
  mode: Mode;
  today: string;
  base: Profile | undefined;
  /** A new profile is her own (woman mode) or another woman's (accompanied mode). */
  self: boolean;
  /** The screen's name: the answers typed are kept under it across an auto-lock (state/draft.ts). */
  draftKey: string;
  /**
   * Read once, when the form mounts: later renders (a language change) keep
   * the answers typed. Answers kept across an auto-lock come back instead.
   */
  initial: ProfileForm;
  /** The pseudonyms of the other profiles of the phone. */
  taken: readonly string[];
  onSaved: (profile: Profile) => void;
  /** Asks to delete the profile edited; absent for a profile not saved yet. */
  onDelete?: (() => void) | undefined;
  /** A passer-by: no pseudonym asked, nothing stored. */
  quick?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const { storageTimeoutMs } = useApp();
  // A new weeks number asks again the day it was known: always in accompanied
  // mode, and on her own profile once saved (a new one keeps today).
  const asksDay = mode === 'accompanied' || base !== undefined;
  // The phone's date before the day this profile was last saved: its clock was
  // set back, and no term is worked out from it.
  const seen = base === undefined ? undefined : localDateOf(base.updatedAt);
  const clockBehind = seen !== undefined && seen > today;
  const { value: form, setValue: setForm, restored } = useDraft(draftKey, initial);
  // A new number of weeks asked the day again: said until it is answered.
  const [dayReset, setDayReset] = useState(false);
  // Each failed save attempt; from the first one, every error follows the answers live.
  const [attempts, setAttempts] = useState(0);
  // Why the last save did not go through: the phone refused it, or the profile was deleted meanwhile.
  const [saveFailed, setSaveFailed] = useState<'failed' | 'gone' | false>(false);
  // A ref, not state: two taps in the same task both see it at once.
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusAfterRender = useRef<string | null>(null);
  const weeksId = useId();

  const allErrors = validateForm(form, today, mode, taken, seen);
  // What may mislead in the pseudonym typed: said, never refused.
  const pseudonymNote =
    form.pseudonym.trim() === '' ? null : pseudonymWarning(form.pseudonym, taken);
  const errors = attempts > 0 ? allErrors : typedErrors(form, allErrors);
  // Neither pregnant nor breastfeeding on a saved profile (the baby is born, not
  // breastfed): said plainly with the way to delete it, never as a refusal.
  const notCovered =
    onDelete !== undefined && form.pregnant === 'no' && form.breastfeeding === false;
  const error = (field: FieldName) => {
    const key = errors[field];
    if (notCovered && key === 'profile.error.neither') return undefined;
    return key === undefined ? undefined : t(key);
  };

  // A failed attempt moves focus to the first answer to fix, and brings its
  // whole question into view (the question above the answer, not just the answer).
  useEffect(() => {
    if (attempts === 0) return;
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!target) return;
    target.focus({ preventScroll: true });
    const question = target.closest<HTMLElement>('fieldset, .text-field') ?? target;
    // Not in every DOM (jsdom has none).
    if (typeof question.scrollIntoView === 'function') question.scrollIntoView({ block: 'start' });
  }, [attempts]);

  // A field that just appeared and should be edited next.
  useEffect(() => {
    const id = focusAfterRender.current;
    if (id === null) return;
    focusAfterRender.current = null;
    document.getElementById(id)?.focus();
  });

  const update = (patch: Partial<ProfileForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };
  // Typed in: the month is given today, and the stored one is let go.
  const typeMonths = (months: string) => {
    setForm((current) => ({ ...current, months, keptTerm: null }));
  };
  const typeBabyAge = (patch: Partial<ProfileForm>) => {
    setForm((current) => ({ ...current, ...patch, keptBabyAge: null }));
  };

  const shown = conditionsShown(mode);
  // A form that opens with the situations answered (a saved profile, answers
  // given back after the code) hides them all until an explicit tap: one of
  // them says HIV. A new form has nothing to hide yet.
  const [situationsHidden] = useState(
    () => shown.some(isConcealedCondition) && (form.conditions.length > 0 || form.noCondition),
  );
  const toggleCondition = (id: ConditionId, checked: boolean) => {
    setForm((current) => ({
      ...current,
      conditions: checked
        ? [...current.conditions.filter((c) => c !== id), id]
        : current.conditions.filter((c) => c !== id),
      noCondition: checked ? false : current.noCondition,
    }));
  };
  const answerNone = (checked: boolean) => {
    setForm((current) => ({
      ...current,
      // Only the situations shown: one this mode does not show stays.
      conditions: checked
        ? current.conditions.filter((c) => !shown.includes(c))
        : current.conditions,
      noCondition: checked,
    }));
  };

  const typeWeeks = (weeks: string) => {
    if (asksDay && form.weeksDay !== null) setDayReset(true);
    setForm((current) => typedWeeks(current, weeks, asksDay));
  };
  // Another answer to "Enceinte ?" lets the day of a stored "Je ne sais pas" go.
  const answerPregnant = (pregnant: PregnantAnswer) => {
    setForm((current) =>
      current.pregnant === pregnant ? current : { ...current, pregnant, keptUnsureOn: null },
    );
  };
  // Another way of giving the term lets the day of a stored unknown term go.
  const chooseTermKind = (termKind: TermInput['kind']) => {
    setForm((current) => ({
      ...current,
      termKind,
      keptTerm: current.keptTerm?.kind === 'unknown' ? null : current.keptTerm,
    }));
  };

  const term = form.pregnant === 'yes' ? shownTerm(form, today) : undefined;
  const babyAge = form.breastfeeding ? babyAgeFromForm(form, today) : undefined;
  const words = (label: TermDisplay['label']) => t(label.key, label.vars);
  let termWords: string | undefined;
  if (form.pregnant === 'unknown') termWords = t('profileStatus.maybePregnant');
  // Never a term worked out from a date the app knows is wrong.
  else if (form.pregnant === 'yes' && clockBehind) termWords = t('profileStatus.clock');
  else if (term) {
    // Weeks known another day: the term today, then the weeks on that day.
    const since = weeksReadback(form, today);
    termWords =
      since === undefined
        ? words(term.label)
        : t('profile.term.since', {
            term: words(term.label),
            weeks: since.weeks,
            date: shortDate(since.givenOn, lang),
          });
  }

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    // Nothing to save (Enter in the name): the way out, deleting, takes the focus.
    if (notCovered) {
      formRef.current?.querySelector<HTMLButtonElement>('.profile__not-covered button')?.focus();
      return;
    }
    if (Object.keys(allErrors).length > 0) {
      setAttempts((n) => n + 1);
      return;
    }
    saving.current = true;
    setSaveFailed(false);
    const profile = profileFromForm(form, {
      ...(base ? { base } : {}),
      id: crypto.randomUUID(),
      nowIso: new Date().toISOString(),
      todayIso: today,
      self,
    });
    // A passer-by's answers stay in memory: nothing goes to storage.
    if (quick) {
      onSaved(profile);
      return;
    }
    try {
      // A profile read from storage is written only while it is still there.
      await withTimeout(saveProfile(profile, { existing: base !== undefined }), storageTimeoutMs);
      onSaved(profile);
    } catch (failure) {
      console.warn('Profile not stored on this device', failure);
      setSaveFailed(failure instanceof ProfileGoneError ? 'gone' : 'failed');
      saving.current = false;
    }
  };

  const yesNoOptions = [
    { value: 'yes', label: t('profile.yes') },
    { value: 'no', label: t('profile.no') },
  ] as const;

  const asWeeks = monthsLookLikeWeeks(form) ? form.months.trim() : null;

  return (
    <form
      ref={formRef}
      className="profile__form"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {/* Answers kept across an auto-lock: back, and not saved yet. */}
      {restored ? (
        <div role="status">
          <Notice>{t('autoLock.restored')}</Notice>
        </div>
      ) : null}
      {quick ? null : (
        <div className="profile__pseudonym">
          <TextField
            label={t('profile.pseudonym')}
            hint={t('profile.pseudonymHint')}
            error={error('pseudonym')}
            value={form.pseudonym}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              update({ pseudonym: event.target.value });
            }}
          />
          {/* Never a refusal: a pseudonym close to another, or like a full name, is said. */}
          <p className="meta" role="status">
            {pseudonymNote === null || error('pseudonym') !== undefined
              ? ''
              : t(pseudonymNote.key, pseudonymNote.vars)}
          </p>
        </div>
      )}

      <section className="profile__group">
        <RadioGroup<PregnantAnswer>
          question
          row
          legend={t('profile.pregnant')}
          error={error('pregnant')}
          options={[
            { value: 'yes', label: t('profile.yes') },
            { value: 'no', label: t('profile.no') },
            { value: 'unknown', label: t('profile.dontKnow') },
          ]}
          value={form.pregnant}
          onChange={answerPregnant}
        />
        {form.pregnant === 'yes' && clockBehind ? (
          <Notice>{t('profile.clockBehind')}</Notice>
        ) : null}
        {form.pregnant === 'yes' ? (
          <>
            <RadioGroup<TermInput['kind']>
              legend={t('profile.termQuestion')}
              hint={t('profile.termHint')}
              error={error('termKind')}
              options={[
                { value: 'lmp', label: t('profile.termLmp') },
                { value: 'weeks', label: t('profile.termWeeks') },
                { value: 'months', label: t('profile.termMonths') },
                { value: 'unknown', label: t('profile.termUnknown') },
              ]}
              // Past 42 weeks is never one of the choices: it comes from an
              // answer (a date, months past 9, "toujours enceinte"), said below.
              value={form.termKind === 'post-term' ? null : form.termKind}
              onChange={chooseTermKind}
            />
            {form.termKind === 'lmp' ? (
              <TextField
                type="date"
                label={t('profile.lmpDate')}
                error={error('lmpDate')}
                value={form.lmpDate}
                min={addDays(today, -LMP_MAX_DAYS)}
                max={today}
                onChange={(event) => {
                  update({ lmpDate: event.target.value });
                }}
              />
            ) : null}
            {form.termKind === 'weeks' ? (
              <>
                <TextField
                  id={weeksId}
                  label={t('profile.weeks')}
                  hint={t('profile.weeksHint')}
                  error={error('weeks')}
                  {...NUMBER_INPUT}
                  value={form.weeks}
                  onChange={(event) => {
                    typeWeeks(event.target.value);
                  }}
                />
                <RadioGroup<WeeksDay>
                  row
                  legend={t('profile.weeksGivenOn')}
                  hint={t('profile.weeksGivenOnHint')}
                  error={error('weeksDay')}
                  options={[
                    { value: 'today', label: t('profile.weeksToday') },
                    { value: 'other', label: t('profile.weeksOtherDay') },
                  ]}
                  value={form.weeksDay}
                  onChange={(weeksDay) => {
                    setDayReset(false);
                    update({ weeksDay });
                  }}
                />
                {/* A new number cleared the day: said, so a typo fixed is not a silent loss. */}
                <p className="meta" role="status">
                  {dayReset && form.weeksDay === null ? t('profile.weeksDayReset') : ''}
                </p>
                {form.weeksDay === 'other' ? (
                  <TextField
                    type="date"
                    label={t('profile.weeksDate')}
                    error={error('weeksGivenOn')}
                    value={form.weeksGivenOn}
                    min={addDays(today, -WEEKS_GIVEN_MAX_DAYS)}
                    max={today}
                    onChange={(event) => {
                      update({ weeksGivenOn: event.target.value });
                    }}
                  />
                ) : null}
              </>
            ) : null}
            {form.termKind === 'months' ? (
              <TextField
                label={t(mode === 'accompanied' ? 'profile.monthsAccompanied' : 'profile.months')}
                error={error('months')}
                {...NUMBER_INPUT}
                // Two digits: "34" stays 34 (and is said to look like weeks), never 3.
                maxLength={2}
                value={form.months}
                onChange={(event) => {
                  typeMonths(event.target.value);
                }}
              />
            ) : null}
            {/* 10 to 12 months: asked, never read as weeks in one tap. */}
            {monthsPastNine(form) ? (
              <div className="inline-question" role="group" aria-labelledby={`${weeksId}-nine`}>
                <p id={`${weeksId}-nine`}>
                  {t(
                    mode === 'accompanied'
                      ? 'postTerm.pastNineAccompanied'
                      : 'postTerm.pastNineWoman',
                  )}
                </p>
                <div className="inline-question__actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setForm((current) => answerPastNine(current, true, asksDay));
                    }}
                  >
                    {t('postTerm.pastNineYes')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      focusAfterRender.current = weeksId;
                      setForm((current) => answerPastNine(current, false, asksDay));
                    }}
                  >
                    {t('postTerm.pastNineNo')}
                  </Button>
                </div>
              </div>
            ) : null}
            {/* Past 42 weeks and still pregnant: to be seen today, the check goes on. */}
            {term?.postTerm === true && !clockBehind ? <PostTermAdvice mode={mode} /> : null}
            {asWeeks === null ? null : (
              <Button
                variant="secondary"
                className="profile__as-weeks"
                onClick={() => {
                  focusAfterRender.current = weeksId;
                  setForm((current) => monthsAsWeeks(current));
                }}
              >
                {t('profile.monthsAsWeeks', { weeks: asWeeks })}
              </Button>
            )}
            {monthsNearTerm(form) ? (
              <div className="profile__near-term">
                <p>{t('profile.monthsNearTerm')}</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    focusAfterRender.current = weeksId;
                    setForm((current) => ({
                      ...current,
                      termKind: 'weeks',
                      weeks: '',
                      weeksDay: asksDay ? null : 'today',
                      weeksGivenOn: '',
                    }));
                  }}
                >
                  {t('profile.monthsNearTermWeeks')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    update({ termKind: 'lmp', lmpDate: '' });
                  }}
                >
                  {t('profile.monthsNearTermLmp')}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        <Readback label={t('profile.termShown')} value={termWords} />
        {form.pregnant === 'yes' && form.termKind === 'lmp' && term && term.postTerm !== true ? (
          <Button
            variant="quiet"
            className="profile__correct"
            onClick={() => {
              focusAfterRender.current = weeksId;
              // Given today, from the date.
              update({
                termKind: 'weeks',
                weeks: String(term.weeksMin),
                weeksDay: 'today',
                weeksGivenOn: '',
              });
            }}
          >
            {t('profile.termCorrect')}
          </Button>
        ) : null}
      </section>

      <section className="profile__group">
        <RadioGroup
          question
          row
          legend={t('profile.breastfeeding')}
          error={error('breastfeeding')}
          options={yesNoOptions}
          value={yesNo(form.breastfeeding)}
          onChange={(answer) => {
            update({ breastfeeding: answer === 'yes' });
          }}
        />
        {notCovered ? (
          <div className="profile__not-covered" role="status">
            <Notice>
              {t(
                mode === 'accompanied'
                  ? 'profile.notCoveredAccompanied'
                  : 'profile.notCoveredWoman',
              )}
            </Notice>
            <Button variant="secondary" onClick={onDelete}>
              {t(
                mode === 'accompanied'
                  ? 'profile.notCoveredDeleteAccompanied'
                  : 'profile.notCoveredDeleteWoman',
              )}
            </Button>
          </div>
        ) : null}
        {form.breastfeeding ? (
          <>
            <RadioGroup<BabyAgeKind>
              legend={t('profile.babyAge')}
              hint={t('profile.babyAgeHint')}
              error={error('babyAgeKind')}
              options={[
                { value: 'birthDate', label: t('profile.babyBirthDateChoice') },
                { value: 'weeks', label: t('profile.babyWeeksChoice') },
                { value: 'months', label: t('profile.babyMonthsChoice') },
                { value: 'unknown', label: t('profile.dontKnow') },
              ]}
              value={form.babyAgeKind}
              onChange={(babyAgeKind) => {
                update({ babyAgeKind });
              }}
            />
            {form.babyAgeKind === 'birthDate' ? (
              <TextField
                type="date"
                label={t('profile.babyBirthDate')}
                error={error('babyBirthDate')}
                value={form.babyBirthDate}
                min={addDays(today, -BIRTH_MAX_DAYS)}
                max={today}
                onChange={(event) => {
                  update({ babyBirthDate: event.target.value });
                }}
              />
            ) : null}
            {form.babyAgeKind === 'weeks' ? (
              <TextField
                label={t('profile.babyWeeks')}
                hint={t('profile.babyWeeksHint')}
                error={error('babyWeeks')}
                {...NUMBER_INPUT}
                value={form.babyWeeks}
                onChange={(event) => {
                  typeBabyAge({ babyWeeks: event.target.value });
                }}
              />
            ) : null}
            {form.babyAgeKind === 'months' ? (
              <TextField
                label={t('profile.babyMonths')}
                hint={t('profile.babyMonthsHint')}
                error={error('babyMonths')}
                {...NUMBER_INPUT}
                maxLength={2}
                value={form.babyMonths}
                onChange={(event) => {
                  typeBabyAge({ babyMonths: event.target.value });
                }}
              />
            ) : null}
            <Readback
              label={t('profile.babyAgeShown')}
              value={babyAge === undefined ? undefined : words(weeksLabel(babyAge))}
            />
            <RadioGroup<PrematureAnswer>
              row
              legend={t('profile.premature')}
              error={error('premature')}
              options={[
                { value: 'yes', label: t('profile.yes') },
                { value: 'no', label: t('profile.no') },
                { value: 'unknown', label: t('profile.dontKnow') },
              ]}
              value={form.premature}
              onChange={(premature) => {
                update({ premature });
              }}
            />
          </>
        ) : null}
      </section>

      <section className="profile__group">
        <CheckboxGroup
          question
          legend={t('profile.situations')}
          hint={t('profile.situationsHint')}
          error={error('conditions')}
          options={shown.map((id) => ({
            id,
            label: t(`profile.condition.${id}`),
            checked: form.conditions.includes(id),
            onChange: (checked: boolean) => {
              toggleCondition(id, checked);
            },
          }))}
          concealed={situationsHidden ? t('conceal.situations') : undefined}
          none={{
            id: 'none',
            label: t('profile.noCondition'),
            checked: form.noCondition,
            onChange: answerNone,
          }}
        />
      </section>

      <div className="profile__save">
        <div role="alert">
          {saveFailed === false ? null : (
            <Notice>
              {t(saveFailed === 'gone' ? 'profile.goneOnSave' : 'profile.saveFailed')}
            </Notice>
          )}
        </div>
        {/* Never a save that does nothing: while the app no longer covers her, the
            way out is the delete offered with the notice (and below). */}
        {notCovered ? null : (
          <Button variant="primary" type="submit" className="profile__submit">
            {t(quick ? 'quick.start' : 'profile.save')}
          </Button>
        )}
        {onDelete === undefined ? null : (
          <Button variant="quiet" className="profile__delete" onClick={onDelete}>
            {t('profile.delete')}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The last step before a profile is deleted: what goes (the profile and the
 * history of its results, from this phone, for good), then delete or keep.
 * Never red: it is not a danger sign.
 */
function DeleteStep({
  mode,
  profile,
  onDeleted,
  onCancel,
}: {
  mode: Mode;
  profile: Profile;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { storageTimeoutMs } = useApp();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A ref, not state: two taps in the same task both see it at once.
  const deleting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const remove = async () => {
    if (deleting.current) return;
    deleting.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await withTimeout(deleteProfile(profile.id), storageTimeoutMs);
      onDeleted();
    } catch (failure) {
      console.warn('Profile not deleted on this device', failure);
      deleting.current = false;
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <div className="profile__delete-step">
      <div className="profile__intro">
        <h1 ref={heading} tabIndex={-1}>
          {mode === 'accompanied'
            ? t('profile.deleteTitle', { name: profile.pseudonym })
            : t('profile.deleteTitleMine')}
        </h1>
        <p>
          {t(mode === 'accompanied' ? 'profile.deleteLeadAccompanied' : 'profile.deleteLeadWoman')}
        </p>
      </div>
      {failed ? <Notice>{t('profile.deleteFailed')}</Notice> : null}
      <p className="sr-only" role="status">
        {busy ? t('profile.deleting') : ''}
      </p>
      <div className="profile__delete-actions">
        <Button
          variant="primary"
          aria-disabled={busy ? true : undefined}
          onClick={() => {
            void remove();
          }}
        >
          {t('profile.deleteConfirm')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('profile.deleteCancel')}
        </Button>
      </div>
    </div>
  );
}

/** "Femme n": the first number from `from` whose pseudonym is not on the phone yet. */
function freeNumber(from: number, taken: readonly string[], name: (n: number) => string): number {
  const used = new Set(taken.map(pseudonymKey));
  let number = from;
  while (used.has(pseudonymKey(name(number)))) number += 1;
  return number;
}

/**
 * Profile: who the check is for, in under 30 seconds. Pregnancy (yes, no or
 * not known) and its term (date of last period, weeks with the day they were
 * known, months or unknown; the term in words), breast feeding with the baby's
 * age and prematurity, and long-term situations (three more in accompanied
 * mode). Pseudonymous: a nickname used once on the phone, no phone number, no
 * address. Saving goes home (the list of profiles in accompanied mode), which
 * says the profile was saved, or on to the check that opened this screen (for
 * want of a profile, or to update an outdated term), for the profile just
 * saved. A saved profile can be deleted with its history, after a last step.
 */
export function ProfileEdit({ target }: { target: ProfileTarget }) {
  const t = useT();
  const { settings, storageTimeoutMs } = useApp();
  const { start, forget } = useCheck();
  const { announceProfileDeleted } = useSession();
  const mode: Mode = settings.mode ?? 'woman';
  const [, navigate] = useLocation();
  const [ask] = useState(entryAsk);
  // "Mettre à jour": the answer to "Le bébé est-il né ?", asked first.
  const [answered, setAnswered] = useState<ProfileUpdate | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  const kind = target.kind;
  const id = target.kind === 'edit' ? target.id : null;

  // The question answered: the form takes its place, its heading the focus.
  useEffect(() => {
    if (answered !== null) body.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [answered]);

  // Back from the last step with the profile kept: the focus returns to the way there.
  useEffect(() => {
    if (wasConfirming.current && !confirming) {
      body.current?.querySelector<HTMLElement>('.profile__delete')?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  useEffect(() => {
    let live = true;
    // Today comes from the phone's clock here, once, and is handed to pure code.
    const today = todayIso(new Date());
    const load = async (): Promise<Loaded> => {
      const profiles = await listProfiles();
      const base = id !== null ? profiles.find((p) => p.id === id) : undefined;
      if (id !== null && !base) return { status: 'missing' };
      // Woman mode opens her own profile only, never another one kept on the phone.
      const edited = base ?? (kind === 'mine' ? ownProfile(profiles) : undefined);
      const taken = profiles.filter((p) => p.id !== edited?.id).map((p) => p.pseudonym);
      if (edited) {
        const form = formFromProfile(edited, today, mode);
        return { status: 'ready', today, base: edited, form, taken };
      }
      // A new profile: its default pseudonym is worded at render, in the language of the moment.
      return {
        status: 'ready',
        today,
        base: undefined,
        form: null,
        number: profiles.length + 1,
        taken,
      };
    };
    withTimeout(load(), storageTimeoutMs).then(
      (result) => {
        if (live) setLoaded(result);
      },
      (failure: unknown) => {
        console.warn('Profiles not read on this device', failure);
        if (live) setLoaded({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
    // Not on the language: a language change rewords the screen, it never reads
    // storage again nor resets answers being typed.
  }, [kind, id, mode, storageTimeoutMs]);

  const pseudonymOf = (number: number) => t('profile.pseudonymNumbered', { number });
  const defaultPseudonym = (number: number, taken: readonly string[]) =>
    kind === 'mine'
      ? t('profile.pseudonymMine')
      : pseudonymOf(freeNumber(number, taken, pseudonymOf));

  const ready = loaded.status === 'ready' ? loaded : null;
  const base = ready?.base;
  // Deleted in another tab: this form leaves, its answers with it.
  useLeaveWhenDeleted(base?.id);
  // "Mettre à jour" on a profile whose baby may be born, or whose term is
  // past 42 weeks: the question first, as the check asks it; its answer sets
  // what the form opens with.
  const baseStatus =
    ready?.base === undefined ? null : profileTermStatus(ready.base, ready.today).status;
  const asking =
    ask.update === 'ask' &&
    answered === null &&
    (baseStatus === 'outdated' || baseStatus === 'possibly-past');
  const update: ProfileUpdate | null = ask.update === 'ask' ? answered : ask.update;
  const lead = update === null ? null : updateLead(update, mode);

  return (
    <main className="screen profile">
      {confirming && base ? (
        <DeleteStep
          mode={mode}
          profile={base}
          onCancel={() => {
            setConfirming(false);
          }}
          onDeleted={() => {
            // Her list, on screen or waiting, is gone with her; the others stay.
            forget(base.id);
            // The other tabs leave her screens too (her id on the channel only).
            announceProfileDeleted(base.id);
            navigate('/', {
              replace: true,
              // Marks only on the entry: the pseudonym stays in memory (entry-state.ts).
              state: inSession(
                mode === 'woman'
                  ? { profileDeletedMine: true }
                  : { profileDeleted: base.pseudonym },
              ),
            });
          }}
        />
      ) : null}
      {asking && base ? (
        <BirthQuestion
          mode={mode}
          profile={base}
          maybe={baseStatus === 'possibly-past'}
          onAnswer={(born) => {
            if (born) setAnswered('born');
            // Past 42 weeks (outdated, or already said past 42 weeks): read so again from today.
            else if (baseStatus === 'outdated' || base.term?.kind === 'post-term') {
              setAnswered(stillPregnantUpdate(base));
            } else setAnswered('term');
          }}
        />
      ) : null}
      <div ref={body} className="profile__body" hidden={confirming || asking}>
        <div className="profile__intro">
          <h1 tabIndex={-1}>{t(TITLES[kind])}</h1>
          {/* Opened from the question "Le bébé est-il né ?": why, before the questions. */}
          {lead === null ? null : <p className="profile__why">{t(lead)}</p>}
          <p>{t('profile.lead')}</p>
        </div>
        {loaded.status === 'missing' ? <Notice>{t('profile.notFound')}</Notice> : null}
        {loaded.status === 'failed' ? <Notice>{t('profile.loadFailed')}</Notice> : null}
        {ready && !asking ? (
          <ProfileQuestions
            mode={mode}
            today={ready.today}
            base={ready.base}
            self={kind === 'mine'}
            draftKey={profileScreenKey(target)}
            taken={ready.taken}
            initial={
              ready.form === null
                ? emptyForm(
                    defaultPseudonym(ready.number, ready.taken),
                    ready.today,
                    // Her own new profile takes today as the day of weeks typed.
                    kind === 'mine' ? 'today' : null,
                  )
                : updatedForm(ready.form, update)
            }
            onDelete={
              ready.base === undefined
                ? undefined
                : () => {
                    setConfirming(true);
                  }
            }
            onSaved={(profile) => {
              if (ask.next !== null) {
                start(profile.id);
                navigate(ask.next, { replace: true });
                return;
              }
              // Home reads the pseudonym from the history entry to say which profile was saved.
              navigate('/', {
                replace: true,
                state: inSession({ profileSaved: profile.pseudonym }),
              });
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
