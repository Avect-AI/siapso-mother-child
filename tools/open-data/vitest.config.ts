// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'open-data', include: ['test/**/*.test.ts'] },
});
