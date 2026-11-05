// SPDX-License-Identifier: MIT
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // No version floor in unit tests: the loader tests pass their own (vite.config.ts
  // sets the version of the built pack for a real build).
  define: { __MIN_PACK_VERSION__: 'null', __MIN_SAFE_PACK_VERSION__: 'null' },
  test: {
    name: 'app',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
