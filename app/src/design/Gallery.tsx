// SPDX-License-Identifier: MIT
// Development-only page (#/design in `pnpm dev`): every component, every level
// and every token pair, plus two sample result screens used for design
// critique. All sample content is fictitious. Interface text normally comes
// from the translation files; literal French and English samples are allowed
// here because the i18n layer arrives later.
import { LEVELS, type Level } from '@siapso/engine';
import { CONTRAST_PAIRS, contrastRatio } from '../styles/contrast.js';
import tokensCss from '../styles/tokens.css?raw';
import { Button, DangerBanner, LevelBadge, LevelIcon, ResultCard, TextField } from '../ui/index.js';
import './gallery.css';

const TOKENS: Record<string, string> = Object.fromEntries(
  [...tokensCss.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  ),
);

const LEVEL_INFO: Record<Level, { fr: string; en: string; colour: string; use: string }> = {
  danger: {
    fr: 'Signe de danger',
    en: 'Danger sign',
    colour: 'Crimson field, white text',
    use: 'Danger signs, and the one product rule with a written danger rationale. Go to the health post now.',
  },
  'before-next-dose': {
    fr: 'À montrer avant la prochaine prise',
    en: 'Show before the next dose',
    colour: 'Orange field, dark text',
    use: 'Show the product to the midwife, the nurse or the pharmacist before the next dose.',
  },
  'next-contact': {
    fr: 'À signaler au prochain contact',
    en: 'Mention at the next contact',
    colour: 'Chrome yellow field, dark text',
    use: 'Tell the midwife at the next visit.',
  },
  unknown: {
    fr: 'On ne sait pas',
    en: 'We do not know',
    colour: 'Mid grey field, dark text',
    use: 'No reliable information. Never a reassurance: show it to the midwife or the pharmacist.',
  },
};

/** Most urgent first. */
const LEVELS_BY_URGENCY: Level[] = [...LEVELS].reverse();

const noop = () => undefined;

/**
 * The sample result's overview, in the order of the cards: what the reader
 * announces before the details. Product names are the confirmed names, the
 * same as the card titles, so one product never has two names on a screen.
 */
const SUMMARY: { level: Level; product: string; label: string }[] = [
  {
    level: 'before-next-dose',
    product: 'Ibuprofène 400 mg, comprimé',
    label: 'À montrer avant la prochaine prise',
  },
  {
    level: 'next-contact',
    product: 'Sirop contre la toux à la codéine',
    label: 'À signaler au prochain contact',
  },
  { level: 'unknown', product: 'Poudre achetée au marché (nom inconnu)', label: 'On ne sait pas' },
];

function ratio(fg: string, bg: string): string {
  const a = TOKENS[fg];
  const b = TOKENS[bg];
  return a && b ? contrastRatio(a, b).toFixed(2) : 'n/a';
}

/**
 * The entry-point mark of the danger-signs shortcut: a chevron, "go there".
 * Never the octagon, which belongs to the danger level and would read as
 * "danger now" on every screen.
 */
function GoMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      style={{ width: '1.25rem', height: '1.25rem' }}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9 5l7 7-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AppBar() {
  return (
    <div className="app-bar">
      <span className="app-bar__name">SIAPSO</span>
      <Button variant="secondary" className="app-bar__danger">
        Signes de danger
        <GoMark />
      </Button>
    </div>
  );
}

function Closing() {
  return (
    <div className="screen__closing">
      <p>Ne changez rien à votre traitement sans en parler à un professionnel.</p>
      <p className="meta">Base de connaissances, version 0.1.0 du 3 novembre 2026.</p>
      <p>
        <strong>Non validée cliniquement.</strong>
      </p>
      <p>Cet outil ne remplace pas un soignant.</p>
    </div>
  );
}

function SampleProducts() {
  return (
    <div className="screen" lang="fr">
      <AppBar />
      <div className="screen__content">
        <div className="screen__heading">
          <h2 className="screen__title">Résultat pour Awa</h2>
          <p className="meta">26 semaines de grossesse, 3 produits</p>
        </div>
        <ul className="result-summary" aria-label="Résumé">
          {SUMMARY.map(({ level, product, label }) => (
            <li key={product} className={`result-summary__row level--${level}`}>
              <span className="result-summary__mark">
                <LevelIcon level={level} />
              </span>
              <span className="result-summary__text">
                <strong>{label}</strong>
                <span>{product}</span>
              </span>
            </li>
          ))}
        </ul>
        <ResultCard
          level="before-next-dose"
          levelLabel="À montrer avant la prochaine prise"
          title={'Ibuprofène 400 mg, comprimé'}
          headingLevel={3}
          orientation="Montrez ce produit à la sage-femme, à l’infirmier ou au pharmacien avant la prochaine prise."
          meta={<p>Source&nbsp;: exemple fictif. Niveau de preuve A&nbsp;: peut provoquer</p>}
        >
          <p>Ce médicament peut abîmer les reins du bébé.</p>
        </ResultCard>
        <ResultCard
          level="next-contact"
          levelLabel="À signaler au prochain contact"
          title="Sirop contre la toux à la codéine"
          headingLevel={3}
          orientation="Dites-le à la sage-femme à la prochaine visite."
          meta={
            <p>
              Source&nbsp;: exemple fictif. Niveau de preuve C&nbsp;: des cas ont été rapportés ou
              observés
            </p>
          }
        >
          <p>Pris longtemps en fin de grossesse, ce sirop peut gêner le bébé à la naissance.</p>
        </ResultCard>
        <ResultCard
          level="unknown"
          levelLabel="On ne sait pas"
          title="Poudre achetée au marché (nom inconnu)"
          headingLevel={3}
          orientation="Montrez-le à la sage-femme ou au pharmacien à la prochaine visite."
          meta={<p>Produit absent de la base.</p>}
        >
          <p>Nous n’avons pas d’information fiable. Cela ne veut pas dire que c’est sans risque.</p>
        </ResultCard>
        <Closing />
        <Button variant="primary" className="screen__action">
          Nouveau contrôle
        </Button>
      </div>
    </div>
  );
}

function SampleDanger() {
  return (
    <div className="screen" lang="fr">
      <AppBar />
      <div className="screen__content">
        <div className="screen__heading">
          <h2 className="screen__title">Résultat pour Mariama</h2>
          <p className="meta">39 semaines de grossesse, 1 produit</p>
        </div>
        <DangerBanner
          levelLabel={'Danger\u00a0: à montrer maintenant'}
          title="Allez au poste de santé maintenant, et montrez à la sage-femme ce qui a été pris."
          action="Voir qui appeler"
          headingLevel={3}
          onAction={noop}
        />
        <ResultCard
          level="danger"
          levelLabel={'Danger\u00a0: à montrer maintenant'}
          title="Huile de ricin"
          headingLevel={3}
          orientation={null}
          meta={
            <p>
              Source&nbsp;: exemple fictif. Niveau de preuve C&nbsp;: des cas ont été rapportés ou
              observés
            </p>
          }
        >
          <p>
            Avec une cicatrice sur l’utérus, cette huile peut déclencher des contractions trop
            fortes.
          </p>
        </ResultCard>
        <Closing />
        <Button variant="secondary" className="screen__action">
          Nouveau contrôle
        </Button>
      </div>
    </div>
  );
}

export function Gallery() {
  return (
    <div className="gallery" lang="en">
      <header className="gallery__intro">
        <h1>SIAPSO visual system</h1>
        <p>
          Development only. Every component and level, and two sample result screens. All sample
          content is fictitious.
        </p>
      </header>

      <main className="gallery__main">
        <section className="gallery__section" aria-labelledby="gallery-samples">
          <h2 id="gallery-samples">Result screen samples</h2>
          <div className="gallery__samples">
            <SampleProducts />
            <SampleDanger />
          </div>
        </section>

        <section className="gallery__section" aria-labelledby="gallery-levels">
          <h2 id="gallery-levels">Levels</h2>
          <ul className="level-list">
            {LEVELS_BY_URGENCY.map((level) => (
              <li key={level} className="level-list__item">
                <div className={`level-list__marks level-mark level--${level}`}>
                  <LevelIcon level={level} size={24} />
                  <LevelIcon level={level} size={32} />
                  <LevelIcon level={level} size={48} />
                </div>
                <div className="level-list__text">
                  <div className="level-list__names">
                    <span lang="fr">
                      <LevelBadge level={level} label={LEVEL_INFO[level].fr} />
                    </span>
                    <LevelBadge level={level} label={LEVEL_INFO[level].en} />
                  </div>
                  <p>{LEVEL_INFO[level].use}</p>
                  <p className="meta">
                    {LEVEL_INFO[level].colour}. Text on field{' '}
                    {ratio(`--level-${level}-fg`, `--level-${level}-bg`)}:1, contour on page{' '}
                    {ratio(`--level-${level}-border`, '--color-bg')}:1.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="gallery__section" aria-labelledby="gallery-cards">
          <h2 id="gallery-cards">Result cards in English, with long text</h2>
          <div className="gallery__grid">
            <ResultCard
              level="danger"
              levelLabel="Danger sign"
              title="Castor oil"
              headingLevel={3}
              orientation="Show this product to the midwife today."
              meta={<p>Source: fictitious example. Evidence level C: serious cases reported</p>}
            >
              <p>
                With a scar on the uterus, this oil can bring on contractions that are too strong.
              </p>
            </ResultCard>
            <ResultCard
              level="before-next-dose"
              levelLabel="Show before the next dose"
              title={'Ibuprofen 400 mg, tablet'}
              headingLevel={3}
              orientation="Show this product to the midwife, the nurse or the pharmacist before the next dose."
              meta={<p>Source: fictitious example. Evidence level A: can cause</p>}
            >
              <p>This medicine can harm the baby’s kidneys.</p>
            </ResultCard>
            <ResultCard
              level="next-contact"
              levelLabel="Mention at the next contact"
              title="Cough syrup with codeine"
              headingLevel={3}
              orientation="Tell the midwife at the next visit."
              meta={<p>Source: fictitious example. Evidence level C: serious cases reported</p>}
            >
              <p>
                Taken for a long time late in pregnancy, this syrup can affect the baby at birth.
              </p>
            </ResultCard>
            <ResultCard
              level="unknown"
              levelLabel="We do not know"
              title="Powder bought at the market in a small paper bag, local name not known"
              headingLevel={3}
              orientation="Show it to your midwife or pharmacist."
              meta={<p>Product not in the knowledge base.</p>}
            >
              <p>We have no reliable information. This does not mean it is risk-free.</p>
            </ResultCard>
          </div>
        </section>

        <section className="gallery__section" aria-labelledby="gallery-banner">
          <h2 id="gallery-banner">Danger banner</h2>
          <DangerBanner
            levelLabel="Danger sign"
            title="Go to the health post now."
            action="See who to call"
            headingLevel={3}
            onAction={noop}
          />
        </section>

        <section className="gallery__section" aria-labelledby="gallery-buttons">
          <h2 id="gallery-buttons">Buttons</h2>
          <p>One primary button per screen. Disabled buttons are dashed and unfilled.</p>
          <div className="gallery__row" lang="fr">
            <Button variant="primary">Voir le résultat</Button>
            <Button variant="secondary">Ajouter un remède</Button>
            <Button variant="quiet">Voir les sources</Button>
            <Button variant="primary" disabled>
              Voir le résultat
            </Button>
          </div>
          <div className="gallery__row">
            <Button variant="primary">See the result</Button>
            <Button variant="secondary">Add a remedy</Button>
            <Button variant="quiet">See the sources</Button>
            <Button variant="secondary" disabled>
              Add a remedy
            </Button>
          </div>
        </section>

        <section className="gallery__section" aria-labelledby="gallery-fields">
          <h2 id="gallery-fields">Text fields</h2>
          <div className="gallery__fields" lang="fr">
            <TextField
              label="Nom du produit"
              hint="Le nom écrit sur la boîte, ou le nom local."
              name="product"
            />
            <TextField
              label="Code"
              hint="4 à 6 chiffres."
              error="Le code a 4 à 6 chiffres. Vous en avez écrit 3."
              inputMode="numeric"
              defaultValue="123"
              name="code"
            />
            <TextField label="Semaines de grossesse" defaultValue="26" disabled name="weeks" />
          </div>
        </section>

        <section className="gallery__section" aria-labelledby="gallery-type">
          <h2 id="gallery-type">Type</h2>
          <dl className="type-list">
            <div>
              <dt className="meta">Headline, 28 px, 800 (a screen’s single lead line)</dt>
              <dd className="type-list__headline" lang="fr">
                Signes de danger
              </dd>
            </div>
            <div>
              <dt className="meta">Title, 22 px, 800 (level names, the strongest line)</dt>
              <dd className="type-list__title" lang="fr">
                À montrer avant la prochaine prise
              </dd>
            </div>
            <div>
              <dt className="meta">Label, 18 px, 800 (product names)</dt>
              <dd className="type-list__label" lang="fr">
                Ibuprofène 400&nbsp;mg, comprimé
              </dd>
            </div>
            <div>
              <dt className="meta">Reading, 18 px, 450 (every sentence read aloud)</dt>
              <dd lang="fr">Montrez ce produit à la sage-femme avant la prochaine prise.</dd>
            </div>
            <div>
              <dt className="meta">Small, 16 px (source and version lines)</dt>
              <dd className="meta" lang="fr">
                Base de connaissances, version 0.1.0 du 3 novembre 2026.
              </dd>
            </div>
          </dl>
        </section>

        <section className="gallery__section" aria-labelledby="gallery-contrast">
          <h2 id="gallery-contrast">Contrast pairs</h2>
          <p>Reading text is held at 7:1 for sunlight; contours and focus rings at 3:1.</p>
          <div
            className="pairs-scroll"
            role="region"
            aria-label="Contrast pairs table, scrolls sideways"
            tabIndex={0}
          >
            <table className="pairs">
              <thead>
                <tr>
                  <th scope="col">Sample</th>
                  <th scope="col">Pair (token names)</th>
                  <th scope="col">Ratio</th>
                  <th scope="col">Minimum</th>
                </tr>
              </thead>
              <tbody>
                {CONTRAST_PAIRS.map(({ fg, bg, min }) => (
                  <tr key={`${fg} ${bg}`}>
                    <td>
                      <span
                        className="pairs__swatch"
                        style={{ color: `var(${fg})`, background: `var(${bg})` }}
                      >
                        Aa
                      </span>
                    </td>
                    <td className="pairs__names">
                      {fg.slice(2)} on {bg.slice(2)}
                    </td>
                    <td className="pairs__ratio">{ratio(fg, bg)}</td>
                    <td>{min}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
