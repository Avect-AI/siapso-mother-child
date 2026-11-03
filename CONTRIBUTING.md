# Contribuer à SIAPSO Mère-Enfant

## Mise en place sur un poste

1. Cloner le dépôt (privé pendant le développement).
2. Activer les hooks git du dépôt : `git config core.hooksPath .githooks`.
3. Vérifier que Python 3 est disponible : les hooks l'utilisent pour le contrôle d'hygiène.

## Circuit d'une modification

1. Prendre un ticket Jira du projet `SCRUM` : un ticket correspond à une fonctionnalité et à une pull request.
2. Créer la branche `feat/SCRUM-<n>-<sujet-court>`.
3. Écrire les commits au format `SCRUM-<n>: <verbe> <objet>`.
4. Ouvrir la PR avec le titre `SCRUM-<n>: ...` et remplir le modèle.
5. La PR est fusionnée (squash) dès que toute la CI est verte. Le ticket passe ensuite à « Terminé ».

## Règles de texte

Le contrôle `tools/hygiene/hygiene.py` refuse :

- le tiret cadratin (U+2014) : utilisez une virgule, deux points ou des parenthèses ;
- les emojis et pictogrammes ;
- toute attribution d'un commit ou d'une PR à un assistant d'IA.

Lancer le contrôle à la main : `sh tools/hygiene/py.sh tools/hygiene/hygiene.py files`.

Seuls les fichiers tiers que nous n'écrivons pas peuvent être exclus, dans `.hygieneignore`.

## Interface

Chaque écran suit `PRODUCT.md` et `DESIGN.md`, et passe par le plugin impeccable avant la PR (`critique`, `audit`, `detect`).

## Contenu clinique

Une règle n'est publiée qu'avec sa source (listée dans `knowledge/sources.yaml`), son niveau de preuve et le nom de ses deux relecteurs. Rien n'est présenté comme validé avant la double signature d'une pharmacienne et d'une sage-femme.
