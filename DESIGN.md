---
name: SIAPSO Mother-Child
description: Offline result screens that say who to show a medicine or remedy to, and when.
colors:
  glass-white: '#f3f5fa'
  reserve-white: '#ffffff'
  ink: '#14182b'
  ink-muted: '#464c63'
  control-contour: '#626880'
  hairline: '#d3d7e2'
  focus-ultramarine: '#2f49d1'
  selection-tint: '#c9d3f6'
  ultramarine: '#22379a'
  ultramarine-deep: '#1a2a78'
  ultramarine-tint: '#e3e8fb'
  danger-crimson: '#b0141b'
  danger-text: '#ffffff'
  danger-contour: '#6e0b10'
  dose-orange: '#f28a1e'
  dose-text: '#1a1206'
  dose-contour: '#8a3d00'
  contact-yellow: '#ffd23a'
  contact-text: '#1e1904'
  contact-contour: '#765800'
  unknown-grey: '#a9adb7'
  unknown-hatch: '#c0c3cb'
  unknown-text: '#15171d'
  unknown-contour: '#4e525e'
typography:
  headline:
    fontFamily: 'Atkinson Hyperlegible Next, Roboto, Noto Sans, Segoe UI, Arial, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 800
    lineHeight: 1.2
  title:
    fontFamily: 'Atkinson Hyperlegible Next, Roboto, Noto Sans, Segoe UI, Arial, sans-serif'
    fontSize: '1.375rem'
    fontWeight: 800
    lineHeight: 1.2
  body:
    fontFamily: 'Atkinson Hyperlegible Next, Roboto, Noto Sans, Segoe UI, Arial, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 450
    lineHeight: 1.5
  label:
    fontFamily: 'Atkinson Hyperlegible Next, Roboto, Noto Sans, Segoe UI, Arial, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: 1.2
  small:
    fontFamily: 'Atkinson Hyperlegible Next, Roboto, Noto Sans, Segoe UI, Arial, sans-serif'
    fontSize: '1rem'
    fontWeight: 450
    lineHeight: 1.5
rounded:
  sm: '4px'
  md: '6px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '24px'
  '6': '32px'
  '7': '48px'
components:
  button-primary:
    backgroundColor: '{colors.ultramarine}'
    textColor: '{colors.reserve-white}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 24px'
    height: '56px'
  button-primary-hover:
    backgroundColor: '{colors.ultramarine-deep}'
  button-secondary:
    backgroundColor: '{colors.reserve-white}'
    textColor: '{colors.ultramarine}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 24px'
    height: '48px'
  button-secondary-hover:
    backgroundColor: '{colors.ultramarine-tint}'
  button-quiet:
    textColor: '{colors.ultramarine}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
    height: '48px'
  text-field:
    backgroundColor: '{colors.reserve-white}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '12px 16px'
    height: '48px'
  level-badge-danger:
    backgroundColor: '{colors.danger-crimson}'
    textColor: '{colors.danger-text}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
  level-badge-before-next-dose:
    backgroundColor: '{colors.dose-orange}'
    textColor: '{colors.dose-text}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
  level-badge-next-contact:
    backgroundColor: '{colors.contact-yellow}'
    textColor: '{colors.contact-text}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
  level-badge-unknown:
    backgroundColor: '{colors.unknown-grey}'
    textColor: '{colors.unknown-text}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
  danger-banner:
    backgroundColor: '{colors.danger-crimson}'
    textColor: '{colors.danger-text}'
    typography: '{typography.title}'
    rounded: '{rounded.md}'
    padding: '16px'
---

# Design System: SIAPSO Mother-Child

## Overview

**Creative North Star: "The Reverse-Glass Pane"**

The system borrows its grammar from the suwer, the Senegalese reverse-glass painting sold in every market: flat fields of strong colour, each held by a darker painted contour, framing a scene and named by a caption. Here each result level is such a pane. Its field is the level colour, its contour is a darker shade of the same hue, its top band is the caption (pictogram and level name), and a white reserve set into the field carries the words a health worker reads aloud. The world lends four things only: palette, type, density and that one signature move. Navigation and controls stay the plain web controls people already know.

The surface is calm and flat. A glass-white ground, white reserves, ink text, ultramarine for the shell and for actions, and level colour only where a level is being said. Light only: the app is read outdoors, in daylight and direct sun, on low-cost screens, so the scene forces dark text on a light ground. Density is low: one reading size, generous targets, one column from 360 px.

Principles (from `PRODUCT.md`, made visual):

1. **Unknown is not safe.** The grey level is hatched, never a flat pale grey that could read as disabled, empty or fine.
2. **Orient, never prescribe.** Every finding says who to show and when right after its risks, the clearest line of its reserve; in accompanied mode the details for the health worker (fact, detailed risk), then source and evidence, come after it, behind one closed "Pourquoi ?" disclosure, so a slow reader reads a short card.
3. **Built for the person in the room.** One hand, shared phone, bright sun, under a minute: reading text at 7:1, targets at 48 px or more, nothing hidden behind a gesture.
4. **Meaning never by colour alone.** Every level has its own silhouette and its name in text, always together.
5. **Traceable.** Source and evidence close every finding (under "Pourquoi ?" in accompanied mode), in the same place every time; the version is said near the top of the result and at its end.

**Key Characteristics:**

- Level panes: flat field, darker contour, caption band, white reserve.
- Four pictogram silhouettes on one 24-unit grid: octagon, eye, speech bubble, circle.
- Hatched grey for "we do not know".
- One reading size (18 px) for every sentence read aloud.
- Ultramarine reserved for the shell and actions; never green anywhere.
- Flat: no shadows, depth by tone and contour.

## Colors

A restrained ground with a full set of level fields: ink and ultramarine do the everyday work, and four saturated fields appear only to say a level.

### Primary

- **Ultramarine** (`--color-primary`): the shell band, the primary button fill, secondary button text and outlines, quiet button text, links. It belongs to no level, so an action is never mistaken for a result.
- **Deep Ultramarine** (`--color-primary-hover`): primary button hover.
- **Ultramarine Tint** (`--color-primary-tint`): secondary and quiet button hover.
- **Focus Ultramarine** (`--color-focus`): the 3 px focus ring. Surfaces override it where ultramarine would not show: white on the ultramarine shell and on the danger banner.

### Levels

| Level              | French                             | English                   | Pictogram                        | Field, text, contour                                           | Use                                                                                                                                                |
| ------------------ | ---------------------------------- | ------------------------- | -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `danger`           | Signe de danger                    | Danger sign               | Octagon with an exclamation mark | Crimson, white text, dark crimson contour                      | Danger signs only, plus the product rules with a written danger rationale. Orientation: go to the health post now.                                 |
| `danger` (product) | Danger : à montrer maintenant      | Danger: show now          | Octagon with an exclamation mark | Crimson, white text, dark crimson contour                      | The same level, named for a product rule (castor oil or misoprostol with a scar, misoprostol late in pregnancy): a product is never called a sign. |
| `before-next-dose` | À montrer avant la prochaine prise | Show before the next dose | Eye                              | Orange, near-black text, burnt orange contour                  | Show the product to the midwife, the nurse or the pharmacist before the next dose. The highest level a product rule normally takes.                |
| `next-contact`     | À dire à la prochaine visite       | Tell at the next visit    | Speech bubble with three dots    | Chrome yellow, near-black text, ochre contour                  | Tell the midwife at the next visit (plain words: a "contact" is also a phone contact in the app).                                                  |
| `unknown`          | On ne sait pas                     | We do not know            | Circle with a question mark      | Hatched mid grey (two stripes), near-black text, slate contour | No reliable information, or nothing found. Never a reassurance: always followed by who to show it to.                                              |

Each level is set by one class (`level--<name>`) that defines `--level-bg`, `--level-fill`, `--level-fg` and `--level-border` for every surface that shows a level (badge, card, banner, summary tile).

### Neutral

- **Glass White** (`--color-bg`): the page ground, a faint cool white.
- **Reserve White** (`--color-surface`): reserves inside level panes, inputs, secondary buttons.
- **Ink** (`--color-text`): all reading text, form errors, invalid input borders.
- **Muted Ink** (`--color-text-muted`): hints, metadata, source and version lines. Still 7.78:1 on the ground.
- **Control Contour** (`--color-border`): input borders and disabled dashes, at least 3:1.
- **Hairline** (`--color-rule`): decorative rules between fields and list rows.
- **Selection Tint** (`--color-selection`): text selection.

### Contrast

Every pair is tested in `app/src/styles/tokens.test.ts` from `CONTRAST_PAIRS` in `app/src/styles/contrast.ts`. Reading text is held at 7:1 (WCAG AAA) for sunlight; contours, input borders and focus rings at 3:1.

| Foreground                        | Background                    | Ratio   | Minimum |
| --------------------------------- | ----------------------------- | ------- | ------- |
| `--color-text`                    | `--color-bg`                  | 16.11:1 | 7:1     |
| `--color-text`                    | `--color-surface`             | 17.57:1 | 7:1     |
| `--color-text-muted`              | `--color-bg`                  | 7.78:1  | 7:1     |
| `--color-text-muted`              | `--color-surface`             | 8.49:1  | 7:1     |
| `--color-text`                    | `--color-selection`           | 11.82:1 | 7:1     |
| `--color-text`                    | `--color-primary-tint`        | 14.39:1 | 7:1     |
| `--color-primary-text`            | `--color-primary`             | 10.09:1 | 7:1     |
| `--color-primary-text`            | `--color-primary-hover`       | 12.76:1 | 7:1     |
| `--color-primary`                 | `--color-surface`             | 10.09:1 | 7:1     |
| `--color-primary`                 | `--color-bg`                  | 9.25:1  | 7:1     |
| `--color-primary`                 | `--color-primary-tint`        | 8.27:1  | 7:1     |
| `--level-danger-fg`               | `--level-danger-bg`           | 7.09:1  | 7:1     |
| `--level-before-next-dose-fg`     | `--level-before-next-dose-bg` | 7.44:1  | 7:1     |
| `--level-next-contact-fg`         | `--level-next-contact-bg`     | 12.15:1 | 7:1     |
| `--level-unknown-fg`              | `--level-unknown-bg`          | 7.98:1  | 7:1     |
| `--level-unknown-fg`              | `--level-unknown-hatch`       | 10.16:1 | 7:1     |
| `--level-danger-border`           | `--color-surface`             | 12.22:1 | 7:1     |
| `--level-danger-border`           | `--color-bg`                  | 11.20:1 | 7:1     |
| `--level-before-next-dose-border` | `--color-bg`                  | 7.01:1  | 3:1     |
| `--level-before-next-dose-border` | `--color-surface`             | 7.64:1  | 3:1     |
| `--level-next-contact-border`     | `--color-bg`                  | 6.08:1  | 3:1     |
| `--level-next-contact-border`     | `--color-surface`             | 6.63:1  | 3:1     |
| `--level-unknown-border`          | `--color-bg`                  | 7.15:1  | 3:1     |
| `--level-unknown-border`          | `--color-surface`             | 7.80:1  | 3:1     |
| `--color-border`                  | `--color-bg`                  | 5.05:1  | 3:1     |
| `--color-border`                  | `--color-surface`             | 5.51:1  | 3:1     |
| `--color-focus`                   | `--color-bg`                  | 6.43:1  | 3:1     |
| `--color-focus`                   | `--color-surface`             | 7.01:1  | 3:1     |
| `--color-focus`                   | `--color-primary-tint`        | 5.74:1  | 3:1     |

### Named Rules

**The No Green Rule.** No colour token has a hue between 75 and 165 degrees with saturation above 0.2. A test reads every token in `tokens.css` and fails on green.

**The Red Is For Danger Rule.** Crimson exists only as the danger field and its contour. Form errors are ink with a triangle mark, never red: a typo is not a danger sign.

**The Hatched Unknown Rule.** The unknown field is two grey stripes at 45 degrees, the map maker's mark for "no data". A flat grey reads as disabled or as nothing to worry about.

## Typography

**Body Font:** Atkinson Hyperlegible Next (with Roboto, Noto Sans, Segoe UI, Arial, sans-serif)

**Character:** one humanist family designed by the Braille Institute for low-vision readers, at heavy weights. It draws I, l and 1 apart, slashes the zero and opens its counters, which matters when a reader checks a product name on a box aloud. The Next release covers full Latin, so Wolof names (ŋ, ñ, ë) and French accents render in the same face. A name in another language than the interface's carries its own `lang` (a Wolof local name `wo`, a plant's Latin name `la`), so a screen reader does not read it with French rules (WCAG 3.1.2).

Why a web font rather than the system stack: the phones run Roboto or a vendor face that changes with the Android skin, and Roboto's I and l are near twins. Atkinson Hyperlegible Next is OFL 1.1, self-hosted in `app/public/fonts/` with its licence, variable from 200 to 800, subset to Latin and Latin Extended: 52 KB in total, preloaded, `font-display: swap`, and cached offline with the app shell.

### Hierarchy

- **Headline** (800, 1.75rem / 28 px, 1.2): reserved for a screen's single lead line when one is needed, and for the danger banner's instruction ("Allez au poste de santé maintenant."), its largest line.
- **Title** (800, 1.375rem / 22 px, 1.2): level names, the strongest line wherever a level is said: the result card caption. Also who to show and when in a finding (line height 1.3), the clearest line of the white reserve; in a card narrow for the text size it steps down to the reading size, as the banner's instruction does, so its words stay whole.
- **Body** (450, 1.125rem / 18 px, 1.5): every other sentence read aloud: fact, risk, fixed sentences. On a phone the measure stays well under 65 characters.
- **Label** (700 to 800, 1.125rem / 18 px, 1.2): product names in a finding (800), the danger banner's level line, level names in summary rows, buttons, field labels, the screen title.
- **Small** (450, 1rem / 16 px, 1.5): source, evidence and version lines, hints. Tabular numerals.

### Named Rules

**The One Reading Size Rule.** Everything read aloud is 18 px, with two exceptions that say what to do: who to show and when in a finding (title size) and the danger banner's instruction (headline size). Hierarchy otherwise comes from the pane, the caption band and weight, not from a ladder of sizes; nothing a reader must say is smaller than 16 px.

**The Weight For Sunlight Rule.** Body text is 450, not 400: a touch heavier holds up under glare.

**The Level First Rule.** The level name always comes first and is never weaker than the product name: the caption of a finding (on its field, beside its pictogram), bold before the product in a summary row, first in the danger banner (where the instruction under it is the largest line, so the banner and the danger card below it never lead with the same caption).

## Layout

One column from 360 px, with a 16 px gutter (`--gutter`: `--space-4`, never wider, so at large text the room goes to the words, not to the edges). The spacing scale has a 4 px base (`--space-1` to `--space-7`: 4, 8, 12, 16, 24, 32, 48 px). Findings are 16 px apart; fields inside a reserve are 12 px apart and separated by hairline rules, in a fixed order: risk, who to show and when, then source, evidence and version.

Components answer to their own width, not the viewport. The danger banner puts its action beside the sentence only when it has room and stacks otherwise. Under 18rem a result card trims its caption padding and keeps its reserve padding at 12 px. Text beside a pictogram keeps a 10rem basis, so at large system text sizes it drops under the pictogram instead of overflowing. Pictograms are sized in rem and grow with the user's font size. At 360 px with text at 200 percent, nothing scrolls sideways, and words never break in the middle: the lines that say what to do (the banner's instruction, who to show and when, the level names) step down to the reading size and keep whole words, and a summary row puts its words under its tile when they do not fit beside it (the longest danger instruction of the pack is tested); a reading word still wider than its line in a narrow card (a long word at 200 percent on a 320 px phone) breaks at a syllable with a hyphen (`hyphens: auto`, words of 16 letters or more, the ones a 360 px line at 200 percent cannot hold), never cut silently; never in a meta line (the name typed, "Vous avez écrit : ...", sources, evidence). Product names are never hyphenated, and each number in them is held to its unit by a no-break space ("1000 mg", "2,4 POUR CENT"), so "DOLIPRANE 1000" never ends a line with "mg" on the next.

The result screen (`#/result`) opens with the danger banner when a finding is a danger (under the title and what the result was worked out on otherwise), then, when the knowledge base is more than 90 days old, the notice (ink, triangle) "Base de connaissances ancienne : plus de 90 jours. Faites-la mettre à jour au poste de santé." (never "périmée", which beside medicine names reads as an expired medicine), then, when there are two findings or more, a summary list, one row per level and products (a level tile, the level name in bold, then the product names), in the order of the cards (two cards about the same products at the same level, such as a duplicate and a daily maximum, are one row); with one finding the card is the summary. Then, under the banner or the summary, two short lines so the first screen says them: the version line (muted) and "Contenu non validé cliniquement." (strong). Then the finding panes, 16 px apart, one per item set and check (the highest level of each), then the notes and, in accompanied mode, the reminders (ink on the ground under hairlines, never a level colour), then the fixed sentences, the version line and "not clinically validated" in full, then the one primary action, "Revenir à la liste" (secondary when the danger banner's action is the primary one). Text she typed (a name kept as not recognised, the name under which a product was found) is a quotation ("« sirop du marché »") at reading weight, under the small muted label "Vous avez écrit :" in a card (in a summary row the label is said to screen readers only), never bold like a confirmed name and never inside a sentence of the app; the check list and the confirm screen quote it the same way. A danger result leaves who to call to the banner's action alone, which carries the danger and the signs. Home in woman mode says the same out-of-date notice before its primary action. See the Gallery sample at `#/design` in development.

The danger signs screen (`#/danger`, one tap from the header of every screen, even before the welcome questions) says the orientation with its condition first ("Si vous voyez un signe de danger : Allez au poste de santé maintenant.", it needs no pack), then "Voir qui appeler" (secondary, straight to the circuit: a sign may be missing from the list), then the 21 signs as large answers in three sections, in the order written in `knowledge/danger-signs.yaml` (the content sets it, the most urgent first, never sorted by id), then the one primary action, "C'est grave maintenant", which never refuses: with or without signs ticked it opens who to call with "Allez au poste de santé maintenant." (she said it is serious now), the signs ticked kept to be said when calling. Under a long list the primary action is held at the bottom of the screen while the list scrolls (`.sticky-action`: the ground colour under a hairline, flat; it measures its own height, whatever the text size, and the page keeps that much room when it scrolls a focused element into view, and a keyboard focus on an answer brings the whole answer into view, its words included, so the bar never hides what has the focus), on the danger signs, on the signs present now and on a confirm screen with a long list of strengths. Who to call (`#/danger/call`) opens with the calls, right under its title, so that on a 360 x 560 screen the first call link ends in the first screen whatever the instruction (the longest danger instruction of the pack is tested, open and locked, with and without a contact): one contact a row under hairlines (name or role, role, the number as text at title size, so it can be read out or typed on another phone, wrapping only between its groups (no group longer than six digits), and a 56 px "Appeler" link that opens the phone's dialler; the contacts kept on the phone come first, in the order of the circuit (relay, Bajenu Gox, ICP, midwife, other), then the deployment's; after a contact saved from who to call, "Contact enregistré : ..." once, in bold, under them, in a status region that is there, empty, when the screen appears and says it a moment later, so a screen reader reads it out); then always the emergency numbers as whole-width 56 px call links that say the service and the number ("Appeler le SAMU (1515)", "Appeler les pompiers (18)": built in, `app/src/config/emergency.ts`, or the deployment's), so a danger never ends on no one to call, locked or not, in both modes, and a keyboard always finds an action in the main area (shown at once, the built-in ones until the deployment file is read, while the contacts say they are loading); the first call link of the screen is its primary action (the first contact, else the first emergency number), the others secondary; then what to do: the danger banner (no action) when a danger was said, "Allez au poste de santé maintenant." from the danger signs screen, the result's own instruction from a result (kept as the message that says it, so a change of language words it again), else the same conditional orientation; then the signs to say when calling; then, under the heading "Circuit de référence" and a hairline, where to go: "Allez au poste de santé ou au centre de santé le plus proche.", always, and under it the national circuit text of the deployment when it gives one; last, the contacts of the phone: "Aucun contact enregistré sur ce téléphone." in bold when there is none (never when the phone storage could not be read: that is said instead), and, once the code is given, in both modes, a quiet link to add one ("Ajouter un contact": saving it comes back to the same who to call, banner and signs kept, the new contact first to call) or to change them; before the code, "Si des contacts sont enregistrés sur ce téléphone, ils apparaissent une fois le code entré." and a quiet "Entrer le code", worded the same whether contacts are saved or not. The boxed buttons of who to call are the calls; setting up the contacts and giving the code are quiet. Nothing on these screens says that a message went out, that someone knows or that help is coming: the app dials nothing itself and sends nothing.

The code screens (SCRUM-27) keep the plain web controls and say nothing about a profile. The code is made at the end of the welcome, typed twice ("Choisissez un code", then "Tapez le code une deuxième fois" with the field named "Le même code"; between them, for a code among the first ones tried, one digit repeated, digits in a row up or down or a year from 1950 to 2030, a plain warning, "Ce code est facile à deviner", that says why and not to use a year of birth, with "Choisir un autre code" primary and "Garder ce code" secondary: a second yes, never a refusal, never red), and asked whenever the session is locked ("Entrez votre code"), under the neutral address `#/unlock` (the screen it locked is held in memory only and comes back once the code is given): the field, then the keypad, then "Ouvrir", the one primary action, then a quiet "J'ai oublié le code" and "Réglages". A wrong code says so in ink with the triangle, with the tries left before a wait ("Encore 4 essais avant une attente."); during a wait (30 s at the fifth wrong code, doubled at each one, 30 minutes at most) the message counts down in minutes and seconds ("Attendez 1 min 59 s", never "119 secondes") and "Ouvrir" is dashed (`aria-disabled`, so the focus stays on it); a screen reader hears the wait once, in words, as the screen first showed it ("2 minutes" after a wrong code, the time left after a reload such as "1 minute 59 secondes"), from a status region filled a moment after the screen appears. A forgotten code ("Code oublié") says in plain words that the only way is to erase the profiles of the phone, with their history and the saved contacts (the language and the product information stay), asks to type EFFACER, then a last yes ("Tout effacer maintenant ?", "Effacer les profils" primary, "Revenir au code" secondary), then goes back to the welcome; nothing on it is red, it is not a danger sign. The neutral screen, what "Quitter" leaves, is the app's mark and neutral name in the middle of the screen, as on the welcome, and "Ouvrir" low, nothing else. In accompanied mode the start is the list of profiles: "Profils", then its actions at the top, in reach however long the list, "Ajouter un profil" (the primary action) and "Regarder sans enregistrer" (secondary: a passer-by looked up with the questions of a profile but no pseudonym, nothing stored); from 9 profiles a search field, "Chercher un profil", that keeps the rows whose pseudonym holds what is typed (without case or accents; "Aucun profil ne porte ce surnom." when none does); then one pseudonym a row as a whole-width secondary answer (it opens her check, with her list as it was left during the visit), where she stands and "Liste en cours : 2 produits" when a list waits for her, and "Modifier" at the end of the row. The settings show the language at any time and the mode only once the code is given (the mode in use says who the phone is for). Each is a group of native radios, and a choice applies only with the button that appears under its group once the answer differs from the one in use (the screen's one primary action while the choice waits, "Revenir à l'accueil", which would leave it, stepping down to secondary): "Switch to English" or "Passer en français", said in the language it switches to, and "Changer de mode". The arrow keys move through the answers and select them, as WAI-ARIA and screen readers expect of radios, and selecting changes nothing yet (WCAG 3.2.2, On Input): exploring the answers never turns the app into English or into the other mode. This is less surprising than radios that apply on Enter or Space only, which would break the radio pattern screen reader users know. Once applied, "Réglage enregistré." is said and the focus goes back to the answer chosen; a new answer clears it, so the next choice applied is said again. A choice not applied is forgotten when the session locks, never left for whoever gives the code next.

## Elevation & Depth

Flat. There are no shadows anywhere. Depth comes from tone (glass-white ground, white reserves) and from contours: the 3 px level contour, the 2 px control borders, the hairline rules.

### Named Rules

**The Painted Not Lifted Rule.** A pane is held by its contour, never floated by a shadow.

## Shapes

Panes with barely softened corners: 6 px (`--radius-md`) on result cards, the danger banner, buttons and inputs; 4 px (`--radius-sm`) on badges and summary tiles. The white reserve inside a result card has no corner or border of its own: it is a hole in the field, not a card inside a card.

Contours: 3 px (`--contour-width`) for level panes, invalid inputs and the focus ring; 2 px (`--border-width`) for controls and badges; 6 px (`--frame-width`) of level field around the reserve.

Pictograms are solid silhouettes on a 24-unit grid with a knocked-out glyph, drawn once and reused at three sizes by role: 24 px inline (badges, tiles, buttons), 32 px in a finding, 48 px in a headline or the danger banner. Danger is an octagon with an exclamation mark, before-next-dose an eye, next-contact a speech bubble with three dots, unknown a circle with a question mark. Form errors use a triangle, a shape no level uses.

**The One Shape One Level Rule.** A level pictogram appears only where that level is being said. The octagon never marks navigation: the header shortcut to the danger-sign list is its label and a chevron (an entry-point mark that no level uses), so it never reads as "danger now".

## Components

All components live in `app/src/ui/`, use only tokens (a test fails on any literal colour in `base.css`) and take French or English text from the caller.

### Buttons

- **Shape:** 6 px corners, at least 48 by 48 px (`--touch-target`); primary buttons are 56 px tall.
- **Primary:** ultramarine fill, white text, label weight. One per screen.
- **Secondary:** white fill, 2 px ultramarine outline and text.
- **Quiet:** no fill, underlined ultramarine text, still 48 px tall.
- **Hover:** primary darkens to deep ultramarine; secondary and quiet take the ultramarine tint.
- **Focus:** 3 px ring at a 2 px offset, in focus ultramarine (white on dark surfaces).
- **Pressed:** moves down 1 px over 120 ms.
- **Disabled:** dashed control contour, no fill, muted text, not-allowed cursor; never a flat grey that could pass for the unknown level.
- `variant` is required, with no default, so a screen never gets an extra primary by accident.
- Defaults to `type="button"`.

### Inputs / Fields

- **Order:** label, hint, error, then the input, the order people read in. The hint and the error describe the input (`aria-describedby`).
- **Style:** white fill, 2 px control contour, 6 px corners, 18 px text, at least 48 px tall.
- **Focus:** border turns ultramarine plus the focus ring.
- **Error:** `aria-invalid`, a 3 px ink border, and an ink message with a triangle mark that names the problem and the fix.
- **Disabled:** dashed border, no fill, muted text.

### Choice Groups

- **Use:** a question with a few answers (`RadioGroup`) or a list to tick (`CheckboxGroup`), in a `fieldset` named by its legend. Native radios and checkboxes, never buttons dressed as answers.
- **Order:** legend, hint, error, then the answers, as in a text field. The hint and the error describe the group.
- **Answer:** a whole-width label at least 56 px tall with the native control (24 px) and the words; the label is the target. White fill, 2 px control contour, 6 px corners, label weight at the snug line height (1.3): many answers, such as the danger signs, are sentences on two or three lines. The words keep the user's text size, are never hyphenated and break between words only: in a list narrow for the text size (under 13rem, so 360 px at 200 percent) the native control goes above the words and the side padding drops to 4 px, so each line has the list's width and "l'accouchement" keeps its letters together; a word is cut only when it is wider than the list on its own.
- **Chosen:** ultramarine contour and the ultramarine tint, ink text; the native mark says it in shape too, so colour is never alone.
- **Error:** every answer takes the 3 px ink contour, `aria-invalid` and the message as its description (some screen readers skip a fieldset's description); the message is ink with the triangle, as in a text field. A failed save moves focus to the first answer to fix and scrolls its whole question into view.
- **Focus:** the 3 px focus ring goes around the whole answer (`:has(:focus-visible)`), the words included; browsers without `:has` keep the ring on the native control.
- **Layout:** short answers (yes, no) sit side by side while they fit and wrap otherwise; longer ones stack. A main question of a screen takes the title size; a follow-up the label size.
- **Exclusive answer:** "none of these" sits after the list, set apart, and clears the list (and the list clears it): an explicit answer, so a forgotten box is never read as none. Where it is the answer expected most of the time and the list is long, it comes first instead, set apart by a hairline under it (`SectionedCheckboxGroup`): the danger signs present now ("Aucun de ces signes", spec section 7.1, screen 8), so it is never taken for the end of a list nobody read.
- **Long list of strengths:** on the confirm screen, a product with more than 5 strengths (DOLIPRANE has 15) shows the boxes of the strength typed first, then "Je ne sais pas", with a secondary "Voir tous les dosages (15)" under them (the focus goes to the first strength it shows); with no strength typed, the whole list. For such a product "Oui, c'est ce produit" alone is held at the bottom of the screen while the question and the units scroll (`StickyAction`), what it adds said in the flow just above it, so it is in the first screen at 360 x 800; when the bar would take more than a third of the screen's height (large text on a small phone) it stays in the flow instead. "Non, chercher encore" comes after the form.
- **Sections:** a long list (the 21 danger signs) is split into sections, each a group named by its heading at label weight (during pregnancy, after the birth, the baby). A screen may show some sections first (those of the profile) with a secondary "see all" action under them; once pressed, it is gone and the focus goes to the first answer it showed, in the order of the list (a section shown before the others too), so the new answers are read next; a ticked answer always keeps its section shown, and no answer is ever hidden for good.

### Microphone (voice input)

- **Place:** beside the search field, at the end of its row, the field taking the rest; the field is 56 px tall there, as the button. Shown only where the browser can record and run the speech model: the keyboard path is whole without it.
- **Shape:** a 56 px square, 6 px corners, white with the 2 px ultramarine outline and an ultramarine microphone (a capsule on a stand, a shape no level uses). Its name says what it does: "Dire le nom".
- **Recording:** filled ultramarine, a white square inside ("Terminer l'enregistrement"), the pulsing ring (Motion). Opening the microphone or thinking: dashed and muted, `aria-disabled`, so the focus stays on it.
- **Panel:** under the form, one live line in bold (read once by a screen reader, and short while recording, "J'écoute en wolof.", so a screen reader is quiet again before she speaks), then what goes with it: "Dites le nom, puis touchez le carré pour terminer.", the seconds at title size for the eye ("3 s sur 8") and "L'enregistrement se termine seul après 8 secondes."; "Je réfléchis..." with its small hint; "J'ai entendu : nebeday"; a refused microphone or an error as a notice (ink and the triangle) in plain words with "Écrire le nom" (and "Installer la voix" when its files are missing); a secondary "Annuler" while busy. What was heard goes in the field: the candidates below are those of a typed name, and "Je ne trouve pas ce ..." is not offered for a text the machine wrote (she types it first). When none matches: first, in bold, that nothing matches, then "Écrire le nom" and "Choisir dans la liste des remèdes" (or "des médicaments"): the whole list, cut by first letter under headings, each entry with its local names ("Nom local : nebeday, nebedaay (wolof)") and opening its confirm screen.
- **Voice screen** (`#/voice`): the lead and, in bold, that the voice stays on the phone; the language as a question (Wolof first, each with its size), the model of the one chosen, the advice to install on wifi at the health post, then "Installer la voix en ..." as the one primary action. Installing: a plain progress bar on the control contour filled in ultramarine, the megabytes and the percentage, a secondary cancel; going back is then the primary action, the download goes on. Installed: the language and the size in bold, how to use it, and a secondary removal asked twice.

### Header and Quick Exit

- **Band:** the ultramarine shell band on every screen, the welcome included, in two rows. The first holds the app mark and neutral name (the way home; the mark alone on the welcome, which shows the name itself) and the danger signs shortcut, which ends it, and nothing else: the shortcut keeps one place at every width (a 320 px phone, a phone held sideways, a tablet) and in every state (welcome, locked, open, offline, the neutral screen), so a thumb that learned where it is never meets "Quitter" there, and a woman who opens the app for the first time in an emergency reaches the danger signs before any welcome question (Back brings her to the step she had reached). The first row never wraps: on a narrow band (under 20rem) or at large text the name shows as the mark alone, a 48 px target that keeps the name as its accessible name, and the shortcut's words wrap inside it rather than leave the row. The second row, 12 px under the first and only when there is something to show, holds the offline badge and the quick exit at its end. Each row ends at its end. At large text the band's paddings stay at their size at normal text (the room goes to the words), and both its buttons stay in the first screen of a 320 x 640 phone at 200 percent; on a short screen (under 45rem tall) its padding tightens to 4 px around its 48 px targets.
- **Quick exit:** once the code is given, "Quitter" sits at the end of the band's second row, after the offline badge when it shows, never in the shortcut's place: outlined in white on the band, transparent, with a close mark (two strokes, a shape no level uses), so it reads as leaving and never as one more page. One tap, no question: the session locks in every tab of the app, the check in memory is forgotten (with the lists waiting for the other women of the visit and a passer-by's answers) and the neutral screen takes the history entry's place. Before the code it shows on the danger signs and who to call only, where signs may be ticked without the code; there it hides them the same way.
- **Offline readiness:** Home and the list of profiles carry a live line after their actions, so the primary action follows the question and no notice but the out-of-date base (on Home) comes between them: a notice (ink, triangle) while the app would not open without the Internet, always with what to do (keep the Internet on, turn it back on, open the app again with it, or open it in Chrome), then a quiet meta line, "Prêt sans Internet". The status screen repeats it under "Sur ce téléphone", with whether the phone keeps the data for good (and, when it may not, that adding the app to the home screen helps).

### Code Input

- **Field:** a password field (label, hint, error, input), so assistive technologies never read the digits, spaced at title size and heading weight; `inputmode="numeric"` opens the phone's numeric keypad. It is a one-time code (`autocomplete="one-time-code"`) with no name and the password managers' ignore marks, so no browser offers to keep the code and fill it in for anyone on a shared phone.
- **Keys:** large keys laid out as on a phone (1 to 9, then 0 under 8 and "Corriger" beside it), 56 px or more, white with the control contour and ink digits at headline size: answers, not actions. They never take the field's focus, so the phone's keyboard does not cover them; a screen reader hears how many digits are in, never which. The key that takes the last digit off says "Corriger" ("Delete" in English), named "Corriger le dernier chiffre" for a screen reader: never "Effacer", the word typed to erase the profiles after a forgotten code, so "tapez Effacer" can never mean both. It is dashed while there is nothing to take off (`aria-disabled`, so a tap never drops the focus). It keeps its key beside 0, on a 320 px phone too, so the one wide button under the keypad is the primary action; only when its word cannot fit a key (keys under 16rem in all, large text) does it take a row of its own, the digits keeping their places. On a short screen (under 45rem tall) the keys are 48 px and the steps of the screen tighter, so the primary action ("Continuer", "Enregistrer le code", "Ouvrir") stays in the first screen of a 320 x 640 phone once the code is typed, a wrong code said included (after a wrong or different code, the error takes the place of the lead).

### Level Badge

The level as a compact tag: pictogram (24 px) and name, on the level field with a 2 px contour, 4 px corners. Never one without the other.

### Result Card (signature component)

One finding as a level pane. The caption band carries the 32 px pictogram and the level name at title size, the strongest line; the white reserve carries the product name (18 px, 800, at the heading level the page outline gives: `headingLevel`; several products each on their own line, the list word "et" starting the next line in the reading weight), the reading fields (children: the risks and the term note; a card that stands for several findings of one product and check, such as two pregnancy rules over a range of weeks, keeps the level and orientation of the highest and says every distinct risk, and in accompanied mode every rule and source), then who to show and when (`orientation`, title size, down to the reading size when the card is narrow for the text size, so "pharmacien" and "d'information" stay whole; under a hairline), then its action if any (`action`: a quiet "Voir qui appeler" under a card below the danger level whose orientation says to go now if something happens, never a second primary action), then the details for the health worker (`details`, accompanied mode, under a hairline: the fact, then each risk's detailed risk with its own evidence level and capped note just under it, small; in a card of several risks each block starts with its risk, so a level is never matched to a risk by position), then the source and rule lines (`meta`, small, under a hairline, each source named in the language of the screen with "documents en anglais" at reading weight when its citations keep English titles). With `whyLabel` the details and the source lines are inside one native disclosure, closed (`details` and `summary` "Pourquoi ?": drawn as the quiet action beside it, ultramarine, underlined, 48 px tall, under a hairline, with a plus that becomes a minus once open, a shape no level uses and not the chevron, which says "go there"; described by the card's heading, so several "Pourquoi ?" are told apart), so a card is short for a slow reader and a health worker opens it with one tap; the result passes it in accompanied mode. Both modes thus read the same lines first. The card renders the orientation itself, so no finding can lack one or put it out of order; the one exception is a danger card whose orientation is the danger banner's instruction, which leaves it to the banner (`orientation` null): the instruction is said once, at the top. The heading says the level before the product (screen readers only; the caption shows the same words to the eye and is hidden from them), so a screen reader that jumps by heading hears both, and the `article` is named by its heading. Product names are never hyphenated (a hyphen the box does not have would mislead), and a number in them keeps its unit on its line (a no-break space); a word breaks only if it cannot fit alone. The card is a size container (it trims its padding under 18rem, where a reading word wider than its line is hyphenated rather than cut), so its parent must give it a width: a block, a grid track or a stretched flex item, never a parent that sizes to its content.

### Danger Banner

The danger field across the content: the level line first (48 px octagon and the level name in text, label size), then the instruction (the banner's largest line, at the heading level the page outline gives: headline size, or title size for an instruction longer than 40 characters, down to the reading size when the banner is narrow for the text size, so that a word such as "maintenant." never breaks; the banner is a size container and its padding stays at 16 px at large text), then one action button (white, dark crimson text, 56 px; its text holds 7:1 at rest and on hover). The level line names a danger sign when one is present, otherwise the product danger ("Danger : à montrer maintenant"). The instruction is the orientation the danger cards share when they all give the same one (a fever's "Allez au poste de santé maintenant pour faire un test.", a rule's own), and "Allez au poste de santé maintenant." when they differ; every danger orientation says now, so a card never gives a slower instruction than the banner; a danger card that gives the same words leaves them to the banner, so the instruction is said once. On who to call the banner has no action: the call links above it are the actions. The level line and the instruction are the alert region (`role="alert"`), the button outside it: screen readers say the words shown when the banner appears, in the current language, and read them once when going through the page, with no hidden copy and no group around them named by the same words (the heading already names the instruction). When it shows, its action is the screen's only primary action and every other button on the screen is secondary.

### Motion

Minimal. The only motion is the press response: background colour and a 1 px move over 120 ms with an exponential ease-out. Under `prefers-reduced-motion: reduce` both are removed. State changes snap; nothing enters, fades or slides.

One exception, so that a recording is seen at a glance: while the microphone records, a 3 px ultramarine ring around the button grows and fades every 1.4 s (`--duration-pulse`). Under reduced motion the ring stays, still: the filled button, the square inside it and the words "J'écoute" with the seconds still say it records.

## Do's and Don'ts

### Do:

- **Do** show every level as its pictogram and its name together, in the level's pane, with the name as the strongest line.
- **Do** give every Button an explicit variant.
- **Do** keep one primary action per screen; when a danger banner shows, its action is that one.
- **Do** keep every sentence read aloud at 18 px and every reading pair at 7:1 or more.
- **Do** say who to show and when right after a finding's risks, then (accompanied mode, behind "Pourquoi ?") the details, then source and evidence, in that order; the version is said short near the top and closes the screen.
- **Do** hatch the unknown field, and follow it with who to show it to.
- **Do** keep targets at 48 px or more and check every screen at 360 px wide and at 200 percent text.
- **Do** take colours from `tokens.css` only, and add every new text pair to `CONTRAST_PAIRS`.

### Don't:

- **Don't** use green, anywhere, for anything.
- **Don't** let colour carry meaning alone: no coloured dot, stripe or chip without the pictogram and the name.
- **Don't** use crimson outside the danger level, not even for form errors.
- **Don't** use a level pictogram for navigation or decoration; the octagon belongs to the danger level alone.
- **Don't** hyphenate product names.
- **Don't** use a flat grey for anything that could be read as a level; disabled is dashed.
- **Don't** add shadows, gradients (other than the unknown hatch), glass or blur.
- **Don't** nest a bordered, rounded box inside a level pane: the reserve is a hole in the field.
- **Don't** show a check mark or any sign that could read as "safe", "verified" or "no risk".
- **Don't** add a kicker or eyebrow label above a heading.

## Result screen brief

Shape brief for the result screen, the most important screen of the app. The interview answers were inferred from `PRODUCT.md`, the implementation design (sections 2, 7.3 and 10) and the SCRUM-16 ticket, because this run had no one to answer questions.

1. **Job and audience.** A relais, a Bajenu Gox, a midwife or a depot keeper has just confirmed one or more products for a woman whose term (or baby's age) is known. She holds a shared low-cost Android phone at arm's length, often outdoors in direct sun, and reads the result aloud. The woman may not read: she follows the pictogram and the colour. Mode: Operate.
2. **Outcome and proof.** In under a minute the reader can say the overall level, then for each product: the risk (no numbers), who to show it to and when, the source and evidence level (accompanied mode), the knowledge base version, "not clinically validated" and the fixed sentences. Proof of success: the result is read aloud top to bottom without hunting, and the level is unmistakable in greyscale and in sunlight.
3. **Selected direction.** Suwer, the Senegalese reverse-glass painting: each level is a flat field of colour held by a darker painted contour and named by a caption, framing a white reserve where the words sit. Ultramarine carries the shell and actions only. Atkinson Hyperlegible Next at heavy weights.
4. **Scope and boundaries.** This ticket ships the tokens, base styles, six components and a development-only Gallery with sample result screens built from them. The real screen arrives in SCRUM-25. Anti-goals: traffic-light green, check marks that read as "safe", illustrated mothers and babies, pastel clinical teal, dashboards and grids of identical cards, dark mode chosen by taste.
5. **States and ranges.** One to six findings (typically one to three). Product names from one word ("Doliprane") to a long remedy name with a local name in brackets. Level names up to 34 characters in French ("À montrer avant la prochaine prise"); French runs about 25 percent longer than English. States: danger sign present (banner), every level, "nothing found" (grey), long text, 200 percent text.
6. **Interaction and layout.** One column from 360 px. A summary list of every finding, most urgent first, then the situations of the profile that the knowledge base does not read yet (plain notes, never a level), then the finding panes, then the fixed sentences and the version line, then the single primary action. When a danger sign is present, the danger banner sits first and its action is the screen's only primary action. No gesture-only action, nothing a reader must say hidden (the health worker's details are one tap away behind "Pourquoi ?", a native disclosure, since SCRUM-50), browser back works.
7. **Constraints and open decisions.** Offline, Android Go class phones, 48 px targets, WCAG 2.2 AA with reading text at 7:1 for sunlight, French and English through translation files, `Level` from `@siapso/engine`. Settled in SCRUM-25 (inferred from the brief, no one to ask in that run): the danger banner, then the summary list (two findings or more), stand for the headline level, so no pane repeats another pane's caption right above it; unknown findings keep the engine's order (last, by level); the primary action is "Revenir à la liste", which keeps the check; after the code the header adds the quick exit (SCRUM-27, see Header and Quick Exit).
