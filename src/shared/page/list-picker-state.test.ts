import { describe, expect, it } from 'vitest';
import type { FuzzyMatcher } from '../../contracts/fuzzy';
import { fakeFuzzyMatcher } from '../fake-fuzzy-matcher.test-support';
import {
  filterPicker,
  movePicker,
  movePickerToEdge,
  openPicker,
  visibleIndexes,
} from './list-picker-state';

const labels = ['~/dev/app', '~/dev/api', 'Choose folder…'];

// Orders by tier, then by the score `scores` sets for a matched text, higher
// first, then input order.
function scoredMatcher(scores: Record<string, number>): FuzzyMatcher {
  const { matches } = fakeFuzzyMatcher;
  return {
    matches,
    rank(items, query, tiersOf) {
      const placed = items.map((item) => {
        const tiers = tiersOf(item);
        const tier = tiers.findIndex((texts) =>
          texts.some((text) => matches(query, text)),
        );
        const texts = tiers[tier] ?? [];
        const score = Math.max(0, ...texts.map((text) => scores[text] ?? 0));
        return { item, tier, score };
      });
      return placed
        .filter(({ tier }) => tier !== -1)
        .sort((a, b) => a.tier - b.tier || b.score - a.score)
        .map(({ item }) => item);
    },
  };
}

const secondBest = scoredMatcher({ '~/dev/api': 1 });

describe('picker state', () => {
  it('openPicker_SelectedInRange', () => {
    expect(openPicker(labels, 1)).toEqual({
      labels,
      names: null,
      filter: '',
      cursor: 1,
    });
  });

  it('openPicker_SelectedOutOfRange_First', () => {
    expect(openPicker(labels, 7).cursor).toBe(0);
  });

  it('openPicker_NoLabels_NoCursor', () => {
    expect(openPicker([], 0).cursor).toBe(-1);
  });

  it('visibleIndexes_Fuzzy_KeepsOnlyMatches', () => {
    const paths = ['src/plugins/chat', 'docs/features'];
    const filtered = filterPicker(
      openPicker(paths, 0),
      'spc',
      fakeFuzzyMatcher,
    );

    expect(visibleIndexes(filtered, fakeFuzzyMatcher)).toEqual([0]);
  });

  it('visibleIndexes_Fuzzy_RanksBestFirst', () => {
    const filtered = filterPicker(openPicker(labels, 0), 'ap', secondBest);

    expect(visibleIndexes(filtered, secondBest)).toEqual([1, 0]);
  });

  it('visibleIndexes_NameOutranksLabel', () => {
    const targets = [
      'backlog-repo — ~/dev/wigley-ai-gui/backlog',
      'wigley-ai-gui — ~/dev/wigley-ai-gui',
    ];
    const names = ['backlog-repo', 'wigley-ai-gui'];
    const filtered = filterPicker(
      openPicker(targets, 0, names),
      'gui',
      fakeFuzzyMatcher,
    );

    expect(visibleIndexes(filtered, fakeFuzzyMatcher)).toEqual([1, 0]);
  });

  it('filterPicker_CaseInsensitiveTrimmed', () => {
    const filtered = filterPicker(
      openPicker(labels, 1),
      ' AP ',
      fakeFuzzyMatcher,
    );

    expect(visibleIndexes(filtered, fakeFuzzyMatcher)).toEqual([0, 1]);
  });

  it.each([
    { given: 'a hidden row', cursor: 2 },
    { given: 'a still-visible row', cursor: 0 },
  ])(
    'filterPicker_NonEmptyFilter_MovesToFirstRanked from $given',
    ({ cursor }) => {
      const filtered = filterPicker(
        openPicker(labels, cursor),
        'ap',
        secondBest,
      );

      expect(filtered.cursor).toBe(1);
    },
  );

  it.each(['', '   '])(
    'filterPicker_EmptyFilter_KeepsCursor "%s"',
    (filter) => {
      const filtered = filterPicker(openPicker(labels, 2), filter, secondBest);

      expect(filtered.cursor).toBe(2);
      expect(visibleIndexes(filtered, secondBest)).toEqual([0, 1, 2]);
    },
  );

  it('filterPicker_EmptyFilterAfterNoMatch_CursorOnFirst', () => {
    const none = filterPicker(openPicker(labels, 2), 'zzz', fakeFuzzyMatcher);

    expect(filterPicker(none, '', fakeFuzzyMatcher).cursor).toBe(0);
  });

  it('filterPicker_NothingVisible_NoCursor', () => {
    const filtered = filterPicker(
      openPicker(labels, 1),
      'zzz',
      fakeFuzzyMatcher,
    );

    expect(visibleIndexes(filtered, fakeFuzzyMatcher)).toEqual([]);
    expect(filtered.cursor).toBe(-1);
  });

  it('movePicker_StepsInRankOrderOverVisibleOnly', () => {
    const filtered = filterPicker(openPicker(labels, 0), 'ap', secondBest);

    const once = movePicker(filtered, 1, secondBest);
    const twice = movePicker(once, 1, secondBest);

    expect(filtered.cursor).toBe(1);
    expect(once.cursor).toBe(0);
    expect(twice.cursor).toBe(0);
  });

  it('movePicker_ClampsAtEnds', () => {
    const filtered = filterPicker(
      openPicker(labels, 0),
      'ap',
      fakeFuzzyMatcher,
    );

    expect(movePicker(filtered, -1, fakeFuzzyMatcher).cursor).toBe(0);
  });

  it('movePicker_NothingVisible_Unchanged', () => {
    const filtered = filterPicker(
      openPicker(labels, 0),
      'zzz',
      fakeFuzzyMatcher,
    );

    expect(movePicker(filtered, 1, fakeFuzzyMatcher)).toBe(filtered);
  });
  const dRanksFirst = scoredMatcher({ 'kept d': 1 });

  it.each([
    { edge: 'first', filter: '', matcher: fakeFuzzyMatcher, cursor: 0 },
    { edge: 'last', filter: '', matcher: fakeFuzzyMatcher, cursor: 3 },
    { edge: 'first', filter: 'kept', matcher: fakeFuzzyMatcher, cursor: 1 },
    { edge: 'last', filter: 'kept', matcher: fakeFuzzyMatcher, cursor: 3 },
    { edge: 'first', filter: 'kept', matcher: dRanksFirst, cursor: 3 },
    { edge: 'last', filter: 'kept', matcher: dRanksFirst, cursor: 1 },
  ] as const)(
    'movePickerToEdge_LandsOnTheShownEdge: $edge, filter "$filter", cursor $cursor',
    ({ edge, filter, matcher, cursor }) => {
      const rows = ['gone a', 'kept b', 'gone c', 'kept d'];
      const opened = filterPicker(openPicker(rows, 2), filter, matcher);

      expect(movePickerToEdge(opened, edge, matcher).cursor).toBe(cursor);
    },
  );

  it.each(['first', 'last'] as const)(
    'movePickerToEdge_NothingVisible_Unchanged: %s',
    (edge) => {
      const filtered = filterPicker(
        openPicker(labels, 0),
        'zzz',
        fakeFuzzyMatcher,
      );

      expect(movePickerToEdge(filtered, edge, fakeFuzzyMatcher)).toBe(filtered);
    },
  );
});
