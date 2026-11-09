// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'ocr', include: ['test/**/*.test.ts'] },
});
