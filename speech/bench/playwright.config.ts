// SPDX-License-Identifier: MIT
// The speech bench (`pnpm voice:bench`): not part of `pnpm e2e` or CI. It needs
// the converted pack in app/public/voice/ (`pnpm voice:convert` then
// `pnpm voice:install-local`). BENCH_PORT sets the preview port (default 4180).
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['BENCH_PORT'] ?? 4180);

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
