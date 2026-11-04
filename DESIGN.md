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
2. **Orient, never prescribe.** Every finding ends its reading text with who to show and when, in bold.
3. **Built for the person in the room.** One hand, shared phone, bright sun, under a minute: reading text at 7:1, targets at 48 px or more, nothing hidden behind a gesture.
4. **Meaning never by colour alone.** Every level has its own silhouette and its name in text, always together.
5. **Traceable.** Source, evidence and version close every finding, in the same place every time.

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

| Level              | French                             | English                     | Pictogram                        | Field, text, contour                                           | Use                                                                                                                                 |
| ------------------ | ---------------------------------- | --------------------------- | -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `danger`           | Signe de danger                    | Danger sign                 | Octagon with an exclamation mark | Crimson, white text, dark crimson contour                      | Danger signs only, plus the one product rule with a written danger rationale. Orientation: go to the health post now.               |
| `before-next-dose` | À montrer avant la prochaine prise | Show before the next dose   | Eye                              | Orange, near-black text, burnt orange contour                  | Show the product to the midwife, the nurse or the pharmacist before the next dose. The highest level a product rule normally takes. |
| `next-contact`     | À signaler au prochain contact     | Mention at the next contact | Speech bubble with three dots    | Chrome yellow, near-black text, ochre contour                  | Tell the midwife at the next visit.                                                                                                 |
| `unknown`          | On ne sait pas                     | We do not know              | Circle with a question mark      | Hatched mid grey (two stripes), near-black text, slate contour | No reliable information, or nothing found. Never a reassurance: always followed by who to show it to.                               |

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

### Named Rules

**The No Green Rule.** No colour token has a hue between 75 and 165 degrees with saturation above 0.2. A test reads every token in `tokens.css` and fails on green.

**The Red Is For Danger Rule.** Crimson exists only as the danger field and its contour. Form errors are ink with a triangle mark, never red: a typo is not a danger sign.

**The Hatched Unknown Rule.** The unknown field is two grey stripes at 45 degrees, the map maker's mark for "no data". A flat grey reads as disabled or as nothing to worry about.

## Typography

**Body Font:** Atkinson Hyperlegible Next (with Roboto, Noto Sans, Segoe UI, Arial, sans-serif)

**Character:** one humanist family designed by the Braille Institute for low-vision readers, at heavy weights. It draws I, l and 1 apart, slashes the zero and opens its counters, which matters when a reader checks a product name on a box aloud. The Next release covers full Latin, so Wolof names (ŋ, ñ, ë) and French accents render in the same face.

Why a web font rather than the system stack: the phones run Roboto or a vendor face that changes with the Android skin, and Roboto's I and l are near twins. Atkinson Hyperlegible Next is OFL 1.1, self-hosted in `app/public/fonts/` with its licence, variable from 200 to 800, subset to Latin and Latin Extended: 52 KB in total, preloaded, `font-display: swap`, and cached offline with the app shell.

### Hierarchy

- **Headline** (800, 1.75rem / 28 px, 1.2): reserved for a screen's single lead line when one is needed.
- **Title** (800, 1.375rem / 22 px, 1.2): level names, the strongest line wherever a level is said: the result card caption and the danger banner's level line.
- **Body** (450, 1.125rem / 18 px, 1.5): every sentence read aloud: risk, orientation, fixed sentences. On a phone the measure stays well under 65 characters.
- **Label** (700 to 800, 1.125rem / 18 px, 1.2): product names in a finding (800), the danger banner sentence, level names in summary rows, buttons, field labels, the screen title.
- **Small** (450, 1rem / 16 px, 1.5): source, evidence and version lines, hints. Tabular numerals.

### Named Rules

**The One Reading Size Rule.** Everything read aloud is 18 px. Hierarchy comes from the pane, the caption band and weight, not from a ladder of sizes; nothing a reader must say is smaller than 16 px.

**The Weight For Sunlight Rule.** Body text is 450, not 400: a touch heavier holds up under glare.

**The Level First Rule.** The level name is always the strongest line: larger than the product name in a finding, bold before the product in a summary row, first in the danger banner.

## Layout

One column from 360 px, with a 16 px gutter (`--space-4`). The spacing scale has a 4 px base (`--space-1` to `--space-7`: 4, 8, 12, 16, 24, 32, 48 px). Findings are 16 px apart; fields inside a reserve are 12 px apart and separated by hairline rules, in a fixed order: risk, who to show and when, then source, evidence and version.

Components answer to their own width, not the viewport. The danger banner puts its action beside the sentence only when it has room and stacks otherwise. Under 18rem a result card trims its caption and reserve padding. Text beside a pictogram keeps a 10rem basis, so at large system text sizes it drops under the pictogram instead of overflowing. Pictograms are sized in rem and grow with the user's font size. At 360 px with text at 200 percent, nothing scrolls sideways.

The result screen opens with a summary list, one row per finding (a level tile, the level name in bold, then the product name), in the order of the cards, then the finding panes, then the fixed sentences, then the one primary action (see the Gallery sample at `#/design` in development).

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

### Level Badge

The level as a compact tag: pictogram (24 px) and name, on the level field with a 2 px contour, 4 px corners. Never one without the other.

### Result Card (signature component)

One finding as a level pane. The caption band carries the 32 px pictogram and the level name at title size, the strongest line; the white reserve carries the product name (`h2`, 18 px, 800) and the fields as children, ruled by hairlines. The `article` is named by the level, then the product, so a screen reader hears the level first. Product names are never hyphenated (a hyphen the box does not have would mislead); a word breaks only if it cannot fit alone. The card is a size container (it trims its padding under 18rem), so its parent must give it a width: a block, a grid track or a stretched flex item, never a parent that sizes to its content.

### Danger Banner

The danger field across the content: the level line first (48 px octagon and the level name in text, title size), then the sentence (`h2`, 18 px, 800), then one action button (white, dark crimson text, 56 px; its text holds 7:1 at rest and on hover). It is announced (`role="alert"`). When it shows, its action is the screen's only primary action and every other button on the screen is secondary.

### Motion

Minimal. The only motion is the press response: background colour and a 1 px move over 120 ms with an exponential ease-out. Under `prefers-reduced-motion: reduce` both are removed. State changes snap; nothing enters, fades or slides.

## Do's and Don'ts

### Do:

- **Do** show every level as its pictogram and its name together, in the level's pane, with the name as the strongest line.
- **Do** give every Button an explicit variant.
- **Do** keep one primary action per screen; when a danger banner shows, its action is that one.
- **Do** keep every sentence read aloud at 18 px and every reading pair at 7:1 or more.
- **Do** end every finding with who to show and when, then source, evidence and version, in that order.
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
6. **Interaction and layout.** One column from 360 px. A summary list of every finding, most urgent first, then the finding panes, then the fixed sentences and the version line, then the single primary action. When a danger sign is present, the danger banner sits first and its action is the screen's only primary action. No gesture-only action, no hidden content, browser back works.
7. **Constraints and open decisions.** Offline, Android Go class phones, 48 px targets, WCAG 2.2 AA with reading text at 7:1 for sunlight, French and English through translation files, `Level` from `@siapso/engine`. Open for SCRUM-25: whether the summary list replaces a single headline level (the implementation design names a "headline level"); the order of unknown findings relative to the others; the primary action wording; the header content after unlock.
