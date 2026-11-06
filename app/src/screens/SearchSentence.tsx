// SPDX-License-Identifier: MIT
// The products named inside a sentence (SCRUM-61): what the voice heard, or a
// sentence typed, names products the search of the whole text does not
// propose ("dama naan doliprane ak nivaquine"). Each product found is an
// answer to tick, ticked when the words name it clearly, with its substances,
// its list and the strength said; one action opens the confirm screen of each
// product ticked in turn. Nothing is added from here, and the other words of
// the sentence are never added as a name.
import type { SentenceProduct } from '@siapso/resolver';
import { useEffect, useRef, useState } from 'react';
import { candidateDisplayOf, milligrams } from '../domain/search-index.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { CheckboxGroup } from '../ui/ChoiceGroup.js';

export function SentenceProducts({
  products,
  heard,
  onAdd,
}: {
  products: readonly SentenceProduct[];
  /** The voice heard the sentence: a strength in it was said, not typed. */
  heard: boolean;
  /** The products ticked, in their order. */
  onAdd: (ticked: SentenceProduct[]) => void;
}) {
  const t = useT();
  const lang = useLang();
  const { pack } = useApp();
  const section = useRef<HTMLElement>(null);
  const [ticked, setTicked] = useState(() => products.map((product) => product.checked));
  // Each refused "add", nothing being ticked; from the first one, the error is said.
  const [attempts, setAttempts] = useState(0);
  const none = !ticked.some(Boolean);

  // A refused "add" moves the focus to the first answer.
  useEffect(() => {
    if (attempts === 0) return;
    section.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  /**
   * Why a product is offered unticked: a name read from words the voice split
   * ("King Kyliba"), a clause that says it is maybe not taken ("pas de
   * cytotec", review of #68), a food ("ail"), or a name that is also a common
   * word ("goro").
   */
  const untickedBecause = (product: SentenceProduct): string[] => {
    if (product.heardAs !== undefined) {
      return [t('search.sentenceCheckHeard', { words: product.heardAs })];
    }
    if (product.clause !== undefined) {
      return [t('search.sentenceCheckClause', { words: product.clause.text })];
    }
    if (product.alsoFood === true) return [t('search.sentenceFood', { word: product.text })];
    return product.checked ? [] : [t('search.sentenceCommonWord', { word: product.text })];
  };

  if (pack === null) return null;
  const options = products.map((product, at) => {
    const shown = candidateDisplayOf(pack, product.candidate, product.text, lang);
    const strength =
      product.strengthMg === undefined
        ? []
        : [
            t(heard ? 'search.sentenceStrengthSaid' : 'search.sentenceStrengthTyped', {
              strength: milligrams(product.strengthMg, lang),
            }),
          ];
    return {
      id: `${product.candidate.kind}:${product.candidate.id}`,
      label: shown.name,
      details: [
        ...(shown.detail === undefined ? [] : [shown.detail]),
        t(product.candidate.kind === 'product' ? 'search.kindProduct' : 'search.kindPlant'),
        ...strength,
        // A word read with a Wolof spelling undone: the spelling it was read as.
        ...(product.readAs === undefined
          ? []
          : [t('search.sentenceReadAs', { spelling: product.readAs })]),
        ...untickedBecause(product),
      ],
      checked: ticked[at] === true,
      onChange: (checked: boolean) => {
        setTicked((now) => now.map((value, index) => (index === at ? checked : value)));
      },
    };
  });

  return (
    <section ref={section} className="search__sentence">
      <CheckboxGroup
        question
        legend={t('search.sentenceTitle')}
        hint={t('search.sentenceHint')}
        error={attempts > 0 && none ? t('search.sentenceNone') : undefined}
        options={options}
      />
      <Button
        variant="primary"
        className="search__sentence-add"
        onClick={() => {
          if (none) {
            setAttempts((count) => count + 1);
            return;
          }
          onAdd(products.filter((_, at) => ticked[at] === true));
        }}
      >
        {t('search.sentenceAdd')}
      </Button>
    </section>
  );
}
