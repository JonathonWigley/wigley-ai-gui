import { describe, expect, it } from 'vitest';
import type { FuzzyTiers } from '../../contracts/fuzzy';
import { createFzfMatcher } from './fzf-matcher';

interface Row {
  id: string;
  tiers: FuzzyTiers;
}

const fuzzy = createFzfMatcher();

function row(id: string, ...tiers: FuzzyTiers): Row {
  return { id, tiers };
}

function rankedIds(rows: readonly Row[], query: string): string[] {
  return fuzzy.rank(rows, query, (item) => item.tiers).map((item) => item.id);
}

describe('rank', () => {
  it.each(['', '   '])(
    'rank_EmptyQuery_ReturnsAllInInputOrder (%j)',
    (query) => {
      const rows = [
        row('zeta', ['zeta']),
        row('alpha', ['alpha']),
        row('none'),
      ];

      expect(rankedIds(rows, query)).toEqual(['zeta', 'alpha', 'none']);
    },
  );

  it('rank_QueryWithOuterSpaces_MatchesAsTrimmed', () => {
    expect(rankedIds([row('make', ['make'])], '  make ')).toEqual(['make']);
  });

  it('rank_NoMatch_LeavesItemOut', () => {
    const rows = [
      row('wigley:feature', ['wigley:feature']),
      row('wigley:feature-primer', ['wigley:feature-primer']),
      row('make', ['make']),
    ];

    const ids = rankedIds(rows, 'feature');

    expect(ids).toHaveLength(2);
    expect(ids).toEqual(
      expect.arrayContaining(['wigley:feature', 'wigley:feature-primer']),
    );
  });

  it('rank_MatchesAnAlias', () => {
    const rows = [row('help', ['help']), row('usage', ['usage', 'cost'])];

    expect(rankedIds(rows, 'cost')).toEqual(['usage']);
  });

  it('rank_ItemWithTwoMatchingTexts_AppearsOnce', () => {
    const scattered = 'fix-each-attribute';
    const rows = [
      row('scattered', [scattered]),
      row('two texts', [scattered, 'feature']),
    ];

    // Ahead of `scattered` by its second text's score.
    expect(rankedIds(rows, 'feat')).toEqual(['two texts', 'scattered']);
  });

  it('rank_EqualScores_KeepInputOrder', () => {
    const rows = [
      row('third', ['feature']),
      row('first', ['feature']),
      row('second', ['feature']),
    ];

    expect(rankedIds(rows, 'feat')).toEqual(['third', 'first', 'second']);
  });

  it('rank_BetterMatchFirst', () => {
    const rows = [
      row('fix-each-attribute', ['fix-each-attribute']),
      row('feature', ['feature']),
    ];

    expect(rankedIds(rows, 'feat')).toEqual(['feature', 'fix-each-attribute']);
  });

  it('rank_ExactAliasOutranksLongerNames', () => {
    const rows = [
      row('publish-feature-catalog', ['publish-feature-catalog']),
      row('wigley:feature-primer', ['wigley:feature-primer', 'feature-primer']),
      row('wigley:feature-spec', ['wigley:feature-spec', 'feature-spec']),
      row('wigley:feature', ['wigley:feature', 'feature']),
    ];

    expect(rankedIds(rows, 'feature')).toEqual([
      'wigley:feature',
      'wigley:feature-spec',
      'wigley:feature-primer',
      'publish-feature-catalog',
    ]);
  });

  it('rank_EarlierTierOutranksLaterTier', () => {
    const rows = [
      row(
        'backlog-repo',
        ['backlog-repo'],
        ['backlog-repo — ~/dev/wigley-ai-gui/backlog'],
      ),
      row(
        'wigley-ai-gui',
        ['wigley-ai-gui'],
        ['wigley-ai-gui — ~/dev/wigley-ai-gui'],
      ),
    ];

    expect(rankedIds(rows, 'gui')).toEqual(['wigley-ai-gui', 'backlog-repo']);
  });
});

describe('matches', () => {
  it.each(['wf', ' wf ', 'WF'])('matches_Subsequence_True (%j)', (query) => {
    expect(fuzzy.matches(query, 'wigley:feature')).toBe(true);
  });

  it('matches_OutOfOrder_False', () => {
    expect(fuzzy.matches('ew', 'wigley:feature')).toBe(false);
  });

  it.each(['', '   '])('matches_EmptyQuery_True (%j)', (query) => {
    expect(fuzzy.matches(query, 'wigley:feature')).toBe(true);
  });

  it.each([
    { text: 'foo-bar', expected: false },
    { text: 'foo bar', expected: true },
  ])('matches_InteriorSpace_IsLiteral ($text)', ({ text, expected }) => {
    expect(fuzzy.matches('foo bar', text)).toBe(expected);
  });
});
