// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
