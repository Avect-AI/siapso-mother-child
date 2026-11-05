#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// The End-to-end job of CI runs in the official Playwright image, so no apt
// mirror is on its way (carry-over of the live test round 2: the system
// libraries took 14 minutes to install on a slow day). The image must hold
// the browsers that the Playwright of app/package.json drives, and it is
// pinned by digest, as the actions are by commit.
//
// Two checks:
// - by default, the workflow: its image tag is the version app/package.json
//   pins, and it is pinned by digest (the unit tests and the job's first step);
// - with --browsers, inside the image once the workspace is installed: the
//   Chromium builds Playwright expects (its browsers.json) are the ones the
//   image holds (/ms-playwright), so a tag moved without its digest, which
//   pulls the image of the old digest, fails here with a plain message
//   instead of "Executable doesn't exist" in every test.
// Usage: node tools/ci/check-playwright-image.mjs [workflow] [package.json]
//        node tools/ci/check-playwright-image.mjs --browsers [browsers folder]
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A Playwright image reference: its version, its Ubuntu name and its digest, when pinned. */
const IMAGE =
  /mcr\.microsoft\.com\/playwright:v(?<version>[^\s@-]+)-(?<distro>[a-z]+)(?:@sha256:(?<digest>[0-9a-f]{64}))?/g;

/** The browsers the end-to-end tests run: Chromium, headed and headless. */
const CHROMIUM = ['chromium', 'chromium-headless-shell'];

/**
 * What is wrong with the Playwright images of `workflow` (the text of a
 * workflow file) for the app package `appPackage` (its parsed package.json):
 * an empty list when every image is the pinned version and pinned by digest.
 */
export function playwrightImageProblems(workflow, appPackage) {
  const wanted = appPackage?.devDependencies?.['@playwright/test'];
  if (typeof wanted !== 'string') return ['app/package.json pins no @playwright/test version'];
  const images = [...workflow.matchAll(IMAGE)];
  if (images.length === 0) return ['the workflow runs no job in the Playwright image'];
  const problems = [];
  for (const image of images) {
    const { version, digest } = image.groups ?? {};
    if (version !== wanted) {
      problems.push(
        `${image[0]} is Playwright ${String(version)}, app/package.json pins ${wanted}: update the tag and its digest`,
      );
    }
    if (digest === undefined) {
      problems.push(`${image[0]} is not pinned by digest (add @sha256:<digest of the tag>)`);
    }
  }
  return problems;
}

/**
 * The folders of the Chromium builds a Playwright expects, from its
 * browsers.json (`chromium-1248`, `chromium_headless_shell-1248`): the names
 * Playwright installs them under.
 */
export function expectedBrowserDirs(browsersJson) {
  return (browsersJson?.browsers ?? [])
    .filter((browser) => CHROMIUM.includes(browser.name))
    .map((browser) => `${browser.name.replace(/-/g, '_')}-${String(browser.revision)}`);
}

/**
 * What is wrong with the browsers an image holds (the names in its browsers
 * folder) for a Playwright's browsers.json: an empty list when every
 * Chromium build it expects is there.
 */
export function browserProblems(browsersJson, installed) {
  const expected = expectedBrowserDirs(browsersJson);
  if (expected.length === 0) return ['the browsers.json of Playwright names no Chromium build'];
  return expected
    .filter((dir) => !installed.includes(dir))
    .map((dir) => {
      const kind = dir.slice(0, dir.lastIndexOf('-'));
      const held = installed.filter((name) => name.startsWith(`${kind}-`));
      return `the image holds ${held.length === 0 ? 'no ' + kind : held.join(', ')}, the Playwright of app/package.json expects ${dir}: the image is of another Playwright (a tag moved without its digest, or the reverse); update the tag and its digest in .github/workflows/ci.yml together`;
    });
}

/**
 * The browsers.json of the Playwright that app/package.json installs, next to
 * the package.json of its playwright-core (the only file of it exported).
 */
export function browsersJsonPath() {
  const app = fileURLToPath(new URL('../../app/package.json', import.meta.url));
  const test = createRequire(app).resolve('@playwright/test/package.json');
  const playwright = createRequire(test).resolve('playwright/package.json');
  const core = createRequire(playwright).resolve('playwright-core/package.json');
  return path.join(path.dirname(core), 'browsers.json');
}

function fail(problems) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--browsers') {
    const folder = args[1] ?? process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/ms-playwright';
    const problems = browserProblems(
      JSON.parse(readFileSync(browsersJsonPath(), 'utf8')),
      readdirSync(folder),
    );
    if (problems.length > 0) fail(problems);
    console.log(`The image holds the Chromium builds Playwright expects (${folder}).`);
    return;
  }
  const [workflowPath = '.github/workflows/ci.yml', packagePath = 'app/package.json'] = args;
  const problems = playwrightImageProblems(
    readFileSync(workflowPath, 'utf8'),
    JSON.parse(readFileSync(packagePath, 'utf8')),
  );
  if (problems.length > 0) fail(problems);
  console.log('The Playwright image of CI is the version app/package.json pins, by digest.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
