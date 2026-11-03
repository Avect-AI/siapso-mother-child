// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'resolver', include: ['test/**/*.test.ts'] },
});
