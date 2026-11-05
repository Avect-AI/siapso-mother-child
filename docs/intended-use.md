<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Intended use

This page is the single source of the intended-use statement of SIAPSO Mother-Child. The About screen of the app, the `README.md` and `MEDICAL_DISCLAIMER.md` must say the same thing, in the same words (the French and English interface strings carry the same meaning). `tools/legal/intended-use.test.mjs` fails when the README or the medical disclaimer drift from the paragraph below. The About screen (SCRUM-28) reads from this source.

The marked paragraph is the source. Change it here first, then everywhere else.

<!-- intended-use:start -->

SIAPSO Mother-Child provides general health information, education and referral for pregnant and breastfeeding women in Senegal and the people who accompany them. It does not diagnose, prescribe or set a dose, and it does not take the place of a health professional.

<!-- intended-use:end -->

## Where it is used

| Place                   | How it uses the paragraph                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `README.md`             | Disclaimer section, same words                                                                                     |
| `MEDICAL_DISCLAIMER.md` | First section, same words                                                                                          |
| About screen of the app | English: this paragraph, bundled at build time; French: a translation with the same meaning (`app/src/i18n/fr.ts`) |

## What a result shows in each mode

The intended use is the same in both modes. What a result shows differs, by design (implementation design, section 2, "Woman mode content" and "Accompanied mode content"):

- **Accompanied mode** (a relay, a Bajenu Gox, a health worker, a depot keeper reads to the woman): every finding says its level, its risk in plain words and who to show it to and when, then, behind a closed "Pourquoi ?", the details for the health worker (the fact, the detailed risk), its evidence level with its wording and its sources; the result says the knowledge base version near its top and ends with it, "not clinically validated" and the fixed sentences.
- **Woman mode** (she reads for herself): the level, the risk in plain words and who to show it to and when, then the knowledge base version, "not clinically validated" and the fixed sentences. The detailed risk, the evidence level and the sources are left to the health worker the result sends her to. They are written for a professional (study types, levels A to E, sources in English), and a woman reading alone could take a detail of a risk as advice to stop, start or change a treatment, which the app never gives. Who to show it to and when carries the urgency: a danger says now, a product such as an anti-inflammatory from 20 weeks says before the next dose, so she does not take another dose before a health worker has seen it.

So the source and evidence level of every finding (`PRODUCT.md`, Brand Commitments) are shown in accompanied mode, under "Pourquoi ?"; in woman mode every result says the knowledge base version, which traces the same sources for anyone who audits it. This choice was confirmed after the live test round 2 (SCRUM-50); changing what woman mode shows is a content decision for the clinical committee.
