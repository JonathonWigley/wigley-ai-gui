import { describe, expect, it, vi } from 'vitest';
import type { CompletionItem } from '../../contracts/editor';
import type { FuzzyMatcher } from '../../contracts/fuzzy';
import {
  completionRowRender,
  popupActionOf,
  prefixMatch,
} from './prefix-completion';

function isSubsequence(query: string, text: string): boolean {
  const lowerText = text.toLowerCase();
  let from = 0;
  for (const character of query.toLowerCase()) {
    const found = lowerText.indexOf(character, from);
    if (found === -1) {
      return false;
    }
    from = found + 1;
  }
  return true;
}

// In-order subsequence over lower-cased text, input order kept.
const matcher: FuzzyMatcher = {
  rank: (items, query, tiersOf) =>
    items.filter((item) =>
      tiersOf(item).some((tier) =>
        tier.some((text) => isSubsequence(query, text)),
      ),
    ),
  matches: isSubsequence,
};

function items(...words: string[]): CompletionItem[] {
  return words.map((word) => ({ word, aliases: [] }));
}

describe('prefixMatch', () => {
  it('prefixMatch_EmptyTyped_OffersAllInOrder', () => {
    expect(prefixMatch('/', '/', items('model', 'compact'), matcher)).toEqual({
      from: 0,
      to: 1,
      words: ['model', 'compact'],
    });
  });

  it('prefixMatch_TypedText_KeepsMatchingWords', () => {
    expect(prefixMatch('/mo', '/', items('model', 'compact'), matcher)).toEqual(
      { from: 0, to: 3, words: ['model'] },
    );
  });

  it('prefixMatch_IgnoresCase', () => {
    expect(prefixMatch('/MO', '/', items('model'), matcher)).toEqual({
      from: 0,
      to: 3,
      words: ['model'],
    });
  });

  it('prefixMatch_NamespacedWord_Matches', () => {
    expect(
      prefixMatch(
        '/wigley:f',
        '/',
        items('wigley:feature', 'wigley:make'),
        matcher,
      )?.words,
    ).toEqual(['wigley:feature']);
  });

  it('prefixMatch_FuzzyWord_Matches', () => {
    expect(
      prefixMatch('/wgft', '/', items('wigley:feature', 'make'), matcher)
        ?.words,
    ).toEqual(['wigley:feature']);
  });

  it('prefixMatch_AliasMatches_OffersFullName', () => {
    const aliased = [
      { word: 'wigley:feature', aliases: ['feature'] },
      { word: 'make', aliases: [] },
    ];
    expect(prefixMatch('/feature', '/', aliased, matcher)?.words).toEqual([
      'wigley:feature',
    ]);
  });

  it('prefixMatch_RepeatedWord_KeptOnce', () => {
    expect(
      prefixMatch('/m', '/', items('model', 'model', 'mcp'), matcher)?.words,
    ).toEqual(['model', 'mcp']);
  });

  it('prefixMatch_RanksOverOneTier_KeepsMatcherOrder', () => {
    const tiersSeen: unknown[] = [];
    const reversing: FuzzyMatcher = {
      ...matcher,
      rank: (ranked, _query, tiersOf) => {
        tiersSeen.push(...ranked.map(tiersOf));
        return [...ranked].reverse();
      },
    };
    const aliased = [
      { word: 'make', aliases: ['build', 'run'] },
      { word: 'model', aliases: [] },
    ];
    expect(prefixMatch('/m', '/', aliased, reversing)?.words).toEqual([
      'model',
      'make',
    ]);
    expect(tiersSeen).toEqual([[['make', 'build', 'run']], [['model']]]);
  });

  it('prefixMatch_Whitespace_ReturnsNull', () => {
    expect(prefixMatch('/mo x', '/', items('model'), matcher)).toBeNull();
    expect(prefixMatch('/mo\n', '/', items('model'), matcher)).toBeNull();
    expect(
      prefixMatch('/wigley feat', '/', items('wigley:feature'), matcher),
    ).toBeNull();
  });

  it('prefixMatch_NoPrefix_ReturnsNull', () => {
    expect(prefixMatch('hi /mo', '/', items('model'), matcher)).toBeNull();
    expect(prefixMatch('', '/', items('model'), matcher)).toBeNull();
  });

  it('prefixMatch_NothingMatches_ReturnsNull', () => {
    expect(prefixMatch('/zz', '/', items('model'), matcher)).toBeNull();
  });
});

describe('completionRowRender', () => {
  const baseCompletions = {
    prefix: '/',
    items: () => [],
    offered: () => {},
    accepted: () => {},
  };

  it('completionRowRender_HandsWordAndElementToDrawRow', () => {
    const element = {} as HTMLElement;
    const drawRow = vi.fn();
    const render = completionRowRender(
      { ...baseCompletions, drawRow },
      () => element,
    );

    expect(render({ label: '/wigley:feature' })).toBe(element);
    expect(drawRow).toHaveBeenCalledWith('wigley:feature', element);
  });

  it('completionRowRender_NoDrawRow_ReturnsNull', () => {
    const createElement = vi.fn(() => ({}) as HTMLElement);
    const render = completionRowRender(baseCompletions, createElement);

    expect(render({ label: '/model' })).toBeNull();
    expect(createElement).not.toHaveBeenCalled();
  });
});

describe('popupActionOf', () => {
  it.each([
    { key: 'Tab', ctrlKey: false, expected: 'accept' },
    { key: 'ArrowDown', ctrlKey: false, expected: 'down' },
    { key: 'n', ctrlKey: true, expected: 'down' },
    { key: 'ArrowUp', ctrlKey: false, expected: 'up' },
    { key: 'p', ctrlKey: true, expected: 'up' },
    { key: 'n', ctrlKey: false, expected: null },
    { key: 'p', ctrlKey: false, expected: null },
    { key: 'h', ctrlKey: true, expected: null },
  ])('$key ctrl=$ctrlKey → $expected', ({ key, ctrlKey, expected }) => {
    expect(popupActionOf({ key, ctrlKey })).toBe(expected);
  });
});
