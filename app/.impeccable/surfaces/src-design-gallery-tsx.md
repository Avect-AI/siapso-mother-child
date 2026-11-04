---
version: 1
slug: 'src-design-gallery-tsx'
primary_target: 'src/design/Gallery.tsx'
related_targets: ['src/ui/ResultCard.tsx', 'src/ui/LevelBadge.tsx', 'src/ui/DangerBanner.tsx']
---

# Surface brief: visual system gallery and result screen components

Scope: the base visual system (tokens, base styles, six components) and the development-only Gallery that shows them inside a sample result screen. Visitor mode: Operate. The real result screen ships in SCRUM-25 and inherits this brief.

Audience and job: a relais, Bajenu Gox, midwife or depot keeper reads a result aloud on a shared low-cost Android phone, outdoors, to a woman who may not read. The result must be understood in under a minute: level, risk, who to show and when, source, version.

Constraints: 360 px minimum width, 48 px targets, WCAG 2.2 AA (reading text held at 7:1 for sunlight), never green, never colour alone, one primary action per screen, French and English.

Assumptions (no human answer mechanism in this run): the interview answers were inferred from PRODUCT.md, the design spec sections 2, 7.3 and 10, and the SCRUM-16 brief.

## Direction contract

THESIS: A result reads like a suwer, the Senegalese reverse-glass painting: each level is a flat field of colour held by a dark painted contour and named by its caption, framing a white reserve where the words sit. It refuses the clinical white card with a teal header and a traffic-light chip.

OWN-WORLD: Glass-white ground, white reserves, ultramarine for the shell and for actions only. Crimson, orange, chrome yellow and mid grey exist only as level fields, each with its own darker contour. Atkinson Hyperlegible Next at heavy weights. Flat, no shadows. Pictograms are solid silhouettes with a knocked-out glyph.

STORY: The reader sees the level before reading, reads the caption aloud, then who to show and when. The woman follows shape and colour. Nobody mistakes grey for fine.

FIRST VIEWPORT: At 360 by 800: ultramarine header band with the product name and the danger signs access; a full-width headline band with a 48 px pictogram and the highest level name; the first finding card, framed in its level colour, starting above the fold. The one primary action closes the content.

FORM: candidate 6 of 7, suwer (reverse-glass painting), seed:71e5c4f7596d6139.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Raises from declined challengers

- Star atlas (fixed magnitude ramp): pictograms take one of three fixed sizes by role (headline 48, finding 32, inline 24), never an arbitrary size.
- Acetate tab manual (one size does the work): every sentence read aloud is set at one reading size; hierarchy comes from the frame, the caption band and weight.
- Emigre bitmap specimen (one form at every size): each pictogram is one drawing on a 24-unit grid, reused at every size, never redrawn.
- Jet-age ticket wallet (fixed fields in a fixed order): every finding lists the same fields in the same order: level, product, risk, who and when, source and evidence, version.
- Variable font specimen (snap between named states): state changes snap; the only motion is a short press response, removed under reduced motion.

Competitive alternate kept on record: airport yellow wayfinding (one message per band, pictogram in an inset tile) held product clarity but lost audience identification.
