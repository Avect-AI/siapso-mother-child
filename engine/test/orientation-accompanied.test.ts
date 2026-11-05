// SPDX-License-Identifier: MIT
// Message.orientationAccompanied: the orientation said to the person helping,
// about the woman, in accompanied mode (live test round 2, SCRUM-52).
import { describe, expect, it } from 'vitest';
import { PackError, parsePack } from '../src/index.js';
import { fixturePack } from './fixtures/pack.js';

const RULE = 'fixture-pregnancy-nsaid-20-plus';

describe('Message.orientationAccompanied', () => {
  it('is accepted with an orientation', () => {
    const pack = fixturePack();
    pack.messages.fr[RULE] = {
      fact: 'Fait.',
      risk: 'Risque.',
      orientation: 'Montrez ce produit.',
      orientationAccompanied: 'Montrez ce produit avant qu’elle en reprenne.',
    };
    expect(() => parsePack(pack)).not.toThrow();
  });

  it('is refused when it is not a string, or without an orientation', () => {
    const notString = fixturePack();
    notString.messages.en[RULE] = {
      fact: 'Fact.',
      risk: 'Risk.',
      orientation: 'Show it.',
      orientationAccompanied: 3 as unknown as string,
    };
    expect(() => parsePack(notString)).toThrow(PackError);
    const alone = fixturePack();
    alone.messages.fr[RULE] = {
      fact: 'Fait.',
      risk: 'Risque.',
      orientationAccompanied: 'Montrez ce produit.',
    };
    expect(() => parsePack(alone)).toThrow(
      /orientationAccompanied: is only allowed with an orientation/,
    );
  });
});
