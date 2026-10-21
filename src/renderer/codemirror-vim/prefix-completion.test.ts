import { describe, expect, it } from 'vitest';
import { prefixMatch } from './prefix-completion';

describe('prefixMatch', () => {
  it('prefixMatch_PrefixAlone_OffersEveryWord', () => {
    expect(prefixMatch('/', '/', ['model', 'compact'])).toEqual({
      from: 0,
      to: 1,
      words: ['model', 'compact'],
    });
  });

  it('prefixMatch_TypedText_KeepsWordsStartingWithIt', () => {
    expect(prefixMatch('/mo', '/', ['model', 'compact'])).toEqual({
      from: 0,
      to: 3,
      words: ['model'],
    });
  });

  it('prefixMatch_IgnoresCase', () => {
    expect(prefixMatch('/MO', '/', ['model'])).toEqual({
      from: 0,
      to: 3,
      words: ['model'],
    });
  });

  it('prefixMatch_NamespacedWord_Matches', () => {
    expect(
      prefixMatch('/wigley:f', '/', ['wigley:feature', 'wigley:make'])?.words,
    ).toEqual(['wigley:feature']);
  });

  it('prefixMatch_RepeatedWord_KeptOnce', () => {
    expect(prefixMatch('/m', '/', ['model', 'model', 'mcp'])?.words).toEqual([
      'model',
      'mcp',
    ]);
  });

  it('prefixMatch_NotAtStartOrHasWhitespaceOrNoMatch_ReturnsNull', () => {
    expect(prefixMatch('/mo x', '/', ['model'])).toBeNull();
    expect(prefixMatch('/mo\n', '/', ['model'])).toBeNull();
    expect(prefixMatch('hi /mo', '/', ['model'])).toBeNull();
    expect(prefixMatch('', '/', ['model'])).toBeNull();
    expect(prefixMatch('/zz', '/', ['model'])).toBeNull();
  });
});
