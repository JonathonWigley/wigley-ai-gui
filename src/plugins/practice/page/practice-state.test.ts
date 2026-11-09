import { describe, expect, it } from 'vitest';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { ProblemStatus, ProblemSummary } from '../contract';
import type { Difficulty } from '../problem';
import {
  difficultyCounts,
  emptyReason,
  initialPracticeState,
  type PracticeAction,
  type PracticeState,
  practiceReducer,
  visibleProblems,
} from './practice-state';

// A substring stand-in for the fuzzy matcher.
const matcher: FuzzyMatcher = {
  rank: (items) => [...items],
  matches: (query, text) => text.toLowerCase().includes(query.toLowerCase()),
};

function summary(fields: {
  slug: string;
  title?: string;
  difficulty: Difficulty;
  status: ProblemStatus;
  due?: boolean;
  tags?: string[];
  lists?: string[];
}): ProblemSummary {
  return {
    title: fields.slug,
    due: false,
    tags: [],
    lists: [],
    ...fields,
  };
}

const slugsOf = (problems: readonly ProblemSummary[]) =>
  problems.map((problem) => problem.slug);

// The list `problems` loaded, with `fields` over the initial state.
function loaded(
  problems: ProblemSummary[],
  fields: Partial<PracticeState> = {},
): PracticeState {
  return practiceReducer(
    { ...initialPracticeState(), ...fields },
    { type: 'loaded', problems },
    matcher,
  );
}

const FILTERED = [
  summary({
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'easy',
    status: 'solved',
    tags: ['array'],
    lists: ['Blind 75'],
  }),
  summary({
    slug: 'clone-graph',
    title: 'Clone Graph',
    difficulty: 'medium',
    status: 'attempted',
    tags: ['graph'],
  }),
  summary({
    slug: 'lru',
    title: 'LRU Cache',
    difficulty: 'medium',
    status: 'new',
    due: true,
    tags: ['design'],
  }),
  summary({
    slug: 'blind-spot',
    title: 'Blind Spot',
    difficulty: 'hard',
    status: 'new',
  }),
];

describe('practiceReducer', () => {
  it('sorts by status, then difficulty, then title', () => {
    const state = loaded([
      summary({ slug: 's-hard-b', difficulty: 'hard', status: 'solved' }),
      summary({
        slug: 'n-easy-b',
        title: 'B',
        difficulty: 'easy',
        status: 'new',
      }),
      summary({ slug: 'a-med', difficulty: 'medium', status: 'attempted' }),
      summary({
        slug: 'n-easy-a',
        title: 'A',
        difficulty: 'easy',
        status: 'new',
      }),
      summary({ slug: 'a-easy', difficulty: 'easy', status: 'attempted' }),
    ]);

    expect(slugsOf(visibleProblems(state, matcher))).toEqual([
      'a-easy',
      'a-med',
      'n-easy-a',
      'n-easy-b',
      's-hard-b',
    ]);
  });

  it.each([
    { filter: 'easy', expected: ['two-sum'] },
    { filter: 'unsolved', expected: ['clone-graph', 'lru', 'blind-spot'] },
    { filter: 'due', expected: ['lru'] },
    { filter: 'GRAPH', expected: ['clone-graph'] },
    { filter: 'blind', expected: ['two-sum'] },
    { filter: '75', expected: ['two-sum'] },
    { filter: 'medium new', expected: ['lru'] },
    { filter: 'clone', expected: ['clone-graph'] },
    { filter: 'zzz', expected: [] },
  ])('filters by each word kind: $filter', ({ filter, expected }) => {
    const state = practiceReducer(
      loaded(FILTERED),
      { type: 'setFilter', text: filter },
      matcher,
    );

    expect(slugsOf(visibleProblems(state, matcher))).toEqual(expected);
  });

  it.each<{
    case: string;
    selectedSlug: string | null;
    filter?: string;
    action: PracticeAction;
    expected: string | null;
  }>([
    {
      case: 'loaded with the selected slug still present',
      selectedSlug: 'lru',
      action: { type: 'loaded', problems: FILTERED },
      expected: 'lru',
    },
    {
      case: 'loaded with the selected slug gone',
      selectedSlug: 'lru',
      action: { type: 'loaded', problems: FILTERED.slice(0, 2) },
      expected: 'clone-graph',
    },
    {
      case: 'setFilter hiding the selection',
      selectedSlug: 'lru',
      action: { type: 'setFilter', text: 'hard' },
      expected: 'blind-spot',
    },
    {
      case: 'setFilter matching nothing',
      selectedSlug: 'lru',
      action: { type: 'setFilter', text: 'zzz' },
      expected: null,
    },
    {
      case: 'move down at the last row',
      selectedSlug: 'two-sum',
      action: { type: 'move', to: 'down' },
      expected: 'two-sum',
    },
    {
      case: 'move top',
      selectedSlug: 'blind-spot',
      action: { type: 'move', to: 'top' },
      expected: 'clone-graph',
    },
    {
      case: 'select of a filtered-out slug',
      selectedSlug: 'lru',
      filter: 'medium',
      action: { type: 'select', slug: 'two-sum' },
      expected: 'lru',
    },
  ])(
    'keeps the selection: $case',
    ({ selectedSlug, filter, action, expected }) => {
      const state = practiceReducer(
        loaded(FILTERED),
        { type: 'setFilter', text: filter ?? '' },
        matcher,
      );

      const next = practiceReducer({ ...state, selectedSlug }, action, matcher);

      expect(next.selectedSlug).toBe(expected);
    },
  );
});

describe('emptyReason', () => {
  it.each<{
    case: string;
    actions: PracticeAction[];
    rowCount: number;
    expected: ReturnType<typeof emptyReason>;
  }>([
    { case: 'before any read', actions: [], rowCount: 0, expected: 'loading' },
    {
      case: 'a failed first read',
      actions: [{ type: 'loadFailed', message: 'disk full' }],
      rowCount: 0,
      expected: 'failed',
    },
    {
      case: 'a failed read after one landed',
      actions: [
        { type: 'loaded', problems: FILTERED },
        { type: 'loadFailed', message: 'disk full' },
      ],
      rowCount: 4,
      expected: null,
    },
    {
      case: 'a read landing after a failed one',
      actions: [
        { type: 'loadFailed', message: 'disk full' },
        { type: 'loaded', problems: [] },
      ],
      rowCount: 0,
      expected: 'noProblems',
    },
    {
      case: 'a filter matching none',
      actions: [{ type: 'loaded', problems: FILTERED }],
      rowCount: 0,
      expected: 'filter',
    },
  ])('$case', ({ actions, rowCount, expected }) => {
    const state = actions.reduce(
      (current, action) => practiceReducer(current, action, matcher),
      initialPracticeState(),
    );

    expect(emptyReason(state, rowCount)).toBe(expected);
  });
});

describe('difficultyCounts', () => {
  it('counts solved of total per difficulty', () => {
    expect(difficultyCounts(FILTERED)).toEqual([
      { difficulty: 'easy', solved: 1, total: 1 },
      { difficulty: 'medium', solved: 0, total: 2 },
      { difficulty: 'hard', solved: 0, total: 1 },
    ]);
  });
});
