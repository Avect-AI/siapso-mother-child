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
  check: {
    // Woman mode: what she takes herself; accompanied mode: what the woman takes.
    titleWoman: 'Ce que vous prenez',
    titleAccompanied: "Ce qu'elle prend",
    lead: 'Ajoutez chaque médicament et chaque remède, un par un.',
    profile: 'Profil : {name}',
    listLabel: 'Produits ajoutés',
    empty: "Rien n'est encore ajouté. Ajoutez au moins un produit pour voir le résultat.",
    addMedicine: 'Ajouter un médicament',
    addRemedy: 'Ajouter un remède',
    seeResult: 'Voir le résultat',
    // Taken off the list being looked at, never off the treatment.
    remove: 'Retirer',
    removeNamed: 'Retirer {name} de la liste',
    added: '{name} est ajouté à la liste.',
    already: '{name} est déjà dans la liste.',
    updated: '{name} est mis à jour dans la liste.',
    removed: '{name} est retiré de la liste.',
    putBack: 'Remettre dans la liste',
    restored: '{name} est remis dans la liste.',
    unitsOne: '1 unité par jour',
    unitsMany: '{units} unités par jour',
    notRecognised: 'Produit non reconnu',
    notRecognisedPlant: 'Remède non reconnu',
    // "Je ne sais pas" was answered to the strength question.
    strengthUnknown: 'Dosage non connu',
  },
  search: {
    titleProduct: 'Ajouter un médicament',
    titlePlant: 'Ajouter un remède',
    fieldProduct: 'Nom du médicament',
    fieldPlant: 'Nom du remède',
    // A strength typed with the name is the one chosen on the confirm screen.
    hintProduct: 'Le nom et le dosage écrits sur la boîte, même avec des fautes.',
    hintPlant: 'En français ou en wolof, même avec des fautes.',
    // Read by a screen reader before `found`: the list itself shows the names.
    foundOne: 'Une proposition : {name}.',
    foundMany: '{count} propositions, la première : {name}.',
    found: 'Choisissez celui qui correspond.',
    noneFound: 'Aucun produit ne correspond à ce nom.',
    noneFoundPlant: 'Aucun remède ne correspond à ce nom.',
    localName: 'Nom local : {name} ({lang})',
    notFound: 'Je ne trouve pas ce produit',
    notFoundPlant: 'Je ne trouve pas ce remède',
    notFoundHint: "Il sera ajouté tel qu'il est écrit, comme produit non reconnu.",
    notFoundHintPlant: "Il sera ajouté tel qu'il est écrit, comme remède non reconnu.",
    candidatesLabel: 'Propositions',
    // A name typed in the other list: one tap to look there.
    otherKindPlant: 'Ce nom correspond à un remède.',
    otherKindProduct: 'Ce nom correspond à un médicament.',
    searchPlants: 'Chercher parmi les remèdes',
    searchProducts: 'Chercher parmi les médicaments',
  },
  // The language of a local name, after the name.
  nameLang: {
    fr: 'français',
    en: 'anglais',
    wo: 'wolof',
  },
  confirm: {
    titleProduct: 'Est-ce bien ce produit ?',
    titlePlant: 'Est-ce bien ce remède ?',
    strength: 'Quel dosage est écrit sur la boîte ?',
    strengthHint: 'Sur la boîte ou sur la plaquette : le nombre suivi de mg.',
    dontKnow: 'Je ne sais pas',
    chooseStrength: 'Choisissez un dosage, ou « Je ne sais pas ».',
    units: "Combien d'unités par jour ?",
    unitsHint:
      'Par exemple, le nombre de comprimés, de sachets ou de suppositoires pris en un jour. Laissez vide si vous ne savez pas.',
    unitsLess: 'Une unité de moins',
    unitsMore: 'Une unité de plus',
    unitsBlank: 'Nombre non connu',
    unitsError: 'Écrivez un nombre entier de 1 à 24, ou laissez vide.',
    adding: 'Vous ajoutez : {name}',
    yesProduct: "Oui, c'est ce produit",
    yesPlant: "Oui, c'est ce remède",
    no: 'Non, chercher encore',
    // The product chosen is already in the check: never listed twice. Names the listed product.
    alreadyNamed: '{name} est déjà dans la liste.',
    changeUnits: 'Changer les unités par jour',
    backToList: 'Revenir à la liste',
    // "Je ne sais pas" while the family is listed with a known strength.
    sameBox: 'Est-ce la même boîte que {name} ?',
    sameBoxMany: "Est-ce la même boîte qu'un produit déjà dans la liste ?",
    sameBoxYes: 'Oui, la même',
    sameBoxYesNamed: 'Oui, la même que {name}',
    sameBoxNo: 'Non, une autre boîte',
    sameBoxError: "Dites si c'est la même boîte.",
    // A known strength chosen while the family is listed without one.
    takesPlace: '{name} est dans la liste sans dosage : ce produit prend sa place.',
    missing: "Ce produit n'est pas sur ce téléphone. Cherchez encore.",
  },
  result: {
    title: 'Résultat',
    items: 'Produits regardés',
    failed: "Le résultat n'a pas pu être donné. Revenez à la liste.",
  },
  // Level names (DESIGN.md, Levels): always shown with their pictogram.
  level: {
    danger: 'Signe de danger',
    'before-next-dose': 'À montrer avant la prochaine prise',
    'next-contact': 'À signaler au prochain contact',
    unknown: 'On ne sait pas',
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
