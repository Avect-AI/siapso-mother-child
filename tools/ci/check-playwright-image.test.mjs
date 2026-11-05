// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  browserProblems,
  browsersJsonPath,
  expectedBrowserDirs,
  playwrightImageProblems,
} from './check-playwright-image.mjs';

const DIGEST = 'a'.repeat(64);
const app = { devDependencies: { '@playwright/test': '1.64.1' } };

function workflow(image) {
  return `jobs:\n  e2e:\n    container:\n      image: ${image}\n`;
}

describe('playwrightImageProblems', () => {
  it('accepts the image of the pinned version, pinned by digest', () => {
    expect(
      playwrightImageProblems(
        workflow(`mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${DIGEST}`),
        app,
      ),
    ).toEqual([]);
  });

  it('refuses an image of another version than app/package.json pins', () => {
    const problems = playwrightImageProblems(
      workflow(`mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${DIGEST}`),
      app,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/1\.63\.0.*1\.64\.1/);
  });

  it('refuses an image pinned by tag only', () => {
    expect(
      playwrightImageProblems(workflow('mcr.microsoft.com/playwright:v1.64.1-noble'), app),
    ).toEqual([expect.stringMatching(/not pinned by digest/)]);
  });

  it('refuses a workflow with no Playwright image, and an app with no Playwright', () => {
    expect(playwrightImageProblems('jobs: {}\n', app)).toEqual([
      expect.stringMatching(/no job in the Playwright image/),
    ]);
    expect(playwrightImageProblems(workflow('x'), { devDependencies: {} })).toEqual([
      expect.stringMatching(/pins no @playwright\/test/),
    ]);
  });
});

const browsers = {
  browsers: [
    { name: 'chromium', revision: '1248' },
    { name: 'chromium-headless-shell', revision: '1248' },
    { name: 'firefox', revision: '1555' },
  ],
};

describe('browserProblems (review of #58)', () => {
  it('names the folders of the Chromium builds that Playwright expects', () => {
    expect(expectedBrowserDirs(browsers)).toEqual([
      'chromium-1248',
      'chromium_headless_shell-1248',
    ]);
  });

  it('accepts an image that holds them', () => {
    expect(
      browserProblems(browsers, ['chromium-1248', 'chromium_headless_shell-1248', 'ffmpeg-1013']),
    ).toEqual([]);
  });

  it('refuses an image of another Playwright, saying what it holds and what is expected', () => {
    // A tag moved without its digest: the image of the old digest is pulled.
    const problems = browserProblems(browsers, ['chromium-1240', 'chromium_headless_shell-1240']);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/chromium-1248/);
    expect(problems[0]).toMatch(/chromium-1240/);
    expect(problems[0]).toMatch(/digest/);
  });

  it('refuses an empty browsers folder, and a Playwright with no Chromium', () => {
    expect(browserProblems(browsers, [])).toHaveLength(2);
    expect(browserProblems({ browsers: [] }, ['chromium-1248'])).toEqual([
      expect.stringMatching(/no Chromium/),
    ]);
  });

  it('finds the browsers.json of the Playwright the app installs', () => {
    const found = JSON.parse(readFileSync(browsersJsonPath(), 'utf8'));
    expect(expectedBrowserDirs(found)).toHaveLength(2);
  });
});

describe('the CI workflow', () => {
  it('is pinned to the Playwright of app/package.json', () => {
    const root = new URL('../../', import.meta.url);
    expect(
      playwrightImageProblems(
        readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8'),
        JSON.parse(readFileSync(new URL('app/package.json', root), 'utf8')),
      ),
    ).toEqual([]);
  });
});
