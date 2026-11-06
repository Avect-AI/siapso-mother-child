// SPDX-License-Identifier: MIT
// The checks added or tuned after the live test round 2 (SCRUM-52): a toxic
// daily amount (from-mg-per-day), a danger sign as a requirement, the
// accompanied orientation of a message, readable source links, and the
// hidden-instruction and dose-in-words checks.
import { describe, expect, it } from 'vitest';
import { buildPack, validateContent } from '../src/index.js';
import type { RawContent } from '../src/index.js';
import { copyOf, expectProblem, loadValid, patch, sub } from './helpers.js';
import type { Dict } from './helpers.js';

const MAX = 'knowledge/rules/paracetamol-max-dose.yaml';
const NSAID = 'nsaid-pregnancy-from-20-weeks';
const NSAID_MESSAGE = `knowledge/messages/${NSAID}.yaml`;
const MORINGA = 'knowledge/messages/herb-drug-moringa.yaml';

let valid: RawContent | undefined;

async function fresh(): Promise<RawContent> {
  valid ??= await loadValid();
  return copyOf(valid);
}

/** The problems of one message file after changing one field of it. */
async function problemsOf(lang: string, field: string, text: string, id = 'herb-drug-moringa') {
  const raw = patch(await fresh(), 'messages', id, (d) => {
    sub(d, lang)[field] = text;
  });
  return validateContent(raw).filter((p) => p.path === `${lang}.${field}`);
}

describe('from-mg-per-day', () => {
  it('is accepted on a max-dose rule instead of max-mg-per-day, and built into the pack', async () => {
    const raw = patch(await fresh(), 'rules', 'paracetamol-max-dose', (d) => {
      delete sub(d, 'when')['max-mg-per-day'];
      sub(d, 'when')['from-mg-per-day'] = 8000;
    });
    expect(validateContent(raw)).toEqual([]);
    const rule = buildPack(raw).rules.find((r) => r.id === 'paracetamol-max-dose');
    expect(rule?.when).toEqual({ subject: { substance: 'paracetamol' }, fromMgPerDay: 8000 });
  });

  it('is refused with max-mg-per-day, and on a rule that is not max-dose', async () => {
    const raw = patch(await fresh(), 'rules', 'paracetamol-max-dose', (d) => {
      sub(d, 'when')['from-mg-per-day'] = 8000;
    });
    patch(raw, 'rules', NSAID, (d) => {
      sub(d, 'when')['from-mg-per-day'] = 10;
    });
    const problems = validateContent(raw);
    expectProblem(problems, {
      file: MAX,
      path: 'when',
      message: /one of max-mg-per-day or from-mg-per-day/,
    });
    expectProblem(problems, {
      file: `knowledge/rules/${NSAID}.yaml`,
      path: 'when.from-mg-per-day',
      message: /max-dose/,
    });
  });
});

describe('a danger sign as a requirement', () => {
  it('is accepted when the pack lists the sign', async () => {
    const raw = patch(await fresh(), 'rules', 'moringa-paracetamol', (d) => {
      (d.when as Dict).requires = [{ sign: 'bleeding' }, { sign: 'fever' }];
      d.kind = 'toxicity';
    });
    expect(validateContent(raw)).toEqual([]);
  });

  it('is refused for a sign the pack does not list', async () => {
    const raw = patch(await fresh(), 'rules', 'moringa-paracetamol', (d) => {
      (d.when as Dict).requires = [{ sign: 'no-such-sign' }];
      d.kind = 'toxicity';
    });
    expectProblem(validateContent(raw), {
      file: 'knowledge/rules/moringa-paracetamol.yaml',
      path: 'when.requires[0].sign',
      message: /unknown danger sign "no-such-sign"/,
    });
  });
});

describe('orientation-accompanied', () => {
  const accompanied = (text: string) => async () => {
    const raw = patch(await fresh(), 'messages', NSAID, (d) => {
      sub(d, 'fr')['orientation-accompanied'] = text;
    });
    return validateContent(raw).filter((p) => p.path === 'fr.orientation-accompanied');
  };

  it('is accepted beside an orientation, speaking of her', async () => {
    const problems = await accompanied(
      "Montrez ce produit à la sage-femme ou à l'infirmier avant qu'elle en reprenne.",
    )();
    expect(problems).toEqual([]);
  });

  it('is refused without an orientation', async () => {
    const raw = patch(await fresh(), 'messages', 'herb-drug-moringa', (d) => {
      sub(d, 'en')['orientation-accompanied'] = 'Show this product to the midwife.';
    });
    expectProblem(validateContent(raw), {
      file: MORINGA,
      path: 'en.orientation-accompanied',
      message: /only allowed with an orientation/,
    });
  });

  it('is checked as an orientation: digits, wording and timing', async () => {
    expect(
      (await accompanied('Montrez ce produit avant 2 jours.')()).map((p) => p.message),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/digits/)]));
    expect(
      (await accompanied('Arrêtez ce produit avant qu’elle en reprenne.')()).map((p) => p.message),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/forbidden wording/)]));
    expect(
      (await accompanied('Dites-le à la sage-femme à sa prochaine visite.')()).map(
        (p) => p.message,
      ),
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/prochaine visite.*before-next-dose/)]),
    );
  });

  it('speaks of her: never "vous", "votre", "you", "your", nor the next visit without "sa"', async () => {
    for (const [lang, text] of [
      ['fr', 'Montrez votre produit avant la prochaine prise.'],
      ['fr', 'Si vous saignez, allez au poste de santé maintenant.'],
      ['en', 'Show your product before the next dose.'],
    ] as const) {
      const raw = patch(await fresh(), 'messages', NSAID, (d) => {
        sub(d, lang).orientation = 'Montrez ce produit avant la prochaine prise.';
        sub(d, lang)['orientation-accompanied'] = text;
      });
      expectProblem(validateContent(raw), {
        file: NSAID_MESSAGE,
        path: `${lang}.orientation-accompanied`,
        message: /speaks of her/,
      });
    }
    const raw = patch(await fresh(), 'rules', NSAID, (d) => {
      d.level = 'next-contact';
    });
    patch(raw, 'messages', NSAID, (d) => {
      sub(d, 'fr').orientation = 'Dites-le à la sage-femme à la prochaine visite.';
      sub(d, 'fr')['orientation-accompanied'] = 'Dites-le à la sage-femme à la prochaine visite.';
      sub(d, 'en').orientation = 'Tell the midwife at the next visit.';
      sub(d, 'en')['orientation-accompanied'] = 'Tell the midwife at her next visit.';
    });
    const problems = validateContent(raw);
    expectProblem(problems, {
      file: NSAID_MESSAGE,
      path: 'fr.orientation-accompanied',
      message: /sa prochaine visite/,
    });
    expect(problems.filter((p) => p.path === 'en.orientation-accompanied')).toEqual([]);
  });
});

describe('an orientation never shows "this screen"', () => {
  it('refuses "cet écran" and "this screen": nothing is kept for a passer-by', async () => {
    const raw = patch(await fresh(), 'messages', 'nothing-found', (d) => {
      sub(d, 'fr').orientation = 'Montrez cet écran à la sage-femme à la prochaine visite.';
      sub(d, 'en').orientation = 'Show this screen to the midwife at the next visit.';
    });
    const problems = validateContent(raw);
    const file = 'knowledge/messages/nothing-found.yaml';
    expectProblem(problems, { file, path: 'fr.orientation', message: /this screen/ });
    expectProblem(problems, { file, path: 'en.orientation', message: /this screen/ });
  });
});

describe('readable source links', () => {
  it('refuses an API, a bulk archive or an XML record as a citation link', async () => {
    for (const url of [
      'https://api.fda.gov/drug/label.json?search=x&limit=1',
      'https://ftp.ncbi.nlm.nih.gov/pub/litarch/90/6c/lactmed_NBK501922.tar.gz',
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=1&retmode=xml',
      'https://example.org/records.zip',
    ]) {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        (d.sources as Dict[])[0] = { ...(d.sources as Dict[])[0], url };
      });
      expectProblem(validateContent(raw), {
        file: `knowledge/rules/${NSAID}.yaml`,
        path: 'sources[0].url',
        message: /readable page/,
      });
    }
  });

  it('accepts a readable page', async () => {
    for (const url of [
      'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=015a6179-bacb-452d-b594-4de628ddc11d',
      'https://pubmed.ncbi.nlm.nih.gov/18191685/',
      'https://www.ncbi.nlm.nih.gov/books/NBK501212/',
      'https://base-donnees-publique.medicaments.gouv.fr/affichageDoc.php?specid=60234100&typedoc=R',
    ]) {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        (d.sources as Dict[])[0] = { ...(d.sources as Dict[])[0], url };
      });
      expect(validateContent(raw), url).toEqual([]);
    }
  });
});

describe('the hidden-instruction check', () => {
  it('refuses the obligations and imperatives it used to miss', async () => {
    for (const [lang, text] of [
      ['fr', 'Le médecin doit être vu rapidement.'],
      ['fr', 'Il faut le dire à la sage-femme.'],
      ['fr', 'Elle doit aller au poste de santé.'],
      ['fr', 'Prévenez la sage-femme.'],
      ['fr', 'Signalez tout saignement.'],
      ['fr', 'Surveillez le bébé.'],
      ['fr', 'Retournez au poste de santé.'],
      ['fr', 'Ne changez rien au traitement.'],
      ['fr', 'Un produit à montrer à la sage-femme.'],
      ['en', 'If she bleeds, go to the health post.'],
      ['en', 'She should see the midwife.'],
      ['en', 'Please tell the midwife.'],
      ['en', 'Watch the baby closely.'],
      ['en', 'Make sure the midwife knows.'],
      ['en', 'Never give it to the baby.'],
    ] as const) {
      const problems = await problemsOf(lang, 'risk-detail', text);
      expect(
        problems.some((p) => /instruction/.test(p.message)),
        `${lang} ${text}`,
      ).toBe(true);
    }
  });

  it('accepts "dites" meaning so-called, the participle "faites", and "Never" or "Keep" stating a fact', async () => {
    for (const [lang, text] of [
      ['fr', 'Les crèmes dites éclaircissantes contiennent souvent une cortisone.'],
      ['fr', "Des études faites chez l'animal ont montré un effet."],
      ['en', 'Never studied in pregnant women.'],
      ['en', 'Keep in the range of the label: this was not studied.'],
    ] as const) {
      expect(await problemsOf(lang, 'risk-detail', text), `${lang} ${text}`).toEqual([]);
    }
  });

  it('accepts "Never" or "Keep" starting a sentence inside a quoted English title', async () => {
    for (const text of [
      'The WHO guide "Medicines in pregnancy. Never give up on the data" is old.',
      'The review "Never take risks with herbs" found little data.',
      'The study “Keep, watch and wait” followed forty women.',
    ]) {
      expect(await problemsOf('en', 'risk-detail', text), text).toEqual([]);
    }
  });

  it('still reads an English instruction outside the quoted title', async () => {
    for (const text of [
      'The review "Herbs in pregnancy" found little data: tell the midwife.',
      'If she bleeds, go to the health post ("Bleeding in pregnancy", WHO).',
      'She should see the midwife, as the leaflet “Herbs and the baby” says.',
    ]) {
      const problems = await problemsOf('en', 'risk-detail', text);
      expect(
        problems.some((p) => /instruction/.test(p.message)),
        text,
      ).toBe(true);
    }
  });
});

describe('the dose-in-words check', () => {
  it('refuses a bedtime dose and a weekly frequency', async () => {
    for (const [lang, text] of [
      ['fr', 'Elle le prend le soir au coucher.'],
      ['fr', 'Trois fois par semaine.'],
      ['fr', 'Une fois par semaine.'],
      ['en', 'Taken at bedtime.'],
      ['en', 'Three times a week.'],
      ['en', 'Once a week.'],
    ] as const) {
      const problems = await problemsOf(lang, 'fact', text);
      expect(
        problems.some((p) => /dose in words/.test(p.message)),
        `${lang} ${text}`,
      ).toBe(true);
    }
    const digits = await problemsOf('fr', 'risk-detail', 'Trois prises, 2 fois par semaine.');
    expect(digits.some((p) => /gives a dose/.test(p.message))).toBe(true);
  });

  it('accepts a bowl of sauce and the times of day in a study description', async () => {
    for (const [lang, text] of [
      ['fr', 'La poudre est mélangée dans un bol de sauce.'],
      ['en', 'The powder is mixed into a bowl of sauce.'],
      ['fr', 'Dans une étude, des volontaires en prenaient matin et soir pendant deux semaines.'],
      ['en', 'In a study, volunteers took it morning and evening for two weeks.'],
    ] as const) {
      expect(await problemsOf(lang, 'risk-detail', text), `${lang} ${text}`).toEqual([]);
    }
    // Outside a study, the times of day are still a dose.
    const dose = await problemsOf('fr', 'risk-detail', 'Elle en prend matin et soir.');
    expect(dose.some((p) => /dose in words/.test(p.message))).toBe(true);
  });
});

describe('fix round 1 of SCRUM-52', () => {
  it('builds the adult minimum strength of a substance, above 0 only', async () => {
    const raw = await fresh();
    const substances = raw.substances?.data as Dict[];
    const paracetamol = substances.find((s) => s.id === 'paracetamol');
    if (paracetamol === undefined) throw new Error('No fixture substance');
    paracetamol['adult-min-strength-mg'] = 400;
    expect(validateContent(raw)).toEqual([]);
    expect(buildPack(raw).substances.find((s) => s.id === 'paracetamol')).toEqual({
      id: 'paracetamol',
      names: { fr: 'Paracétamol', en: 'Paracetamol' },
      classes: [],
      adultMinStrengthMg: 400,
    });
    paracetamol['adult-min-strength-mg'] = 0;
    expect(validateContent(raw).length).toBeGreaterThan(0);
  });

  it('builds the possible message of a max-dose rule, and checks it', async () => {
    const raw = patch(await fresh(), 'rules', 'paracetamol-max-dose', (d) => {
      d['possible-message'] = 'max-dose-may-exceed';
    });
    expect(validateContent(raw)).toEqual([]);
    expect(buildPack(raw).rules.find((r) => r.id === 'paracetamol-max-dose')?.possibleMessage).toBe(
      'max-dose-may-exceed',
    );
    const unknown = patch(await fresh(), 'rules', 'paracetamol-max-dose', (d) => {
      d['possible-message'] = 'no-such-message';
    });
    expectProblem(validateContent(unknown), {
      file: MAX,
      path: 'possible-message',
      message: /unknown message "no-such-message"/,
    });
    const notMax = patch(await fresh(), 'rules', NSAID, (d) => {
      d['possible-message'] = 'max-dose-may-exceed';
    });
    expectProblem(validateContent(notMax), {
      file: `knowledge/rules/${NSAID}.yaml`,
      path: 'possible-message',
      message: /max-dose/,
    });
    // Said before the next dose: never a later timing.
    const later = patch(await fresh(), 'rules', 'paracetamol-max-dose', (d) => {
      d['possible-message'] = 'herb-drug-moringa';
    });
    patch(later, 'messages', 'herb-drug-moringa', (d) => {
      sub(d, 'fr').orientation = 'Montrez les boîtes à la prochaine visite.';
    });
    expectProblem(validateContent(later), {
      file: MORINGA,
      path: 'fr.orientation',
      message: /prochaine visite.*before-next-dose/,
    });
  });

  it('keeps the citation links of a source on the hosts it declares', async () => {
    const raw = await fresh();
    const sources = raw.sources?.data as { allowed: Dict[] };
    const openfda = sources.allowed.find((s) => s.id === 'openfda');
    if (openfda === undefined) throw new Error('No fixture source');
    openfda['link-hosts'] = ['dailymed.nlm.nih.gov'];
    // The fixture rule links example.org for an openFDA citation.
    expectProblem(validateContent(raw), {
      file: `knowledge/rules/${NSAID}.yaml`,
      path: 'sources[0].url',
      message: /dailymed\.nlm\.nih\.gov/,
    });
    patch(raw, 'rules', NSAID, (d) => {
      (d.sources as Dict[])[0] = {
        ...(d.sources as Dict[])[0],
        url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=x',
      };
    });
    expect(validateContent(raw)).toEqual([]);
  });

  it('refuses a WHO IRIS file link, and accepts its handle page', async () => {
    const at = (url: string) => async () => {
      const raw = patch(await fresh(), 'rules', NSAID, (d) => {
        (d.sources as Dict[])[0] = { ...(d.sources as Dict[])[0], url };
      });
      return validateContent(raw);
    };
    expectProblem(await at('https://iris.who.int/server/api/core/bitstreams/e9f751fd/content')(), {
      file: `knowledge/rules/${NSAID}.yaml`,
      path: 'sources[0].url',
      message: /readable page/,
    });
    expect(await at('https://iris.who.int/handle/10665/249580')()).toEqual([]);
  });
});
