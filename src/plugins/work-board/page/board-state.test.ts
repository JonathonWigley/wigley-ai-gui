import { describe, expect, it } from 'vitest';
import {
  OTHER_COLUMN,
  type WorkCard,
  type WorkDetail,
  type WorkItem,
  type WorkState,
  type WorkSuggestion,
} from '../../work/contract';
import {
  jiraCard,
  localCard,
  threadDetail,
  ticketDetail,
  workItem,
} from '../../work/contract.test-support';
import type { WorkBoardPlace } from '../contract';
import type {
  DetailInput,
  TaskPaneInput,
  TicketPaneInput,
} from '../layouts/layout';
import {
  type BoardAction,
  type BoardViewState,
  boardReducer,
  cardActions,
  initialBoardState,
  neighbourColumns,
  paneInputOf,
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
    lastSweepAt: null,
    problem: null,
    ...overrides,
  };
}

const inColumn = (key: string, column: string) =>
  jiraCard(key, column, { column });

// A saved place on card `cursorCardId`, the pane closed, no drafts.
const savedPlace = (cursorCardId: string): WorkBoardPlace => ({
  cursorCardId,
  paneOpen: false,
  drafts: {},
});

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
      action: { type: 'restore', place: null },
      expected: 'B-1',
    },
    {
      case: 'a saved card still on the board is put back',
      cursor: null,
      action: { type: 'restore', place: savedPlace('Q-2') },
      expected: 'Q-2',
    },
    {
      case: 'a saved card gone from the board falls back to the first card',
      cursor: null,
      action: { type: 'restore', place: savedPlace('GONE-1') },
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
    const state = {
      ...initialBoardState,
      cursorCardId: 'B-1',
      flashCardId: 'Q-1',
    };

    const next = boardReducer(
      state,
      { type: 'stateChanged', previous: work },
      without('Q-1'),
    );

    expect(next.flashCardId).toBeNull();
  });

  it.each<{
    case: string;
    state: Partial<BoardViewState>;
    action: BoardAction;
    after?: WorkState;
    expected: Pick<BoardViewState, 'paneOpen' | 'focus' | 'drafts'>;
  }>([
    {
      case: 'pane opens',
      state: {},
      action: { type: 'pane', open: true },
      expected: { paneOpen: true, focus: 'board', drafts: {} },
    },
    {
      case: 'pane closes',
      state: { paneOpen: true },
      action: { type: 'pane', open: false },
      expected: { paneOpen: false, focus: 'board', drafts: {} },
    },
    {
      case: 'restore puts back the pane and the drafts of cards still on the board',
      state: {},
      action: {
        type: 'restore',
        place: {
          cursorCardId: 'T-1',
          paneOpen: true,
          drafts: { 'T-1': 'mine', 'GONE-1': 'lost' },
        },
      },
      expected: { paneOpen: true, focus: 'board', drafts: { 'T-1': 'mine' } },
    },
    {
      case: 'draftEdited sets a card text beside the others',
      state: { drafts: { 'B-1': 'old' } },
      action: { type: 'draftEdited', cardId: 'T-1', text: 'hi' },
      expected: {
        paneOpen: false,
        focus: 'board',
        drafts: { 'B-1': 'old', 'T-1': 'hi' },
      },
    },
    {
      case: 'draftDropped removes only that card text',
      state: { drafts: { 'B-1': 'a', 'T-1': 'b' } },
      action: { type: 'draftDropped', cardId: 'T-1' },
      expected: { paneOpen: false, focus: 'board', drafts: { 'B-1': 'a' } },
    },
    {
      case: 'stateChanged drops the draft of a card that left',
      state: { cursorCardId: 'Q-1', drafts: { 'B-2': 'x', 'Q-1': 'y' } },
      action: { type: 'stateChanged', previous: work },
      after: without('B-2'),
      expected: { paneOpen: false, focus: 'board', drafts: { 'Q-1': 'y' } },
    },
    {
      case: 'focus moves to the box',
      state: {},
      action: { type: 'focus', focus: 'box' },
      expected: { paneOpen: false, focus: 'box', drafts: {} },
    },
  ])(
    'boardReducer keeps the pane, the focus and each card draft: $case',
    ({ state, action, after, expected }) => {
      const next = boardReducer(
        { ...initialBoardState, cursorCardId: 'B-1', ...state },
        action,
        after ?? work,
      );

      expect({
        paneOpen: next.paneOpen,
        focus: next.focus,
        drafts: next.drafts,
      }).toEqual(expected);
    },
  );
});

describe('paneInputOf', () => {
  const NOW = Date.parse('2026-11-23T12:00:00.000Z');
  const ISSUE = {
    key: 'ABC-2',
    title: 'Add a test',
    status: 'To Do',
    relation: null,
    url: 'https://jira.example/browse/ABC-2',
  };
  const LINK = {
    key: 'ABC-9',
    title: 'Crash on resume',
    status: 'Done',
    relation: 'blocks',
    url: 'https://jira.example/browse/ABC-9',
  };
  const TICKET: TicketPaneInput = {
    kind: 'ticket',
    id: 'ABC-1',
    key: 'ABC-1',
    title: 'Ticket ABC-1',
    url: 'https://jira.example/browse/ABC-1',
    fetched: null,
    detail: null,
    threads: [],
    box: { kind: 'comment', sending: null },
    posting: [],
    note: null,
  };
  const TASK: TaskPaneInput = {
    kind: 'task',
    id: 'local-1',
    title: 'Task local-1',
    url: null,
    hasThread: true,
    source: {
      channel: '#team',
      participants: ['Ann', 'Bo'],
      ticketKeys: ['ABC-1'],
      summary: 'Ann asks for a review.',
    },
    fetched: null,
    detail: null,
    box: { kind: 'reply', sending: null },
    note: null,
  };
  const ticket = jiraCard('ABC-1', 'To Do', { column: 'Todo' });
  const task = localCard('local-1', 'Todo', { sourceItemId: 't1' });
  const sourceItem = (overrides: Partial<WorkItem> = {}) =>
    workItem('t1', { ticketKeys: ['ABC-1'], ...overrides });

  it.each<{
    case: string;
    card: WorkCard;
    items?: WorkItem[];
    details?: WorkDetail[];
    expected: DetailInput;
  }>([
    {
      case: 'a Jira card with its ticket detail',
      card: ticket,
      details: [
        ticketDetail('ABC-1', {
          fetchedAt: '2026-11-23T11:57:00.000Z',
          updated: '2026-11-23T11:20:00.000Z',
          priority: 'High',
          comments: [
            { author: 'Bo', at: '2026-11-23T11:59:30.000Z', text: 'Seen it.' },
            { author: 'Ann', at: '2026-11-23T09:00:00.000Z', text: '`x`' },
          ],
          subtasks: [ISSUE],
          links: [LINK],
        }),
      ],
      expected: {
        ...TICKET,
        fetched: 'Fetched 3m ago',
        detail: {
          type: 'Bug',
          priority: 'High',
          status: 'To Do',
          assignee: 'Ann',
          reporter: 'Bo',
          updated: '40m ago',
          description: 'Fix the **board**.',
          comments: [
            { author: 'Bo', age: 'just now', text: 'Seen it.' },
            { author: 'Ann', age: '3h ago', text: '`x`' },
          ],
          subtasks: [ISSUE],
          links: [LINK],
        },
      },
    },
    {
      case: 'a Jira card with no record',
      card: ticket,
      expected: TICKET,
    },
    {
      case: 'a Jira card whose id holds a thread record',
      card: ticket,
      details: [threadDetail('ABC-1')],
      expected: TICKET,
    },
    {
      case: 'threads list only the open items naming the key, in slot order',
      card: ticket,
      items: [
        workItem('t1', { ticketKeys: ['ABC-1'], latest: 'Ann: one' }),
        workItem('t2', { ticketKeys: ['ABC-1'], state: 'dismissed' }),
        workItem('t3', { ticketKeys: ['ABC-10'] }),
        workItem('t4', {
          ticketKeys: ['XYZ-2', 'ABC-1'],
          channel: '#client',
          summary: 'QA wants a build.',
          latest: 'Sam: ETA?',
        }),
      ],
      expected: {
        ...TICKET,
        threads: [
          {
            channel: '#team',
            summary: 'Ann asks for a review.',
            latest: 'Ann: one',
          },
          {
            channel: '#client',
            summary: 'QA wants a build.',
            latest: 'Sam: ETA?',
          },
        ],
      },
    },
    {
      case: 'posting holds the queued comments, and the note shows',
      card: jiraCard('ABC-1', 'To Do', {
        column: 'Todo',
        commenting: ['first', 'second'],
        note: 'Jira refused the comment',
      }),
      expected: {
        ...TICKET,
        posting: ['first', 'second'],
        note: 'Jira refused the comment',
      },
    },
    {
      case: 'a local task with its source and thread detail',
      card: task,
      items: [sourceItem()],
      details: [
        threadDetail('t1', {
          fetchedAt: '2026-11-23T11:57:00.000Z',
          root: { author: 'Ann', at: '2026-11-23T11:00:00.000Z', text: 'Q?' },
          replies: [
            { author: 'Bo', at: '2026-11-23T11:30:00.000Z', text: 'A.' },
            { author: 'Ann', at: '2026-11-23T11:58:00.000Z', text: 'B.' },
          ],
          replyCount: 4,
        }),
      ],
      expected: {
        ...TASK,
        fetched: 'Fetched 3m ago',
        detail: {
          root: { author: 'Ann', age: '1h ago', text: 'Q?' },
          replies: [
            { author: 'Bo', age: '30m ago', text: 'A.' },
            { author: 'Ann', age: '2m ago', text: 'B.' },
          ],
          hidden: 2,
        },
      },
    },
    {
      case: 'a local task whose source item is cleared has no box',
      card: task,
      items: [sourceItem({ state: 'cleared' })],
      expected: { ...TASK, box: null },
    },
    {
      case: 'a local task whose source item is sending',
      card: task,
      items: [sourceItem({ sending: 'on its way' })],
      expected: { ...TASK, box: { kind: 'reply', sending: 'on its way' } },
    },
    {
      case: 'a local task with no source thread',
      card: localCard('local-1', 'Todo'),
      items: [sourceItem()],
      details: [threadDetail('t1')],
      expected: { ...TASK, hasThread: false, source: null, box: null },
    },
    {
      case: 'a local task whose source item the Inbox no longer holds',
      card: task,
      expected: { ...TASK, source: null, box: null },
    },
  ])(
    'paneInputOf reads the stored detail of its own kind and ages it: $case',
    ({ card, items = [], details = [], expected }) => {
      const stored = new Map(details.map((detail) => [detail.id, detail]));

      expect(paneInputOf(card, board([card], { items }), stored, NOW)).toEqual(
        expected,
      );
    },
  );
});
