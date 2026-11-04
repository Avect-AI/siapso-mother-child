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
    // Woman mode: her one profile. Accompanied mode: a new one (the list comes with the codes).
    profileMine: 'Mon profil',
    profileNew: 'Nouveau profil',
    profileSaved: 'Profil enregistré : {name}.',
  },
  profile: {
    titleMine: 'Mon profil',
    titleNew: 'Nouveau profil',
    titleEdit: 'Modifier le profil',
    lead: 'Ces réponses restent sur ce téléphone.',
    pseudonym: 'Surnom',
    pseudonymHint: 'Un surnom, jamais le vrai nom.',
    // Filled in for a new profile, so the common case types only the term.
    pseudonymMine: 'Moi',
    pseudonymNumbered: 'Femme {number}',
    yes: 'Oui',
    no: 'Non',
    dontKnow: 'Je ne sais pas',
    pregnant: 'Enceinte ?',
    termQuestion: 'Terme de la grossesse',
    termHint: 'Choisissez ce que vous connaissez.',
    termLmp: 'Date des dernières règles',
    termWeeks: 'En semaines',
    termMonths: 'En mois',
    termUnknown: 'Je ne sais pas',
    lmpDate: 'Premier jour des dernières règles',
    weeks: 'Nombre de semaines',
    weeksHint: "Semaines d'aménorrhée (depuis les dernières règles), de 0 à 42.",
    // The month in progress; the term read back covers "months completed" too.
    months: 'Dans quel mois de grossesse êtes-vous ? (le mois en cours, du 1er au 9e)',
    termShown: 'Terme retenu',
    term: {
      underOne: "Moins d'une semaine",
      one: 'Environ 1 semaine',
      exact: 'Environ {weeks} semaines',
      estimated: 'Entre {min} et {max} semaines (estimé)',
      unknown: 'Terme inconnu',
    },
    termCorrect: 'Corriger le nombre de semaines',
    // The baby's age read back in the weeks the rules use (months are converted).
    babyAgeShown: 'Âge retenu',
    breastfeeding: 'Allaite ?',
    babyAge: 'Âge du bébé',
    babyAgeHint: 'Choisissez ce que vous connaissez.',
    babyBirthDateChoice: 'Date de naissance',
    babyWeeksChoice: 'En semaines',
    babyMonthsChoice: 'En mois',
    babyBirthDate: 'Date de naissance du bébé',
    babyWeeks: 'Âge en semaines',
    babyWeeksHint: 'De 0 à 104.',
    babyMonths: 'Âge en mois',
    babyMonthsHint: 'De 0 à 24.',
    premature: 'Né avant terme (prématuré) ?',
    situations: 'Situations de longue durée',
    situationsHint: 'Cochez ce qui est connu.',
    condition: {
      'hiv-cotrimoxazole': 'VIH, avec cotrimoxazole',
      'tuberculosis-treatment': 'Traitement contre la tuberculose',
      'epilepsy-treatment': "Traitement contre l'épilepsie",
      'uterine-scar': "Ancienne césarienne (cicatrice sur l'utérus)",
      'renal-failure': 'Insuffisance rénale',
      'hepatic-failure': 'Insuffisance hépatique',
      'sickle-cell': 'Drépanocytose',
    },
    noCondition: 'Aucune de ces situations',
    save: 'Enregistrer',
    saveFailed: "Ce profil n'a pas pu être enregistré sur ce téléphone. Essayez encore.",
    loadFailed:
      "Les profils n'ont pas pu être lus sur ce téléphone. Fermez l'application, puis rouvrez-la.",
    notFound: "Ce profil n'est pas sur ce téléphone. Revenez à l'accueil.",
    error: {
      pseudonym: 'Écrivez un surnom.',
      pseudonymNumber: 'Pas de numéro de téléphone : écrivez un surnom.',
      yesNo: 'Répondez oui ou non.',
      choose: 'Choisissez une réponse.',
      date: 'Écrivez une date.',
      dateFuture: "Cette date est après aujourd'hui : choisissez aujourd'hui ou une date passée.",
      lmpTooOld:
        'Cette date remonte à plus de 45 semaines. Choisissez une date plus récente, ou Je ne sais pas.',
      birthTooOld:
        'Cette date remonte à plus de 2 ans. Pour un enfant de plus de 2 ans, choisissez En semaines et écrivez 104.',
      weeksMovedOn:
        "Le terme a avancé depuis qu'il a été noté et dépasse 42 semaines : écrivez le terme d'aujourd'hui, ou choisissez Je ne sais pas.",
      monthsOutdated: "Ce mois a été donné il y a longtemps : écrivez le mois d'aujourd'hui.",
      babyAgeMovedOn:
        "L'âge noté a avancé et dépasse 2 ans : écrivez l'âge d'aujourd'hui. Pour un enfant de plus de 2 ans, choisissez En semaines et écrivez 104.",
      weeks: 'Écrivez un nombre entier de 0 à 42.',
      months: 'Écrivez un nombre entier de 1 à 9.',
      babyWeeks: 'Écrivez un nombre entier de 0 à 104.',
      babyMonths: 'Écrivez un nombre entier de 0 à 24.',
      situations: 'Cochez au moins une case.',
      neither:
        "L'application sert pendant la grossesse et l'allaitement : répondez Oui à au moins une des deux questions.",
    },
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
