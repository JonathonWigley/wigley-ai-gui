import { describe, expect, it } from 'vitest';
import { ANSWERABLE_KINDS, FORMATS, ITEM_KINDS } from './formats';

describe('kind order lists', () => {
  it('ITEM_KINDS names every kind in FORMATS once', () => {
    expect([...ITEM_KINDS].sort()).toEqual(Object.keys(FORMATS).sort());
  });

  it('ANSWERABLE_KINDS names exactly the kinds whose format answers', () => {
    const answering = Object.entries(FORMATS)
      .filter(([, format]) => 'answerSubject' in format)
      .map(([kind]) => kind);
    expect([...ANSWERABLE_KINDS].sort()).toEqual(answering.sort());
  });
});
