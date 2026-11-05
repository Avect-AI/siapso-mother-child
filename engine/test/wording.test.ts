// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { findForbiddenWording } from '../src/index.js';
import { fixturePack } from './fixtures/pack.js';

describe('findForbiddenWording in French', () => {
  it('finds the forbidden words of the specification', () => {
    expect(findForbiddenWording('Ce produit est sûr.', 'fr')).toEqual(['sûr']);
    expect(findForbiddenWording('Arrêtez ce médicament', 'fr')).toEqual(['arrêtez']);
    expect(findForbiddenWording("Cela ne veut pas dire que c'est sans risque.", 'fr')).toEqual([]);
    expect(findForbiddenWording('Sûrement', 'fr')).toEqual([]);
  });

  it('finds every forbidden expression', () => {
    const cases: [string, string][] = [
      ['C’est sans danger.', 'sans danger'],
      ['Le produit a été vérifié.', 'vérifié'],
      ['Vérifiez la boîte.', 'vérifiez'],
      ['Ne prenez pas ce sirop.', 'ne prenez pas'],
      ['Remplacez-le par un autre.', 'remplacez'],
      ['Diminuez la quantité.', 'diminuez'],
      ['Prenez plutôt du thé.', 'prenez plutôt'],
      ['Ce remède est autorisé.', 'autorisé'],
      ['Ils sont compatibles.', 'compatible'],
      ['C’est sans risque.', 'sans risque'],
    ];
    for (const [text, expression] of cases) {
      expect(findForbiddenWording(text, 'fr'), text).toEqual([expression]);
    }
  });

  it('finds ne prenez pas with an object pronoun', () => {
    expect(findForbiddenWording('Ne le prenez pas.', 'fr')).toEqual(['ne le prenez pas']);
    expect(findForbiddenWording('Ne la prenez pas avec du thé.', 'fr')).toEqual([
      'ne la prenez pas',
    ]);
    expect(findForbiddenWording('NE LES PRENEZ PAS', 'fr')).toEqual(['ne les prenez pas']);
    expect(findForbiddenWording('Ne  le   prenez pas', 'fr')).toEqual(['ne le prenez pas']);
    expect(findForbiddenWording('Une le prenez passage', 'fr')).toEqual([]);
  });

  it('does not confuse the preposition sur with the adjective sûr', () => {
    expect(findForbiddenWording('Posez-le sur la table.', 'fr')).toEqual([]);
    expect(findForbiddenWording('SUR LA TABLE', 'fr')).toEqual([]);
    expect(findForbiddenWording('Bien sûr, montrez-le.', 'fr')).toEqual(['sûr']);
  });

  it('catches the feminine and plural forms of the forbidden adjectives', () => {
    expect(findForbiddenWording('Cette plante est sûre.', 'fr')).toEqual(['sûr']);
    expect(findForbiddenWording('Des remèdes sûrs.', 'fr')).toEqual(['sûr']);
    expect(findForbiddenWording('Des tisanes vérifiées et autorisées.', 'fr')).toEqual([
      'vérifié',
      'autorisé',
    ]);
  });

  it('catches the forbidden words typed without accents, except sur', () => {
    expect(findForbiddenWording('arretez tout', 'fr')).toEqual(['arrêtez']);
    expect(findForbiddenWording('Produit verifie.', 'fr')).toEqual(['vérifié']);
    expect(findForbiddenWording('Verifiez la date.', 'fr')).toEqual(['vérifiez']);
    expect(findForbiddenWording('prenez plutot ceci', 'fr')).toEqual(['prenez plutôt']);
    expect(findForbiddenWording('Ce produit est autorise.', 'fr')).toEqual(['autorisé']);
  });

  it('is case-insensitive and compares after NFC normalisation', () => {
    expect(findForbiddenWording('CE PRODUIT EST SÛR', 'fr')).toEqual(['sûr']);
    expect(findForbiddenWording('Ce produit est sûr.', 'fr')).toEqual(['sûr']);
    expect(findForbiddenWording('Arrêtez.', 'fr')).toEqual(['arrêtez']);
  });

  it('matches whole words only, with any spacing inside an expression', () => {
    expect(findForbiddenWording('Les sûretés et la compatibilité.', 'fr')).toEqual([]);
    expect(findForbiddenWording('Ne  prenez pas ceci.', 'fr')).toEqual(['ne prenez pas']);
  });

  it('allows sans risque only inside the fixed sentence', () => {
    for (const text of [
      "Cela ne veut pas dire que c'est sans risque.",
      'Cela ne veut pas dire que c’est sans risque.',
      "Cela ne veut pas dire qu'il est sans risque.",
      "Cela ne veut pas dire qu'elle est sans risque.",
      "CELA NE VEUT PAS DIRE QUE C'EST SANS RISQUE.",
    ]) {
      expect(findForbiddenWording(text, 'fr'), text).toEqual([]);
    }
    expect(
      findForbiddenWording(
        "Cela ne veut pas dire que c'est sans risque. Ce thé est sans risque.",
        'fr',
      ),
    ).toEqual(['sans risque']);
  });

  it('returns each expression once, in order of first appearance', () => {
    expect(findForbiddenWording('Il est sûr. Arrêtez. Il est sûr, arrêtez.', 'fr')).toEqual([
      'sûr',
      'arrêtez',
    ]);
    expect(findForbiddenWording('Arrêtez. Il est sûr.', 'fr')).toEqual(['arrêtez', 'sûr']);
  });
});

describe('findForbiddenWording in English', () => {
  it('finds the forbidden words of the specification', () => {
    expect(findForbiddenWording('This is safe', 'en')).toEqual(['safe']);
    expect(findForbiddenWording('safety information', 'en')).toEqual([]);
  });

  it('finds every forbidden expression', () => {
    const cases: [string, string][] = [
      ['Safe for you.', 'safe'],
      ['It is harmless.', 'harmless'],
      ['Verified by us.', 'verified'],
      ['Verify the box.', 'verify'],
      ['Stop now.', 'stop'],
      ['Do not take this syrup.', 'do not take'],
      ['Replace it.', 'replace'],
      ['Reduce the amount.', 'reduce'],
      ['Take instead some tea.', 'take instead'],
      ['It is authorised.', 'authorised'],
      ['It is authorized.', 'authorized'],
      ['They are compatible.', 'compatible'],
      ['There is no risk.', 'no risk'],
      ['A risk-free remedy.', 'risk-free'],
    ];
    for (const [text, expression] of cases) {
      expect(findForbiddenWording(text, 'en'), text).toEqual([expression]);
    }
  });

  it('finds the contracted, unpunctuated and hyphenated forms', () => {
    expect(findForbiddenWording("Don't take this syrup.", 'en')).toEqual(["don't take"]);
    expect(findForbiddenWording('Don’t take this syrup.', 'en')).toEqual(["don't take"]);
    expect(findForbiddenWording('dont take it', 'en')).toEqual(['dont take']);
    expect(findForbiddenWording('A no-risk remedy.', 'en')).toEqual(['no-risk']);
    expect(findForbiddenWording('NO-RISK', 'en')).toEqual(['no-risk']);
  });

  it('finds the inflections of stop, replace and reduce as the base verb', () => {
    const cases: [string, string][] = [
      ['It stops the pain.', 'stop'],
      ['Stopping it helps.', 'stop'],
      ['She stopped it.', 'stop'],
      ['It replaces the tablet.', 'replace'],
      ['Replacing it helps.', 'replace'],
      ['It was replaced.', 'replace'],
      ['It reduces the dose.', 'reduce'],
      ['Reducing it helps.', 'reduce'],
      ['It was reduced.', 'reduce'],
    ];
    for (const [text, expression] of cases) {
      expect(findForbiddenWording(text, 'en'), text).toEqual([expression]);
    }
    expect(findForbiddenWording('Stop. It stops. It stopped.', 'en')).toEqual(['stop']);
  });

  it('matches whole words only', () => {
    expect(
      findForbiddenWording('Unsafe, nonstop, stopover, replacement, reduction, safety.', 'en'),
    ).toEqual([]);
  });

  it('allows risk-free only inside the fixed sentence', () => {
    expect(findForbiddenWording('This does not mean it is risk-free.', 'en')).toEqual([]);
    expect(
      findForbiddenWording('This does not mean it is risk-free. It is risk-free.', 'en'),
    ).toEqual(['risk-free']);
  });

  it('checks only the list of the requested language', () => {
    expect(findForbiddenWording('This is safe', 'fr')).toEqual([]);
    expect(findForbiddenWording('Ce produit est sûr.', 'en')).toEqual([]);
  });
});

describe('fixture builtin messages', () => {
  it('contain no forbidden wording', () => {
    const pack = fixturePack();
    for (const lang of ['fr', 'en'] as const) {
      for (const id of [
        'nothing-found',
        'nothing-applies',
        'not-recognised',
        'danger-sign',
        'max-dose-not-computable',
      ]) {
        const message = pack.messages[lang][id];
        const text = [message?.fact, message?.risk, message?.orientation].join(' ');
        expect(findForbiddenWording(text, lang), `${lang} ${id}`).toEqual([]);
      }
    }
  });
});
