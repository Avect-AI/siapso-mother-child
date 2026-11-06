// SPDX-License-Identifier: MIT
// The fluidity meter (SCRUM-56, docs/superpowers/specs/2026-11-05-ux-fluidity-design.md,
// sections 3 and 13): counts the taps, keystrokes, screens and scroll
// gestures of one journey at 360 x 800, with the words read and the app's
// waits, and models its time. The counting rules are those of the spec,
// section 3.2:
// - a tap is one press on a control (a text field that does not have the
//   focus yet counts as one); an answer already chosen is not tapped;
// - a keystroke is one character typed, or one digit tapped on the keypad;
// - a screen is each change of the address and main heading (on the welcome,
//   its question); coming back to a screen counts again;
// - a scroll is a gesture needed, before a tap, to bring its target wholly
//   into view (one gesture moves about 70 percent of the screen; a bar held at
//   the bottom shortens the visible area).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';

/** Touch keystroke-level model, in seconds (spec section 3.3). */
export const MODEL = { screen: 1.35, tap: 1.1, key: 0.7, scroll: 1.5 } as const;

/** What a journey may cost at most: a later change cannot add a step silently. */
export interface Budget {
  taps: number;
  keys: number;
  screens: number;
  scrolls: number;
}

export interface Step {
  n: number;
  label: string;
  screen: string;
  newScreen: boolean;
  waitedMs: number;
}

export interface Measure extends Budget {
  id: string;
  title: string;
  words: number;
  appWaitS: number;
  modelledS: number;
  screenList: { screen: string; words: number }[];
  steps: Step[];
  notes: string[];
  /** Where the result stands once shown (spec section 13, step 5). */
  result?: ResultFacts;
}

export interface ResultFacts {
  /** The top of the first finding card, in px from the top of the page. */
  firstCardTop: number | null;
  /** Whether the level of the first finding is in the first screen. */
  levelInFirstScreen: boolean | null;
  /**
   * Whether the level of the first finding is wholly in view as the page
   * stands once the result shows (SCRUM-56: on the check, the result is
   * brought into view when it first shows).
   */
  levelInView: boolean | null;
  cards: number;
  /** The length of the page, in screens. */
  pageScreens: number;
}

/** Where the first finding stands on the result now on show. */
export function resultFacts(page: Page): Promise<ResultFacts> {
  return page.evaluate(() => {
    const card = document.querySelector('main article');
    const box = card?.getBoundingClientRect();
    const level = card?.querySelector('.result-card__level')?.getBoundingClientRect();
    return {
      firstCardTop: box ? Math.round(box.top + scrollY) : null,
      levelInFirstScreen: level ? level.bottom + scrollY <= innerHeight : null,
      levelInView: level ? level.top >= 0 && level.bottom <= innerHeight : null,
      cards: document.querySelectorAll('main article').length,
      pageScreens: Number((document.documentElement.scrollHeight / innerHeight).toFixed(2)),
    };
  });
}

/** Resolves once the page has been quiet for `quiet` ms (at most `max` ms). */
async function settle(page: Page, quiet = 150, max = 4000): Promise<void> {
  await page.evaluate(
    ({ quiet, max }) =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, quiet);
        });
        let timer = setTimeout(done, quiet);
        const stop = setTimeout(done, max);
        function done() {
          observer.disconnect();
          clearTimeout(timer);
          clearTimeout(stop);
          resolve();
        }
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
      }),
    { quiet, max },
  );
}

/** What the screen is: its address and main heading, and on the welcome its question. */
function screenOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const h1 = (document.querySelector('main h1')?.textContent ?? '').trim();
    const question = (document.querySelector('.welcome__question h2')?.textContent ?? '').trim();
    return `${location.hash || '#/'}|${h1}${question === '' ? '' : `|${question}`}`;
  });
}

function wordsOnScreen(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const text = main ? main.innerText : document.body.innerText;
    return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  });
}

/** The scroll gestures that bring `target` wholly into the visible area from where the page is. */
function scrollsNeeded(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    const height = window.innerHeight;
    const box = element.getBoundingClientRect();
    let bottom = height;
    const bar = document.querySelector('.sticky-action');
    if (bar && !bar.contains(element)) {
      const held = bar.getBoundingClientRect();
      if (held.top < height && held.bottom > 0) bottom = Math.min(bottom, held.top);
    }
    let delta = 0;
    if (box.bottom > bottom) delta = box.bottom - bottom + 8;
    else if (box.top < 0) delta = -box.top + 8;
    return delta <= 0 ? 0 : Math.ceil(delta / (0.7 * height));
  });
}

/** One journey being measured. */
export class Journey {
  taps = 0;
  keys = 0;
  screens = 0;
  scrolls = 0;
  words = 0;
  readonly notes: string[] = [];
  private appWaitMs = 0;
  private readonly steps: Step[] = [];
  private readonly screenList: { screen: string; words: number }[] = [];
  private last: string | null = null;

  constructor(
    readonly page: Page,
    readonly id: string,
    readonly title: string,
  ) {}

  /** The screen on show counts as the first screen. */
  async begin(label: string): Promise<void> {
    await settle(this.page);
    await this.after(label, 0);
  }

  private async after(label: string, waitedMs: number): Promise<void> {
    const screen = await screenOf(this.page);
    const newScreen = screen !== this.last;
    if (newScreen) {
      this.last = screen;
      this.screens += 1;
      const words = await wordsOnScreen(this.page);
      this.words += words;
      this.screenList.push({ screen, words });
    }
    this.steps.push({ n: this.steps.length + 1, label, screen, newScreen, waitedMs });
  }

  private async reach(target: Locator): Promise<void> {
    this.scrolls += await scrollsNeeded(target);
  }

  /** One tap on `target`; `then` is what the tap brings (the time to it is the app's wait). */
  async tap(target: Locator, label: string, { then }: { then?: Locator } = {}): Promise<void> {
    const control = target.first();
    await control.waitFor({ state: 'visible' });
    await this.reach(control);
    this.taps += 1;
    const start = Date.now();
    await control.click();
    if (then) await then.first().waitFor({ state: 'visible', timeout: 30_000 });
    const waited = Date.now() - start;
    if (then) this.appWaitMs += waited;
    await settle(this.page);
    await this.after(label, waited);
  }

  /** A tap counted but not made (a call link opens the dialler). */
  async tapCountOnly(target: Locator, label: string): Promise<void> {
    const control = target.first();
    await control.waitFor({ state: 'visible' });
    await this.reach(control);
    this.taps += 1;
    await this.after(label, 0);
  }

  /** Text typed on the phone's keyboard, with a tap first when the field does not have the focus. */
  async type(
    target: Locator,
    text: string,
    label: string,
    { then }: { then?: Locator } = {},
  ): Promise<void> {
    const field = target.first();
    await field.waitFor({ state: 'visible' });
    const focused = await field.evaluate((element) => element === document.activeElement);
    if (!focused) {
      await this.reach(field);
      this.taps += 1;
      await field.click();
    }
    this.keys += Array.from(text).length;
    const start = Date.now();
    await field.pressSequentially(text, { delay: 20 });
    if (then) await then.first().waitFor({ state: 'visible', timeout: 30_000 });
    await settle(this.page);
    await this.after(label, Date.now() - start);
  }

  /** Digits tapped on the app's keypad: each one a keystroke, no tap on the field. */
  async keypad(digits: string, label: string, { then }: { then?: Locator } = {}): Promise<void> {
    const start = Date.now();
    for (const digit of digits) {
      const key = this.page.locator('.keypad__key').filter({ hasText: new RegExp(`^${digit}$`) });
      await this.reach(key.first());
      this.keys += 1;
      await key.first().click();
    }
    if (then) await then.first().waitFor({ state: 'visible', timeout: 30_000 });
    const waited = Date.now() - start;
    if (then) this.appWaitMs += waited;
    await settle(this.page);
    await this.after(label, waited);
  }

  /** The counts, the words and the modelled time (spec section 3.3). */
  end(result?: ResultFacts): Measure {
    const modelled =
      MODEL.screen * this.screens +
      MODEL.tap * this.taps +
      MODEL.key * this.keys +
      MODEL.scroll * this.scrolls +
      this.appWaitMs / 1000;
    return {
      id: this.id,
      title: this.title,
      taps: this.taps,
      keys: this.keys,
      screens: this.screens,
      scrolls: this.scrolls,
      words: this.words,
      appWaitS: Number((this.appWaitMs / 1000).toFixed(1)),
      modelledS: Number(modelled.toFixed(1)),
      screenList: this.screenList,
      steps: this.steps,
      notes: this.notes,
      ...(result === undefined ? {} : { result }),
    };
  }
}

/** The measure of one journey, kept as a JSON file of the run and attached to its report. */
export async function report(testInfo: TestInfo, measure: Measure): Promise<void> {
  const body = JSON.stringify(measure, null, 2);
  const folder = path.join(testInfo.project.outputDir, 'fluidity');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, `${measure.id}.json`), body);
  await testInfo.attach(`fluidity-${measure.id}.json`, {
    body,
    contentType: 'application/json',
  });
}

/** The counts over budget, in words (empty when the journey is within it). */
export function overBudget(measure: Measure, budget: Budget): string[] {
  return (['taps', 'keys', 'screens', 'scrolls'] as const)
    .filter((count) => measure[count] > budget[count])
    .map(
      (count) => `${count}: ${String(measure[count])} over a budget of ${String(budget[count])}`,
    );
}
