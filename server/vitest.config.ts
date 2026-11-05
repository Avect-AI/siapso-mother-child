// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    include: ['test/**/*.test.ts'],
    // The HTTP and socket tests wait on real timers; give them room under CPU load.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
