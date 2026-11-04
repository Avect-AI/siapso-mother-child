// SPDX-License-Identifier: MIT
// Shared by vite.config.ts (web app manifest, page title) and the app itself
// (header, welcome screen), so both always show the same name.

/** A neutral name: on a shared phone, the home screen icon says nothing about a pregnancy. */
export const DEFAULT_APP_NAME = 'Carnet';

/** The configured name (VITE_APP_NAME), or the default when it is unset or blank. */
export function appName(configured: string | undefined): string {
  const name = configured?.trim() ?? '';
  return name === '' ? DEFAULT_APP_NAME : name;
}
