// SPDX-License-Identifier: MIT
// Danger signs and who to call, offline, as on a phone in airplane mode.
// Phone numbers here are made up: runs of the same digit, never a real number.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addFirstCandidate, onboard, type Mode, unlock } from './support.js';

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

/**
 * The national emergency numbers, always on who to call: call links that open
 * the phone's dialler, and where to go.
 */
async function expectEmergencyNumbers(page: Page, { primary }: { primary: boolean }) {
  const samu = page.getByRole('link', { name: 'Appeler le SAMU (1515)' });
  await expect(samu).toHaveAttribute('href', 'tel:1515');
  await expect(samu).toHaveClass(primary ? /button--primary/ : /button--secondary/);
  await expect(page.getByRole('link', { name: 'Appeler les pompiers (18)' })).toHaveAttribute(
    'href',
    'tel:18',
  );
  await expect(
    page.getByText('Allez au poste de santé ou au centre de santé le plus proche.'),
  ).toBeVisible();
}

/** The console warnings of the page about the deployment's referral file. */
function referralWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (/referral/i.test(message.text())) warnings.push(message.text());
  });
  return warnings;
}

/** Fills the new contact screen and saves it. */
async function saveContact(page: Page, role: string, name: string, phone: string) {
  await expect(page.getByRole('heading', { level: 1, name: 'Nouveau contact' })).toBeVisible();
  await answer(page, 'Rôle', role).click();
  await page.getByRole('textbox', { name: 'Nom' }).fill(name);
  await page.getByRole('textbox', { name: 'Numéro de téléphone' }).fill(phone);
  await expectNoSeriousViolation(page);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
}

/**
 * Welcome in French, a mode and the code; the app is then served offline by
 * the service worker, and the code opens it again after the reload.
 */
async function onboardOffline(page: Page, mode: Mode) {
  await onboard(page, mode);
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('banner').getByText('Hors ligne')).toBeVisible();
  await unlock(page);
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

test('offline: danger signs from her start, her check and the result, then who to call', async ({
  page,
}) => {
  const warnings = referralWarnings(page);
  await onboardOffline(page, 'woman');

  // From her start, her check with the questions about her (SCRUM-56, S4).
  await openDangerAndBack(page, 'Un médicament ou un remède ?');

  // Her answers, then a product, offline.
  await answer(page, /^Enceinte/, 'Oui').click();
  await answer(page, 'Terme de la grossesse', 'En semaines').click();
  await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill('14');
  await answer(page, /^Allaite/, 'Non').click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').fill('kinkeliba');
  await addFirstCandidate(page);
  await expect(page.getByRole('list', { name: 'Produits ajoutés' })).toContainText('Kinkéliba');

  // From Check.
  await openDangerAndBack(page, 'Un médicament ou un remède ?');

  // The signs present now on the check (SCRUM-56, S13): in words, then "no" or "yes"; a fever now.
  const asked = page.getByRole('heading', {
    level: 2,
    name: 'Avez-vous un de ces signes maintenant ?',
  });
  await expect(asked).toBeVisible();
  await expect(page.locator('.check__sign-words')).toContainText('Fièvre');
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);
  await page.getByRole('button', { name: 'Oui, au moins un' }).click();
  const question = page.getByRole('group', { name: 'Avez-vous un de ces signes maintenant ?' });
  // Nothing ticked, the focus on the first sign of the list.
  await expect(question.getByRole('checkbox').first()).toBeFocused();
  await expect(question.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);
  await question.getByText('Fièvre', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();

  // The result leads with the danger.
  await expect(page.getByRole('heading', { level: 2, name: 'Résultat' })).toBeVisible();
  const fever = 'Allez au poste de santé maintenant pour faire un test.';
  await expect(page.getByRole('alert')).toContainText(fever);
  await expect(page.getByRole('article').first()).toHaveClass(/level--danger/);

  // From the result, on the check: Back comes to the check, which was left, so the
  // signs are asked again (SCRUM-56, S14); the fever answered again.
  await openDangerAndBack(page, 'Un médicament ou un remède ?');
  await expect(page.getByRole('heading', { level: 2, name: 'Résultat' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Oui, au moins un' }).click();
  await question.getByText('Fièvre', { exact: true }).click();
  await page.getByRole('button', { name: 'Voir le résultat' }).click();
  await expect(page.locator('.check__danger')).toBeFocused();

  // Who to call, from the banner: the same instruction, the sign to say, the circuit.
  await page.getByRole('button', { name: 'Voir qui appeler' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: fever })).toBeVisible();
  await expect(
    page.getByText('Dites ces signes au téléphone ou au poste de santé :'),
  ).toBeVisible();
  await expect(page.getByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
  // No contact, no deployment file, offline: the emergency numbers are still there to call.
  await expectEmergencyNumbers(page, { primary: true });
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);
  // This build has no deployment file: read as none, without a warning about it.
  expect(warnings).toEqual([]);
});

test('online without a deployment file: the app page is never read as one', async ({ page }) => {
  const warnings = referralWarnings(page);
  await onboard(page, 'woman');
  // The preview server answers every path with the app page, as many servers do.
  const served = await page.request.get('/config/referral.json');
  expect(served.headers()['content-type']).toMatch(/html/);

  await page.goto('/#/danger/call');
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await expectEmergencyNumbers(page, { primary: true });
  expect(warnings).toEqual([]);
});

test.describe('on a small phone (360 x 560), a call is in the first screen', () => {
  test.use({ viewport: { width: 360, height: 560 } });

  /**
   * The longest instruction the danger banner can give with the pack of this
   * build: the standard one, and the orientation of every danger rule and of
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

  /** The danger banner says `words`, sized as the banner sizes a long instruction. */
  async function sayInBanner(page: Page, words: string) {
    await page
      .getByRole('alert')
      .getByRole('heading')
      .evaluate((heading, text) => {
        heading.textContent = text;
        heading.classList.toggle('danger-banner__title--long', text.length > 40);
      }, words);
    await expect(page.getByRole('alert')).toContainText(words);
  }

  for (const { name, contact, locked } of [
    { name: 'no contact, open', contact: false, locked: false },
    { name: 'one contact, open', contact: true, locked: false },
    { name: 'locked, a contact saved', contact: true, locked: true },
  ]) {
    test(`with the longest danger instruction of the pack, ${name}`, async ({ page }) => {
      await onboard(page, 'woman');
      if (contact) {
        await page.goto('/#/contacts/new');
        await saveContact(page, 'Sage-femme', 'Fatou', '00 00 00 00');
        await expect(page.getByText('Contact enregistré : Fatou (Sage-femme).')).toBeVisible();
      }
      if (locked) {
        // A reload locks: the danger signs and who to call open without the code.
        await page.reload();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Entrez votre code' }),
        ).toBeVisible();
      }
      await page.goto('/#/danger');
      await page.getByText('Saignement par le vagin', { exact: true }).click();
      await page.getByRole('button', { name: "C'est grave maintenant" }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
      const first = page.locator('main a[href^="tel:"]').first();
      await (contact && !locked
        ? expect(first).toHaveAccessibleName('Appeler Fatou (Sage-femme), 00 00 00 00')
        : expect(first).toHaveText('Appeler le SAMU (1515)'));

      const longest = await longestDangerInstruction(page);
      expect(longest.length).toBeGreaterThan(40);
      await sayInBanner(page, longest);
      await expectFirstCallInView(page);
    });
  }

  /** Her start: her answers, a remedy, a fever now, the result, then "Voir qui appeler". */
  async function fromAFeverResultToCall(page: Page) {
    await page.goto('/#/');
    await answer(page, /^Enceinte/, 'Oui').click();
    await answer(page, 'Terme de la grossesse', 'En semaines').click();
    await page.getByRole('textbox', { name: 'Nombre de semaines' }).fill('14');
    await answer(page, /^Allaite/, 'Non').click();
    await page.getByText('Aucune de ces situations').click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByRole('searchbox').fill('kinkeliba');
    await addFirstCandidate(page);
    // The signs present now, on the check (SCRUM-56, S13): "Oui, au moins un", then the sign.
    await page.getByRole('button', { name: 'Oui, au moins un' }).click();
    await page
      .getByRole('group', { name: 'Avez-vous un de ces signes maintenant ?' })
      .getByText('Fièvre', { exact: true })
      .click();
    await page.getByRole('button', { name: 'Voir le résultat' }).click();
    await page.getByRole('button', { name: 'Voir qui appeler' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    await expect(page.getByRole('alert')).toBeVisible();
  }

  /** The first call link of the screen ends within the first screen, without a scroll. */
  async function expectFirstCallInView(page: Page) {
    const first = page.locator('main a[href^="tel:"]').first();
    await expect(first).toBeVisible();
    const fits = await first.evaluate(
      (link) => window.scrollY === 0 && link.getBoundingClientRect().bottom <= window.innerHeight,
    );
    expect(fits).toBe(true);
  }

  test('with no contact, "Appeler le SAMU (1515)" is in the first screen', async ({ page }) => {
    await onboard(page, 'woman');
    await fromAFeverResultToCall(page);
    await expect(page.locator('main a[href^="tel:"]').first()).toHaveText('Appeler le SAMU (1515)');
    await expectFirstCallInView(page);
  });

  test('with one contact, the contact\'s "Appeler" is in the first screen', async ({ page }) => {
    await onboard(page, 'woman');
    await page.goto('/#/contacts/new');
    await saveContact(page, 'Sage-femme', 'Fatou', '00 00 00 00');
    await expect(page.getByText('Contact enregistré : Fatou (Sage-femme).')).toBeVisible();
    await fromAFeverResultToCall(page);
    await expect(page.locator('main a[href^="tel:"]').first()).toHaveAccessibleName(
      'Appeler Fatou (Sage-femme), 00 00 00 00',
    );
    await expectFirstCallInView(page);
  });
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
  await expectEmergencyNumbers(page, { primary: true });
  // Woman mode: she can add her own contact, behind her code.
  await expect(page.getByRole('link', { name: 'Ajouter un contact' })).toBeVisible();
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
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('label.option > span')].map(
      (span) => getComputedStyle(span).fontSize,
    ),
  );
  // The answers keep the full text size: nothing scales them down to fit.
  expect(new Set(sizes)).toEqual(new Set(['36px']));
  // Each word of each answer sits on one line (its range has a single line
  // box), unless that word alone is wider than the column of the list (not
  // the answer's own text box, which its padding could make too narrow).
  const broken = await page.evaluate(() => {
    const found: string[] = [];
    for (const span of document.querySelectorAll<HTMLElement>('label.option > span')) {
      const column = span.closest('.options')?.clientWidth ?? 0;
      const node = span.firstChild;
      if (node?.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent ?? '';
      for (const match of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        if (tops.size <= 1) continue;
        // The word's own width, on one line, in the answer's font.
        const probe = document.createElement('span');
        probe.textContent = match[0];
        probe.style.whiteSpace = 'nowrap';
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        span.append(probe);
        const wider = probe.getBoundingClientRect().width > column;
        probe.remove();
        if (!wider) found.push(match[0]);
      }
    }
    return found;
  });
  expect(broken).toEqual([]);
});

test('offline, woman mode: a contact she adds from who to call is there to call, and on her contacts', async ({
  page,
}) => {
  await onboardOffline(page, 'woman');
  await page.getByRole('banner').getByRole('link', { name: 'Signes de danger' }).click();
  await page.getByText('Saignement par le vagin', { exact: true }).click();
  await page.getByRole('button', { name: "C'est grave maintenant" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await page.getByRole('link', { name: 'Ajouter un contact' }).click();

  await saveContact(page, 'Sage-femme', 'Fatou', '00 00 00 00');

  // Straight back to who to call, the danger and the sign still said, the save said once.
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Allez au poste de santé maintenant.');
  await expect(
    page.getByRole('main').getByText('Contact enregistré : Fatou (Sage-femme).'),
  ).toHaveAttribute('role', 'status');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Saignement par le vagin' }),
  ).toBeVisible();
  const call = page.getByRole('link', { name: 'Appeler Fatou (Sage-femme), 00 00 00 00' });
  await expect(call).toHaveAttribute('href', 'tel:00000000');
  await expect(call).toHaveClass(/button--primary/);
  await expectEmergencyNumbers(page, { primary: false });
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);

  // Her contacts: each number is called from there too.
  await page.getByRole('link', { name: 'Modifier les contacts' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts à appeler' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Appeler Fatou (Sage-femme), 00 00 00 00' }),
  ).toHaveAttribute('href', 'tel:00000000');
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);
});

test('offline, accompanied mode: a contact added on the phone is called from who to call', async ({
  page,
}) => {
  await onboardOffline(page, 'accompanied');
  await page.goto('/#/danger/call');
  await expect(page.getByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
  await page.getByRole('link', { name: 'Ajouter un contact' }).click();

  await saveContact(page, 'Relais', 'Awa', '00 00 00 00');

  // Saved from who to call: back there, to call it.
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
  const call = page.getByRole('link', { name: 'Appeler Awa (Relais), 00 00 00 00' });
  await expect(call).toHaveAttribute('href', 'tel:00000000');
  await expect(page.getByText('00 00 00 00', { exact: true })).toBeVisible();
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);

  // The contacts screen calls each number too.
  await page.getByRole('link', { name: 'Modifier les contacts' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts à appeler' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Appeler Awa (Relais), 00 00 00 00' }),
  ).toHaveAttribute('href', 'tel:00000000');
  await expectNoSeriousViolation(page);
  await expectThumbTargets(page);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();

  // At 200 percent text, nothing scrolls sideways at 360 px.
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const width = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
});
