// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // No version floor in unit tests: the loader tests pass their own (vite.config.ts
  // sets the version of the built pack for a real build).
  define: { __MIN_PACK_VERSION__: 'null', __MIN_SAFE_PACK_VERSION__: 'null' },
  resolve: {
    alias: {
      // A virtual module of vite-plugin-pwa, absent outside a build.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwa-register.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'app',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
