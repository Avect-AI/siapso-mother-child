// SPDX-License-Identifier: MIT
// Words the app never says about a call or a referral: that a message was
// sent, that someone was told or is on the way, or that care has started.
// The app only opens the phone's dialler; the person reading must still call
// and go, and nothing may let her think it is done. Checked over every
// interface string (i18n.test.ts) and over the deployment's national circuit
// text (data/referral.ts).
import type { Lang } from '@siapso/engine';

/** Whole words, accents included, any case. */
const IMPLIES_CARE: Record<Lang, RegExp> = {
  fr: /(?<!\p{L})(envoy\p{L}*|transmis\p{L}*|prévenu\p{L}*|informé\p{L}*|alerté\p{L}*|alerte|averti\p{L}*|contacté\p{L}*|appelé\p{L}*|notifié\p{L}*|en route|en chemin|arrive\p{L}*|vient|viennent|pris\p{L}* en charge|secours|messages?|sms|rassur\p{L}*)(?!\p{L})/iu,
  en: /(?<!\p{L})(sent|send\p{L}*|informed|notified|alerted|alert|warned|contacted|called|told|on (?:the|their|her|his) way|coming|taken care|care is|help is|messages?|texted|sms|reassur\p{L}*)(?!\p{L})/iu,
};

/** The first words of `text` that would say care is under way, or undefined when there are none. */
export function careUnderWayWording(text: string, lang: Lang): string | undefined {
  return IMPLIES_CARE[lang].exec(text)?.[0];
}
