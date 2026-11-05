# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite + TypeScript, shipped as an installable web app (PWA) that works offline. Chosen by the Avect-AI team on 2026-11-03. Interface languages: French and English. Voice input understands French and Wolof.

## Users

Primary users are the people who already visit pregnant and breastfeeding women in rural Senegal: Bajenu Gox (community godmothers), relais, community health workers, the nurse in charge of a health post (ICP), midwives and pharmacy depot keepers. They use the app during a home visit, at a sale or at an antenatal or postnatal contact, often on a shared low-cost Android phone, sometimes with no network.

Secondary users are women who can read, mostly in peri-urban areas, who use a reduced personal mode. Women who cannot read use the app with the person who accompanies them; that person reads and explains the result.

## Product Purpose

SIAPSO Mother-Child flags risky medicines and traditional remedies during pregnancy and breastfeeding, and tells the user who to show them to and when. It fills the gap between two contacts with a health worker, when a woman takes medicines and remedies at home with nobody who knows the plants.

Success means: no missed danger signal on the reference cases, a result understood by the accompanying person in under a minute, and every alert traceable to a cited source and a knowledge base version.

## Positioning

The only open, offline tool focused on the safety of medicines and traditional remedies in pregnancy and breastfeeding for French-speaking West Africa, with an open speech model that understands French and Wolof. It never says "safe" when it does not know: an unknown product or a remedy without evidence shows a neutral grey state.

## Operating Context

- Four moments of use: first antenatal visit (profile creation), home visit, sale at a pharmacy depot, postnatal visits at day 7 and day 42.
- Offline first: the rules engine, the knowledge pack and the speech model run on the phone; the network is only needed to update the pack.
- Shared phones: profiles are pseudonymous and protected by a code; no account is needed in personal mode.
- Low literacy: the accompanying person reads the screen aloud; pictograms and colour support the text but never carry meaning alone.
- Referral circuit: relais or Bajenu Gox, then the ICP, then the midwife at the health centre; danger signs follow the national referral circuit.

## Capabilities and Constraints

- Four result levels: danger sign (go now), show before the next dose, tell at the next visit, unknown (grey). Never green, never "safe", "verified" or "no risk".
- The app never tells anyone to start, stop or change a treatment, gives no dose and no alternative, and never states that a plant treats anything.
- Models propose, rules decide: the speech model and the name resolver only suggest a product; the user always confirms it; the deterministic engine alone sets the alert level.
- Evidence level (A to E, 0) is shown separately from severity.
- No TerangaHealth component, no audio output, no voice synthesis. Answers stay as text.
- No em dash and no emoji anywhere in the interface, code, docs or commits.
- Personalised contraception efficacy verdicts are out of the MVP (general information only).
- Regulatory intended use: health information, education and referral; not a diagnosis or prescription tool.
- Undecided: pilot district, Wolof written interface, distribution channel beyond the pilot.

## Brand Commitments

- Name: SIAPSO Mère-Enfant (French), SIAPSO Mother-Child (English).
- Voice: plain, calm, respectful words. Short sentences. Allowed verbs: show, tell, ask, go, call. Never blame traditional medicine: "we do not know enough" rather than "dangerous".
- Every finding of an accompanied-mode result keeps its source and evidence level under "Pourquoi ?"; every result says the knowledge base version near its top and ends with it and "Cet outil ne remplace pas un soignant." ("This tool does not take the place of a health worker.") Woman mode leaves the details, evidence levels and sources to the health worker it sends her to (`docs/intended-use.md`, "What a result shows in each mode").

## Evidence on Hand

- Design dossier: https://claude.ai/artifact/771WvpJtMCZYdN6YMEHAHu (strategy, candidature summary, agent annexes).
- Ten pharmacist test cases and an 18-product remedy registry (annex A and B of the dossier).
- No user testing, no testimonials, no clinical validation yet. Nothing in the interface may claim review by pharmacists or midwives until it is true.

## Product Principles

1. Unknown is not safe: silence or missing data always shows as grey with an orientation.
2. Orient, never prescribe: every message ends with who to show and when.
3. Built for the person in the room: one hand, shared phone, offline, bright sunlight, under a minute.
4. Respect before warning: traditional practice is named with care, risks are stated with their evidence level.
5. Open and traceable: every rule cites a source and a version that anyone can audit.

## Accessibility & Inclusion

- Target WCAG 2.2 AA; text contrast must hold in outdoor light.
- Large touch targets (at least 48 px), one primary action per screen, no gesture-only actions.
- Meaning never relies on colour alone (level name and pictogram always shown).
- Works on Android Go class phones with Chrome, 2 GB of RAM, small screens from 360 px wide.
- French and English text; local Wolof names recognised in search and voice input.
