// SPDX-License-Identifier: MIT
// Read a prescription in the app (SCRUM-57, phase 3), end to end with the
// real reading pack served by the preview (`pnpm ocr:install-local
// --download` puts it in app/public/ocr/): install on her tap, then offline,
// a synthetic printed prescription (fake names only) through the file
// chooser, the list with nothing ticked, a product confirmed, and the check
// with it. Skipped when the pack is not installed on this machine.
import { existsSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { checkField, onboard } from './support.js';

const PACK = new URL('../public/ocr/ppocrv5-mobile-latin/ocr-pack.json', import.meta.url);

/** Fake content only: no real prescription, no real person (as ocr/bench/bench.spec.ts). */
const SHEET = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
body { margin: 0; background: #fff; }
#sheet { width: 1100px; min-height: 1500px; box-sizing: border-box; padding: 60px 70px; background: #fdfcf7; font: 30px Arial, sans-serif; color: #111; }
h1 { text-align: center; font-size: 40px; letter-spacing: 6px; margin: 30px 0; }
li { margin: 0 0 26px; } .pos { margin-left: 34px; font-size: 27px; }
</style></head><body><div id="sheet">
<div style="text-align:center;line-height:1.4"><b>CENTRE DE SANTÉ DE TEST</b><br>Service de maternité</div>
<h1>ORDONNANCE</h1>
<p>Nom et prénom : Awa Diop &nbsp; Âge : 27 ans</p>
<ol>
<li>Doliprane 1000 mg cp<div class="pos">1 cp x 3/j si douleur</div></li>
<li>Amoxicilline 500 mg gél<div class="pos">2 gél x 3/j pendant 7 jours</div></li>
<li>Fer + Acide folique cp : 1 cp/jour pendant 3 mois</li>
</ol>
<p style="margin-top:120px;text-align:right">Signature et cachet<br>Dr Moussa Test</p>
</div></body></html>`;

/** The synthetic prescription as a PNG, rendered in a page of its own. */
async function scanOf(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
  await page.setContent(SHEET);
  const png = await page.locator('#sheet').screenshot({ type: 'png' });
  await page.close();
  return png;
}

async function startWithProfile(page: Page) {
  await onboard(page, 'woman');
  await page
    .getByRole('group', { name: /^Enceinte/ })
    .getByText('Oui', { exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Terme de la grossesse' })
    .getByText('Je ne sais pas')
    .click();
  await page
    .getByRole('group', { name: /^Allaite/ })
    .getByText('Non', { exact: true })
    .click();
  await page.getByText('Aucune de ces situations').click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(checkField(page)).toBeVisible();
}

test.skip(
  !existsSync(PACK),
  'the reading pack is not installed (pnpm ocr:install-local --download)',
);
test.setTimeout(240_000);

test('reads a synthetic prescription offline: nothing ticked, each product confirmed', async ({
  page,
  context,
  browser,
}) => {
  const scan = await scanOf(browser);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await startWithProfile(page);
  await page.getByRole('button', { name: /^Lire une ordonnance/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lire une ordonnance' })).toBeVisible();

  // Nothing of the pack is asked for before her tap.
  expect(requests.some((url) => url.includes('/ocr/'))).toBe(false);
  await page.getByRole('button', { name: 'Installer le pack' }).click();
  await expect(page.getByRole('button', { name: 'Prendre une photo' })).toBeVisible({
    timeout: 120_000,
  });

  // Offline from here: the reading uses the pack stored on the phone only.
  await context.setOffline(true);
  const before = requests.length;
  await page.getByTestId('prescription-file').setInputFiles({
    name: 'ordonnance.png',
    mimeType: 'image/png',
    buffer: scan,
  });
  await expect(
    page.getByRole('heading', { level: 2, name: "Produits lus sur l'ordonnance" }),
  ).toBeVisible({
    timeout: 120_000,
  });
  const offlineRequests = requests
    .slice(before)
    .filter((url) => !url.startsWith('blob:') && !url.startsWith('data:'));
  expect(
    offlineRequests.filter((url) => !url.includes('/ocr/') && !url.includes('/assets/')),
  ).toEqual([]);

  // Nothing ticked; what was read is quoted; no patient name in the list.
  const boxes = page.getByRole('checkbox');
  expect(await boxes.count()).toBeGreaterThanOrEqual(2);
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
  await expect(page.getByText(/Lu sur l'ordonnance : « 1\. Doliprane 1000 mg cp/)).toBeVisible();
  await expect(page.getByText(/Awa Diop/)).toHaveCount(0);

  // Doliprane ticked, then confirmed with the questions of a name typed.
  await page.getByRole('checkbox', { name: /Doliprane/ }).check();
  await page.getByRole('button', { name: 'Confirmer les produits cochés' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Produit 1 sur 1' })).toBeFocused();
  await page.getByRole('button', { name: /^Oui/ }).first().click();

  // Back on her check, with the product listed and the danger signs question asked first.
  await expect(checkField(page)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Produits ajoutés' })).toContainText(/Doliprane/i);
  await expect(page.getByRole('heading', { level: 2, name: /signes maintenant/ })).toBeVisible();
});
