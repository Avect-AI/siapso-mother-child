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
    // The quick exit: locks at once and shows the neutral screen.
    quickExit: 'Quitter',
  },
  // The code that opens the profiles on a shared phone (spec section 2, Codes).
  code: {
    title: 'Entrez votre code',
    label: 'Code',
    open: 'Ouvrir',
    opening: 'Ouverture en cours.',
    wrong: "Ce n'est pas le bon code.",
    triesLeft: 'Encore {count} essais avant une attente.',
    lastTry: 'Encore 1 essai avant une attente.',
    waitSeconds: "Trop d'essais. Attendez {count} secondes, puis essayez encore.",
    waitMinutes: "Trop d'essais. Attendez {count} minutes, puis essayez encore.",
    waitHours: "Trop d'essais. Attendez {count} heures, puis essayez encore.",
    // Said once to a screen reader when a wait is over.
    tryAgain: 'Vous pouvez essayer à nouveau.',
    unavailable:
      "Le code n'a pas pu être lu sur ce téléphone. Fermez l'application, puis rouvrez-la.",
    keypad: 'Clavier du code',
    erase: 'Effacer',
    // Said to a screen reader as the keys on the screen are tapped.
    digitsNone: 'Aucun chiffre',
    digitsOne: '1 chiffre',
    digits: '{count} chiffres',
    createTitle: 'Choisissez un code',
    createLeadWoman: 'Ce code ouvre votre profil sur ce téléphone.',
    createLeadAccompanied: 'Ce code ouvre les profils des femmes que vous suivez.',
    createHintWoman:
      "De 4 à 6 chiffres. Gardez-le pour vous : sans lui, votre profil ne s'ouvre pas.",
    createHintAccompanied:
      "De 4 à 6 chiffres. Gardez-le pour vous : sans lui, les profils ne s'ouvrent pas.",
    // The field of the second typing: what a screen reader hears when it takes the focus.
    confirmLabel: 'Le même code',
    confirmTitle: 'Tapez le code une deuxième fois',
    next: 'Continuer',
    save: 'Enregistrer le code',
    saving: 'Le code se prépare.',
    invalid: 'Écrivez de 4 à 6 chiffres.',
    mismatch: 'Les deux codes ne sont pas les mêmes. Choisissez un code à nouveau.',
    changeMode: 'Changer de mode',
  },
  home: {
    title: 'Un médicament ou un remède ?',
    lead: 'Sachez à qui le montrer, et quand.',
    // Never "vérifier": the tool flags and refers, it does not verify.
    check: 'Regarder un produit',
    packUnavailable:
      "Les informations sur les produits ne sont pas encore sur ce téléphone. Ouvrez l'application une fois avec Internet.",
    closing: 'Cet outil ne remplace pas un soignant.',
    // Woman mode: her one profile (accompanied mode opens on the list of profiles).
    profileMine: 'Mon profil',
    settings: 'Réglages',
    profileSaved: 'Profil enregistré : {name}.',
  },
  // A forgotten code: the only way is to erase the profiles of this phone,
  // typed word then a last yes. Never red: it is not a danger sign.
  forgot: {
    link: "J'ai oublié le code",
    title: 'Code oublié',
    lead: "Sans le code, la seule solution est d'effacer les profils enregistrés sur ce téléphone, avec leur historique et les contacts enregistrés. La langue et les informations sur les produits restent.",
    word: 'EFFACER',
    wordLabel: 'Pour continuer, écrivez EFFACER',
    wordError: 'Écrivez EFFACER pour continuer, ou revenez au code.',
    next: 'Continuer',
    confirmTitle: 'Tout effacer maintenant ?',
    confirmLead:
      'Les profils, leur historique et les contacts de ce téléphone seront effacés. Cela ne peut pas être annulé.',
    erase: 'Effacer les profils',
    erasing: 'Effacement en cours.',
    failed: "Les profils n'ont pas pu être effacés sur ce téléphone. Essayez encore.",
    back: 'Revenir au code',
  },
  // Accompanied mode: the women followed, by pseudonym, after the code.
  profiles: {
    title: 'Profils',
    lead: 'Choisissez une femme pour regarder un produit.',
    listLabel: 'Profils enregistrés sur ce téléphone',
    loading: 'Les profils se chargent.',
    empty: 'Aucun profil sur ce téléphone pour le moment.',
    add: 'Ajouter un profil',
    edit: 'Modifier',
    editNamed: 'Modifier le profil de {name}',
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
    // Accompanied mode: the question is about the woman, as "Ce qu'elle prend".
    monthsAccompanied: 'Dans quel mois de grossesse est-elle ? (le mois en cours, du 1er au 9e)',
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
    // The name she typed, when the product is shown under another name (Cytotec, Misoprostol).
    writtenAs: 'Vous avez écrit : {text}',
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
    // The brand a candidate was found by, when its name shown does not say it ("cytotek").
    boxName: 'Nom sur la boîte : {name}',
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
    // The length of the name typed, shown near the limit of the field.
    limit: '{count} caractères sur {max}',
    limitReached: "{max} caractères au plus : la suite ne s'écrit pas.",
    // "Je ne trouve pas" while the name looks like products or remedies of either list.
    lookalikeTitle: 'Ce nom ressemble à :',
    // The question asked before a name is added as typed, following the lists it shows.
    lookalikeAskProduct: "Est-ce l'un de ces médicaments ?",
    lookalikeAskPlant: "Est-ce l'un de ces remèdes ?",
    lookalikeAskBoth: "Est-ce l'un de ces médicaments ou remèdes ?",
    noneOfTheseProduct: 'Non, aucun de ces médicaments',
    noneOfThesePlant: 'Non, aucun de ces remèdes',
    noneOfTheseBoth: 'Non, aucun de ces produits',
    // What "none of these" does: the result still counts a name that looks very much like one.
    noneOfTheseHint:
      "Le nom sera ajouté tel qu'il est écrit. S'il ressemble beaucoup à l'un d'eux, le résultat en tiendra compte aussi.",
    kindProduct: 'Médicament',
    kindPlant: 'Remède',
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
    // A known strength chosen while the family is listed without one, and she said it is the same box.
    takesPlace: '{name}, dosage non connu, devient {product} dans la liste.',
    missing: "Ce produit n'est pas sur ce téléphone. Cherchez encore.",
    // The name typed names a substance the product chosen does not have ("efferalgan codéine").
    missingSubstances:
      "{substances} : ce produit n'en contient pas. Comparez avec le nom sur la boîte.",
  },
  result: {
    title: 'Résultat',
    // Accompanied mode: the profile's pseudonym, never a real name.
    titleFor: 'Résultat pour {name}',
    loading: 'Le résultat se prépare.',
    failed: "Le résultat n'a pas pu être donné. Revenez à la liste.",
    profileMissing: "Ce profil n'est plus sur ce téléphone. Revenez à la liste.",
    // The overview of the cards, most urgent first, when there are several.
    summary: 'Résumé',
    // Default orientation of each level (spec section 10), when a message gives none.
    orientation: {
      danger: 'Allez au poste de santé maintenant.',
      'before-next-dose':
        "Montrez ce produit à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
      'next-contact': 'Dites-le à la sage-femme à la prochaine visite.',
      // Who and when (PRODUCT.md principle 2), in words that suit both modes.
      unknown: 'Montrez-le à la sage-femme ou au pharmacien à la prochaine visite.',
    },
    // The level name of a danger that comes from a product rule, not from a
    // danger sign (DESIGN.md, Levels): a product is never called a sign.
    dangerProductLevel: 'Danger : à montrer maintenant',
    // A situation ticked in the profile that no rule of the knowledge base reads.
    conditionNote:
      '{situation} : notre base ne tient pas encore compte de cette situation, et ce résultat non plus. Ajoutez à la liste chaque médicament pris pour ce traitement ou cette maladie : il sera regardé comme les autres.',
    conditionOrientation: 'Parlez-en à la sage-femme ou au médecin à la prochaine visite.',
    // The heading of those notes, said before the cards.
    situations: 'Situations non prises en compte',
    // "On ne sait pas" without an orientation of its own: these come first (spec section 10),
    // each unless what the card has just said contains its phrase (unknownSaid, lowercase).
    unknown: {
      noInformation: "Nous n'avons pas d'information fiable.",
      notRiskFree: "Cela ne veut pas dire que c'est sans risque.",
    },
    unknownSaid: {
      noInformation: "pas d'information fiable",
      notRiskFree: 'ne veut pas dire',
    },
    // Before the next dose, for a finding about several products (a duplicate, an interaction).
    orientationProducts:
      "Montrez ces produits à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
    // The danger banner's action: the referral circuit on the danger signs screen.
    dangerAction: 'Voir qui appeler',
    // After the first sentence of "nothing found" (spec section 2).
    versionInline: '(version {version} du {date})',
    // A name typed as not recognised that looks like a product or remedy of the base.
    possibleProduct: "Ce nom ressemble à {name}. Si c'est ce produit :",
    possiblePlant: "Ce nom ressemble à {name}. Si c'est ce remède :",
    // The grey card of the name typed, read after its possible match.
    possibleNotProduct: "Si ce n'est pas ce produit :",
    possibleNotPlant: "Si ce n'est pas ce remède :",
    resembles: 'ressemble à {name}',
    term: {
      estimated: 'Terme estimé : ce résultat tient compte de toutes les semaines possibles.',
      unknown: 'Terme inconnu : ce résultat tient compte de toute la grossesse.',
    },
    // Accompanied mode: the evidence level and the wording it sets (knowledge/README.md).
    // The wording in quotes: it is how the messages of that level are written.
    evidence: 'Niveau de preuve {level} : « {wording} »',
    evidenceWording: {
      A: 'peut provoquer',
      B: 'une étude chez des volontaires a montré',
      // Case reports or observational studies: not always serious cases.
      C: 'des cas ont été rapportés ou observés',
      D: "des tests en laboratoire suggèrent, ce n'est pas prouvé chez la femme",
      E: "c'est possible, mais cela n'a pas été étudié",
      '0': "pas d'information fiable",
    },
    capped: 'Niveau limité parce que la preuve est faible.',
    sources: 'Sources :',
    // Said after a source link, for a screen reader.
    newWindow: "(s'ouvre dans une autre fenêtre)",
    rule: 'Règle : {id}',
    rules: 'Règles : {ids}',
    notes: 'À noter aussi',
    reminders: 'Rappels',
    noChange: 'Ne changez rien à votre traitement sans en parler à un professionnel.',
    version: 'Base de connaissances {version} du {date}',
    notValidated: "Contenu non validé cliniquement : ne l'utilisez pas seul pour décider.",
    closing: 'Cet outil ne remplace pas un soignant.',
    // The check is kept: a forgotten product can still be added.
    backToList: 'Revenir à la liste',
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
    // The list to choose from: one or more signs seen now, then "C'est grave maintenant".
    question: 'Quels signes voyez-vous maintenant ?',
    hint: 'Cochez les signes que vous voyez, pour les dire quand vous appelez.',
    group: {
      pregnancy: 'Pendant la grossesse',
      postpartum: "Après l'accouchement",
      baby: 'Chez le bébé',
    },
    now: "C'est grave maintenant",
    // Straight to who to call, without choosing a sign (one missing from the list).
    call: 'Voir qui appeler',
  },
  // Who to call: the referral circuit. The app only opens the phone's dialler:
  // it never sends anything and never says that someone knows or is coming.
  call: {
    title: 'Qui appeler',
    signsLabel: 'Dites ces signes au téléphone ou au poste de santé :',
    contactsLabel: 'Contacts à appeler',
    loading: 'Les contacts se chargent.',
    none: 'Aucun contact enregistré sur ce téléphone.',
    savedUnavailable:
      "Les contacts de ce téléphone n'ont pas pu être lus. Fermez l'application, puis rouvrez-la.",
    // The link that opens the phone's dialler; who and the number follow for a screen reader.
    dial: 'Appeler',
    dialWho: '{who}, {phone}',
    add: 'Ajouter un contact',
    manage: 'Modifier les contacts',
    circuit: 'Circuit de référence',
    // The built-in line said with the emergency numbers (config/emergency.ts); always shown, the deployment's circuit text under it.
    emergencyCircuit: 'Allez au poste de santé ou au centre de santé le plus proche.',
    emergencyLabel: "Numéros d'urgence",
    // The link that dials a public emergency number: the service named in the sentence, then the number.
    emergencyDial: 'Appeler {service} ({phone})',
    services: {
      samu: 'le SAMU',
      firefighters: 'les pompiers',
    },
    // Before the code: the contacts kept on the phone are not shown, and
    // nothing says whether there are any.
    locked:
      'Si des contacts sont enregistrés sur ce téléphone, ils apparaissent une fois le code entré.',
    enterCode: 'Entrer le code',
  },
  contacts: {
    title: 'Contacts à appeler',
    lead: 'Ces numéros restent sur ce téléphone.',
    listLabel: 'Contacts enregistrés sur ce téléphone',
    add: 'Ajouter un contact',
    edit: 'Modifier',
    editNamed: 'Modifier {who}',
    // Taken off the phone's list of contacts.
    remove: 'Retirer',
    removeNamed: 'Retirer {who}',
    removed: '{who} est retiré des contacts.',
    putBack: 'Remettre dans les contacts',
    restored: '{who} est remis dans les contacts.',
    saved: 'Contact enregistré : {who}.',
    provided: "Contacts fournis avec l'application",
    providedHint: 'Ils ne se modifient pas ici.',
    loadFailed:
      "Les contacts n'ont pas pu être lus sur ce téléphone. Fermez l'application, puis rouvrez-la.",
    saveFailed: "Les contacts n'ont pas pu être enregistrés sur ce téléphone. Essayez encore.",
    missing: "Ce contact n'est plus sur ce téléphone. Revenez aux contacts.",
    titleNew: 'Nouveau contact',
    titleEdit: 'Modifier le contact',
    role: 'Rôle',
    name: 'Nom',
    nameHint: 'Facultatif.',
    phone: 'Numéro de téléphone',
    phoneHint:
      'Des chiffres, avec des espaces si vous voulez, et un + au début pour un numéro international.',
    save: 'Enregistrer',
    // A contact: the name, then the role; the role alone when no name was given.
    who: '{name} ({role})',
    roles: {
      relay: 'Relais',
      'bajenu-gox': 'Bajenu Gox',
      icp: 'Infirmier chef de poste (ICP)',
      midwife: 'Sage-femme',
      other: 'Autre contact',
    },
    error: {
      role: 'Choisissez un rôle.',
      phone: 'Écrivez un numéro de téléphone.',
      phoneFormat:
        'Écrivez de 6 à 15 chiffres, avec des espaces si vous voulez, et un + seulement au début.',
    },
  },
  // Danger signs now, asked once in a check before the result (spec section 7.1, screen 8).
  signs: {
    titleWoman: 'Avez-vous un de ces signes maintenant ?',
    titleAccompanied: 'A-t-elle un de ces signes maintenant ?',
    hint: 'Cochez Aucun de ces signes, ou chaque signe présent maintenant.',
    none: 'Aucun de ces signes',
    showAll: 'Voir tous les signes',
    error: 'Répondez : Aucun de ces signes, ou les signes présents maintenant.',
    loading: 'La liste se prépare.',
    seeResult: 'Voir le résultat',
  },
  settings: {
    unavailable:
      "Ce téléphone n'a pas pu garder vos réglages. Vos choix seront peut-être à refaire.",
    title: 'Réglages',
    language: 'Langue',
    mode: "Qui utilise l'application ?",
    modeHint: 'Changer de mode ne supprime aucune donnée.',
    // Woman mode opens one profile: the first one made. The others stay on the phone.
    modeWomanNote:
      "En mode « Je suis enceinte ou j'allaite », seul le premier profil s'ouvre. Les autres restent sur ce téléphone.",
    changed: 'Réglage enregistré.',
    done: "Revenir à l'accueil",
  },
  // The two links to the status and about screens, on Home, the list of
  // profiles and the settings.
  nav: {
    status: 'Base de connaissances',
    about: 'À propos',
  },
  // The knowledge base: its version, its age, where it came from. Nothing
  // here is about a profile, so it opens before the code.
  status: {
    title: 'Base de connaissances',
    lead: "Ce que l'application connaît des produits et des remèdes, et la date de ces informations.",
    loading: 'La base de connaissances se charge.',
    unavailable:
      "La base de connaissances n'est pas encore sur ce téléphone. Ouvrez l'application une fois avec Internet.",
    contentLabel: 'Contenu de la base',
    version: 'Version',
    date: 'Date de la base',
    dateUnknown: 'Date inconnue',
    rules: 'Règles',
    products: 'Produits',
    remedies: 'Remèdes',
    stale: 'Base périmée : plus de 90 jours. Faites-la mettre à jour au poste de santé.',
    sourceTitle: 'Provenance de cette base',
    fromNetwork: "Cette base est celle chargée avec l'application.",
    fromCopy: 'Cette base est la copie gardée sur ce téléphone.',
    fallback:
      "La base n'a pas pu être chargée avec l'application. La copie gardée sur ce téléphone est utilisée.",
    fallbackRefused:
      'Une nouvelle base a été refusée par ce téléphone. La copie gardée sur ce téléphone est utilisée.',
    rolledBack:
      "La version précédente a été remise sur ce téléphone. Une version plus récente sera prise dès qu'elle sera disponible.",
    reason: 'Détail technique : {reason}',
    notStored:
      "Ce téléphone n'a pas pu garder cette base. Elle marche pour le moment. Ouvrez l'application avec Internet pour qu'elle soit gardée.",
    unsigned: 'Version de test : base de connaissances non signée.',
    rollbackTitle: 'Version précédente',
    rollbackLead:
      'La version {version} est gardée sur ce téléphone. Revenez-y seulement si la base actuelle pose problème.',
    rollbackAction: 'Revenir à la version {version}',
    rollbackConfirm:
      'La base {current} sera retirée de ce téléphone et la version {previous} reprise. Ce téléphone ne reprendra pas la version {current}.',
    rollbackYes: 'Oui, revenir à la version {version}',
    rollbackCancel: 'Annuler',
    rollbackFailed: "Le retour à la version précédente n'a pas marché. La base actuelle reste.",
  },
  // Licences, sources and limits of the tool. The intended use is the
  // paragraph of docs/intended-use.md (English: that text, word for word;
  // French: its translation, kept in step by tools/legal/intended-use.test.mjs).
  about: {
    title: 'À propos',
    intendedUseTitle: "À quoi sert l'application",
    intendedUse:
      "SIAPSO Mother-Child donne des informations générales sur la santé, de l'éducation à la santé et une orientation vers un professionnel de santé aux femmes enceintes et allaitantes au Sénégal et aux personnes qui les accompagnent. Il ne pose pas de diagnostic, ne prescrit pas et ne fixe pas de dose, et il ne remplace pas un professionnel de santé.",
    licencesTitle: 'Licences',
    licenceCode: 'Code : licence MIT.',
    licenceContent: 'Contenus (connaissances et registre) : licence CC BY 4.0.',
    licenceFont: 'Police Atkinson Hyperlegible Next : licence SIL OFL 1.1.',
    sourcesTitle: 'Sources de la base',
    sourcesLead: 'Les sources déclarées par la base de connaissances, avec leur licence.',
    sourcesNone:
      "La base de connaissances n'est pas chargée : les sources ne peuvent pas être listées.",
    sourcesEmpty: 'Cette base ne déclare aucune source.',
    sourceLicence: 'Licence : {licence}',
    sourceVersion: 'Version : {version}',
    newWindow: "(s'ouvre dans une autre fenêtre)",
    thirdPartyTitle: 'Logiciels tiers',
    thirdTransformers:
      'Transformers.js (licence Apache-2.0) : utilisé seulement si le pack vocal est installé.',
    repositoryTitle: 'Code source',
    repositoryPrivate: 'Le dépôt est privé pendant le développement.',
  },
  update: {
    ready: 'Une nouvelle version est prête.',
    // Not "Recharger": in Senegal it reads as buying phone credit.
    reload: 'Mettre à jour',
  },
};

/** The shape every dictionary has: the same keys as French, each a string. */
export type Dictionary = typeof fr;
