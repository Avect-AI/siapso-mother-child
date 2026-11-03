// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'speech', include: ['test/**/*.test.ts'] },
});
