// SPDX-License-Identifier: MIT
// Danger signs and who to call, offline, as on a phone in airplane mode.
// Phone numbers here are made up: runs of the same digit, never a real number.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

/**
 * Waits until the service worker is active and controls the page. A first
 * install does not claim the page that registered it, so reload until the
 * worker serves the navigation (normally once).
 */
async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(async () => {
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
      await page.reload();
    }
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }).toPass({ timeout: 15_000 });
}

/** Every link, button and answer of the screen is at least 48 px in both directions. */
async function expectThumbTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a, button, label.option')]
      .map((el) => ({ text: el.textContent, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 48 || box.height < 48)
      .map(({ text }) => text),
  );
  expect(small).toEqual([]);
}

function answer(page: Page, question: string | RegExp, label: string) {
  return page.getByRole('group', { name: question }).getByText(label, { exact: true });
}

/** Welcome in French, then a mode; the app is then served offline by the service worker. */
async function onboardOffline(page: Page, mode: 'woman' | 'accompanied') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Français' }).click();
  await page
    .getByRole('button', { name: mode === 'woman' ? /^Je suis enceinte/ : /^J'accompagne/ })
    .click();
  await expect(page.getByRole('button', { name: 'Regarder un produit' })).toBeVisible();
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('banner').getByText('Hors ligne')).toBeVisible();
}

/** The header shortcut opens the danger signs; back returns to the screen it was opened from. */
async function openDangerAndBack(page: Page, from: RegExp | string) {
  await page.getByRole('banner').getByRole('link', { name: 'Signes de danger' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Signes de danger' })).toBeVisible();
  await expect(page.getByText('Allez au poste de santé maintenant.')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(21);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: from })).toBeVisible();
}

test('offline: danger signs from Home, Check and Result, then who to call', async ({ page }) => {
  await onboardOffline(page, 'woman');

  // From Home.
  await openDangerAndBack(page, 'Un médicament ou un remède ?');

  // The profile, then the check, offline.
  await page.getByRole('button', { name: 'Regarder un produit' }).click();
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill('14');
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ce que vous prenez' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un remède' }).click();
  await page.getByRole('searchbox').fill('kinkeliba');
  await page.locator('.candidate').first().click();
  await page.getByRole('button', { name: "Oui, c'est ce remède" }).click();
  await expect(page.getByRole('list', { name: 'Produits ajoutés' })).toContainText('Kinkéliba');

  // From Check.
  await openDangerAndBack(page, 'Ce que vous prenez');

  // The signs present now, "none" first; a fever now.
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  const question = page.getByRole('group', { name: 'Avez-vous un de ces signes maintenant ?' });
  await expect(question.getByRole('checkbox').first()).toHaveAccessibleName('Aucun de ces signes');
  // The heading of the new screen has the focus once the list is shown.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Avez-vous un de ces signes maintenant ?' }),
  ).toBeFocused();
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);
  await question.getByText('Fièvre', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();

  // The result leads with the danger.
  await expect(page.getByRole('heading', { level: 1, name: 'Résultat' })).toBeVisible();
  const fever = "Allez faire un test au poste de santé aujourd'hui.";
  await expect(page.getByRole('alert')).toContainText(fever);
  await expect(page.getByRole('article').first()).toHaveClass(/level--danger/);

  // From Result.
  await openDangerAndBack(page, 'Résultat');

  // Who to call, from the banner: the same instruction, the sign to say, the circuit.
  await page.getByRole('button', { name: 'Voir qui appeler' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: fever })).toBeVisible();
  await expect(
    page.getByText('Dites ces signes au téléphone ou au poste de santé :'),
  ).toBeVisible();
  await expect(page.getByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
  await expectNoSeriousViolation(page);
});

test('offline: "C\'est grave maintenant" never refuses, and keeps the signs ticked for the call', async ({
  page,
}) => {
  await onboardOffline(page, 'woman');
  await page.getByRole('banner').getByRole('link', { name: 'Signes de danger' }).click();
  const now = page.getByRole('button', { name: "C'est grave maintenant" });
  await expectThumbTargets(page);

  // No sign ticked: still the danger instruction and who to call, no error.
  await now.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Signe de danger Allez au poste de santé maintenant.',
  );
  await expect(page.getByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
  // Woman mode: no way to add contacts here.
  await expect(page.getByRole('link', { name: 'Ajouter un contact' })).toHaveCount(0);
  await page.goBack();

  // A sign ticked: the same instruction, and the sign to say.
  await page.getByText('Saignement par le vagin', { exact: true }).click();
  await now.click();
  await expect(page.getByRole('alert')).toContainText(
    'Signe de danger Allez au poste de santé maintenant.',
  );
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Saignement par le vagin' }),
  ).toBeVisible();
  await expectNoSeriousViolation(page);

  // Back finds the sign still ticked.
  await page.goBack();
  await expect(page.getByRole('checkbox', { name: 'Saignement par le vagin' })).toBeChecked();
});

test('at 200 percent text on a 360 px phone, no word of a sign breaks inside itself', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) > 360, 'a 360 px phone only');
  await page.goto('/#/danger');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expect(page.getByRole('checkbox')).toHaveCount(21);
  // Each word of each answer sits on one line: its range has a single line box.
  const broken = await page.evaluate(() => {
    const found: string[] = [];
    for (const span of document.querySelectorAll('label.option > span')) {
      const node = span.firstChild;
      if (node?.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent ?? '';
      for (const match of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        if (tops.size > 1) found.push(match[0]);
      }
    }
    return found;
  });
  expect(broken).toEqual([]);
});

test('offline, accompanied mode: a contact added on the phone is called from who to call', async ({
  page,
}) => {
  await onboardOffline(page, 'accompanied');
  await page.goto('/#/danger/call');
  await expect(page.getByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
  await page.getByRole('link', { name: 'Ajouter un contact' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Nouveau contact' })).toBeVisible();
  await answer(page, 'Rôle', 'Relais').click();
  await page.getByRole('textbox', { name: 'Nom' }).fill('Awa');
  await page.getByRole('textbox', { name: 'Numéro de téléphone' }).fill('00 00 00 00');
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page.getByText('Contact enregistré : Awa (Relais).')).toBeVisible();
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);
  await page.goBack();

  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  const call = page.getByRole('link', { name: 'Appeler Awa (Relais), 00 00 00 00' });
  await expect(call).toHaveAttribute('href', 'tel:00000000');
  await expect(page.getByText('00 00 00 00', { exact: true })).toBeVisible();
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);

  // At 200 percent text, nothing scrolls sideways at 360 px.
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const width = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
});
