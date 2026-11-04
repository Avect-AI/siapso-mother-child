// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { appName } from './src/app-name.js';

const root = fileURLToPath(new URL('.', import.meta.url));

/** A colour from src/styles/tokens.css, so the manifest never drifts from the design. */
function tokenColour(name: string): string {
  const css = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
  const value = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css)?.[1];
  if (value === undefined) throw new Error(`tokens.css has no colour ${name}`);
  return value;
}

/** Fills %APP_NAME% and %THEME_COLOR% in index.html. */
function htmlValues(values: Record<string, string>): Plugin {
  return {
    name: 'siapso-html-values',
    transformIndexHtml: (html) =>
      html.replace(/%(APP_NAME|THEME_COLOR)%/g, (_, key: string) => values[key] ?? ''),
  };
}

export default defineConfig(({ mode }) => {
  const name = appName(loadEnv(mode, root, 'VITE_')['VITE_APP_NAME']);
  const themeColour = tokenColour('--color-primary');
  return {
    plugins: [
      react(),
      htmlValues({ APP_NAME: name, THEME_COLOR: themeColour }),
      VitePWA({
        // A waiting version takes over only when the user accepts the update prompt.
        registerType: 'prompt',
        // main.tsx registers the worker through virtual:pwa-register/react.
        injectRegister: false,
        // start_url and scope are left to vite-plugin-pwa, which sets both to
        // Vite's resolved base (import.meta.env.BASE_URL, `--base` included);
        // with no id, the manifest id is start_url, so all three follow it.
        manifest: {
          name,
          short_name: name,
          lang: 'fr',
          display: 'standalone',
          theme_color: themeColour,
          background_color: tokenColour('--color-bg'),
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // The app shell, its fonts and icons, and the knowledge pack: the
          // manifest and its fragments. pack.json repeats every fragment in
          // one file and the app never reads it, so it is not downloaded twice.
          globPatterns: ['**/*.{html,js,css,woff2,svg,png,webmanifest}', 'pack/*.json'],
          globIgnores: ['pack/pack.json'],
          // Pack fragments grow with the content; a file over the limit would
          // silently be left out of the precache.
          maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});
