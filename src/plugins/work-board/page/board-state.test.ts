import { describe, expect, it } from 'vitest';
import {
  OTHER_COLUMN,
  type WorkCard,
  type WorkState,
  type WorkSuggestion,
} from '../../work/contract';
import {
  jiraCard,
  localCard,
  workItem,
} from '../../work/contract.test-support';
import {
  type BoardAction,
  boardReducer,
  cardActions,
  initialBoardState,
  neighbourColumns,
  shownColumns,
  threadCount,
} from './board-state';

const COLUMNS = ['Backlog', 'Todo', 'In Progress', 'In QA', 'Done'];

function board(
  cards: WorkCard[],
  overrides: Partial<WorkState> = {},
): WorkState {
  return {
    items: [],
    cards,
    suggestions: [],
    columns: [...COLUMNS, OTHER_COLUMN],
    job: { running: null, last: null },
    problem: null,
    ...overrides,
  };
}

const inColumn = (key: string, column: string) =>
  jiraCard(key, column, { column });

function suggestion(
  cardId: string,
  state: WorkSuggestion['state'],
): WorkSuggestion {
  return {
    cardId,
    signal: 'branch',
    column: 'In Progress',
    reason: `Branch ${cardId}-fix in repo`,
    at: '2026-11-23T10:00:00.000Z',
    state,
  };
}

describe('shownColumns', () => {
  it.each([
    {
      case: 'no card in Other',
      cards: [inColumn('A-1', 'Backlog'), inColumn('A-2', 'Todo')],
      names: COLUMNS,
      other: [],
    },
    {
      case: 'a Jira card in Other',
      cards: [inColumn('A-1', 'Backlog'), inColumn('A-3', OTHER_COLUMN)],
      names: [...COLUMNS, OTHER_COLUMN],
      other: ['A-3'],
    },
    {
      case: 'a local task in an unknown column',
      cards: [localCard('local-1', 'Parked'), inColumn('A-2', 'Todo')],
      names: [...COLUMNS, OTHER_COLUMN],
      other: ['local-1'],
    },
  ])(
    'shownColumns orders the configured columns and adds Other only while it holds a card: $case',
    ({ cards, names, other }) => {
      const columns = shownColumns(board(cards));

      expect(columns.map((column) => column.name)).toEqual(names);
      const otherColumn = columns.find(
        (column) => column.name === OTHER_COLUMN,
      );
      expect(otherColumn?.cards.map((card) => card.id) ?? []).toEqual(other);
      expect(otherColumn?.isDropTarget ?? false).toBe(false);
      expect(
        columns
          .filter((column) => column.name !== OTHER_COLUMN)
          .every((column) => column.isDropTarget),
      ).toBe(true);
    },
  );

  it('keeps the slot order within a column', () => {
    const columns = shownColumns(
      board([
        inColumn('A-9', 'Todo'),
        inColumn('A-1', 'Backlog'),
        inColumn('A-4', 'Todo'),
      ]),
    );

    expect(columns[1].cards.map((card) => card.id)).toEqual(['A-9', 'A-4']);
  });
});

describe('neighbourColumns', () => {
  it.each([
    { column: 'Backlog', prev: null, next: 'Todo' },
    { column: 'In Progress', prev: 'Todo', next: 'In QA' },
    { column: 'Done', prev: 'In QA', next: null },
    { column: OTHER_COLUMN, prev: null, next: null },
    { column: 'Parked', prev: null, next: null },
  ])(
    'neighbourColumns gives none from Other and at either end: $column',
    ({ column, prev, next }) => {
      const card = inColumn('A-1', column);

      expect(neighbourColumns(card, board([card]))).toEqual({ prev, next });
    },
  );
});

describe('cardActions', () => {
  it.each([
    {
      case: 'a Jira card in a middle column',
      card: inColumn('A-1', 'Todo'),
      suggestions: [],
      actions: ['moveLeft', 'moveRight', 'startSession'],
    },
    {
      case: 'a moving Jira card',
      card: jiraCard('A-1', 'Todo', { column: 'Todo', movingTo: 'In QA' }),
      suggestions: [],
      actions: ['startSession'],
    },
    {
      case: 'a Jira card in the first column with a waiting suggestion',
      card: inColumn('A-1', 'Backlog'),
      suggestions: [suggestion('A-1', 'suggested')],
      actions: ['moveRight', 'accept', 'notYet', 'startSession'],
    },
    {
      case: 'a Jira card whose suggestion is done',
      card: inColumn('A-1', 'Done'),
      suggestions: [suggestion('A-1', 'done')],
      actions: ['moveLeft', 'startSession'],
    },
    {
      case: 'a local task in Todo',
      card: localCard('local-1', 'Todo'),
      suggestions: [],
      actions: ['moveLeft', 'moveRight', 'startSession', 'deleteTask'],
    },
    {
      case: 'a local task in Other',
      card: localCard('local-1', 'Parked'),
      suggestions: [],
      actions: ['startSession', 'deleteTask'],
    },
  ])(
    'cardActions gives Jira cards no delete and moving cards no moves: $case',
    ({ card, suggestions, actions }) => {
      expect(cardActions(card, board([card], { suggestions }))).toEqual(
        actions,
      );
    },
  );
});

describe('threadCount', () => {
  it.each([
    {
      case: 'two open items holding the key',
      card: inColumn('ABC-1', 'Todo') as WorkCard,
      items: [
        workItem('t1', { ticketKeys: ['ABC-1'] }),
        workItem('t2', { ticketKeys: ['XYZ-2', 'ABC-1'] }),
        workItem('t3', { ticketKeys: ['ABC-10'] }),
      ],
      count: 2,
    },
    {
      case: 'a dismissed item holding the key',
      card: inColumn('ABC-1', 'Todo') as WorkCard,
      items: [
        workItem('t1', { ticketKeys: ['ABC-1'], state: 'dismissed' }),
        workItem('t2', { ticketKeys: ['ABC-1'] }),
      ],
      count: 1,
    },
    {
      case: 'a local task',
      card: localCard('local-1', 'Todo') as WorkCard,
      items: [workItem('t1', { ticketKeys: ['local-1'] })],
      count: 0,
    },
  ])(
    'threadCount counts open items by key, and none for a local task: $case',
    ({ card, items, count }) => {
      expect(threadCount(card, board([card], { items }))).toBe(count);
    },
  );
});

describe('boardReducer', () => {
  // Backlog: B-1, B-2, B-3; Todo: T-1; In Progress: none; In QA: Q-1, Q-2.
  const cards = [
    inColumn('B-1', 'Backlog'),
    inColumn('B-2', 'Backlog'),
    inColumn('B-3', 'Backlog'),
    inColumn('T-1', 'Todo'),
    inColumn('Q-1', 'In QA'),
    inColumn('Q-2', 'In QA'),
  ];
  const work = board(cards);
  const without = (id: string) => board(cards.filter((card) => card.id !== id));

  it.each<{
    case: string;
    cursor: string | null;
    action: BoardAction;
    after?: WorkState;
    expected: string | null;
  }>([
    {
      case: 'the first placement puts it on the first card',
      cursor: null,
      action: { type: 'restore', cursorCardId: null },
      expected: 'B-1',
    },
    {
      case: 'a saved card still on the board is put back',
      cursor: null,
      action: { type: 'restore', cursorCardId: 'Q-2' },
      expected: 'Q-2',
    },
    {
      case: 'a saved card gone from the board falls back to the first card',
      cursor: null,
      action: { type: 'restore', cursorCardId: 'GONE-1' },
      expected: 'B-1',
    },
    {
      case: 'j moves down its column',
      cursor: 'B-1',
      action: { type: 'cardStep', to: 'down' },
      expected: 'B-2',
    },
    {
      case: 'G moves to the last card of its column',
      cursor: 'B-1',
      action: { type: 'cardStep', to: 'bottom' },
      expected: 'B-3',
    },
    {
      case: 'gg moves to the first card of its column',
      cursor: 'Q-2',
      action: { type: 'cardStep', to: 'top' },
      expected: 'Q-1',
    },
    {
      case: 'l keeps the row index in the next column with cards',
      cursor: 'B-1',
      action: { type: 'columnStep', delta: 1 },
      expected: 'T-1',
    },
    {
      case: 'l into a shorter column takes its last card',
      cursor: 'B-3',
      action: { type: 'columnStep', delta: 1 },
      expected: 'T-1',
    },
    {
      case: 'l skips an empty column',
      cursor: 'T-1',
      action: { type: 'columnStep', delta: 1 },
      expected: 'Q-1',
    },
    {
      case: 'h skips an empty column into a shorter one, taking its last card',
      cursor: 'Q-2',
      action: { type: 'columnStep', delta: -1 },
      expected: 'T-1',
    },
    {
      case: 'h with no card to that side does nothing',
      cursor: 'B-2',
      action: { type: 'columnStep', delta: -1 },
      expected: 'B-2',
    },
    {
      case: 'l with no card to that side does nothing',
      cursor: 'Q-1',
      action: { type: 'columnStep', delta: 1 },
      expected: 'Q-1',
    },
    {
      case: 'a cursor card that leaves takes the next card of its column',
      cursor: 'B-2',
      action: { type: 'stateChanged', previous: work },
      after: without('B-2'),
      expected: 'B-3',
    },
    {
      case: 'a last cursor card that leaves takes the previous card',
      cursor: 'Q-2',
      action: { type: 'stateChanged', previous: work },
      after: without('Q-2'),
      expected: 'Q-1',
    },
    {
      case: 'a lone cursor card that leaves takes the nearest column first card',
      cursor: 'T-1',
      action: { type: 'stateChanged', previous: work },
      after: without('T-1'),
      expected: 'B-1',
    },
    {
      case: 'a cursor card that stays keeps the cursor',
      cursor: 'Q-1',
      action: { type: 'stateChanged', previous: work },
      after: without('B-1'),
      expected: 'Q-1',
    },
    {
      case: 'the last card leaving empties the cursor',
      cursor: 'T-1',
      action: {
        type: 'stateChanged',
        previous: board([inColumn('T-1', 'Todo')]),
      },
      after: board([]),
      expected: null,
    },
    {
      case: 'select an unknown card does nothing',
      cursor: 'B-1',
      action: { type: 'select', cardId: 'GONE-1' },
      expected: 'B-1',
    },
  ])(
    'boardReducer moves the cursor by column and keeps a neighbour when its card leaves: $case',
    ({ cursor, action, after, expected }) => {
      const state = { ...initialBoardState, cursorCardId: cursor };

      const next = boardReducer(state, action, after ?? work);

      expect(next.cursorCardId).toBe(expected);
    },
  );

  it('drops the flash when its card leaves', () => {
    const state = { cursorCardId: 'B-1', flashCardId: 'Q-1' };

    const next = boardReducer(
      state,
      { type: 'stateChanged', previous: work },
      without('Q-1'),
    );

    expect(next.flashCardId).toBeNull();
  });
});
