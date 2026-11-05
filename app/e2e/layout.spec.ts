// SPDX-License-Identifier: MIT
// Accessibility and small-screen layout found by the live test (SCRUM-50):
// small phones (320 x 640), text at 200 percent, keyboard focus, and what a
// screen reader hears.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CODE, onboard } from './support.js';

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

/** Doubles the root font size, as a phone set to its largest text would. */
async function largeText(page: Page) {
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
}

function answer(page: Page, question: string | RegExp, label: string) {
  return page.getByRole('group', { name: question }).getByText(label, { exact: true });
}

/**
 * The words of `selector` whose letters land on two lines: a word cut in the
 * middle. A break after a hyphen or a slash the word already has is a break
 * between its parts, not a cut.
 */
function cutWords(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const cut: string[] = [];
    for (const root of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const word of text.matchAll(/\S+/g)) {
          let top: number | null = null;
          for (let i = 0; i < word[0].length; i++) {
            const range = document.createRange();
            range.setStart(node, word.index + i);
            range.setEnd(node, word.index + i + 1);
            const box = [...range.getClientRects()].find((rect) => rect.width > 0);
            if (box === undefined) continue;
            if (top !== null && Math.abs(box.top - top) > 4) {
              const before = word[0][i - 1];
              if (before !== '-' && before !== '/') cut.push(word[0]);
              break;
            }
            top = box.top;
          }
        }
      }
    }
    return cut;
  }, selector);
}

/** The bottom of `name`'s button, in page pixels, and whether the page is scrolled. */
async function buttonBottom(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).evaluate((button) => ({
    bottom: button.getBoundingClientRect().bottom + window.scrollY,
    scrolled: window.scrollY,
  }));
}

/** Taps the code's digits on the keys of the screen. */
async function tapCode(page: Page, code: string = CODE) {
  const keypad = page.getByRole('group', { name: 'Clavier du code' });
  for (const digit of code) await keypad.getByRole('button', { name: digit, exact: true }).click();
}

/** Where the danger signs shortcut sits in the band, rounded to the pixel. */
async function shortcutBox(page: Page) {
  const box = await page
    .getByRole('banner')
    .getByRole('link', { name: 'Signes de danger' })
    .boundingBox();
  return box === null
    ? null
    : {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
}

type Box = { x: number; y: number; width: number; height: number };

/** Whether two boxes share any area. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The danger signs shortcut in every state of the band: the welcome, open,
 * offline, the neutral screen after "Quitter", the code screen. It must keep
 * one place, and "Quitter" (open) must never sit where it is when locked.
 * `prepare` runs after each page load (a text size, say).
 */
async function expectShortcutInOnePlace(
  page: Page,
  context: BrowserContext,
  prepare: (page: Page) => Promise<void> = () => Promise.resolve(),
) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Français' })).toBeVisible();
  await prepare(page);
  const place = await shortcutBox(page);
  expect(place).not.toBeNull();

  await onboard(page, 'woman');
  await prepare(page);
  expect(await shortcutBox(page)).toEqual(place);
  const exit = await page
    .getByRole('banner')
    .getByRole('button', { name: 'Quitter' })
    .boundingBox();

  await context.setOffline(true);
  await expect(page.getByRole('banner').getByText('Hors ligne')).toBeVisible();
  expect(await shortcutBox(page)).toEqual(place);
  await context.setOffline(false);
  await expect(page.getByRole('banner').getByText('Hors ligne')).toHaveCount(0);

  await page.getByRole('button', { name: 'Quitter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Carnet' })).toBeVisible();
  expect(await shortcutBox(page)).toEqual(place);
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
  const locked = await shortcutBox(page);
  expect(locked).toEqual(place);
  expect(exit).not.toBeNull();
  if (exit !== null && locked !== null) expect(overlaps(exit, locked)).toBe(false);
}

/**
 * The rows of the band: its visible items grouped by the line they sit on
 * (centres a few pixels apart are one row: a 32 px badge beside a 48 px button).
 */
function bandRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const centres = [
      ...document.querySelectorAll('.header__bar > a, .header__bar > button, .offline-badge'),
    ]
      .map((item) => item.getBoundingClientRect())
      .filter((box) => box.width > 1)
      .map((box) => box.top + box.height / 2)
      .sort((a, b) => a - b);
    return centres.filter((centre, i) => i === 0 || centre - (centres[i - 1] ?? 0) > 8).length;
  });
}

/** Her profile, pregnant at `weeks` weeks, from Home; ends on the check. */
async function pregnantAt(page: Page, weeks: number) {
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill(String(weeks));
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
}

async function add(page: Page, list: string, query: string) {
  await page.getByRole('button', { name: list }).click();
  await page.getByRole('searchbox').fill(query);
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: /^Oui, c'est ce/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Ce qu/ })).toBeVisible();
}

test.describe('on a small phone (320 x 640)', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the code screens keep their one primary action in the first screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Français' }).click();
    await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Choisissez un code' })).toBeVisible();
    // "Corriger" keeps its place in the keypad, beside 0: the wide button is the primary one.
    const keypad = page.getByRole('group', { name: 'Clavier du code' });
    const row = async (name: string) =>
      keypad
        .getByRole('button', { name, exact: true })
        .evaluate((key) => Math.round(key.getBoundingClientRect().top));
    expect(await row('Corriger le dernier chiffre')).toBe(await row('0'));

    await tapCode(page);
    let action = await buttonBottom(page, 'Continuer');
    expect(action.scrolled).toBe(0);
    expect(action.bottom).toBeLessThanOrEqual(640);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tapez le code une deuxième fois' }),
    ).toBeVisible();
    // Two different codes: said, then the code is chosen again, "Continuer" still in view.
    await tapCode(page, '1357');
    await page.getByRole('button', { name: 'Enregistrer le code' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Choisissez un code' })).toBeVisible();
    await expect(page.getByLabel('Code', { exact: true })).toHaveAccessibleDescription(
      /Les deux codes ne sont pas les mêmes/,
    );
    await tapCode(page);
    action = await buttonBottom(page, 'Continuer');
    expect(action.scrolled).toBe(0);
    expect(action.bottom).toBeLessThanOrEqual(640);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await tapCode(page);
    action = await buttonBottom(page, 'Enregistrer le code');
    expect(action.scrolled).toBe(0);
    expect(action.bottom).toBeLessThanOrEqual(640);
    await page.getByRole('button', { name: 'Enregistrer le code' }).click();
    await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();

    // The code asked again, with a wrong code said: "Ouvrir" still in the first screen.
    await page.getByRole('button', { name: 'Quitter' }).click();
    await page.getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
    await tapCode(page, '1111');
    await page.getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page.getByLabel('Code', { exact: true })).toHaveAccessibleDescription(
      "Ce n'est pas le bon code. Encore 4 essais avant une attente.",
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await tapCode(page);
    action = await buttonBottom(page, 'Ouvrir');
    expect(action.scrolled).toBe(0);
    expect(action.bottom).toBeLessThanOrEqual(640);
    await expectNoSeriousViolation(page);
  });

  test('offline, the code step of the welcome keeps "Continuer" in the first screen', async ({
    page,
    context,
  }) => {
    // Live test round 2 (carry-over): "Hors ligne" in the band pushed it 3 px below.
    await page.goto('/');
    await page.getByRole('button', { name: 'Français' }).click();
    await context.setOffline(true);
    await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Choisissez un code' })).toBeVisible();
    await expect(page.getByRole('banner').getByText('Hors ligne')).toBeVisible();

    await tapCode(page);
    const action = await buttonBottom(page, 'Continuer');
    expect(action.scrolled).toBe(0);
    expect(action.bottom).toBeLessThanOrEqual(640);
    await context.setOffline(false);
  });

  test('the band keeps to two rows, offline too, the danger shortcut always in its place', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Français' })).toBeVisible();
    const welcome = await shortcutBox(page);
    await onboard(page, 'woman');
    await expect(page.getByRole('button', { name: 'Quitter' })).toBeVisible();
    expect(await bandRows(page)).toBeLessThanOrEqual(2);
    // The same place on the welcome and once the code is given: never Quitter's.
    expect(await shortcutBox(page)).toEqual(welcome);
    await expect(page.getByRole('link', { name: 'Carnet' })).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByRole('banner').getByText('Hors ligne')).toBeVisible();
    expect(await bandRows(page)).toBeLessThanOrEqual(2);
    expect(await shortcutBox(page)).toEqual(welcome);
    await expectNoSeriousViolation(page);
    await context.setOffline(false);

    await page.getByRole('button', { name: 'Quitter' }).click();
    await page.getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
    expect(await shortcutBox(page)).toEqual(welcome);
  });
});

for (const viewport of [
  { width: 740, height: 360 },
  { width: 1024, height: 768 },
]) {
  test.describe(`on a wide screen (${String(viewport.width)} x ${String(viewport.height)})`, () => {
    test.use({ viewport });

    test('the danger shortcut keeps one place in every state, never the quick exit', async ({
      page,
      context,
    }) => {
      await expectShortcutInOnePlace(page, context);
    });
  });
}

test.describe('on a small phone (320 x 640) with text at 200 percent', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the danger shortcut keeps its place, and both buttons of the band are in the first screen', async ({
    page,
    context,
  }) => {
    await expectShortcutInOnePlace(page, context, largeText);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();
    await page.getByLabel('Code', { exact: true }).fill(CODE);
    await page.getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
    await largeText(page);
    const band = page.getByRole('banner');
    for (const control of [
      band.getByRole('link', { name: 'Signes de danger' }),
      band.getByRole('button', { name: 'Quitter' }),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('on a 360 px phone', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('the band keeps to two rows', async ({ page }) => {
    await onboard(page, 'accompanied');
    expect(await bandRows(page)).toBeLessThanOrEqual(2);
  });

  test('the welcome keeps the danger signs one tap away, and comes back to the step', async ({
    page,
  }) => {
    await page.goto('/');
    const band = page.getByRole('banner');
    await expect(band.getByRole('link', { name: 'Signes de danger' })).toBeVisible();
    await page.getByRole('button', { name: 'Français' }).click();
    await expect(band.getByRole('link', { name: 'Signes de danger' })).toBeVisible();
    await page.getByRole('button', { name: /^Je suis enceinte/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Choisissez un code' })).toBeVisible();

    await band.getByRole('link', { name: 'Signes de danger' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
    await expectNoSeriousViolation(page);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Choisissez un code' })).toBeVisible();
    await expectNoSeriousViolation(page);
  });

  test('About: every link is a thumb-sized target', async ({ page }) => {
    await onboard(page, 'woman');
    await page.getByRole('link', { name: 'À propos' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main a, main button')]
        .map((el) => ({ text: el.textContent, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width < 48 || box.height < 48)
        .map(({ text }) => text),
    );
    expect(small).toEqual([]);
    await expectNoSeriousViolation(page);
  });

  test('Settings: the arrow keys go through the answers and change nothing until applied', async ({
    page,
  }) => {
    await onboard(page, 'woman');
    await page.getByRole('link', { name: 'Réglages' }).click();
    await page.getByRole('radio', { name: "Je suis enceinte ou j'allaite" }).focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('radio', { name: 'Français' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Réglage enregistré.' })).toHaveCount(
      0,
    );
    await expectNoSeriousViolation(page);

    await page.getByRole('button', { name: 'Switch to English' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'English' })).toBeFocused();
    await page.getByRole('button', { name: 'Change the mode' }).click();
    await page.getByRole('button', { name: 'Back to the start' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Profiles' })).toBeVisible();
  });

  test('the check never shows before the profile screen it opens', async ({ page }) => {
    await onboard(page, 'woman');
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { seenHeadings: string[] }).seenHeadings = seen;
      new MutationObserver(() => {
        const text = document.querySelector('main h1')?.textContent;
        if (text !== undefined && seen.at(-1) !== text) seen.push(text);
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await page.getByRole('button', { name: 'Regarder un produit' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeFocused();
    const seen = await page.evaluate(
      () => (window as unknown as { seenHeadings: string[] }).seenHeadings,
    );
    expect(seen).not.toContain('Ce que vous prenez');
  });

  test('"Voir tous les signes" takes the focus to the first sign it shows', async ({ page }) => {
    await onboard(page, 'woman');
    await pregnantAt(page, 20);
    await add(page, 'Ajouter un médicament', 'ibuprofene');
    await page.getByRole('button', { name: 'Voir le résultat' }).click();
    const showAll = page.getByRole('button', { name: 'Voir tous les signes' });
    await showAll.focus();
    await page.keyboard.press('Enter');
    const postpartum = page.getByRole('group', { name: "Après l'accouchement" });
    await expect(postpartum.getByRole('checkbox').first()).toBeFocused();
    await expectNoSeriousViolation(page);
  });

  test('Wolof and Latin names are marked with their language', async ({ page }) => {
    await onboard(page, 'woman');
    await pregnantAt(page, 20);
    await page.getByRole('button', { name: 'Ajouter un remède' }).click();
    await page.getByRole('searchbox').fill('nebeday');
    const first = page.locator('.candidate').first();
    await expect(first.getByText('nebeday', { exact: true })).toHaveAttribute('lang', 'wo');
    await expect(first.getByText('Moringa oleifera')).toHaveAttribute('lang', 'la');
    await expectNoSeriousViolation(page);
  });

  test('a number and its unit stay on one line in a product name', async ({ page }) => {
    await onboard(page, 'woman');
    await pregnantAt(page, 20);
    await page.getByRole('button', { name: 'Ajouter un médicament' }).click();
    await page.getByRole('searchbox').fill('Doliprane 1000 mg');
    await page.locator('.candidate').first().click();
    const name = page.locator('.confirm__name');
    await expect(name).toContainText('DOLIPRANE');
    expect(await name.textContent()).toContain('1000 mg');
    await largeText(page);
    expect(await cutWords(page, '.confirm__name')).toEqual([]);
  });
});

test.describe('at 360 px with text at 200 percent', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('the sticky action never hides a focused danger sign', async ({ page }) => {
    await page.goto('/#/danger');
    await expect(page.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
    await expect(page.locator('.option').first()).toBeVisible();
    await largeText(page);
    const boxes = await page.locator('main input[type=checkbox]').count();
    expect(boxes).toBeGreaterThan(10);
    await page.getByRole('heading', { level: 1, name: 'Signes de danger' }).focus();
    const hidden: string[] = [];
    for (let i = 0; i < boxes + 2; i++) {
      await page.keyboard.press('Tab');
      const covered = await page.evaluate(() => {
        const focused = document.activeElement;
        const bar = document.querySelector('.sticky-action');
        if (focused === null || bar === null || bar.contains(focused)) return null;
        const answer = focused.closest('.option') ?? focused;
        const bottom = answer.getBoundingClientRect().bottom;
        return bottom > bar.getBoundingClientRect().top + 1 ? answer.textContent : null;
      });
      if (covered !== null) hidden.push(covered);
    }
    expect(hidden).toEqual([]);
  });

  /**
   * The longest instruction the danger banner can give with the pack of this
   * build: the standard one, and the orientation of every danger rule and
   * every danger sign, in both languages.
   */
  async function longestDangerInstruction(page: Page): Promise<string> {
    const fragment = async (file: string): Promise<unknown> =>
      (await page.request.get(`/pack/${file}`)).json();
    const rules = (await fragment('rules.json')) as { level: string; message: string }[];
    const signs = (await fragment('danger-signs.json')) as { message?: string }[];
    const ids = new Set([
      ...rules.filter((rule) => rule.level === 'danger').map((rule) => rule.message),
      ...signs.map((sign) => sign.message ?? 'danger-sign'),
    ]);
    const texts = ['Allez au poste de santé maintenant.', 'Go to the health post now.'];
    for (const lang of ['fr', 'en']) {
      const messages = (await fragment(`messages.${lang}.json`)) as Record<
        string,
        { orientation?: string }
      >;
      for (const id of ids) {
        const orientation = messages[id]?.orientation;
        if (orientation !== undefined) texts.push(orientation);
      }
    }
    return texts.reduce((longest, text) => (text.length > longest.length ? text : longest));
  }

  test('a result keeps whole words in the banner instruction and in who to show and when', async ({
    page,
  }) => {
    await onboard(page, 'accompanied');
    await page.getByRole('button', { name: 'Ajouter un profil' }).click();
    await answer(page, /^Enceinte/, 'Oui').click();
    await answer(page, 'Terme de la grossesse', 'En semaines').click();
    await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill('34');
    await answer(page, /^Ce terme date de quand/, "Aujourd'hui").click();
    await answer(page, /^Allaite/, 'Non').click();
    await page.getByText("Ancienne césarienne (cicatrice sur l'utérus)").click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page
      .getByRole('list', { name: 'Profils enregistrés sur ce téléphone' })
      .getByRole('button', { name: /^Femme 1 / })
      .click();
    await add(page, 'Ajouter un médicament', 'ibuprofene');
    await add(page, 'Ajouter un remède', 'huile de ricin');
    await add(page, 'Ajouter un remède', 'argile');
    await add(page, 'Ajouter un remède', 'kinkeliba');
    await page.getByRole('button', { name: 'Voir le résultat' }).click();
    await page.getByText('Aucun de ces signes', { exact: true }).click();
    await page.getByRole('button', { name: 'Voir le résultat' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /^Résultat/ })).toBeVisible();
    // The banner names its instruction once: no group named by the same words.
    await expect(page.locator('.danger-banner[role="group"]')).toHaveCount(0);
    await expectNoSeriousViolation(page);

    await largeText(page);
    const longest = await longestDangerInstruction(page);
    expect(longest.length).toBeGreaterThan(40);
    await page
      .getByRole('alert')
      .getByRole('heading')
      .evaluate((heading, text) => {
        heading.textContent = text;
        heading.classList.toggle('danger-banner__title--long', text.length > 40);
      }, longest);
    expect(await cutWords(page, '.danger-banner__title')).toEqual([]);
    expect(await cutWords(page, '.result-card__orientation')).toEqual([]);
    expect(await cutWords(page, '.result-card__level')).toEqual([]);
    expect(await cutWords(page, '.result-summary')).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // On a 320 px phone too, the summary and who to show and when keep whole words.
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await cutWords(page, '.result-summary')).toEqual([]);
    expect(await cutWords(page, '.result-card__orientation')).toEqual([]);
  });
});
