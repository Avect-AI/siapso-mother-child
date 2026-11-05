// SPDX-License-Identifier: MIT
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // A phone in the pilot country, whatever the machine: who to call shows
    // the numbers of the country the phone says (src/domain/country.ts).
    // e2e/country.spec.ts sets other phones.
    locale: 'fr-SN',
    timezoneId: 'Africa/Dakar',
  },
  // The tests run on a demo build in app/dist-demo (Vite mode demo: it
  // accepts the unsigned pack of `pnpm knowledge:build`, docs/pack-signing.md),
  // never on a release.
  webServer: {
    command: 'pnpm build:demo && pnpm preview:demo',
    port: 4173,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
