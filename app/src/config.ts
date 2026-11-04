// SPDX-License-Identifier: MIT
import { appName } from './app-name.js';

/** The app name, from VITE_APP_NAME at build time ("Carnet" by default). */
export const APP_NAME = appName(import.meta.env.VITE_APP_NAME);
