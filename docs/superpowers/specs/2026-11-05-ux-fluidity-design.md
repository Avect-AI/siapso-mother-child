# SIAPSO Mother-Child: a lighter check flow (fluidity study and redesign)

Status: proposed on 2026-11-05, for review by the controller and the team before any implementation.
Tickets: SCRUM-56 (fluidity of the user experience), SCRUM-59 (pharmacist and health professional use, added the same day); SCRUM-57 (prescription scan or upload) is designed in its own ticket and gets a slot here.
Context: `PRODUCT.md`, `DESIGN.md`, `docs/intended-use.md`, `docs/privacy.md`, `docs/superpowers/specs/2026-11-03-implementation-design.md` (called "the implementation design" below; its section numbers are used as they are).

French interface sentences are quoted with their accents, as the interface writes them. Every sentence proposed here is a draft for the translation files (`app/src/i18n/fr.ts`, `en.ts`) and must pass the forbidden words test.

## 1. Why

The team, after its own quick test (2026-11-05):

> "Nous jugeons la fluidité, l'expérience utilisateur reste complexe, beaucoup de manipulations à faire, cela peut décourager l'utilisation. Nous souhaitons que vous travailliez sur ce point qui reste très important pour la viabilité de l'application."

They also want to scan or upload a prescription (SCRUM-57), and, if the app is fluid, pharmacists could use it every day to alert women from their prescription and tell the prescribing doctor (SCRUM-59).

This document measures the main journeys as they are, finds every step that can be removed, merged, defaulted or deferred without losing a safety or privacy invariant, compares three overall approaches, recommends one, and gives the new flows, target numbers, an invariants checklist, a phased plan of independent pull requests with their tests, and the measurement method to run again after each phase. It changes no code.

## 2. Summary

- **Baseline (360 x 800, French, production build).** A returning woman needs 8 taps, 14 keystrokes and 8 screens to see the result for one product (about 30 s in the touch keystroke model of section 3.3); the first use needs 17 taps, 20 keystrokes, 12 screens and 3 scroll gestures (about 54 s); a relay creating a new woman's profile needs 17 taps, 22 keystrokes, 10 screens and 4 scrolls (about 54 s); a passer-by at a depot 15 taps and 9 screens; a pharmacist with a four-product prescription 25 taps, 55 keystrokes, 18 screens and 7 scrolls (about 100 s), with no handout and no note for the prescriber. The danger path is already short: 3 taps from the locked phone to a call link.
- **Where the taps go.** Each product costs 3 taps and 3 screen changes (add, search, confirm, back); the result costs 3 taps and 2 screens after the list (see the result, no sign, see the result); the first use spends 5 taps, 8 digits and 5 screens before her first question about the pregnancy; profile forms put the explicit "none" answer of the situations last, 2 scroll gestures down; the strength question shows 16 answers for "doliprane" although no rule reads the strength unless a daily count is given.
- **Recommendation: approach B, one check screen.** Products, the woman's term, the danger signs present now and the result live on one screen: one search field for medicines and remedies with voice and the prescription scan beside it, a tap on a candidate adds it (the tap is the confirmation; an inline question only when something must be asked), the danger signs question is one tap on the same screen just before the result, and the result appears under the list and updates as products are added. Around it: the welcome in one screen (language from the phone, the mode and the code together), the code opening at its length, the woman starting on her check, answers defaulted where a default cannot lower a level, and a professional mode for pharmacies.
- **Targets.** A returning woman: one product to result in at most 2 taps (plus the 4 code digits and the name), 2 screens, no scroll; two products in 3 taps. First use to a first result in at most 6 taps, 3 screens. A relay with an existing woman: 3 taps; a new woman: 8 taps, 4 screens. A passer-by: 6 taps, 3 screens. A pharmacist: a four-product prescription to a result with every detail and source open in 8 taps on 1 screen, then 2 taps for each output. Danger: never more taps than today.
- **Plan.** Fifteen pull requests (P0 to P14) in seven phases: a fluidity harness with budgets first, quick wins that keep today's screens, then the one check screen in four steps, then accompanied mode, then the professional mode (gated on the team's decisions of section 14 and the regulatory questions of section 15), then the scan slot (SCRUM-57), then budgets tightened to the targets and a live test round.

## 3. Method

### 3.1 What was measured

- **Build.** The team preview at `http://localhost:5173` (a production build; knowledge pack 0.1.0 of 2026-11-04; `origin/main` was `160de43` that day), read only, never stopped.
- **Browser.** Playwright 1.64 (Chromium), one browser at a time, a new context for each journey, closed after it: viewport 360 x 800, mobile, touch, device scale factor 1, locale fr-FR, service workers allowed. Interface in French.
- **Set-up out of the count.** What a journey assumes (onboarding, saved profiles) is done first and not counted; "opening the app again" is a new load of the start address, which locks it as a real start does.
- **Common answers.** Code 2468 (tapped on the app's keypad), pregnant at 24 weeks given today, not breastfeeding, no long-term situation. Names typed in full: `ibuprofene`, `paracetamol`, `doliprane`, `doliprane 1000`, `clamoxyl 1g`, `bi profenid`, `tardyferon b9`. At 24 weeks ibuprofen and ketoprofen are "À montrer avant la prochaine prise".

### 3.2 Counting rules

- **Tap:** one press on a control: a button, a link, an answer of a question, a candidate, a text field that does not have the focus yet. A tap that the next screen does not need (an answer already chosen by default) is not made and not counted.
- **Keystroke:** one character typed, or one digit tapped on the code keypad.
- **Screen:** each change of what the screen is (its address and its main heading; on the welcome, its question). Coming back to the list counts as a new screen, as it is one for the eye.
- **Scroll:** the gestures needed, before a tap, to bring its target wholly into view from where the page stands (one gesture moves about 70 percent of the screen; a bar held at the bottom shortens the visible area). Reading the result to its end is not counted (its length is given apart).
- **Words:** the words of the main area when a screen first shows (a reading load, not a reading time).
- **App wait:** time from a tap to the element it brings, measured on the study machine (a desktop: a floor, not a phone).

### 3.3 Time model

Seconds are modelled with a touch keystroke-level model, so that designs are compared under the same assumptions: 1.35 s per screen (mental preparation and taking in the new question, the KLM "M" operator), 1.1 s per tap (pointing a target and tapping it, for a novice on a phone), 0.7 s per keystroke (a soft keyboard, hunting the keys), 1.5 s per scroll gesture (the gesture and finding the place again), plus the measured app waits. This is not a prediction for a low-literacy user who reads aloud and explains to the woman: those minutes come on top and are measured only with real users (section 13).

### 3.4 Limits

No real phone (the code derivation, PBKDF2 at 600 000 iterations, takes 0.25 s on the study machine and several seconds on an Android Go phone: to be measured on one); no voice (the headless browser has no microphone; the voice path is counted by design); no real users; names typed in full (a prefix often shows the right candidate sooner). The scripts and every screenshot are on the study machine:

`<scratch>` = `C:\Users\djene\AppData\Local\Temp\claude\ff82dbb411fd0739\80df48ab-1299-4671-bb8b-5e8fe4fd1870\scratchpad\scrum56\`

- `<scratch>meter.mjs` (the harness), `<scratch>journeys.mjs` (the journeys), `<scratch>results.json` (every count and step), `<scratch>steps.txt` (each step with its screenshot);
- `<scratch>shots\<journey>-<step>-<what>.png`, one screenshot after every step (for example `j1-01-welcome-language.png` to `j1-21-voir-le-resultat-2.png`). Appendix A lists them by journey.

Phase 0 of the plan (section 12) moves the harness into the repository, so that the numbers can be produced again by anyone.

## 4. Baseline

### 4.1 Results

| Journey | Taps | Keys | Screens | Scrolls | Words read | App wait | Modelled time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| J1 First use, woman mode, ibuprofen (welcome, code, profile) | 17 | 20 | 12 | 3 | 521 | 0.8 s | 54 s |
| J2a Returning woman, one product | 8 | 14 | 8 | 0 | 349 | 0.5 s | 30 s |
| J2b Returning woman, two products (ibuprofen, paracetamol) | 12 | 25 | 11 | 1 | 520 | 1.1 s | 48 s |
| J3a Relay, existing woman, one product | 8 | 14 | 8 | 0 | 360 | 0.6 s | 30 s |
| J3b Relay, new woman, one product | 17 | 22 | 10 | 4 | 464 | 0.6 s | 54 s |
| J4 Passer-by at a depot, one product | 15 | 16 | 9 | 4 | 440 | 0.7 s | 47 s |
| J5a Danger from the locked phone, to a call | 3 | 0 | 3 | 0 | 252 | 0 | 7 s |
| J5b Danger from Home, one sign ticked, to a call | 4 | 0 | 3 | 0 | 265 | 0 | 9 s |
| J5c Danger sign ticked during a check, to a call (from the signs now screen) | 4 | 0 | 3 | 0 | 306 | 0 | 9 s |
| J6a Strength to choose: "doliprane", box DOLIPRANE 1000 mg | 4 | 9 | 4 | 1 | 207 | 0.1 s | 18 s |
| J6b Strength typed: "doliprane 1000" | 3 | 14 | 4 | 0 | 203 | 0.1 s | 19 s |
| J6c Strength unknown: "paracetamol", "Je ne sais pas" | 4 | 11 | 4 | 1 | 142 | 0.1 s | 19 s |
| J7 Pharmacist at the counter, prescription of 4 products, details opened | 25 | 55 | 18 | 7 | 1157 | 0.7 s | 102 s |

J6 journeys start and end on the check list (one product added). J7 uses today's nearest path, accompanied mode and "Regarder sans enregistrer", then opens every "Pourquoi ?" (one: the three grey cards have none).

On every journey that ends on a result, the level of the first finding is in the first screen, except J7: with four findings, the summary rows push the first card to 816 px (the summary says the levels). The result is 1.4 screens long for one product in woman mode, 1.7 in accompanied mode, 3.9 screens for the four products of J7 and 5.4 with "Pourquoi ?" open.

### 4.2 Where the taps and screens go

Returning woman, one product (J2a, 8 taps, 8 screens):

| Part | Taps | Screens | Steps |
| --- | --- | --- | --- |
| Open | 1 | 2 | code (4 digits), "Ouvrir", Home |
| Start the check | 1 | 1 | "Regarder un produit" |
| Add the product | 3 | 3 | "Ajouter un médicament", the name, the candidate, "Oui, c'est ce produit" |
| Get the result | 3 | 2 | "Voir le résultat", "Aucun de ces signes", "Voir le résultat" |

First use (J1, 17 taps, 12 screens): welcome and code 4 taps, 8 digits, 4 screens (language, mode, code, code again); Home 1 tap, 1 screen; her profile 6 taps, 2 digits, 1 screen, 3 scroll gestures; then the 6 taps and 6 screens of a check.

### 4.3 Findings

- **F1. The round trip of each product.** Adding one product is 3 taps and 3 screen changes (the add button, the search, the confirmation, back to the list). In J7, 12 of the 18 screens are this round trip.
- **F2. The result behind three taps.** After the list: "Voir le résultat", "Aucun de ces signes" (the expected answer, first in the list), "Voir le résultat" again, on two screens.
- **F3. A long road to the first question that matters.** The first use spends 4 taps, 8 digits and 4 screens on the welcome and the code, then Home, before her profile.
- **F4. Explicit "none" last.** "Aucune de ces situations" comes after the list of situations: 1 to 2 scroll gestures on every profile form (4 on the relay forms).
- **F5. Strength questions nobody needs.** "doliprane" shows 16 answers (one scroll) and "paracetamol" 3, yet no rule reads the strength of paracetamol unless a daily count is given; 89 of the 209 product families of the pack hold several products, so the confirm screen asks which one (a strength or a form), while only 2 families (ASPEGIC and KARDEGIC, aspirin around the 100 mg threshold of `strength-above-mg`) need one for every check, and 7 paracetamol families need one only with a daily count.
- **F6. Home is a pass-through in woman mode.** One tap and one screen at every use.
- **F7. A new woman goes back to the list.** After saving a new profile, one more tap opens her check.
- **F8. The danger path is short and must stay so.** 3 taps from the locked phone to a call link, 4 with a sign ticked.
- **F9. The pharmacist has no way through.** Accompanied mode serves the counter poorly: 25 taps and 55 keys for four products, the code at each return after two minutes, details behind "Pourquoi ?", an orientation written for a relay ("Montrez ce produit à la sage-femme ou à l'infirmier avant qu'elle en reprenne."), and nothing to give the woman or the prescriber.
- **F10. The app itself is quick.** Waits are under 1.2 s per journey on the desktop, mostly the code derivation; what costs time is the steps, not the engine or the resolver.

## 5. What must not change: the invariants

Every change below is checked against these (section 11 gives the full checklist with its tests):

1. **The product is always confirmed before a result.** A model or the resolver proposes; a person picks the product by an explicit action. Nothing is added from a voice transcript, a scan or a typed text without that action.
2. **The danger signs present now are asked before a result**, possibly on the same screen, with an explicit answer (never a forgotten box read as none).
3. **Who to call is always one tap from a danger** (the banner's action, a danger card's action, the band's shortcut on every screen).
4. **Nothing reassuring.** Never green, never "safe", "verified" or "no risk"; unknown is grey and always followed by who to show it to; no default can lower a level.
5. **Privacy on a shared phone:** a code before anything stored about a woman shows, the auto-lock after two minutes, the quick exit on every screen once open, nothing about a woman in the address or the page title, nothing leaves the phone by default.
6. **Models propose, rules decide;** the engine alone sets the level; woman mode shows no details, accompanied mode keeps them under "Pourquoi ?".

## 6. Every step, examined

Gains are for the journeys named, against the baseline; time uses the model of section 3.3.

| # | Change | Journeys | Gain | Risk | How the invariants hold |
| --- | --- | --- | --- | --- | --- |
| S1 | Language from the phone (`navigator.languages`: French unless the first language is English), the other language one tap away on the welcome | J1 | -1 tap, -1 screen (-2.5 s) | A French reader on a phone set to English (or the reverse) taps the switch, which is in the first screen | None touched |
| S2 | Mode and code on one screen: the choice collapses into a line with "Changer", the code part shows under it; a new code is 4 digits by default ("Choisir un code plus long" before typing gives 5 or 6), the field moves on at the 4th digit to "Tapez-le encore", and the code is kept as soon as both match | J1, J3, J4 at first use | -2 taps ("Continuer", "Enregistrer le code"), -2 screens (-4.9 s) | A mistyped second entry says so and asks it again (as today); a code among the first ones tried still gets its warning and "Garder ce code" | Code still typed twice, stored only when none is, same verifier |
| S3 | Unlock at the code's length: the length is stored with the verifier, the code is tried when that many digits are in, without "Ouvrir" | J2, J3, J4, J7 | -1 tap per opening (-1.1 s) | A wrong digit is tried at once and counts as a wrong try (5 before the first wait, as today). The length is a new clear fact in storage: an attacker who reads storage learns 4 instead of "4 to 6"; it does not weaken a 6-digit code, and a 4-digit code falls to the offline search in the same time either way (`docs/privacy.md`, Not covered) | Tries counted before the work, lockout unchanged; `docs/privacy.md` and `docs/threat-model.md` updated |
| S4 | Woman mode starts on her check; Home merges into it (the lead, the out-of-date base notice, "Prêt sans Internet", and the quiet links "Mon profil", "Réglages", "Base de connaissances", "À propos" at the end) | J1, J2 | -1 tap, -1 screen per use (-2.5 s) | The settings and about are lower on the screen; the out-of-date notice moves above the search | About still reachable before the code from the code screen; the band unchanged |
| S5 | The term in weeks by default: after "Enceinte : Oui" the weeks field shows and takes the focus; "En mois", "Date des dernières règles" and "Je ne sais pas" stay as answers beside it | J1, J3b, J4, J7 | -2 taps ("En semaines", the field) (-2.2 s) | Someone who knows months taps "En mois", as today; the numeric keyboard may cover the next question (a scroll) | "Je ne sais pas" stays one tap; nothing assumed |
| S6 | "Aucune de ces situations" first, set apart by a hairline, as "Aucun de ces signes" is (`DESIGN.md`, Exclusive answer) | J1, J3b, J4, J7 | -1 to -2 scrolls per form (-1.5 to -3 s) | Tapping it without reading the list, the same risk as the danger signs today; the list follows right under it | Explicit answer kept; nothing defaulted |
| S7 | "Ce terme date de quand ?" preselected "Aujourd'hui" for a passer-by and in professional mode (she says her term at the counter); still asked, never preselected, for a saved profile in accompanied mode | J4, J7 | -1 tap (-1.1 s) | A term copied from an old booklet read as today: an underestimated term. Mitigated by the 28-day look-ahead and "Un autre jour" on screen. Team decision (section 14, Q-T3) | Engine unchanged; the term used is said on the result |
| S8 | A new profile saved opens her check ("Enregistrer et regarder ses produits"), not the list | J3b | -1 tap, -1 screen (-2.5 s) | None | None touched |
| S9 | The default pseudonym ("Femme 3") is selected when its field takes the focus, so typing replaces it | J3b | -1 tap (-1.1 s) | None | Pseudonym rules unchanged |
| S10 | The strength is asked only when a rule reads it: a family whose strengths sit on both sides of a `strength-above-mg` threshold of a rule on its substance (ASPEGIC, KARDEGIC today), or a family under a daily maximum rule once a daily count is given; otherwise the product is added with its strength unknown ("Dosage non précisé") | J2b, J6, J7 | -1 tap and up to 1 scroll per such product; 89 families asking today, 2 always and 7 with a count after | The product is named less precisely on the result. A daily count given without the strength reads the family's strengths (lowest certain, highest possible, implementation design section 2), which can say "peut dépasser" more often: the strength is then asked on the item | Engine unchanged (strength unknown is already handled at least as cautiously as a known one); computed from the pack, tested over every family |
| S11 | A tap on a candidate adds it: the candidate row shows what the confirm screen showed (name, substances and strength, "Vous avez écrit :" or "Vous avez dit :", "Nom sur la boîte :", "Ne contient pas : codéine"), its name says "Ajouter ..."; an inline question opens under it only when something must be asked: the strength (S10) or "Est-ce la même boîte que ... ?" | J1 to J4, J6, J7 | -1 tap ("Oui"), -1 screen per product (-2.5 s) | A wrong tap adds a wrong product: it shows at once in the list with "Retirer", the live line says "... est ajouté à la liste.", and the result names it | The tap on a named candidate is the confirmation; nothing is added without it, from any entry (typing, voice, scan, "Ce nom ressemble à :") |
| S12 | The search on the check screen: one field for medicines and remedies ("Nom du médicament ou du remède"), the microphone and the scan beside it, the candidates of both lists under it, each with "Médicament" or "Remède" | J1 to J4, J6, J7 | -1 tap (the add button), -2 screens per product (-3.8 s) | Names that exist in both lists: the kind is said on each row; the resolver is evaluated on both lists together (`eval/resolver`) | The resolver still never decides a level; "Je ne trouve pas ce produit" keeps its "Ce nom ressemble à :" step |
| S13 | The danger signs question on the check screen, just before the result: the question lists the signs of her groups in words, then "Non, aucun de ces signes" (one tap, the result shows) and "Oui, au moins un" (the checklist, as today, then the result) | J1 to J4, J7 | -2 taps, -1 screen (-3.6 s) | Answering without reading: the signs are written right above the answer, as today where "Aucun de ces signes" is the first box above them | Explicit answer, never preselected; no result before it |
| S14 | The answer kept for this check: adding or taking off a product does not ask it again; it is shown above the result ("Signes de danger maintenant : aucun", "Changer"), and forgotten when the check is left, another woman or passer-by is chosen, at every lock (two minutes), at the quick exit and at a reload | J2b, J7, every change of list after a result | -3 taps, -2 screens per new result view | A sign that appears during the few minutes of one check: the answer is on screen with "Changer", and the band's "Signes de danger" is one tap away; the two-minute lock bounds how old it can be | Changes the rule "a change to the list asks it again" (implementation design section 2): a decision to record |
| S15 | The result on the check screen, under the list, worked out again at each change; one history entry per check, kept up to date | J1 to J4, J7 | -1 screen per check; a product added after a result costs no result step | A longer screen; a danger must not be missed below the fold: when the level becomes a danger, the focus goes to the banner and the banner comes into view, as on today's result | Same result content and order; the banner's action stays the one primary action |
| S16 | Accompanied mode: women of the visit as one-tap chips on the check ("Awa : 2 produits", "Fatou", "Autre femme"); "Regarder sans enregistrer" asks its questions on the check screen | J3, J4 | -1 tap, -1 screen per change of woman; J4 -1 screen | The wrong woman: her pseudonym and term head the screen | Lists per woman in memory as today (`docs/privacy.md`) |
| S17 | Professional mode for pharmacies (section 9) | J7 | -17 taps, -17 screens, details open | Sections 14 and 15 | Section 9 |

Considered and set aside:

- **No code until something is saved** (a first check without a code, the code asked when she keeps her answers). It saves 8 digits and one screen once per phone, against a new privacy model (what a phone without a code shows, mode visible before any code). Kept as a question for the team (section 14, Q-T2), not recommended now.
- **Situations asked only when a rule needs them.** In accompanied mode the IPTp reminder reads the HIV situation (`unless-conditions`) for every pregnancy, so the question would show almost always; the gain is too small for a second kind of question at the gate.
- **A single candidate added without a tap**, and **"Tout ajouter"** for a scanned prescription: both break invariant 1.
- **"Je ne sais pas" preselected** for the strength: S10 goes further (no question at all when no rule reads it) and keeps the question explicit where a rule does.
- **A longer auto-lock** at the counter: the two-minute lock and its warning band stay; the professional mode forgets the patient instead of asking a code (section 9).

## 7. Approaches

### A. Trim the current flow

Keep today's screens (check, search, confirm, danger signs now, result) and apply S1 to S11 and S13 on them: the welcome in one screen, the code opening at its length, the woman starting on her check, weeks by default, "none" first, strength only when a rule reads it, the confirm screen only when it asks something, and one tap on the danger signs screen ("Aucun de ces signes" becomes a button that opens the result).

- Returning woman, one product: 4 taps, 6 screens (code, check, search, check, signs, result).
- Relay, new woman: 10 taps, 8 screens. Passer-by: 9 taps, 8 screens. Pharmacist: 15 taps, 14 screens to the result.
- For: small pull requests, every screen stays where testers know it, low risk. Against: each product is still a round trip of 2 screens and the result still a separate place; the team would still count many screens, and voice and scan stay behind a button on another screen.

### B. One check screen (recommended)

A plus S12 to S16: one screen holds who it is for and her term, the products (search, voice, scan, candidates, list), the danger signs question and the result, which updates as products are added. The welcome is one screen, the start of woman mode is her check, and a professional mode starts on the same screen for a patient nobody keeps (S17).

- Returning woman, one product: 2 taps, 2 screens. Relay, new woman: 8 taps, 4 screens. Passer-by: 6 taps, 3 screens. Pharmacist: 8 taps, 1 screen.
- For: the largest gain where use repeats (every check, every product); voice and scan are on the screen where products are added; the professional mode is the same screen with other defaults. Against: a deeper change to the check (routes, history entries, focus rules, the result inside a longer screen), so more tests to move; a danger must be brought into view on a longer screen.

### C. Ask later

B plus no code until something is saved and no question before the first product: the welcome asks the mode only, and her pregnancy, term, breastfeeding and situations are asked at the gate with the danger signs; the code is made when she chooses to keep her answers.

- First use: 6 taps, 12 keys, 2 screens (B: 6 taps, 20 keys, 3 screens); every other journey as B.
- For: the shortest first use. Against: the gain is once per phone (8 digits), while it changes the privacy model (what an app without a code shows), the meaning of the mode, and adds a lazy question at the gate; most of the team's pain is in repeated use, which B already removes.

### Recommendation

**B**, built in the order of section 12 so that A's quick wins ship first and the team feels the change within days, with C's "no code until saved" left to the team (Q-T2). B is the only approach that meets the targets of section 10.2 for repeated use and the pharmacist's journey, and it keeps every invariant with one recorded change of rule (S14: the danger signs answer kept within one check).

## 8. The recommended design

### 8.1 Welcome (first use)

One screen, under the band (with "Signes de danger" as today):

1. The app's mark and neutral name; a quiet switch to the other language ("English" on a French screen, "Français" on an English one), the language taken from the phone.
2. "Qui utilise l'application ?" with three large answers:
   - "Je suis enceinte ou j'allaite" (hint "Pour moi-même");
   - "J'accompagne des femmes" (hint "Relais, Bajenu Gox, agent de santé, ICP, sage-femme, dépositaire");
   - "Pharmacie ou professionnel de santé" (hint "Au comptoir, avec une ordonnance. Rien n'est enregistré."), see section 9.
3. Once answered (woman or accompanied), the answers collapse into one line ("Je suis enceinte ou j'allaite", "Changer") and the code part shows: "Choisissez un code de 4 chiffres" with the keypad (and "Choisir un code plus long" under the hint), then "Tapez-le encore" at the 4th digit, kept when both match (the weak-code warning and "Garder ce code" when it applies). The code opens woman mode on her check (8.3), accompanied mode on the list of profiles.
4. The professional answer opens the professional check at once (no code: nothing is stored, section 9).

A welcome cut short, a code made in another tab and the forgotten-code erase behave as today (`docs/privacy.md`).

### 8.2 Code and unlock

The code screen as today, with no "Ouvrir" step: once the number of digits of the stored code is in, the code is tried (the try counted first, as today). "Ouvrir" stays on screen for a keyboard or a screen reader user and after a wrong code. The verifier record keeps `length` (4, 5 or 6) beside `salt`, `hash`, `iterations` and `version`; a verifier from before has no length and keeps "Ouvrir" until the next right code adds it (in the same transaction that makes a verifier again today).

### 8.3 The check screen

The same screen in every mode; what differs is said per mode. At 360 x 800, top to bottom:

```
[band: Carnet | Signes de danger >]            (as today)
[                         x Quitter]
Un médicament ou un remède ?                   (h1; accompanied: "Ce qu'elle prend")
Environ 24 semaines . Modifier                 (who and her term; accompanied: "Awa : environ 24 semaines")
[Awa : 2 produits] [Fatou] [Autre femme]       (accompanied only: chips, 8.8)
(out-of-date base notice, when it applies)
Nom du médicament ou du remède                 (label; hint: the name on the box, even misspelt)
[ ibupro...........  x ] [mic] [scan]           (field 56 px; the scan from SCRUM-57)
  Ibuprofène (générique)  Médicament  >        (candidates, at most 4, both lists)
  ADVIL  Ibuprofène  Médicament  >
  Je ne trouve pas ce produit
Liste                                          (the products added, each with "Retirer")
  Ibuprofène (générique)          Retirer
Avez-vous un de ces signes maintenant ?        (shown once a product is listed, 8.5)
  Fièvre, saignement par le vagin, ... (Voir tous les signes)
  [ Non, aucun de ces signes ]  [ Oui, au moins un ]
--- Résultat ---                               (8.6, once the question is answered)
```

- **Her answers when there is no profile yet** (her first check in woman mode, a passer-by, a patient in professional mode): an "about her" block above the search, with the questions of a profile in the order and with the defaults of S5 to S7 ("Enceinte ?", the weeks field, "Allaitez-vous ?" with the baby's age when yes, the situations with "Aucune de ces situations" first). Once answered, the block folds into the line "Environ 24 semaines . Modifier" and the search field takes the focus. In woman mode her answers are saved as her profile once the block is complete (under her code, as today: `self: true`); a passer-by and a professional patient stay in memory only.
- **Focus.** On opening, the search field takes the focus when her term is known (the keyboard opens: she came to look up a product); otherwise the first unanswered question does.
- **One primary action at most.** The danger banner's action when a danger shows; "Fiche pour la patiente" in professional mode once a result shows; none otherwise (the answers and candidates are secondary-styled answers, as today).
- **Outdated term.** "Le bébé est-il né ?" still replaces the screen when the term is past 42 weeks (implementation design section 2), and a possibly past term still adds the signs after the birth to the question.
- **Back.** The check is one history entry: Back leaves it (to the start or the list). Inline questions are not history entries. Nothing about a product goes in the address, as today. `docs/privacy.md` ("The browser history", which says the steps of a check are separate entries) is updated with it: the browser history then shows `#/check` alone for a check, which tells less.

### 8.4 Adding a product

- Typing shows the candidates of both lists under the field (the resolver as today, run on both, at most 4 rows, each saying "Médicament" or "Remède"). Voice puts what it heard in the field as today ("Vous avez dit :"), and its candidates are the same rows. The scan (SCRUM-57) puts its proposals in the same place, one row per line read, each to be tapped.
- **A tap on a row adds it** when nothing must be asked. The row's accessible name is "Ajouter <name>"; the field clears and keeps the focus for the next name; the live line says "<name> est ajouté à la liste." (as today on the list), and the list shows it with "Retirer" (and "Remettre" after a removal, as today).
- **An inline question under the row** replaces the confirm screen when it is needed, and "Ajouter" then follows the answer:
  - the strength, only under S10 (its answers as today, the boxes of a typed strength first, "Je ne sais pas" always offered);
  - "Est-ce la même boîte que <name> ?" when the family is already listed (as today's confirm screen);
  - a daily count for a product under a daily maximum rule is not asked when adding: the listed item offers "Combien par jour ? (facultatif)" with its steps, and asks the strength then if the box has none (S10).
- "Je ne trouve pas ce produit" keeps today's behaviour, its "Ce nom ressemble à :" rows following the same tap-to-add rule.

### 8.5 The danger signs question

- Shown under the list once at least one product is listed (no result without a product), never before her term is known.
- The question names the signs of her groups (pregnancy; after the birth and the baby when she breastfeeds or the baby may be born) in one short list of words, with "Voir tous les signes".
- "Non, aucun de ces signes" (one tap): the result shows under it and takes the focus (a button press, so moving the focus is expected, WCAG 3.2.2). "Oui, au moins un": the checklist opens in place, as today's screen (her groups first, "Voir tous les signes" for the 21, nothing ticked), then "Voir le résultat".
- The answer stays for this check (S14), shown as a line above the result with "Changer", and is forgotten when the check is left, another woman or passer-by is chosen, at every lock, the quick exit and a reload. It never comes back after a lock (a new epoch, as the danger signs ticked today).
- The band's "Signes de danger" and who to call are unchanged.

### 8.6 The result on the check screen

- The result section is today's result, in its order (the term used, the danger banner first when there is one, the out-of-date notice, the summary rows from two findings, the version line and "Contenu non validé cliniquement.", the cards, the notes and reminders in accompanied mode, the fixed sentences, the version, "non validé cliniquement" in full), with its heading "Résultat" (h2) instead of a separate screen. Woman mode shows no details; accompanied mode keeps "Pourquoi ?" closed; professional mode opens them (section 9).
- It is worked out again (the engine is pure and fast) whenever the list, her answers or the signs change; a change of level is said once by the live region; a level that becomes a danger moves the focus to the banner (its `role="alert"` speaks) and scrolls it into view.
- One history entry per check (as today, at most 20 per profile), written when the result first shows and kept up to date while the check stays open.
- "Revenir à la liste" goes (the list is above). In accompanied mode "Femme suivante" (secondary) goes back to the list of profiles.

### 8.7 Woman mode

Her start is her check (S4). The first use opens it with the "about her" block (8.3). Her profile stays one tap away ("Mon profil", in the line of her term and at the end of the screen), with "Supprimer ce profil" as today.

### 8.8 Accompanied mode

- The start is the list of profiles, as today, with "Ajouter un profil" and "Regarder sans enregistrer" at the top.
- **A new woman:** the profile screen as today with S5, S6, S9, and "Enregistrer et regarder ses produits" (primary) opening her check (S8). "Ce terme date de quand ?" stays asked for a saved profile.
- **A passer-by:** "Regarder sans enregistrer" opens the check screen with the "about her" block (no pseudonym), "Femme de passage : rien n'est enregistré" as today, "Aujourd'hui" preselected (S7).
- **Switching women:** the women with a list waiting during the visit show as chips under the heading; one tap opens her check with her list; "Autre femme" goes to the list. The lists stay in memory only and are forgotten as today.

### 8.9 Danger path

Unchanged: the band's "Signes de danger" on every screen (welcome, locked, professional mode), "Voir qui appeler" first on it, "C'est grave maintenant", who to call with the calls first. From the check: "Oui, au moins un", a sign, "Voir le résultat", the banner's "Voir qui appeler", the call: 5 taps, as today from the check (8.5).

### 8.10 Entry points: voice and the prescription scan (slot for SCRUM-57)

The search row holds the field, the microphone (as today, `DESIGN.md`, Microphone) and a third 56 px button for the scan when SCRUM-57 ships it. The contract SCRUM-57 must meet here:

- its result is a list of proposals, each a candidate row of 8.4 (name, substances, strength, kind, "Lu sur l'ordonnance : <text read>" quoted like a typed name), never items of the list;
- each proposal is added by its own tap (invariant 1), with the same inline questions; a line not recognised offers "Je ne trouve pas ce produit" with the text read;
- the image stays on the phone, is never stored nor sent, and is dropped once read (as the audio of the voice, `docs/privacy.md`).

At 360 px the field keeps at least 12rem beside the two buttons; under that, the buttons wrap under the field.

### 8.11 Targets, scrolls and reading

- Every tap target stays at 48 px or more; candidate rows and the signs answers at 56 px.
- On a 360 x 800 phone: the danger signs answer in the first screen once one product is listed, without scroll; the level of the first finding (or the summary) in the first screen after "Non, aucun de ces signes"; the "about her" block answered with at most one scroll gesture.

## 9. Professional mode (SCRUM-59)

### 9.1 Purpose and audience

A pharmacist (or a doctor, a midwife, a nurse) at the counter: a woman hands a prescription; every product is looked up in seconds; the professional details and sources are read directly; she receives a plain-language handout; if needed, the prescriber receives a structured note. Depot keepers stay in accompanied mode (the implementation design, section 10: "the depot keeper is not a pharmacist").

### 9.2 Behaviour

- **Entry.** The welcome's third answer, or "Changer de mode" in the settings. It opens the professional check, titled "Regarder une ordonnance" (never a form of "vérifier").
- **Nothing stored, no code.** No profile, no history entry, no saved contact is written in this mode; the patient's answers and list live in memory only, like a passer-by's. With nothing stored about anyone, no code is asked. Leaving the mode for woman or accompanied mode makes the code then, or asks it when the phone already has one (profiles kept from another mode stay sealed and are never shown in professional mode). The danger signs band, the quick exit ("Quitter") and the two-minute lock stay: the lock (with its 30-second warning band), "Quitter" and "Nouvelle patiente" forget the patient, as a passer-by is let go today; the neutral screen's "Ouvrir" then opens an empty professional check.
- **The test pack line.** While the pack says `clinicallyValidated: false`, a notice heads the screen and every output: "Pack de test, non validé cliniquement : ne pas utiliser pour une décision." ("Test pack, not clinically validated: do not use it for a decision.").
- **The check.** The screen of 8.3 with the "about her" block for the patient (the seven situations of accompanied mode, "Aucune de ces situations" first; "Aujourd'hui" preselected, S7), the search row with typing, voice and the scan, the danger signs question ("La patiente a-t-elle un de ces signes maintenant ?"), then the result with the accompanied content and **every "Pourquoi ?" open by default** (the fact, the detailed risks with their evidence level and wording, the sources, the rule id), reminders and notes shown; the privacy taps that hide an HIV-related situation, the reminders and contraception notes stay as in accompanied mode until the team decides otherwise (Q-T5).
- **Orientation.** Interim: the accompanied orientations (about her). Professional wording (what the pharmacist tells the prescriber, and when) is a content question for the clinical committee (Q-C1).

### 9.3 The two outputs

Generated on the phone from the result on screen, shown in a preview first, shared only by an explicit action of the professional: "Partager" (the phone's share sheet, `navigator.share`, text, offered only where the browser has it), "Imprimer" (the browser's print, a print style sheet), "Copier" (the clipboard). The preview says "Rien n'est envoyé ni enregistré par l'application." Nothing is written to storage, the history or the address; the preview is forgotten with the patient.

**"Fiche pour la patiente"** (handout, plain words, woman-mode content):

- the date; "Pour : <name>" only when the professional types a name in the preview's optional field ("Nom (facultatif, jamais enregistré)"), otherwise no name at all;
- her situation in plain words ("Enceinte d'environ 24 semaines", "Allaite, bébé de 3 mois");
- for each product: the level name, the product's name, the risk in plain words, who to show it to and when (woman-mode wording);
- the fixed sentences, the knowledge base version, "Contenu non validé cliniquement.", "Cet outil ne remplace pas un soignant." and, while it applies, the test pack line;
- never a dose, an alternative, a detail for the professional or a source list (woman mode, `docs/intended-use.md`).

**"Note pour le prescripteur"** (structured):

- the date; "De : <pharmacie>" and "À : <prescripteur>" only when typed in the preview (optional, never stored);
- the patient: no name unless typed; the term used and its precision, breastfeeding and the baby's age, the situations declared;
- the products as on the prescription (names confirmed);
- for each finding above grey: the level, the products, the fact, the detailed risk, the evidence level with its wording, the sources (citation and version), the rule id; the grey ones listed as "Notre base ne contient rien sur ce produit pour cette situation.";
- the question, editable in the preview, by default: "Pouvez-vous nous dire si cette prescription tient compte de la grossesse (environ 24 semaines) ?" (never a suggestion to stop, change or replace, never a dose or an alternative);
- the knowledge base version, "Contenu non validé cliniquement : ne l'utilisez pas seul pour décider.", the test pack line, "Note préparée sur le téléphone ; l'application n'envoie rien."

Both texts are built by pure functions from the evaluation and the interface dictionaries, so that the forbidden words test, the no-dose test and the no-name test run on them for every reference case.

### 9.4 Pharmacist journey (J7) in the new design

1. Opens the app (professional mode, no code): "Regarder une ordonnance", the test pack line, the patient block.
2. "Enceinte ?" Oui (1 tap); weeks field focused, "24" (2 keys); "Aujourd'hui" already chosen; "Allaite ?" Non (2); "Aucune de ces situations" (3).
3. The field has the focus: `clamoxyl 1g`, tap the row (4); `bi profenid` (5); `doliprane 1000` (6); `tardyferon b9` (7). No strength question (S10).
4. "Non, aucun de ces signes" (8): the result, details and sources open.
5. "Fiche pour la patiente" (9), "Partager" or "Imprimer" (10); "Note pour le prescripteur" (11), the question read, "Partager" (12).
6. "Nouvelle patiente" (13) or the two-minute lock: everything forgotten.

To the result: 8 taps, 51 keystrokes, 1 screen (baseline 25 taps, 55 keys, 18 screens, about 102 s; modelled about 49 s, of which 36 s of typing, which voice or the scan reduce).

## 10. New flows and target numbers

### 10.1 Steps of each journey

**J1 First use, woman mode.** Welcome: "Je suis enceinte ou j'allaite" (1); code: 4 digits, again 4 digits (kept). Her check with the "about her" block: "Enceinte ?" Oui (2), "24" (focused), "Allaitez-vous ?" Non (3), "Aucune de ces situations" (4), saved; the field: `ibuprofene`, tap the row (5); "Non, aucun de ces signes" (6); the result.

**J2a Returning woman, one product.** Code: 4 digits (opens). Her check, the field focused: `ibuprofene`, tap the row (1); "Non, aucun de ces signes" (2); the result.

**J2b Two products.** As J2a, then `paracetamol`, tap the row (3), added with "Dosage non précisé" (no daily count given); the result updates.

**J3a Relay, existing woman.** Code (opens). The list: "Awa" (1). Her check: `ibuprofene`, the row (2); "Non, aucun de ces signes" (3).

**J3b Relay, new woman.** Code. "Ajouter un profil" (1). Profile: "Femme 3" selected, `Coumba`; "Enceinte ?" Oui (2), "24" (focused); "Ce terme date de quand ?" Aujourd'hui (3); "Allaite ?" Non (4); "Aucune de ces situations" (5); "Enregistrer et regarder ses produits" (6). Her check: `ibuprofene`, the row (7); "Non, aucun de ces signes" (8).

**J4 Passer-by at a depot.** Code. "Regarder sans enregistrer" (1). The check with the "about her" block: Oui (2), "24", "Aujourd'hui" preselected, "Allaite ?" Non (3), "Aucune de ces situations" (4); `ibuprofene`, the row (5); "Non, aucun de ces signes" (6).

**J5 Danger.** As today (8.9).

**J6 Strength.** `doliprane`, the row (1): "DOLIPRANE, dosage non précisé". `doliprane 1000`, the row (1). `paracetamol`, the row (1). A daily count given on a paracetamol item without a strength asks the strength on that item.

**J7 Pharmacist.** Section 9.4.

### 10.2 Targets

Targets are upper bounds for the harness of section 13 (same queries, same counting rules). Keys are those of the code and the names; a shorter name or the voice lowers them.

| Journey | Baseline taps / keys / screens / scrolls / time | Target taps / keys / screens / scrolls / time |
| --- | --- | --- |
| J1 First use, woman | 17 / 20 / 12 / 3 / 54 s | 6 / 20 / 3 / 1 / 28 s |
| J2a Returning woman, one product | 8 / 14 / 8 / 0 / 30 s | 2 / 14 / 2 / 0 / 16 s |
| J2b Returning woman, two products | 12 / 25 / 11 / 1 / 48 s | 3 / 25 / 2 / 0 / 25 s |
| J3a Relay, existing woman | 8 / 14 / 8 / 0 / 30 s | 3 / 14 / 3 / 0 / 18 s |
| J3b Relay, new woman | 17 / 22 / 10 / 4 / 54 s | 8 / 22 / 4 / 1 / 33 s |
| J4 Passer-by | 15 / 16 / 9 / 4 / 47 s | 6 / 16 / 3 / 1 / 25 s |
| J5a Danger, locked phone, to a call | 3 / 0 / 3 / 0 / 7 s | 3 / 0 / 3 / 0 / 7 s (never more) |
| J5b Danger from the start, one sign, to a call | 4 / 0 / 3 / 0 / 9 s | 4 / 0 / 3 / 0 / 9 s (never more) |
| J5c Danger sign during a check, to a call | 5 from the check (4 from the signs screen) | 5 from the check (never more) |
| J6a "doliprane" | 4 / 9 / 4 / 1 / 18 s | 1 / 9 / 1 / 0 / 9 s |
| J6c "paracetamol" | 4 / 11 / 4 / 1 / 19 s | 1 / 11 / 1 / 0 / 10 s |
| J7 Pharmacist, 4 products, details read | 25 / 55 / 18 / 7 / 102 s | 8 / 51 / 1 / 2 / 50 s; each output 2 more taps |

Headline: **a returning woman goes from opening the app to the result for one product in at most 2 taps** (besides her 4 code digits and the name), on 2 screens, in about half the time.

## 11. Invariants checklist

Each line must hold after every phase; the test named is added or kept in the phase that touches it.

| Invariant | How the design keeps it | Test |
| --- | --- | --- |
| Product confirmed before a result | Only a tap on a named candidate row (or its inline question's "Ajouter") adds a product; typed text, a voice transcript, a scan proposal, a possible match never land in the list by themselves | Component test: no item without a tap, for typing, voice (mocked worker) and scan proposals; e2e `search.spec.ts`, `voice.spec.ts` updated |
| What the confirm screen said is still seen before adding | The row shows the name, substances and strength, "Vous avez écrit :" or "Vous avez dit :", "Nom sur la boîte :", "Ne contient pas : ..." | Component tests per case (alias, box name, missing substance, voice) |
| Danger signs asked before a result | The result section renders only with an explicit answer for this check ("Non, aucun" or at least one sign); never preselected | Component test: no result without the answer; e2e: a fresh check, another woman, after a lock, after a reload all ask again |
| The answer is never stale beyond the check | Forgotten when the check is left, at a change of woman or passer-by, every lock, the quick exit, a reload | Unit tests on the check state; e2e in `tabs.spec.ts` (lock from another tab) |
| Who to call one tap from a danger | Banner action, danger card action, band shortcut, in every mode, the professional mode and the welcome included | `danger.spec.ts` kept; new: from the check screen and the professional check |
| A danger is seen | A level that becomes a danger takes the focus to the banner and scrolls it into view; the banner's action is the one primary action | e2e: a product danger added after a first result moves the focus to the banner |
| Nothing reassuring | No result section without a product; the grey wording unchanged; no green; the new strings and the two outputs pass the forbidden words test | `i18n.test.ts`; a wording test over the outputs of every reference case |
| No default lowers a level | Defaults only where the engine reads the riskier case anyway (strength unknown) or where the answer is shown and one tap from change ("Aujourd'hui" for a passer-by, S7, a team decision); pregnancy, breastfeeding, situations and signs stay explicit | Unit test: `strengthMatters` over every family of the pack; reference cases unchanged |
| Code before stored data shows | Woman and accompanied modes as today; the professional mode stores nothing (no profile, history or contact write is possible in it) | Storage inventory test in professional mode (nothing new in IndexedDB, local or session storage); `encryption.spec.ts` |
| Auto-lock and quick exit | Unchanged; in professional mode the lock and "Quitter" forget the patient | e2e: idle two minutes in professional mode leaves an empty check |
| Nothing in the address or title | The check is one entry; no product, name or answer in the address; title stays "Carnet" | `isolation.spec.ts`, `layout.spec.ts` |
| Nothing leaves the phone by default | Outputs leave only by "Partager", "Imprimer" or "Copier"; no request at generation | e2e: no network request during and after generating both outputs |
| Models propose, rules decide | Engine unchanged; the inline questions feed the same `CheckedItem` | Reference cases (`eval/cases`) unchanged, engine coverage |
| Woman mode shows no details | The result section in woman mode as today; the patient handout uses woman-mode content | `result.spec.ts`; output test: no evidence level, source or detail in the handout |
| Accessibility | 48 px targets, one primary action, focus on the heading or field a screen exists for, live region for additions and level changes, axe clean | `accessibility.spec.ts`, axe on the check screen in each state |

## 12. Phased implementation plan

Each step is one pull request, mergeable alone with CI green, ordered by dependency; every step updates the affected sections of the implementation design (section 7.1), `DESIGN.md` and, where named, `docs/privacy.md`, and tightens the fluidity budgets of Phase 0 for the journeys it improves. Interface steps go through `/impeccable shape`, `critique`, `audit` and `detect` as `CLAUDE.md` asks.

**Phase 0: measure in the repository**

| PR | Content | Tests |
| --- | --- | --- |
| P0 `test(app): measure the main journeys against budgets` | The harness of section 13 as a Playwright suite (`app/e2e/fluidity.spec.ts`, helpers in `app/e2e/fluidity/`), the journeys J1 to J7, a JSON report as a CI artefact, budgets set to the baseline | The suite itself, in the end-to-end job |

**Phase 1: quick wins on today's screens**

| PR | Content | Tests |
| --- | --- | --- |
| P1 `feat(app): welcome in one screen` | S1, S2 (language from the phone, mode and code on one screen, 4 digits by default, moves on and keeps the code) | `Welcome.test.tsx`, `CodeSetup.test.tsx`, `welcome-end.spec.ts`, `modes.spec.ts`, `language.spec.ts`; budget J1 |
| P2 `feat(app): open at the code's length` | S3, verifier `length`, `docs/privacy.md` and `docs/threat-model.md` | `code.test.ts`, `code-guard.test.ts` (a try counted before the work), `Unlock.test.tsx`, `encryption.spec.ts`; budgets J2 to J4, J7 |
| P3 `feat(app): lighter profile answers` | S5, S6, S7 (passer-by), S8, S9 | `ProfileEdit.test.tsx`, `profile-form.test.ts`, `QuickCheck.test.tsx`, `profile.spec.ts`, `visit.spec.ts`, `term-and-profile.spec.ts`; budgets J1, J3b, J4 |
| P4 `feat(app): ask the strength only when a rule reads it` | S10: `strengthMatters(pack, family)` from the pack's rules; the daily count on the list item, the strength asked there when a count is given | Unit test over every family of the pack; `Confirm.test.tsx`; the reference cases; an e2e for DOLIPRANE with and without a count; budget J6 |
| P5 `feat(app): add a product in one tap` | S11 on today's search screen: the row shows the confirm screen's facts, a tap adds, the confirm screen only for the strength or the same box | `Search.test.tsx`, `Confirm.test.tsx`, `search.spec.ts`, `names.spec.ts`, `voice.spec.ts`; budgets J1 to J4, J7 |

**Phase 2: one check screen**

| PR | Content | Tests |
| --- | --- | --- |
| P6 `feat(app): search on the check screen` | S12: the field, voice and the candidates of both lists on the check; `#/search` kept for the whole list and "Je ne trouve pas ce produit" | `Check.test.tsx`, `search-index.test.ts`, `pnpm eval:resolver` on both lists (new baseline), `search.spec.ts`, `voice.spec.ts`; budgets |
| P7 `feat(app): ask the danger signs on the check screen` | S13, S14; the rule change recorded in the implementation design section 2 and `docs/privacy.md` | `SignsNow.test.tsx` moved, check state tests (forgotten at each lock, change of woman, leaving), `danger.spec.ts`, `tabs.spec.ts`; budgets |
| P8 `feat(app): show the result on the check screen` | S15: the result section, one history entry per check, focus and scroll on a danger; `#/result` removed; `docs/privacy.md` (the browser history) | `Result.test.tsx` and `result-wording.test.ts` moved, `history.test.ts`, `result.spec.ts`, `layout.spec.ts` (200 percent text, 320 px), axe; budgets |
| P9 `feat(app): start woman mode on her check` | S4 and the "about her" block for her first check (saved as her profile) | `Home.test.tsx` folded, `Check.test.tsx`, `modes.spec.ts`, `offline.spec.ts` (readiness line); budgets J1, J2 |

**Phase 3: accompanied mode**

| PR | Content | Tests |
| --- | --- | --- |
| P10 `feat(app): switch women and look up a passer-by on the check` | S16: chips of the women with a list waiting; the passer-by's questions on the check screen | `Profiles.test.tsx`, `QuickCheck.test.tsx`, `visit.spec.ts`; budgets J3, J4 |

**Phase 4: professional mode (SCRUM-59)**, after the team's decision Q-T1 (section 14), the answers to Q-R1 to Q-R4 (section 15) and the update of `docs/intended-use.md`

| PR | Content | Tests |
| --- | --- | --- |
| P11 `feat(app): add a professional mode for pharmacies` | The welcome's third answer and the settings; the professional check (no code, nothing stored, lock and "Nouvelle patiente" forget the patient); the test pack line; details open; `docs/privacy.md` and `docs/threat-model.md` for the mode | `Welcome.test.tsx`, `Settings.test.tsx`, a storage inventory e2e (nothing written), `modes.spec.ts`; budget J7 |
| P12 `feat(app): give a patient handout and a prescriber note` | Section 9.3: pure builders, preview, share, print, copy | Builders over every reference case (forbidden words, no dose, no name unless typed, test pack line, sources in the note only); e2e: no request, nothing stored; print style sheet at 360 px |

**Phase 5: the scan slot**

| PR | Content | Tests |
| --- | --- | --- |
| P13 (SCRUM-57) | The scan button and its proposals as candidate rows (8.10) | Owned by SCRUM-57; invariant 1 tests of section 11 |

**Phase 6: measure and test with people**

| PR | Content | Tests |
| --- | --- | --- |
| P14 `test(app): tighten the fluidity budgets to the targets` | Budgets at the targets of section 10.2, the report against the baseline in `docs/` | The suite |
| Live test round | The personas of the implementation design section 12, plus a pharmacist at the counter, on the production build; findings triaged | Report in the PR of P14 |

## 13. Measurement method to run again

1. **Build.** A production build (`pnpm build`, then `pnpm --filter app preview`) or the team preview; note the commit and the pack version.
2. **Harness.** P0's suite (until then `<scratch>meter.mjs` and `<scratch>journeys.mjs`, run with `node journeys.mjs [j1 j2a ...]` and Playwright loaded through `createRequire` from `app/package.json`): one Chromium, a new context per journey, 360 x 800, mobile, touch, scale 1, fr-FR, service workers allowed.
3. **Counting.** The rules of section 3.2: taps through a helper that also counts the scroll gestures a target needs; keys through typing and the keypad helper; a screen at each change of address and main heading; words at each screen's first view; app waits from a tap to the element it brings.
4. **Same inputs.** Section 3.1 (code, term, names). A new journey keeps its own inputs in the suite.
5. **Report.** For each journey: taps, keys, screens, scrolls, words, app wait, modelled time (section 3.3 constants), the result's facts (first card position, level in the first screen, length in screens), and the screenshots; the budget check fails the suite when a journey goes over its budget.
6. **People.** The model compares designs; it does not replace users. After P14, the team runs a short field test with each kind of user (a woman who reads, a relay or Bajenu Gox, a depot keeper, a pharmacist; five of each if possible): task time from opening the app to saying the result aloud, errors (a wrong product added, a sign missed), and the Single Ease Question after each task; the same tasks on the old build give the comparison.
7. **Phone.** The same journeys timed once on an Android Go class phone (2 GB) for the app waits, the code derivation included.

## 14. Questions and decisions for the team

Team (product and privacy):

- **Q-T1.** The professional mode changes who the app is for and what it is used for (section 15). Do we build it in the pilot, and for whom?
- **Q-T2.** No code until something is saved (approach C): worth a change of the privacy model for 8 digits once per phone? (Recommended: no, for now.)
- **Q-T3.** "Aujourd'hui" preselected for a passer-by and a professional patient (S7).
- **Q-T4.** The danger signs answer kept within one check (S14), a change of the rule of the implementation design section 2.
- **Q-T5.** In professional mode, keep the taps that hide an HIV-related situation, the reminders and the contraception notes, or show them (the screen faces the professional)?
- **Q-T6.** The code's length kept in clear to open without "Ouvrir" (S3).

Clinical committee:

- **Q-C1.** Orientation wording for a professional (who the pharmacist tells, and when), and the default question to the prescriber.
- **Q-C2.** Should the patient handout carry the danger signs ("Allez au poste de santé maintenant si : ...")?
- **Q-C3.** Is "Dosage non précisé" acceptable on the result for the products whose strength no rule reads (S10)?

## 15. Regulatory questions raised by the professional use (to list, not to resolve)

The professional use changes the intended use. Today (`docs/intended-use.md`): "general health information, education and referral for pregnant and breastfeeding women in Senegal and the people who accompany them. It does not diagnose, prescribe or set a dose". A pharmacist who checks a prescription with the app and alerts the prescriber uses it to support a decision on a treatment. Before P11, the team needs answers on:

- **Q-R1. Intended use.** A new statement for the professional mode (or for the whole app), and whether the app stays "information, education and referral" when a professional uses it at dispensing; the About screen, `README.md` and `MEDICAL_DISCLAIMER.md` follow it (`tools/legal/intended-use.test.mjs`).
- **Q-R2. Medical device status.** Whether software that flags risks of a prescription for a professional is clinical decision support software regulated as a medical device or health product in Senegal, and which procedure applies with the ARP (Agence sénégalaise de Réglementation Pharmaceutique); references the team may consult: the IMDRF definitions of software as a medical device, the European MDR rule 11 for decision support software, the WHO guidance on digital health regulation.
- **Q-R3. Ordre des pharmaciens du Sénégal.** Whether a pharmacist may use a tool that is not clinically validated at dispensing, under which conditions, and how a pharmaceutical intervention addressed to a prescriber should be written and kept.
- **Q-R4. Clinical validation first.** Whether the professional mode may be offered at all while the pack is a test pack, even with the line "Pack de test, non validé cliniquement : ne pas utiliser pour une décision.", and what validation (pharmacist and midwife sign-off, a reference case review) unlocks it.
- **Q-R5. Personal data.** The handout and the note can carry a name and health data and leave the phone through the share sheet (messaging apps): the woman's consent, the pharmacist's responsibility, professional secrecy (a situation such as HIV in the note), and the rules of the Commission de Protection des Données Personnelles (CDP).
- **Q-R6. Liability and claims.** Who answers for a missed alert or a wrong one in professional use; how the mode may be described without claiming a validation the app does not have (`PRODUCT.md`, Evidence on Hand).
- **Q-R7. Who may use it.** Self-declared at the welcome, no check: is that acceptable, and how are depot keepers kept out of a mode meant for pharmacists?
- **Q-R8. Pharmacovigilance.** The link with adverse event reports (SCRUM-41) and the format the ARP expects.
- **Q-R9. "Never tell to stop, start or change a treatment."** Whether a note that asks the prescriber a question stays within this rule, and the exact wording allowed.

## Appendix A. Baseline screenshots by journey

All under `<scratch>shots\`. Each step's screenshot is taken after the step; "new screen" marks a change of screen.

- **J1** (`j1-01` to `j1-21`): welcome language (01), French (02, new: mode), woman (03, new: code), digits (04), "Continuer" (05, new: code again), digits (06), "Enregistrer le code" (07, new: Home), "Regarder un produit" (08, new: Mon profil), Oui (09), "En semaines" (10), 24 (11), "Allaite : Non" after 1 scroll (12), "Aucune de ces situations" after 1 scroll (13), "Enregistrer" (14, new: check), "Ajouter un médicament" (15, new: search), `ibuprofene` (16), the candidate (17, new: confirm), "Oui" (18, new: check), "Voir le résultat" (19, new: signs now), "Aucun de ces signes" (20), "Voir le résultat" (21, new: result).
- **J2a** (`j2a-01` to `j2a-11`): code screen (01), digits (02), "Ouvrir" (03, Home), "Regarder un produit" (04), then the product and the result (05 to 11) as J1 15 to 21.
- **J2b** (`j2b-01` to `j2b-16`): as J2a to 08, then `paracetamol` (09 to 13: the strength question with 3 answers in 11, "Je ne sais pas" in 12, "Oui" after 1 scroll in 13), the result (14 to 16, two cards).
- **J3a** (`j3a-01` to `j3a-11`): code (01, 02), "Ouvrir" (03, Profils), "Awa" (04), product and result (05 to 11).
- **J3b** (`j3b-01` to `j3b-20`): code (01 to 03), "Ajouter un profil" (04), pseudonym (05), the answers (06 to 11, 1 then 2 scrolls), "Enregistrer" (12, back to Profils), "Coumba" (13), product and result (14 to 20).
- **J4** (`j4-01` to `j4-18`): code (01 to 03), "Regarder sans enregistrer" (04), the answers (05 to 10, 1 then 2 scrolls), "Regarder ses produits" (11), product and result (12 to 18).
- **J5a** (`j5a-01` to `j5a-04`): code screen, "Signes de danger", "Voir qui appeler", the first call link. **J5b** (`j5b-01` to `j5b-05`): Home, the band, "Saignement par le vagin", "C'est grave maintenant", the call. **J5c** (`j5c-01` to `j5c-05`): signs now, "Fièvre", the result with its banner, "Voir qui appeler", the call.
- **J6a** (`j6a-01` to `j6a-06`): the check, search, `doliprane`, the confirm screen with 16 answers (04), "1000 mg, comprimé" after 1 scroll (05), back to the check. **J6b** (`j6b-01` to `j6b-05`): `doliprane 1000` preselected. **J6c** (`j6c-01` to `j6c-06`): `paracetamol`, 3 answers, "Je ne sais pas".
- **J7** (`j7-01` to `j7-31`): code (01 to 03), passer-by answers (04 to 10), four round trips (12 to 27; CLAMOXYL with 8 answers, its typed strength chosen, in 14), signs now (28, 1 scroll), "Aucun de ces signes" (29), the result with four summary rows (30), "Pourquoi ?" open on the one card that has it (31).
