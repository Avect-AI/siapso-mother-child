// SPDX-License-Identifier: MIT
// Smoke test of the Android app (CI job "Android APK", docs/android.md): on a
// running emulator or a phone with USB debugging, installs the APK, turns on
// airplane mode, starts the app and checks through its WebView that it opens
// offline from the first launch, with its knowledge pack and the danger signs.
// It also reports whether the service worker controls the page and the page is
// cross-origin isolated (several threads for the speech model).
// Usage: node app/scripts/android-smoke.mjs <app.apk> <output folder>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _android as android } from '@playwright/test';

const [apk, out = 'android-smoke'] = process.argv.slice(2);
if (apk === undefined) throw new Error('usage: android-smoke.mjs <app.apk> [output folder]');
const PACKAGE = 'com.avectai.siapso';
// The app speaks the language of the phone: French or English.
const WELCOME = /Qui utilise l'application \?|Who is using the app\?/;
const DANGER_SIGNS = /Signes de danger|Danger signs/;
const GO_NOW = /Allez au poste de santé maintenant|Go to the health post now/;

await mkdir(out, { recursive: true });
const report = { checks: {}, facts: {} };
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  console.log(
    `${ok ? 'ok' : 'FAIL'}: ${name}${detail === undefined ? '' : ` (${String(detail)})`}`,
  );
};

const [device] = await android.devices();
if (device === undefined) throw new Error('no Android device: start an emulator or plug a phone');
console.log(`device: ${device.model()} ${device.serial()}`);
try {
  await device.installApk(apk);
  // Airplane mode: the app must not need the network at its first launch.
  await device.shell('cmd connectivity airplane-mode enable');
  await device.shell('svc wifi disable');
  await device.shell('svc data disable');
  const network = (await device.shell('ping -c 1 -W 2 8.8.8.8 || true')).toString();
  check('the phone has no network', !network.includes(' 0% packet loss'));

  const start = async () => {
    await device.shell(`am force-stop ${PACKAGE}`);
    await device.shell(`am start -W -n ${PACKAGE}/.MainActivity`);
    const webview = await device.webView({ pkg: PACKAGE }, { timeout: 60_000 });
    return webview.page();
  };

  let page = await start();
  await page.getByText(WELCOME).waitFor({ timeout: 60_000 });
  check('the welcome opens offline at the first launch', true);
  await device.screenshot({ path: path.join(out, '1-welcome.png') });

  const facts = () =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      const answers = async (url) => {
        try {
          return (await fetch(url, { cache: 'no-store' })).ok;
        } catch {
          return false;
        }
      };
      return {
        url: globalThis.location.href,
        online: navigator.onLine,
        secureContext: globalThis.isSecureContext,
        crossOriginIsolated: globalThis.crossOriginIsolated,
        serviceWorkerActive: registration?.active?.state ?? null,
        serviceWorkerControls: navigator.serviceWorker?.controller !== null,
        knowledgePack: await answers('/pack/manifest.json'),
        prescriptionPack: await answers('/ocr/ppocrv5-mobile-latin/ocr-pack.json'),
        webView: navigator.userAgent,
      };
    });

  report.facts.firstLaunch = await facts();
  check('a secure context (WebCrypto, storage)', report.facts.firstLaunch.secureContext);
  check('the knowledge pack is in the app', report.facts.firstLaunch.knowledgePack);
  check('the prescription reading pack is in the app', report.facts.firstLaunch.prescriptionPack);

  // The danger signs are reachable from every screen, before any profile.
  await page.getByText(DANGER_SIGNS).first().click();
  await page.getByText(GO_NOW).first().waitFor({ timeout: 30_000 });
  check('the danger signs open offline', true);
  await device.screenshot({ path: path.join(out, '2-danger-signs.png') });

  // A second launch, still offline: the service worker may now control the page.
  page = await start();
  await page.getByText(WELCOME).waitFor({ timeout: 60_000 });
  report.facts.secondLaunch = await facts();
  check('the app opens again offline', true);
  console.log(
    `service worker controls the page: ${String(report.facts.secondLaunch.serviceWorkerControls)}`,
  );
  console.log(`cross-origin isolated: ${String(report.facts.secondLaunch.crossOriginIsolated)}`);
  console.log(`WebView: ${report.facts.secondLaunch.webView}`);
  await device.screenshot({ path: path.join(out, '3-second-launch.png') });
} catch (error) {
  check('the smoke test ran to its end', false, error instanceof Error ? error.message : error);
  await device.screenshot({ path: path.join(out, 'failure.png') }).catch(() => undefined);
} finally {
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await device.shell('cmd connectivity airplane-mode disable').catch(() => undefined);
  await device.close();
}

const failed = Object.entries(report.checks).filter(([, c]) => !c.ok);
if (failed.length > 0) {
  console.error(`${String(failed.length)} check(s) failed: ${failed.map(([n]) => n).join(', ')}`);
  process.exit(1);
}
console.log('All checks passed.');
