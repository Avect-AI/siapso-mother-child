# SIAPSO Mère-Enfant : règles pour les agents

Application web installable, hors ligne, qui signale les médicaments et les remèdes traditionnels à risque pendant la grossesse et l'allaitement, et oriente vers un soignant. Dossier de conception : https://claude.ai/artifact/771WvpJtMCZYdN6YMEHAHu. Contexte produit : `PRODUCT.md`. Système visuel : `DESIGN.md` (quand il existe).

## Règles absolues

- **Aucun tiret cadratin** (U+2014) et **aucun emoji** dans le code, l'interface, la documentation, les données et les messages de commit. Utiliser une virgule, deux points ou des parenthèses.
- **Aucune attribution à Claude ou à Anthropic** dans les commits et les pull requests : pas de ligne `Co-Authored-By`, pas de mention « Generated with ».
- Ces trois règles sont contrôlées par `tools/hygiene/hygiene.py` : hook Claude Code avant chaque écriture, hooks git `pre-commit` et `commit-msg`, et CI sur chaque PR. Ne jamais contourner un refus : corriger le texte.
- Aucune brique de TerangaHealth. Aucun message audio ni voix de synthèse : les réponses restent en texte.
- Les modèles proposent, les règles décident : le modèle vocal et le résolveur suggèrent un produit, la personne le confirme, le moteur seul fixe le niveau d'alerte.
- L'application ne dit jamais « sûr », « sans danger » ou « vérifié », n'utilise jamais le vert, ne dit jamais d'arrêter, de commencer ou de modifier un traitement, et ne donne ni dose ni alternative.
- Aucune donnée personnelle de femme ne quitte le téléphone par défaut. Aucun secret dans le dépôt.
- Aucune donnée LEDIAM ou DDInter, et aucune source hors de `knowledge/sources.yaml`.

## Méthode de travail

1. Un ticket Jira (projet `SCRUM`) correspond à une fonctionnalité, une branche et une pull request.
2. Branche : `feat/SCRUM-<n>-<sujet-court>` (ou `fix/`, `chore/`, `docs/`).
3. Commits et titre de PR : `SCRUM-<n>: <verbe à l'impératif> <objet>`, en français, sans attribution.
4. La PR remplit le modèle `.github/pull_request_template.md` et lie le ticket.
5. Fusion : squash, dès que toute la CI est verte (décision de l'équipe du 3 novembre 2026). Passer ensuite le ticket Jira à « Terminé ».
6. Le dépôt reste **privé** pendant tout le développement ; il sera rendu public à la fin, après audit.

## Interface et design

- Toute interface passe par le plugin impeccable (`.claude/skills/impeccable`).
- Avant un nouvel écran : `/impeccable shape <écran>`. Avant la PR : `/impeccable critique <écran>` puis `/impeccable audit <écran>`, et `.claude/skills/impeccable/scripts/impeccable detect app/src` sans alerte.
- Ne jamais utiliser le mode `live` d'impeccable (il lance un agent sans validation).
- Simplicité d'abord : une action principale par écran, cibles tactiles de 48 px minimum, lisible en plein soleil, sens jamais porté par la seule couleur.

## Pile technique

React, Vite et TypeScript ; application web installable (PWA) ; moteur de règles TypeScript pur, identique sur le téléphone et sur le serveur ; interface en français et en anglais ; saisie vocale française et wolof avec un modèle ouvert exécuté dans le navigateur.
