// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'pack-tools', include: ['test/**/*.test.ts'] },
});
