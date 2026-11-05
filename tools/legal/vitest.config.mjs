// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'legal', include: ['*.test.mjs'] },
});
