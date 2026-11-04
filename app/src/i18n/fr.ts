// SPDX-License-Identifier: MIT
// French interface strings. The English dictionary is typed from this one, so
// a key missing from or added to en.ts fails type checking. French puts a
// no-break space (U+00A0) before "?" and ":".

export const fr = {
  language: {
    fr: 'Français',
    en: 'English',
  },
  welcome: {
    languageTitle: 'Choisissez votre langue',
    modeTitle: "Qui utilise l'application ?",
    modeWoman: "Je suis enceinte ou j'allaite",
    modeWomanHint: 'Pour moi-même',
    modeAccompanied: "J'accompagne des femmes",
    modeAccompaniedHint: 'Relais, Bajenu Gox, agent de santé, ICP, sage-femme, dépositaire',
    changeLanguage: 'Changer de langue',
  },
  header: {
    danger: 'Signes de danger',
    offline: 'Hors ligne',
  },
  home: {
    title: 'Un médicament ou un remède ?',
    lead: 'Sachez à qui le montrer, et quand.',
    // Never "vérifier": the tool flags and refers, it does not verify.
    check: 'Regarder un produit',
    packUnavailable:
      "Les informations sur les produits ne sont pas encore sur ce téléphone. Ouvrez l'application une fois avec Internet.",
    closing: 'Cet outil ne remplace pas un soignant.',
  },
  danger: {
    title: 'Signes de danger',
    condition: 'Si vous voyez un signe de danger :',
    orientation: 'Allez au poste de santé maintenant.',
    // No pack could be loaded on this phone.
    listUnavailable: "La liste des signes de danger n'est pas encore sur ce téléphone.",
    // A pack is loaded but lists no danger sign.
    listEmpty: "La liste des signes de danger n'a pas encore été ajoutée.",
  },
  settings: {
    unavailable:
      "Ce téléphone n'a pas pu garder vos réglages. Vos choix seront peut-être à refaire.",
  },
  update: {
    ready: 'Une nouvelle version est prête.',
    // Not "Recharger": in Senegal it reads as buying phone credit.
    reload: 'Mettre à jour',
  },
};

/** The shape every dictionary has: the same keys as French, each a string. */
export type Dictionary = typeof fr;
