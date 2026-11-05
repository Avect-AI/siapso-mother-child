// SPDX-License-Identifier: MIT
// Who to call gives the national emergency numbers of the country where the
// phone is used (app/src/config/emergency-numbers.json), found on the phone
// itself, offline: the region of its language first, then its time zone. A
// phone that says no country of the list gets no guessed number: the
// country to choose comes first, and the place to go stays.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  longestDangerInstruction,
  onboard,
  sayInBanner,
  unlock,
  waitForServiceWorkerControl,
} from './support.js';

async function expectNoSeriousViolation(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
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

/** `link` ends within the first screen, without a scroll. */
async function expectInFirstScreen(page: Page, link: ReturnType<Page['locator']>) {
  await expect(link).toBeVisible();
  const fits = await link.evaluate(
    (element) =>
      window.scrollY === 0 && element.getBoundingClientRect().bottom <= window.innerHeight,
  );
  expect(fits).toBe(true);
}

/** The app installed once, then opened offline: the service worker serves it all. */
async function openOffline(page: Page) {
  await page.goto('/');
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
}

const CIRCUIT_LINE = 'Allez au poste de santé ou au centre de santé le plus proche.';

const PHONES = [
  {
    locale: 'fr-SN',
    timezoneId: 'Africa/Dakar',
    country: 'Sénégal',
    calls: [
      { name: 'Appeler le SAMU (1515)', href: 'tel:1515' },
      { name: 'Appeler les pompiers (18)', href: 'tel:18' },
    ],
  },
  {
    locale: 'fr-ML',
    timezoneId: 'Africa/Bamako',
    country: 'Mali',
    calls: [
      { name: 'Appeler les urgences médicales (15)', href: 'tel:15' },
      { name: 'Appeler les pompiers (18)', href: 'tel:18' },
    ],
  },
  {
    locale: 'fr-CI',
    timezoneId: 'Africa/Abidjan',
    country: "Côte d'Ivoire",
    calls: [
      { name: 'Appeler le SAMU (185)', href: 'tel:185' },
      { name: 'Appeler les pompiers (180)', href: 'tel:180' },
    ],
  },
  {
    // The interface stays in French until English is chosen: the numbers follow the phone.
    locale: 'en-GH',
    timezoneId: 'Africa/Accra',
    country: 'Ghana',
    calls: [
      { name: "Appeler le numéro d'urgence (112)", href: 'tel:112' },
      { name: "Appeler le numéro d'urgence (999)", href: 'tel:999' },
    ],
  },
];

for (const phone of PHONES) {
  test.describe(`a phone set to ${phone.locale}`, () => {
    test.use({ locale: phone.locale, timezoneId: phone.timezoneId });

    test('who to call gives the numbers of its country, offline, at first launch', async ({
      page,
    }) => {
      await openOffline(page);
      await page.goto('/#/danger/call');
      await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();

      const links = page.locator('main a[href^="tel:"]');
      await expect(links).toHaveCount(phone.calls.length);
      for (const [index, call] of phone.calls.entries()) {
        await expect(links.nth(index)).toHaveText(call.name);
        await expect(links.nth(index)).toHaveAttribute('href', call.href);
      }
      await expect(links.first()).toHaveClass(/button--primary/);
      await expect(page.getByText(`Pays : ${phone.country}`)).toBeVisible();
      await expect(page.getByRole('link', { name: 'Changer le pays' })).toHaveClass(
        /button--quiet/,
      );
      await expect(page.getByText(CIRCUIT_LINE)).toBeVisible();
      await expectNoSeriousViolation(page);
      await expectThumbTargets(page);
    });
  });
}

test.describe('a phone that says no country of the list', () => {
  // French (Belgium), in Brussels; on a small phone.
  test.use({
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    viewport: { width: 360, height: 560 },
  });

  test('locked and offline: no guessed number, the country to choose first, then its numbers', async ({
    page,
  }) => {
    await onboard(page, 'woman');
    const longest = await longestDangerInstruction(page);
    await waitForServiceWorkerControl(page);
    await page.context().setOffline(true);
    // A reload locks: the danger signs and who to call open without the code.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrez votre code' })).toBeVisible();

    await page.getByRole('banner').getByRole('link', { name: 'Signes de danger' }).click();
    await page.getByText('Saignement par le vagin', { exact: true }).click();
    await page.getByRole('button', { name: "C'est grave maintenant" }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();

    // Never a number of another country.
    await expect(page.locator('main a[href^="tel:"]')).toHaveCount(0);
    await expect(page.getByText("Appelez le numéro d'urgence de votre pays.")).toBeVisible();
    const choose = page.getByRole('link', { name: 'Choisir le pays' });
    await expect(choose).toHaveClass(/button--primary/);
    await expect(page.getByText(CIRCUIT_LINE)).toBeVisible();
    // The first action stays in the first screen whatever the instruction says.
    expect(longest.length).toBeGreaterThan(40);
    await sayInBanner(page, longest);
    await expectInFirstScreen(page, choose);
    await expectNoSeriousViolation(page);
    await expectThumbTargets(page);

    await choose.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dans quel pays êtes-vous ?' }),
    ).toBeVisible();
    await expectNoSeriousViolation(page);
    await expectThumbTargets(page);
    await page.getByRole('searchbox', { name: 'Chercher un pays' }).fill('sene');
    await page.getByRole('button', { name: 'Sénégal' }).click();

    // Back on the same who to call: the danger and the sign kept, the numbers of Senegal.
    await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    const samu = page.getByRole('link', { name: 'Appeler le SAMU (1515)' });
    await expect(samu).toHaveAttribute('href', 'tel:1515');
    await expect(samu).toHaveClass(/button--primary/);
    await expect(page.getByText('Pays : Sénégal')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Allez au poste de santé maintenant.');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Saignement par le vagin' }),
    ).toBeVisible();

    // Kept on the phone: after a reload, locked and still offline, the same numbers.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Appeler le SAMU (1515)' })).toBeVisible();
    await expect(page.getByText('Pays : Sénégal')).toBeVisible();
    // And after the code too.
    await page.goto('/#/');
    await unlock(page);
    await page.goto('/#/danger/call');
    await expect(page.getByRole('link', { name: 'Appeler le SAMU (1515)' })).toBeVisible();
  });
});
