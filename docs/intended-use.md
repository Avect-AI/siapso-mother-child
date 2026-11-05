<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Intended use

This page is the single source of the intended-use statement of SIAPSO Mother-Child. The About screen of the app, the `README.md` and `MEDICAL_DISCLAIMER.md` must say the same thing, in the same words (the French and English interface strings carry the same meaning). `tools/legal/intended-use.test.mjs` fails when the README or the medical disclaimer drift from the paragraph below. The About screen (SCRUM-28) reads from this source.

The marked paragraph is the source. Change it here first, then everywhere else.

<!-- intended-use:start -->

SIAPSO Mother-Child provides general health information, education and referral for pregnant and breastfeeding women in Senegal and the people who accompany them. It does not diagnose, prescribe or set a dose, and it does not replace a health professional.

<!-- intended-use:end -->

## Where it is used

| Place                   | How it uses the paragraph                        |
| ----------------------- | ------------------------------------------------ |
| `README.md`             | Disclaimer section, same words                   |
| `MEDICAL_DISCLAIMER.md` | First section, same words                        |
| About screen of the app | French and English strings with the same meaning |
