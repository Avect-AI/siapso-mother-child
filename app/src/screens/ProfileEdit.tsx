// SPDX-License-Identifier: MIT
import type { ConditionId } from '@siapso/engine';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { useLocation } from 'wouter';
import { getProfile, listProfiles, saveProfile } from '../data/profiles.js';
import { addDays, todayIso } from '../domain/dates.js';
import {
  babyAgeFromForm,
  conditionsShown,
  emptyForm,
  formFromProfile,
  profileFromForm,
  termFromForm,
  validateForm,
  type BabyAgeKind,
  type FieldName,
  type FormErrors,
  type PrematureAnswer,
  type ProfileForm,
} from '../domain/profile-form.js';
import { termDisplay, weeksLabel, type TermDisplay } from '../domain/term.js';
import type { Mode, Profile, TermInput } from '../domain/types.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { CheckboxGroup, RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';

/** Which profile the screen opens: hers (woman mode), a new one, or one by its id. */
export type ProfileTarget = { kind: 'mine' } | { kind: 'new' } | { kind: 'edit'; id: string };

/**
 * Fields whose error shows as soon as something is typed in them, before any
 * save: a number out of range or a date that cannot be used is said at once.
 * A question not answered yet is only marked once a save was tried.
 */
const TYPED_FIELDS = [
  'lmpDate',
  'weeks',
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

/** The oldest last period accepted: 45 weeks and 6 days (weeksFromLmp). */
const LMP_MAX_DAYS = 45 * 7 + 6;
/** The oldest birth date accepted: 104 weeks and 6 days. */
const BIRTH_MAX_DAYS = 104 * 7 + 6;

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; today: string; base: Profile; form: ProfileForm }
  /** A new profile: `number` is the count of profiles plus one, for its default pseudonym. */
  | { status: 'ready'; today: string; base: undefined; form: null; number: number }
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

/**
 * Where a save goes when the profile screen was opened on the way to another
 * screen: the check opens it when there is no profile yet, and leaves
 * `next: '/check'` on the history entry. Null: home, which says it was saved.
 */
function nextAfterSave(): string | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null || !('next' in state)) return null;
  return state.next === '/check' ? '/check' : null;
}

/** Digits only, for the numeric keypad; the value stays text until validation. */
const NUMBER_INPUT = { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 3 } as const;

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

function Form({
  mode,
  today,
  base,
  initial,
  onSaved,
}: {
  mode: Mode;
  today: string;
  base: Profile | undefined;
  /** Read once, when the form mounts: later renders (a language change) keep the answers typed. */
  initial: ProfileForm;
  onSaved: (profile: Profile) => void;
}) {
  const t = useT();
  const { storageTimeoutMs } = useApp();
  const [form, setForm] = useState(initial);
  // Each failed save attempt; from the first one, every error follows the answers live.
  const [attempts, setAttempts] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusAfterRender = useRef<string | null>(null);
  const weeksId = useId();

  const allErrors = validateForm(form, today, mode);
  const errors = attempts > 0 ? allErrors : typedErrors(form, allErrors);
  const error = (field: FieldName) => {
    const key = errors[field];
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
  // Typed in: the value is given today, and the stored one of that kind is let go.
  const typeTerm = (kind: 'weeks' | 'months', patch: Partial<ProfileForm>) => {
    setForm((current) => ({
      ...current,
      ...patch,
      keptTerm: current.keptTerm?.kind === kind ? null : current.keptTerm,
    }));
  };
  const typeBabyAge = (patch: Partial<ProfileForm>) => {
    setForm((current) => ({ ...current, ...patch, keptBabyAge: null }));
  };

  const shown = conditionsShown(mode);
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

  const term = form.pregnant ? shownTerm(form, today) : undefined;
  const babyAge = form.breastfeeding ? babyAgeFromForm(form, today) : undefined;
  const words = (label: TermDisplay['label']) => t(label.key, label.vars);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (Object.keys(allErrors).length > 0) {
      setAttempts((n) => n + 1);
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    const profile = profileFromForm(form, {
      ...(base ? { base } : {}),
      id: crypto.randomUUID(),
      nowIso: new Date().toISOString(),
      todayIso: today,
    });
    try {
      await withTimeout(saveProfile(profile), storageTimeoutMs);
      onSaved(profile);
    } catch (failure) {
      console.warn('Profile not stored on this device', failure);
      setSaveFailed(true);
      setSaving(false);
    }
  };

  const yesNoOptions = [
    { value: 'yes', label: t('profile.yes') },
    { value: 'no', label: t('profile.no') },
  ] as const;

  return (
    <form
      ref={formRef}
      className="profile__form"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <TextField
        label={t('profile.pseudonym')}
        hint={t('profile.pseudonymHint')}
        error={error('pseudonym')}
        value={form.pseudonym}
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          update({ pseudonym: event.target.value });
        }}
      />

      <section className="profile__group">
        <RadioGroup
          question
          row
          legend={t('profile.pregnant')}
          error={error('pregnant')}
          options={yesNoOptions}
          value={yesNo(form.pregnant)}
          onChange={(answer) => {
            update({ pregnant: answer === 'yes' });
          }}
        />
        {form.pregnant ? (
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
              value={form.termKind}
              onChange={(termKind) => {
                update({ termKind });
              }}
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
              <TextField
                id={weeksId}
                label={t('profile.weeks')}
                hint={t('profile.weeksHint')}
                error={error('weeks')}
                {...NUMBER_INPUT}
                value={form.weeks}
                onChange={(event) => {
                  typeTerm('weeks', { weeks: event.target.value });
                }}
              />
            ) : null}
            {form.termKind === 'months' ? (
              <TextField
                label={t('profile.months')}
                error={error('months')}
                {...NUMBER_INPUT}
                maxLength={1}
                value={form.months}
                onChange={(event) => {
                  typeTerm('months', { months: event.target.value });
                }}
              />
            ) : null}
            <Readback label={t('profile.termShown')} value={term ? words(term.label) : undefined} />
            {form.termKind === 'lmp' && term ? (
              <Button
                variant="quiet"
                className="profile__correct"
                onClick={() => {
                  focusAfterRender.current = weeksId;
                  // Given today, from the date: never a weeks term kept from storage.
                  update({ termKind: 'weeks', weeks: String(term.weeksMin), keptTerm: null });
                }}
              >
                {t('profile.termCorrect')}
              </Button>
            ) : null}
          </>
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
          none={{
            id: 'none',
            label: t('profile.noCondition'),
            checked: form.noCondition,
            onChange: answerNone,
          }}
        />
      </section>

      <div className="profile__save">
        <div role="alert">{saveFailed ? <Notice>{t('profile.saveFailed')}</Notice> : null}</div>
        <Button variant="primary" type="submit" className="profile__submit">
          {t('profile.save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Profile: who the check is for, in under 30 seconds. Pregnancy and its term
 * (date of last period, weeks, months or unknown; the term in words), breast
 * feeding with the baby's age and prematurity, and long-term situations (three
 * more in accompanied mode). Pseudonymous: a nickname, no phone number, no
 * address. Saving goes home, which says the profile was saved, or on to the
 * check that opened this screen for want of a profile.
 */
export function ProfileEdit({ target }: { target: ProfileTarget }) {
  const t = useT();
  const { settings, storageTimeoutMs } = useApp();
  const mode: Mode = settings.mode ?? 'woman';
  const [, navigate] = useLocation();
  const [next] = useState(nextAfterSave);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const kind = target.kind;
  const id = target.kind === 'edit' ? target.id : null;

  useEffect(() => {
    let live = true;
    // Today comes from the phone's clock here, once, and is handed to pure code.
    const today = todayIso(new Date());
    const load = async (): Promise<Loaded> => {
      if (id !== null) {
        const base = await getProfile(id);
        if (!base) return { status: 'missing' };
        return { status: 'ready', today, base, form: formFromProfile(base, today, mode) };
      }
      const profiles = await listProfiles();
      const mine = kind === 'mine' ? profiles[0] : undefined;
      if (mine) {
        return { status: 'ready', today, base: mine, form: formFromProfile(mine, today, mode) };
      }
      // A new profile: its default pseudonym is worded at render, in the language of the moment.
      return { status: 'ready', today, base: undefined, form: null, number: profiles.length + 1 };
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

  const defaultPseudonym = (number: number) =>
    kind === 'mine' ? t('profile.pseudonymMine') : t('profile.pseudonymNumbered', { number });

  return (
    <main className="screen profile">
      <div className="profile__intro">
        <h1 tabIndex={-1}>{t(TITLES[kind])}</h1>
        <p>{t('profile.lead')}</p>
      </div>
      {loaded.status === 'missing' ? <Notice>{t('profile.notFound')}</Notice> : null}
      {loaded.status === 'failed' ? <Notice>{t('profile.loadFailed')}</Notice> : null}
      {loaded.status === 'ready' ? (
        <Form
          mode={mode}
          today={loaded.today}
          base={loaded.base}
          initial={loaded.form === null ? emptyForm(defaultPseudonym(loaded.number)) : loaded.form}
          onSaved={(profile) => {
            if (next !== null) {
              navigate(next, { replace: true });
              return;
            }
            // Home reads the pseudonym from the history entry to say which profile was saved.
            navigate('/', { replace: true, state: { profileSaved: profile.pseudonym } });
          }}
        />
      ) : null}
    </main>
  );
}
