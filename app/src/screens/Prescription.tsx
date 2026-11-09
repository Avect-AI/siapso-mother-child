// SPDX-License-Identifier: MIT
// Read a prescription (SCRUM-57, phase 3; spec 7.1 to 7.13): a photo taken
// with the phone's camera, or an image or a PDF chosen, read on the phone
// with the optional "Lecture d'ordonnance" pack, then one list to tick. The
// reading proposes and she decides: nothing is ticked at first, each product
// ticked is then confirmed with the same questions as a name typed (strength,
// units per day, same box), and a line not recognised can be added as typed.
// The file and the lines read live in this screen only: never stored, never
// sent, gone when the screen is left or the app locks (the screen unmounts).
import {
  OcrPackError,
  createOcrClient,
  installOcrPack,
  installedOcrPackInfo,
  isOcrSupported,
  ocrPackInfo,
  removeOcrPack,
  type OcrClient,
  type OcrErrorReason,
  type OcrPackInfo,
} from '@siapso/ocr';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { megabytes } from '../config/voice.js';
import { readPrescription, type PrescriptionReading } from '../domain/prescription-reading.js';
import { notesOf, ocrErrorKeyOf } from '../domain/prescription-view.js';
import { candidateOf, displayOf } from '../domain/search-index.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { backToCheck, flowState } from './check-flow.js';
import { ConfirmForm } from './Confirm.js';

export const PRESCRIPTION_PATH = '/prescription';

/**
 * The size of the reading pack on the phone (ocr/scripts/install-local.mjs,
 * PR #69: 29,620,048 bytes), said before the pack's manifest is asked for:
 * nothing is requested before she taps "Installer le pack".
 */
const PACK_BYTES_SAID = 29_620_048;

type Phase =
  | { kind: 'unsupported' }
  | { kind: 'checking' }
  | { kind: 'pack'; failure?: OcrErrorReason; removed?: boolean }
  | { kind: 'installing'; percent: number }
  | { kind: 'ready'; failure?: OcrErrorReason }
  | { kind: 'reading'; percent: number }
  | { kind: 'list'; reading: PrescriptionReading }
  | {
      kind: 'confirming';
      reading: PrescriptionReading;
      queue: number[];
      at: number;
      typed: number[];
    };

function reasonOf(failure: unknown): OcrErrorReason {
  return failure instanceof OcrPackError ? failure.reason : 'read';
}

export function Prescription() {
  const t = useT();
  const lang = useLang();
  const { pack } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  // Read once: how many entries back the check is (the way back after the list).
  const [entry] = useState(flowState);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const client = useRef<OcrClient | null>(null);
  const info = useRef<OcrPackInfo | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>(() =>
    isOcrSupported() ? { kind: 'checking' } : { kind: 'unsupported' },
  );
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const listId = useId();

  // Installed or not: the Cache API only, never the network.
  useEffect(() => {
    if (phase.kind !== 'checking') return;
    let live = true;
    installedOcrPackInfo()
      .then((installed) => {
        if (!live) return;
        info.current = installed;
        setPhase(installed === null ? { kind: 'pack' } : { kind: 'ready' });
      })
      .catch(() => {
        if (live) setPhase({ kind: 'pack' });
      });
    return () => {
      live = false;
    };
  }, [phase.kind]);

  // The models freed when the page is hidden; the worker ended with the screen.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') client.current?.release();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      abort.current?.abort();
      client.current?.dispose();
      client.current = null;
    };
  }, []);

  // Each new step of the confirmation: its heading takes the focus.
  const at = phase.kind === 'confirming' ? phase.at : -1;
  useEffect(() => {
    if (at >= 0) stepHeading.current?.focus();
  }, [at]);

  const install = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'installing', percent: 0 });
    try {
      const manifest = await ocrPackInfo();
      await installOcrPack(
        manifest,
        (loaded, total) => {
          setPhase({
            kind: 'installing',
            percent: total > 0 ? Math.floor((loaded / total) * 100) : 0,
          });
        },
        controller.signal,
      );
      info.current = await installedOcrPackInfo();
      setPhase(info.current === null ? { kind: 'pack', failure: 'invalid' } : { kind: 'ready' });
    } catch (failure) {
      setPhase(
        controller.signal.aborted ? { kind: 'pack' } : { kind: 'pack', failure: reasonOf(failure) },
      );
    } finally {
      abort.current = null;
    }
  };

  const remove = async () => {
    client.current?.dispose();
    client.current = null;
    info.current = null;
    await removeOcrPack().catch(() => undefined);
    setPhase({ kind: 'pack', removed: true });
  };

  const read = useCallback(
    async (file: File) => {
      if (pack === null || info.current === null) return;
      const controller = new AbortController();
      abort.current = controller;
      setPhase({ kind: 'reading', percent: 0 });
      client.current ??= createOcrClient(info.current);
      try {
        const reading = await client.current.read(file, {
          signal: controller.signal,
          onProgress: (progress) => {
            setPhase({ kind: 'reading', percent: Math.floor(progress * 100) });
          },
        });
        // Only the lines go on, read into products; the file is let go here.
        setTicked(new Set());
        setRefused(false);
        setPhase({ kind: 'list', reading: readPrescription(pack, reading.lines) });
      } catch (failure) {
        setPhase({ kind: 'ready', failure: reasonOf(failure) });
      } finally {
        abort.current = null;
      }
    },
    [pack],
  );

  const chosen = (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    // The chooser keeps nothing: the same file can be chosen again.
    if (input) input.value = '';
    if (file !== undefined) void read(file);
  };

  const toggle = (key: string) => {
    setRefused(false);
    setTicked((before) => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirmTicked = (reading: PrescriptionReading) => {
    const queue = reading.products.flatMap((_, index) =>
      ticked.has(`p${String(index)}`) ? [index] : [],
    );
    const typed = reading.typed.flatMap((_, index) =>
      ticked.has(`t${String(index)}`) ? [index] : [],
    );
    if (queue.length === 0 && typed.length === 0) {
      setRefused(true);
      return;
    }
    if (queue.length === 0) {
      finish(reading, typed);
      return;
    }
    setPhase({ kind: 'confirming', reading, queue, at: 0, typed });
  };

  /** The lines ticked to add as typed, then back to the check. */
  const finish = (reading: PrescriptionReading, typed: readonly number[]) => {
    for (const index of typed) {
      const line = reading.typed[index];
      if (line !== undefined)
        check.add({ ref: { kind: 'unrecognised', text: line.text } }, { list: 'product' });
    }
    backToCheck(navigate, entry.stepsToCheck);
  };

  const next = () => {
    if (phase.kind !== 'confirming') return;
    if (phase.at + 1 < phase.queue.length) setPhase({ ...phase, at: phase.at + 1 });
    else finish(phase.reading, phase.typed);
  };

  const nameOf = (ref: { kind: 'product' | 'plant'; id: string }) =>
    pack === null ? ref.id : displayOf(pack, ref, lang).name;

  return (
    <main className="screen prescription">
      <h1 ref={titleRef} tabIndex={-1}>
        {t('prescription.title')}
      </h1>

      {phase.kind === 'unsupported' ? <Notice>{t('prescription.unsupported')}</Notice> : null}
      {phase.kind === 'checking' ? <p role="status">{t('prescription.checking')}</p> : null}

      {phase.kind === 'pack' || phase.kind === 'installing' ? (
        <section className="prescription__pack" aria-labelledby={`${listId}-pack`}>
          <h2 id={`${listId}-pack`}>{t('prescription.packTitle')}</h2>
          <p>
            {t('prescription.packLead', {
              size: t('voicePack.megabytes', { count: megabytes(PACK_BYTES_SAID) }),
            })}
          </p>
          {phase.kind === 'pack' && phase.removed === true ? (
            <p role="status">{t('prescription.packRemoved')}</p>
          ) : null}
          {phase.kind === 'pack' && phase.failure !== undefined ? (
            <Notice>{t(ocrErrorKeyOf(phase.failure))}</Notice>
          ) : null}
          {phase.kind === 'installing' ? (
            <>
              <p role="status">{t('prescription.packInstalling', { percent: phase.percent })}</p>
              <Button variant="secondary" onClick={() => abort.current?.abort()}>
                {t('prescription.packCancel')}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => void install()}>
              {t('prescription.packInstall')}
            </Button>
          )}
        </section>
      ) : null}

      {phase.kind === 'ready' ? (
        <section className="prescription__choose">
          <p>{t('prescription.lead')}</p>
          {phase.failure !== undefined ? <Notice>{t(ocrErrorKeyOf(phase.failure))}</Notice> : null}
          {/* The phone's own camera: the photo comes back as a file, kept in memory only. */}
          <input
            ref={photoInput}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="prescription-photo"
            onChange={() => {
              chosen(photoInput.current);
            }}
          />
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/*,application/pdf"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="prescription-file"
            onChange={() => {
              chosen(fileInput.current);
            }}
          />
          <Button variant="primary" onClick={() => photoInput.current?.click()}>
            {t('prescription.takePhoto')}
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            {t('prescription.chooseFile')}
          </Button>
          <Button variant="quiet" onClick={() => void remove()}>
            {t('prescription.packRemove')}
          </Button>
        </section>
      ) : null}

      {phase.kind === 'reading' ? (
        <section className="prescription__reading">
          <p role="status">{t('prescription.reading', { percent: phase.percent })}</p>
          <Button variant="secondary" onClick={() => abort.current?.abort()}>
            {t('prescription.cancelReading')}
          </Button>
        </section>
      ) : null}

      {phase.kind === 'list' && pack !== null ? (
        <section className="prescription__list" aria-labelledby={`${listId}-list`}>
          <h2 id={`${listId}-list`}>{t('prescription.listTitle')}</h2>
          {phase.reading.products.length === 0 && phase.reading.typed.length === 0 ? (
            <Notice>{t('prescription.nothing')}</Notice>
          ) : (
            <p>{t('prescription.listLead')}</p>
          )}
          <ul className="prescription__items">
            {phase.reading.products.map((product, index) => {
              const key = `p${String(index)}`;
              const id = `${listId}-${key}`;
              return (
                <li key={key} className="prescription__item">
                  <input
                    id={id}
                    type="checkbox"
                    checked={ticked.has(key)}
                    onChange={() => {
                      toggle(key);
                    }}
                  />
                  <label htmlFor={id}>
                    <span className="prescription__name">{nameOf(product.ref)}</span>
                    <span className="prescription__line">
                      {t('prescription.readOn', { line: product.line })}
                    </span>
                    {notesOf(pack, product, lang).map((note) => (
                      <span key={note.key} className="prescription__note">
                        {t(note.key, note.vars)}
                      </span>
                    ))}
                  </label>
                </li>
              );
            })}
          </ul>
          {phase.reading.typed.length === 0 ? null : (
            <>
              <h3>{t('prescription.typedTitle')}</h3>
              <p>{t('prescription.typedLead')}</p>
              <ul className="prescription__items">
                {phase.reading.typed.map((line, index) => {
                  const key = `t${String(index)}`;
                  const id = `${listId}-${key}`;
                  return (
                    <li key={key} className="prescription__item">
                      <input
                        id={id}
                        type="checkbox"
                        checked={ticked.has(key)}
                        onChange={() => {
                          toggle(key);
                        }}
                      />
                      <label htmlFor={id}>
                        {t('prescription.addTyped', { text: line.text })}
                        <span className="prescription__line">
                          {t('prescription.readOn', { line: line.line })}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {refused ? <Notice>{t('prescription.noneTicked')}</Notice> : null}
          <Button
            variant={ticked.size > 0 ? 'primary' : 'secondary'}
            onClick={() => {
              confirmTicked(phase.reading);
            }}
          >
            {t('prescription.confirmTicked')}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setPhase({ kind: 'ready' });
            }}
          >
            {t('prescription.again')}
          </Button>
        </section>
      ) : null}

      {phase.kind === 'confirming' && pack !== null
        ? (() => {
            const product = phase.reading.products[phase.queue[phase.at] ?? -1];
            const candidate = product === undefined ? undefined : candidateOf(pack, product.ref);
            if (product === undefined || candidate === undefined) return null;
            return (
              <section className="prescription__confirm" key={phase.at}>
                <h2 ref={stepHeading} tabIndex={-1}>
                  {t('prescription.confirmStep', { n: phase.at + 1, total: phase.queue.length })}
                </h2>
                <p className="prescription__line">
                  {t('prescription.readOn', { line: product.line })}
                </p>
                {notesOf(pack, product, lang).map((note) => (
                  <Notice key={note.key}>{t(note.key, note.vars)}</Notice>
                ))}
                <ConfirmForm
                  pack={pack}
                  candidate={candidate}
                  entry={{ query: product.strengthQuery, matched: product.candidate.matched }}
                  onSearchAgain={next}
                  onDone={next}
                  inline
                />
              </section>
            );
          })()
        : null}

      <Button
        variant="quiet"
        className="prescription__back"
        onClick={() => {
          backToCheck(navigate, entry.stepsToCheck);
        }}
      >
        {t('prescription.backToCheck')}
      </Button>
    </main>
  );
}
