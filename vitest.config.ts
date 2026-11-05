// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['engine', 'resolver', 'speech', 'app', 'tools/*', 'server'],
    coverage: {
      provider: 'v8',
      include: ['engine/src/**', 'resolver/src/**', 'speech/src/**', 'app/src/**'],
      exclude: ['**/*.test.{ts,tsx}', 'app/src/test/**', 'app/src/main.tsx'],
      thresholds: {
        'engine/src/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
