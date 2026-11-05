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
  // Whether this phone opens the app without the Internet (Home, the list of
  // profiles, the status screen), whether it keeps the app's data for good,
  // and what needs the Internet.
  offline: {
    ready: 'Prêt sans Internet',
    preparing:
      "Gardez Internet encore un moment : l'application se prépare pour fonctionner sans réseau.",
    unsupported:
      "Ce navigateur ne peut pas garder l'application pour l'ouvrir sans Internet. Ouvrez-la dans Chrome.",
    failed:
      "L'application n'a pas pu se préparer pour fonctionner sans réseau. Rouvrez-la avec Internet.",
    reconnect:
      "Reconnectez Internet : l'application n'a pas fini de se préparer pour fonctionner sans réseau.",
    phoneTitle: 'Sur ce téléphone',
    persistent: "Ce téléphone garde les données de l'application.",
    bestEffort:
      "Les données peuvent être effacées si le téléphone manque de place. Ajoutez l'application à l'écran d'accueil pour aider le téléphone à les garder.",
    linksNeedInternet: "Ces liens s'ouvrent avec Internet.",
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
    // A wait as it is read aloud: "1 min 59 s", never "119 secondes" (30 minutes at most).
    wait: "Trop d'essais. Attendez {time}, puis essayez encore.",
    timeSeconds: '{seconds} s',
    timeMinutes: '{minutes} min',
    timeMinutesSeconds: '{minutes} min {seconds} s',
    // Said to a screen reader in whole words: "1 minute 59 secondes".
    spokenSecond: '1 seconde',
    spokenSeconds: '{seconds} secondes',
    spokenMinute: '1 minute',
    spokenMinutes: '{minutes} minutes',
    // Said once to a screen reader when a wait is over.
    tryAgain: 'Vous pouvez essayer à nouveau.',
    unavailable:
      "Le code n'a pas pu être lu sur ce téléphone. Fermez l'application, puis rouvrez-la.",
    // A code made in a tab while one was already on the phone (another tab, a welcome cut short).
    exists: "Un code existe déjà sur ce téléphone : entrez-le pour ouvrir l'application.",
    notSaved: "Le code n'a pas pu être enregistré sur ce téléphone. Essayez encore.",
    // The right code, but what an older version kept in clear could not be sealed: nothing opens.
    openFailed:
      "Le code est bon, mais les profils n'ont pas pu être ouverts sur ce téléphone. Tapez le code encore une fois.",
    // Locked meanwhile (the quick exit, another tab) while the code was being worked out.
    typeAgain:
      "L'application s'est verrouillée pendant l'ouverture. Tapez le code encore une fois.",
    // A verifier made by a newer version of the app: nothing is tried.
    unsupported:
      "Ce code a été créé par une version plus récente de l'application. Mettez l'application à jour pour l'ouvrir.",
    keypad: 'Clavier du code',
    // The key that takes the last digit off: never the word of the data wipe (EFFACER).
    erase: 'Corriger',
    eraseName: 'Corriger le dernier chiffre',
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
    // A code among the first tried (0000, 1234, a year): a warning and a second
    // yes, never a refusal. Never red: it is not a danger sign.
    weakTitle: 'Ce code est facile à deviner',
    weakLead:
      "Une date, une année, un même chiffre répété, des chiffres qui se suivent ou qui reviennent (comme 1234, 1212 ou 2580) sont les premiers codes qu'une autre personne essaie. N'utilisez pas une date ou une année de naissance.",
    weakOther: 'Choisir un autre code',
    weakKeep: 'Garder ce code',
  },
  // A new code behind the current one (Réglages, after the code): the data stay.
  changeCode: {
    link: 'Changer le code',
    title: 'Changer le code',
    currentLead: "Tapez d'abord le code actuel.",
    currentLabel: 'Code actuel',
    newTitle: 'Choisissez le nouveau code',
    newLead: 'De 4 à 6 chiffres. Gardez-le pour vous : il prend la place du code actuel.',
    newLabel: 'Nouveau code',
    confirmTitle: 'Tapez le nouveau code une deuxième fois',
    same: "Le nouveau code est le même que l'actuel : choisissez-en un autre.",
    changing: 'Le nouveau code se prépare.',
    failed:
      "Le code n'a pas pu être changé sur ce téléphone : le code actuel reste le bon. Essayez encore.",
    doneTitle: 'Le code est changé',
    doneLead:
      "Le nouveau code ouvre l'application et les réponses enregistrées. L'ancien code n'ouvre plus rien.",
    back: 'Revenir aux réglages',
    cancel: 'Garder le code actuel',
  },
  // Shortly before the two minutes run out, while a form has answers not saved.
  autoLock: {
    soon: "L'application va se verrouiller : touchez l'écran pour continuer.",
    // A passer-by: her answers go with the lock (never given back).
    soonPasserBy:
      "L'application va se verrouiller : ses réponses seront effacées. Touchez l'écran pour continuer.",
    stay: 'Continuer',
    // Answers kept in memory across an auto-lock, given back after the code.
    restored: 'Vos réponses sont revenues, mais elles ne sont pas encore enregistrées.',
  },
  // A sensitive answer (an HIV-related situation, a note on contraception),
  // hidden until an explicit tap, worded so that it says nothing of what it hides.
  conceal: {
    situations: 'Situations masquées : touchez pour les afficher',
    note: "Information masquée : touchez pour l'afficher",
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
    // A passer-by (a sale at the depot): checked with no profile and no history kept.
    quick: 'Regarder sans enregistrer',
    // From 9 profiles on, a field finds a woman by her pseudonym.
    search: 'Chercher un profil',
    searchHint: 'Une partie du surnom suffit.',
    noMatch: 'Aucun profil ne porte ce surnom.',
    // Her list waits while another woman is looked at (cleared at the lock and by Quitter).
    pendingOne: 'Liste en cours : 1 produit',
    pendingMany: 'Liste en cours : {count} produits',
    edit: 'Modifier',
    editNamed: 'Modifier le profil de {name}',
    // The way to a profile whose term is to be updated or confirmed.
    update: 'Mettre à jour',
    updateNamed: 'Mettre à jour le profil de {name}',
    deleted: 'Profil supprimé : {name}.',
    // A lock let a passer-by go: said once, so the keeper knows why her answers are gone.
    passerByCleared: 'Pour sa confidentialité, les réponses de la femme de passage ont été effacées.',
  },
  // Where a profile stands, in plain words: on the list, the check and the result.
  profileStatus: {
    // The start of the term is past 42 weeks: the profile is updated first.
    outdated: 'À mettre à jour',
    // Its end only is past 42 weeks, or "Je ne sais pas" is old: the check goes on.
    mayBeBorn: 'À confirmer : le bébé est peut-être né',
    maybePregnant: 'Grossesse possible, terme inconnu',
    clock: 'Terme inconnu (date du téléphone)',
    babyUnknown: 'Allaite, âge du bébé inconnu',
    babyUnderOne: "Allaite, bébé de moins d'une semaine",
    babyOneWeek: 'Allaite, bébé de 1 semaine',
    babyWeeks: 'Allaite, bébé de {weeks} semaines',
    babyOneMonth: 'Allaite, bébé de 1 mois',
    babyMonths: 'Allaite, bébé de {months} mois',
  },
  // Past 42 weeks and still pregnant: to be seen today, the check goes on.
  postTerm: {
    adviceWoman:
      "Allez au poste de santé aujourd'hui : une grossesse de plus de 42 semaines doit être vue.",
    adviceAccompanied:
      "Elle doit aller au poste de santé aujourd'hui : une grossesse de plus de 42 semaines doit être vue.",
    call: 'Voir qui appeler',
    // 10 to 12 typed as months: past term, or weeks in the wrong field.
    pastNineWoman: 'Avez-vous dépassé 9 mois ?',
    pastNineAccompanied: 'Elle a dépassé 9 mois ?',
    pastNineYes: 'Oui, plus de 9 mois',
    pastNineNo: 'Non, ce sont des semaines',
  },
  // A pregnancy profile whose term is past 42 weeks: asked before any check.
  outdated: {
    titleWoman: 'Votre terme noté a passé 42 semaines. Votre bébé est-il né ?',
    titleAccompanied: 'Le terme noté a passé 42 semaines. Le bébé est-il né ?',
    leadWoman: 'Mettez votre profil à jour avant de regarder un produit.',
    leadAccompanied: 'Mettez son profil à jour avant de regarder un produit.',
    // A passer-by has no profile: her answers are given again.
    leadPasserBy: 'Reprenez ses réponses avant de regarder un produit.',
    // "Mettre à jour" on a profile where the baby may be born: the same question, first.
    titleMaybeWoman: 'Votre terme noté a peut-être passé 42 semaines. Votre bébé est-il né ?',
    titleMaybeAccompanied: 'Le terme noté a peut-être passé 42 semaines. Le bébé est-il né ?',
    leadMaybeWoman: 'Dites-le avant de mettre votre profil à jour.',
    leadMaybeAccompanied: 'Dites-le avant de mettre son profil à jour.',
    born: 'Oui, le bébé est né',
    notBorn: 'Non, toujours enceinte',
  },
  profile: {
    titleMine: 'Mon profil',
    titleNew: 'Nouveau profil',
    titleEdit: 'Modifier le profil',
    lead: 'Ces réponses restent sur ce téléphone.',
    // Opened from the outdated-term step: why, and the way out when she does not breastfeed.
    leadBornWoman:
      "Votre bébé est né : dites si vous allaitez, et son âge. Si vous n'allaitez pas, vous pouvez supprimer votre profil en bas de l'écran.",
    leadBornAccompanied:
      "Le bébé est né : dites si elle allaite, et l'âge du bébé. Si elle n'allaite pas, vous pouvez supprimer son profil en bas de l'écran.",
    leadTerm: "Donnez le terme d'aujourd'hui.",
    pseudonym: 'Surnom',
    pseudonymHint: 'Un surnom, jamais le vrai nom. 40 caractères au plus.',
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
    // Plain words for a woman who is not a health worker (weeks of amenorrhoea).
    weeksHint:
      'Semaines de grossesse, comptées depuis le premier jour des dernières règles, de 0 à 42.',
    // The day the weeks were known (an ultrasound, the booklet): the term moves on from it.
    weeksGivenOn: 'Ce terme date de quand ?',
    weeksGivenOnHint: "Aujourd'hui, ou le jour de l'échographie ou de la visite où il a été noté.",
    monthsNearTermWeeks: 'Donner le nombre de semaines',
    monthsNearTermLmp: 'Donner la date des dernières règles',
    weeksToday: "Aujourd'hui",
    weeksOtherDay: 'Un autre jour',
    weeksDate: 'Jour où ce nombre de semaines a été noté',
    // Near term a month is several weeks wide: weeks or the last period say more.
    monthsNearTerm:
      'Près du terme, un mois couvre plusieurs semaines. Si vous les connaissez, donnez le nombre de semaines ou la date des dernières règles.',
    // The month in progress; the term read back covers "months completed" too.
    months: 'Dans quel mois de grossesse êtes-vous ? (le mois en cours, du 1er au 9e)',
    // A number of 10 or more typed as months: one tap gives it as weeks.
    monthsAsWeeks: 'Ce sont {weeks} semaines',
    // Accompanied mode: the question is about the woman, as "Ce qu'elle prend".
    monthsAccompanied: 'Dans quel mois de grossesse est-elle ? (le mois en cours, du 1er au 9e)',
    termShown: 'Terme calculé',
    term: {
      underOne: "Moins d'une semaine",
      one: 'Environ 1 semaine',
      exact: 'Environ {weeks} semaines',
      estimated: 'Entre {min} et {max} semaines (estimé)',
      unknown: 'Terme inconnu',
      // Past 42 weeks and still pregnant: read as 42 weeks and over.
      postTerm: 'Plus de 42 semaines',
      // Weeks known another day: the term today, then as noted ("26 semaines le 24/09").
      since: "{term} aujourd'hui ({weeks} semaines le {date})",
    },
    termCorrect: 'Corriger le nombre de semaines',
    // A new number of weeks: the day they date from is asked again, and said so.
    weeksDayReset: 'Le nombre de semaines a changé : redites de quand date ce terme.',
    // The phone's date is before the last save: no term worked out from it.
    clockBehind:
      'La date du téléphone semble fausse : elle est avant le jour où ce profil a été enregistré. Regardez la date du téléphone.',
    // The baby's age read back in the weeks the rules use (months are converted).
    babyAgeShown: 'Âge calculé',
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
    // Deleted meanwhile (in another tab): never written back.
    goneOnSave: "Ce profil a été supprimé de ce téléphone : il n'est pas enregistré.",
    // Deleting one profile and its history, after a last yes. Never red: not a danger sign.
    delete: 'Supprimer ce profil',
    deleteTitle: 'Supprimer le profil {name} ?',
    deleteTitleMine: 'Supprimer votre profil ?',
    deleteLeadWoman:
      "Votre profil et l'historique de vos résultats seront supprimés de ce téléphone. Cela ne peut pas être annulé.",
    deleteLeadAccompanied:
      "Son profil et l'historique de ses résultats seront supprimés de ce téléphone. Cela ne peut pas être annulé.",
    deleteConfirm: 'Supprimer le profil',
    deleteCancel: 'Garder le profil',
    deleting: 'Suppression en cours.',
    deleteFailed: "Ce profil n'a pas pu être supprimé sur ce téléphone. Essayez encore.",
    deletedMine: 'Votre profil est supprimé.',
    // Neither pregnant nor breastfeeding any more (after "the baby is born"): said plainly.
    notCoveredWoman:
      "L'application sert pendant la grossesse et l'allaitement. Si vous n'êtes plus enceinte et n'allaitez pas, elle ne vous concerne plus : vous pouvez supprimer votre profil.",
    notCoveredDeleteWoman: 'Supprimer mon profil',
    notCoveredDeleteAccompanied: 'Supprimer son profil',
    notCoveredAccompanied:
      "L'application sert pendant la grossesse et l'allaitement. Si elle n'est plus enceinte et n'allaite pas, elle ne la concerne plus : vous pouvez supprimer son profil.",
    loadFailed:
      "Les profils n'ont pas pu être lus sur ce téléphone. Fermez l'application, puis rouvrez-la.",
    notFound: "Ce profil n'est pas sur ce téléphone. Revenez à l'accueil.",
    // Said under the pseudonym, never a refusal: the list could mix two women up.
    warning: {
      near: 'Un surnom proche est déjà sur ce téléphone : {name}. Choisissez un surnom bien différent, pour ne pas les confondre.',
      realName: 'Ce surnom ressemble à un prénom et un nom : un surnom, jamais le vrai nom.',
    },
    error: {
      pseudonym: 'Écrivez un surnom.',
      // A pseudonym heads her result: never a dose nor "Sans danger".
      pseudonymWording:
        'Ce surnom ressemble à une dose ou à un avis sur un produit : écrivez un autre surnom.',
      pseudonymNumber: 'Pas de numéro de téléphone : écrivez un surnom.',
      pseudonymLong: 'Écrivez un surnom de 40 caractères au plus.',
      pseudonymTaken: 'Ce surnom est déjà sur ce téléphone : écrivez-en un autre.',
      yesNo: 'Répondez oui ou non.',
      choose: 'Choisissez une réponse.',
      date: 'Écrivez une date.',
      dateFuture: "Cette date est après aujourd'hui : choisissez aujourd'hui ou une date passée.",
      // 45 weeks or more: no pregnancy lasts so long. Never "Je ne sais pas" to a term she knows.
      lmpTooOld:
        'Cette date remonte à 45 semaines ou plus : une grossesse ne dure pas si longtemps. Regardez la date. Si le bébé est né, répondez Non à Enceinte.',
      clockBehind:
        "Ce terme a été noté après la date du téléphone. Regardez la date du téléphone, ou écrivez le mois d'aujourd'hui.",
      monthsLooksLikeWeeks:
        'Ce nombre ressemble à des semaines : un mois de grossesse va de 1 à 9.',
      // 10 to 12 months: past term, or weeks in the wrong field. Asked, never converted.
      monthsPastNine: 'Un mois de grossesse va de 1 à 9 : répondez à la question en dessous.',
      // A date after the phone's date, on a profile saved later: the clock was set back.
      phoneDate:
        'La date du téléphone semble fausse : ce terme a été noté après elle. Regardez la date du téléphone.',
      birthTooOld:
        'Cette date remonte à plus de 2 ans. Pour un enfant de plus de 2 ans, choisissez En semaines et écrivez 104.',
      weeksMovedOn:
        "Le terme a avancé depuis qu'il a été noté et dépasserait 45 semaines aujourd'hui : écrivez le terme d'aujourd'hui.",
      postTermOutdated:
        "Ce terme dépassé a été noté il y a plus d'une semaine : donnez le terme d'aujourd'hui.",
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
  // A passer-by checked without a profile (accompanied mode, a sale at the depot).
  quick: {
    // "Regarder", as "Regarder un produit": never "contrôle", which reads as an inspection.
    title: 'Regarder sans enregistrer',
    lead: 'Pour une femme de passage. Ses réponses servent seulement à regarder ses produits : aucun profil et aucun historique ne restent sur ce téléphone.',
    // Her term was past 42 weeks and the baby is born: the questions again.
    leadBorn: "Le bébé est né : dites si elle allaite, et l'âge du bébé.",
    start: 'Regarder ses produits',
  },
  check: {
    // A passer-by: said instead of a pseudonym.
    quick: "Femme de passage : rien n'est enregistré",
    // Woman mode: what she takes herself; accompanied mode: what the woman takes.
    titleWoman: 'Ce que vous prenez',
    titleAccompanied: "Ce qu'elle prend",
    // Said only when the profile takes a moment to read.
    loading: 'Chargement en cours.',
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
    // A French or English name is another name, never a local one (local-name.ts).
    otherName: 'Autre nom : {name}',
    otherNameLang: 'Autre nom : {name} ({lang})',
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
  // The language of the documents of a source, said beside its name when it is
  // not the language of the screen (an English label cited on a French screen).
  sourceDocuments: {
    fr: 'documents en français',
    en: 'documents en anglais',
  },
  confirm: {
    titleProduct: 'Est-ce bien ce produit ?',
    titlePlant: 'Est-ce bien ce remède ?',
    strength: 'Quel dosage est écrit sur la boîte ?',
    strengthHint: 'Sur la boîte ou sur la plaquette : le nombre suivi de mg ou de g.',
    dontKnow: 'Je ne sais pas',
    // A long list shows the strength typed first: the others on demand.
    showAllStrengths: 'Voir tous les dosages ({count})',
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
    // A passer-by checked without a profile: nothing of it is kept.
    titleQuick: 'Résultat, sans enregistrer',
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
    // Accompanied mode, before the next dose: said to the person helping, at a
    // home visit or a sale at a depot (the depot keeper is not the pharmacist):
    // before she takes it again, to a health worker, never read as an order to
    // start. The other levels keep the defaults above, the words of the grey
    // messages of the pack, so two cards never name different people.
    orientationAccompanied:
      "Montrez ce produit à la sage-femme ou à l'infirmier avant qu'elle en reprenne.",
    orientationProductsAccompanied:
      "Montrez ces produits à la sage-femme ou à l'infirmier avant qu'elle en reprenne.",
    // A danger held at "before the next dose" because the name typed only looks
    // like the product (possible-matches.ts): never a lower urgency when it may
    // have been taken, so it branches on intake (go now if taken, else show it
    // before any to find out whether it is the product).
    orientationHeld: {
      product:
        "S'il a déjà été pris, allez au poste de santé maintenant et montrez-le. Sinon, montrez-le à la sage-femme ou à l'infirmier avant d'en prendre, pour savoir si c'est bien ce produit.",
      plant:
        "S'il a déjà été pris, allez au poste de santé maintenant et montrez-le. Sinon, montrez-le à la sage-femme ou à l'infirmier avant d'en prendre, pour savoir si c'est bien ce remède.",
      productAccompanied:
        "Si elle en a déjà pris, elle doit aller au poste de santé maintenant et montrer ce produit. Sinon, montrez-le à la sage-femme ou à l'infirmier avant qu'elle en prenne, pour savoir si c'est bien ce produit.",
      plantAccompanied:
        "Si elle en a déjà pris, elle doit aller au poste de santé maintenant et montrer ce remède. Sinon, montrez-le à la sage-femme ou à l'infirmier avant qu'elle en prenne, pour savoir si c'est bien ce remède.",
    },
    // Under a card whose orientation says to go now if something happens.
    callNow: 'Voir qui appeler',
    // The level name of a danger that comes from a product rule, not from a
    // danger sign (DESIGN.md, Levels): a product is never called a sign.
    dangerProductLevel: 'Danger : à montrer maintenant',
    // A situation ticked in the profile that no rule of the knowledge base reads.
    conditionNote:
      '{situation} : notre base ne tient pas encore compte de cette situation, et ce résultat non plus. Ajoutez à la liste chaque médicament pris pour ce traitement ou cette maladie : il sera regardé comme les autres.',
    conditionOrientation: 'Parlez-en à la sage-femme ou au médecin à la prochaine visite.',
    // The heading of those notes, said before the cards.
    situations: 'Situations non prises en compte',
    // The reminders section, hidden behind a tap, when it holds none.
    noReminder: 'Aucun rappel pour ce résultat.',
    // "On ne sait pas" without an orientation of its own: these come first (spec section 10),
    // each unless what the card has just said contains its phrase (unknownSaid, lowercase).
    // Said positively: a listener who hears only the end never hears "sans risque".
    unknown: {
      noInformation: "Nous n'avons pas d'information fiable.",
      mayHarm: 'On ne sait pas si ce produit peut faire du mal.',
    },
    unknownSaid: {
      noInformation: "pas d'information fiable",
      // "On ne sait pas si ... peut faire du mal" says both.
      unknown: 'on ne sait pas si',
      mayHarm: 'peut faire du mal',
      // The wording of an older knowledge base still on the phone.
      notRiskFree: 'ne veut pas dire',
    },
    // Before the next dose, for a finding about several products (a duplicate, an interaction).
    orientationProducts:
      "Montrez ces produits à la sage-femme, à l'infirmier ou au pharmacien avant la prochaine prise.",
    // The danger banner's action: the referral circuit on the danger signs screen.
    dangerAction: 'Voir qui appeler',
    // Text she typed, quoted under its label, never said as the app's own words.
    typedLabel: 'Vous avez écrit :',
    quoted: '« {text} »',
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
    // Under the title: the term the result was worked out on, in plain words.
    termUsed: 'Terme utilisé pour ce résultat : {term}',
    // The engine looks TERM_LOOKAHEAD_DAYS ahead of the term: a treatment goes on.
    lookahead: 'Ce résultat tient compte aussi des {weeks} semaines à venir.',
    // The phone's date before a day the app has already seen: the term read as
    // unknown, breastfeeding as possible (the real date is later), and said why.
    termClockWoman:
      "La date du téléphone semble fausse : elle est avant un jour où l'application a déjà servi. Regardez la date du téléphone. En attendant, le terme est inconnu et votre bébé est peut-être né : ce résultat tient compte de toute la grossesse et de l'allaitement.",
    termClockAccompanied:
      "La date du téléphone semble fausse : elle est avant un jour où l'application a déjà servi. Regardez la date du téléphone. En attendant, le terme est inconnu et le bébé est peut-être né : ce résultat tient compte de toute la grossesse et de l'allaitement.",
    // The baby may be born (possibly past term): breastfeeding is read as possible too.
    mayBeBornWoman:
      "Nous ne savons pas si votre bébé est né : ce résultat tient compte de la grossesse et de l'allaitement.",
    mayBeBornAccompanied:
      "Nous ne savons pas si le bébé est né : ce résultat tient compte de la grossesse et de l'allaitement.",
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
    // Accompanied mode: the fact, the detailed risks, the evidence, the sources
    // and the rules of a card, behind one disclosure, so the card stays short.
    why: 'Pourquoi ?',
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
    // The same as notValidated, short, near the top of the result (the full line closes it).
    notValidatedShort: 'Contenu non validé cliniquement.',
    closing: 'Cet outil ne remplace pas un soignant.',
    // The check is kept: a forgotten product can still be added.
    backToList: 'Revenir à la liste',
    // A passer-by served: she is let go, and the questions open for the next one.
    nextPasserBy: 'Femme suivante',
  },
  // Level names (DESIGN.md, Levels): always shown with their pictogram.
  level: {
    danger: 'Signe de danger',
    'before-next-dose': 'À montrer avant la prochaine prise',
    'next-contact': 'À dire à la prochaine visite',
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
      // No brackets: a contact is said "name (role)", never with brackets inside brackets.
      icp: 'Infirmier chef de poste, ICP',
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
    // "Aucun" tapped while signs are ticked: they are taken off only on yes.
    noneConfirm: 'Retirer les signes cochés ({signs}) ?',
    noneYes: 'Oui, aucun de ces signes',
    noneKeep: 'Non, garder ces signes',
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
      "En mode « Je suis enceinte ou j'allaite », seul votre profil s'ouvre. Les autres restent sur ce téléphone.",
    changed: 'Réglage enregistré.',
    // A choice applies with its button, never with the answer alone. The
    // language button is said in the language it switches to.
    applyLanguage: 'Passer en français',
    applyMode: 'Changer de mode',
    done: "Revenir à l'accueil",
  },
  // The two links to the status and about screens, on Home, the list of
  // profiles and the settings.
  nav: {
    status: 'Base de connaissances',
    about: 'À propos',
    voice: "Parler au lieu d'écrire",
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
    // Not "périmée": beside medicine names it reads as an expired medicine.
    stale:
      'Base de connaissances ancienne : plus de 90 jours. Faites-la mettre à jour au poste de santé.',
    sourceTitle: 'Provenance de cette base',
    fromNetwork: "Cette base est celle chargée avec l'application.",
    fromCopy: 'Cette base est la copie gardée sur ce téléphone.',
    fallback:
      "La base n'a pas pu être chargée avec l'application. La copie gardée sur ce téléphone est utilisée.",
    fallbackRefused:
      'Une nouvelle base a été refusée par ce téléphone. La copie gardée sur ce téléphone est utilisée.',
    rolledBack:
      "La version précédente a été remise sur ce téléphone. Une version plus récente sera prise dès qu'elle sera disponible.",
    // The reason is the code's own message, in English: said so on a French screen.
    reason: 'Détail technique (en anglais) : {reason}',
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
      "SIAPSO Mère-Enfant donne des informations générales sur la santé, de l'éducation à la santé et une orientation vers un professionnel de santé aux femmes enceintes et allaitantes au Sénégal et aux personnes qui les accompagnent. Il ne pose pas de diagnostic, ne prescrit pas et ne fixe pas de dose, et il ne remplace pas un professionnel de santé.",
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
      'Transformers.js (licence Apache-2.0), ONNX Runtime Web et les modèles Whisper (MIT) : seulement pour la voix, une fois installée.',
    licencesLink: 'Lire les licences des logiciels tiers',
    repositoryTitle: 'Code source',
    repositoryPrivate: 'Le dépôt est privé pendant le développement.',
  },
  // Voice input in the search (SCRUM-31): the model only writes what it
  // heard; the candidates are confirmed as typed ones. The recording "se
  // termine": no word here reads as an instruction about a treatment.
  voice: {
    // The microphone button beside the search field.
    mic: 'Dire le nom',
    micFinish: "Terminer l'enregistrement",
    opening: "Le micro s'ouvre. Si le téléphone le demande, touchez Autoriser.",
    // Short, said by a screen reader before she speaks: the rest is not read out.
    listening: "J'écoute {languageIn}.",
    listeningPlain: "J'écoute.",
    listeningHow: 'Dites le nom, puis touchez le carré pour terminer.',
    seconds: '{count} s sur {max}',
    autoEnd: "L'enregistrement se termine seul après {max} secondes.",
    thinking: 'Je réfléchis...',
    thinkingHint: 'Cela peut prendre une minute sur ce téléphone.',
    cancel: 'Annuler',
    cancelled: 'Enregistrement annulé.',
    heard: "J'ai entendu : {text}",
    heardNothing: "Je n'ai pas entendu de nom.",
    noneHint: 'Écrivez le nom, ou choisissez-le dans la liste.',
    type: 'Écrire le nom',
    chooseProduct: 'Choisir dans la liste des médicaments',
    choosePlant: 'Choisir dans la liste des remèdes',
    listProduct: 'Tous les médicaments',
    listPlant: 'Tous les remèdes',
    denied: 'Le micro est bloqué pour cette application.',
    deniedHow:
      'Pour le permettre dans Chrome : touchez les trois points en haut, puis Paramètres, Paramètres des sites, Micro, et permettez ce site, puis touchez à nouveau le micro. En attendant, écrivez le nom.',
    install: 'Installer la voix',
    error: {
      unavailable:
        "La voix n'est pas complète sur ce téléphone. Installez-la à nouveau, ou écrivez le nom.",
      invalid:
        'Les fichiers de la voix reçus ne sont pas bons. Réessayez plus tard, ou dites-le au poste de santé.',
      storage:
        "Il n'y a pas assez de place sur ce téléphone pour la voix. Libérez de la place, puis réessayez.",
      download:
        "Le téléchargement s'est interrompu. Reconnectez Internet, de préférence le wifi, puis touchez Reprendre : il continue là où il en était.",
      load: "La voix n'a pas pu démarrer sur ce téléphone. Fermez les autres applications, puis réessayez. Vous pouvez aussi écrire le nom.",
      transcribe: "Je n'ai pas pu comprendre cet enregistrement. Réessayez, ou écrivez le nom.",
      'no-microphone': "Aucun micro n'a été trouvé sur ce téléphone. Écrivez le nom.",
      unsupported:
        "Ce navigateur ne peut pas enregistrer la voix. Ouvrez l'application dans Chrome, ou écrivez le nom.",
      record:
        "Le micro n'a pas pu enregistrer. Une autre application l'utilise peut-être. Réessayez, ou écrivez le nom.",
    },
  },
  // The voice pack: chosen, installed and removed on this screen only; never
  // downloaded without the install button.
  voicePack: {
    title: "Parler au lieu d'écrire",
    lead: "Dites le nom d'un médicament ou d'un remède : l'application l'écrit pour vous, et vous choisissez dans la liste proposée.",
    privacy: "Votre voix reste sur ce téléphone : elle n'en sort jamais et n'est pas gardée.",
    checking: 'Recherche de la voix sur ce téléphone.',
    // The speech package of this page is gone (an update accepted in another tab).
    packageFailed:
      "La voix n'a pas pu se charger sur cette page, peut-être après une mise à jour. Fermez l'application, puis rouvrez-la.",
    unsupported:
      "Ce navigateur ne peut pas utiliser la voix. Ouvrez l'application dans Chrome. Vous pouvez toujours écrire les noms.",
    language: 'Langue de la voix',
    languageHint: "L'application comprend les noms dits dans cette langue.",
    option: '{language}, {size}',
    languageName: {
      wo: 'Wolof',
      fr: 'Français',
    },
    languageIn: {
      wo: 'en wolof',
      fr: 'en français',
    },
    model: {
      wo: 'Modèle Whisper small adapté au wolof (M9and2M), licence MIT.',
      fr: "Modèle Whisper base d'OpenAI, licence MIT.",
    },
    megabytes: '{count} Mo',
    advice:
      'À installer une seule fois, en wifi, au poste de santé par exemple : {size} à télécharger. Ensuite, la voix marche sans Internet.',
    offline: 'Il faut Internet pour installer la voix.',
    install: 'Installer la voix {languageIn}',
    partial: '{stored} sur {size} sont déjà sur ce téléphone.',
    resume: "Reprendre l'installation",
    removePartial: 'Retirer les fichiers déjà téléchargés',
    installing: 'Installation de la voix {languageIn}',
    progressLabel: "Avancement de l'installation",
    progress: '{loaded} sur {size} ({percent} %)',
    keepOpen: "Gardez l'application ouverte et Internet allumé jusqu'à la fin.",
    cancel: "Annuler l'installation",
    cancelled:
      'Installation annulée. Les fichiers déjà téléchargés sont gardés pour la reprendre plus tard.',
    installed: 'La voix {languageIn} est installée ({size}).',
    ready: 'Touchez le micro à côté du champ de recherche pour dire un nom.',
    oneAtATime: "Pour changer de langue, retirez d'abord cette voix.",
    remove: 'Retirer la voix {languageIn}',
    removeConfirm: 'Retirer la voix ? Pour la remettre, il faudra télécharger à nouveau {size}.',
    removeYes: 'Oui, retirer la voix',
    removeNo: 'Garder la voix',
    removed: 'La voix est retirée de ce téléphone.',
    removeFailed: "La voix n'a pas pu être retirée. Essayez encore.",
    back: 'Revenir à la recherche',
  },
  // The third-party software and models of the voice, with their licence
  // texts (reached from About). The texts stay in English, as written.
  licences: {
    title: 'Licences des logiciels tiers',
    lead: 'Les logiciels et les modèles qui servent à la voix, avec leur licence. Ils ne servent que si la voix est installée.',
    softwareTitle: 'Logiciels',
    modelsTitle: 'Modèles de la voix',
    dataTitle: 'Données qui ont servi à adapter le modèle au wolof',
    dataLead:
      "Relevées le 5 novembre 2026 sur la page de chaque source. Ce n'est pas un avis juridique.",
    licence: 'Licence : {licence}',
    source: 'Origine : {source}',
    note: {
      declared: 'Licence déclarée sur la fiche du modèle.',
      'share-alike':
        "Licence à partage à l'identique : son effet sur le modèle n'est pas encore tranché.",
      none: 'Aucune licence trouvée pour ces enregistrements.',
    },
    textsTitle: 'Textes des licences',
    textsLead: "Les textes restent en anglais, leur langue d'origine.",
    back: 'Revenir à la page À propos',
  },
  update: {
    ready: 'Une nouvelle version est prête.',
    // Not "Recharger": in Senegal it reads as buying phone credit.
    reload: 'Mettre à jour',
  },
};

/** The shape every dictionary has: the same keys as French, each a string. */
export type Dictionary = typeof fr;
