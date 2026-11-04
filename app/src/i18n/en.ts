// SPDX-License-Identifier: MIT
// English interface strings, typed from the French dictionary: a missing or
// extra key is a type error. "Replace" is a forbidden word in English, hence
// "does not take the place of" in the closing sentence.
import type { Dictionary } from './fr.js';

export const en: Dictionary = {
  language: {
    fr: 'Français',
    en: 'English',
  },
  welcome: {
    languageTitle: 'Choose your language',
    modeTitle: 'Who is using the app?',
    modeWoman: 'I am pregnant or breastfeeding',
    modeWomanHint: 'For myself',
    modeAccompanied: 'I support women',
    modeAccompaniedHint: 'Relais, Bajenu Gox, health worker, nurse, midwife, depot keeper',
    changeLanguage: 'Change language',
  },
  header: {
    danger: 'Danger signs',
    offline: 'Offline',
  },
  home: {
    title: 'A medicine or a remedy?',
    lead: 'Find out who to show it to, and when.',
    check: 'Look up a product',
    packUnavailable:
      'The product information is not on this phone yet. Open the app once with an internet connection.',
    closing: 'This tool does not take the place of a health worker.',
  },
  danger: {
    title: 'Danger signs',
    condition: 'If you see a danger sign:',
    orientation: 'Go to the health post now.',
    listUnavailable: 'The list of danger signs is not on this phone yet.',
    listEmpty: 'The list of danger signs has not been added yet.',
  },
  settings: {
    unavailable: 'This phone could not keep your settings. You may need to choose again next time.',
  },
  update: {
    ready: 'A new version is ready.',
    reload: 'Update',
  },
};
