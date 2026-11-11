// SPDX-License-Identifier: MIT
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist',
      '**/dist-demo',
      '**/coverage',
      '.claude/**',
      '.superpowers/**',
      // Pre-publication audit cache (git-ignored, tools/release/audit.sh).
      '.cache/**',
      'app/public/pack/**',
      // Voice pack conversion: Python venv and converted files (git-ignored).
      'app/public/voice/**',
      // Prescription reading pack (git-ignored, pnpm ocr:install-local).
      'app/public/ocr/**',
      // Android project: the web build copied by cap sync, and Gradle outputs.
      'app/android/**',
      'speech/convert/.venv/**',
      'speech/convert/out/**',
      '**/playwright-report',
      '**/test-results',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
);
