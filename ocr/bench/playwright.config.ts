// SPDX-License-Identifier: MIT
// The reading bench (`pnpm ocr:bench`): not part of `pnpm e2e` or CI. It needs
// the pack in app/public/ocr/ (`pnpm ocr:install-local`); without it the test
// is skipped with a message. BENCH_PORT sets the preview port (default 4181).
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['BENCH_PORT'] ?? 4181);

export default defineConfig({
  testDir: '.',
  testMatch: 'bench.spec.ts',
  reporter: 'list',
  workers: 1,
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(port)}` },
  webServer: {
    command: `pnpm exec vite preview --config bench/vite.config.ts --port ${String(port)} --strictPort`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    port,
    reuseExistingServer: false,
  },
});
