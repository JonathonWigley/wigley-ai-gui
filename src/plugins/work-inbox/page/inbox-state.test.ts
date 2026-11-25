import { describe, expect, it } from 'vitest';
import type { ThreadDetail, WorkItem, WorkState } from '../../work/contract';
import { threadDetail, workItem } from '../../work/contract.test-support';
import type { WorkInboxPlace } from '../contract';
import type { DetailInput } from '../layouts/layout';
import {
  cardActions,
  cardInput,
  detailInput,
  emptyReason,
  groupStarts,
  initialsOf,
  type InboxAction,
  type InboxViewState,
  inboxReducer,
  initialInboxState,
  navGroupStart,
  personTone,
  prunedDrafts,
  sectionCounts,
  shownItems,
} from './inbox-state';

function work(
  items: WorkItem[],
  job: Partial<WorkState['job']> = {},
): WorkState {
  return {
    items,
    cards: [],
    suggestions: [],
    columns: [],
    job: { running: null, last: null, ...job },
    lastSweepAt: null,
    sweepFailedAt: null,
    problem: null,
  };
}

const NOW = Date.parse('2026-11-23T12:00:00.000Z');

function view(overrides: Partial<InboxViewState> = {}): InboxViewState {
  return { ...initialInboxState(), ...overrides };
}

// Minutes after ten o'clock, as an item's `at`.
function at(minutes: number): string {
  return new Date(
    Date.parse('2026-11-23T10:00:00.000Z') + minutes * 60_000,
  ).toISOString();
}

// ny-open was seen at its latest message, ny-new was seen before its latest one, and the rest were never seen.
const MIXED = work([
  workItem('ny-open', { at: at(1), ticketKeys: ['ABC-1'], seenAt: at(1) }),
  workItem('ny-done', { at: at(2), state: 'dismissed', ticketKeys: ['ABC-1'] }),
  workItem('ny-new', { at: at(3), seenAt: at(2) }),
  workItem('ny-unseen', { at: at(0) }),
  workItem('wait', {
    at: at(4),
    section: 'waiting',
    ticketKeys: ['ABC-1', 'ABC-2'],
  }),
  workItem('around', { at: at(5), section: 'around', state: 'snoozed' }),
]);

describe('sectionCounts', () => {
  it.each([
    { section: 'needs_you', count: 2 },
    { section: 'waiting', count: 1 },
    { section: 'around', count: 0 },
    { section: 'promised', count: 0 },
    { section: 'all', count: 6 },
  ] as const)(
    'sectionCounts counts unseen open items per section and every item under All: $section',
    ({ section, count }) => {
      expect(sectionCounts(MIXED)[section]).toBe(count);
    },
  );
});

describe('shownItems', () => {
  it.each([
    {
      case: 'a section',
      state: view(),
      ids: ['ny-new', 'ny-open', 'ny-unseen'],
    },
    {
      case: 'All',
      state: view({ section: 'all' }),
      ids: ['wait', 'ny-new', 'ny-done', 'ny-open', 'ny-unseen', 'around'],
    },
    {
      case: 'a ticket key across sections',
      state: view({ ticketFilter: 'ABC-1' }),
      ids: ['wait', 'ny-open'],
    },
  ])(
    'shownItems filters by section, All and ticket key, threads before the digest, newest first: $case',
    ({ state, ids }) => {
      expect(shownItems(MIXED, state).map((item) => item.id)).toEqual(ids);
    },
  );
});

describe('groupStarts', () => {
  it.each([
    { case: 'a section', state: view(), starts: [null, null, null] },
    {
      case: 'All',
      state: view({ section: 'all' }),
      starts: ['threads', null, null, null, null, 'digest'],
    },
  ])(
    'groupStarts marks the first row of each group in a mixed list only: $case',
    ({ state, starts }) => {
      expect(groupStarts(shownItems(MIXED, state), state)).toEqual(starts);
    },
  );

  it.each([
    { section: 'needs_you', group: 'threads' },
    { section: 'my_threads', group: null },
    { section: 'around', group: 'digest' },
    { section: 'worth_knowing', group: null },
    { section: 'all', group: 'all' },
  ] as const)(
    'navGroupStart heads Needs you, Around Slack and All: $section',
    ({ section, group }) => {
      expect(navGroupStart(section)).toBe(group);
    },
  );
});

describe('cardActions', () => {
  it.each([
    {
      case: 'Needs you open',
      item: workItem('a'),
      actions: ['send', 'dismiss', 'startSession', 'addToBoard'],
    },
    {
      case: 'Waiting open',
      item: workItem('a', { section: 'waiting' }),
      actions: ['send', 'snooze', 'dismiss', 'startSession', 'addToBoard'],
    },
    {
      case: 'Around open',
      item: workItem('a', { section: 'around' }),
      actions: ['dismiss', 'startSession', 'addToBoard'],
    },
    {
      case: 'My threads open',
      item: workItem('a', { section: 'my_threads' }),
      actions: ['send', 'dismiss', 'startSession', 'addToBoard'],
    },
    {
      case: 'You promised open',
      item: workItem('a', { section: 'promised' }),
      actions: ['send', 'dismiss', 'startSession', 'addToBoard'],
    },
    {
      case: 'Worth knowing open',
      item: workItem('a', { section: 'worth_knowing' }),
      actions: ['dismiss', 'startSession', 'addToBoard'],
    },
    {
      case: 'dismissed under All',
      item: workItem('a', { state: 'dismissed' }),
      actions: ['restore'],
    },
  ])(
    'cardActions gives each section and state its actions: $case',
    ({ item, actions }) => {
      expect(cardActions(item, view({ section: 'all' }))).toEqual(actions);
    },
  );
});

describe('inboxReducer', () => {
  const before = work([
    workItem('first', { at: at(3) }),
    workItem('middle', { at: at(2) }),
    workItem('last', { at: at(1) }),
  ]);

  it.each([
    {
      case: 'a middle card leaves',
      cursor: 'middle',
      leaving: ['middle'],
      lands: 'last',
    },
    {
      case: 'the last card leaves',
      cursor: 'last',
      leaving: ['last'],
      lands: 'middle',
    },
    {
      case: 'the next card leaves with it',
      cursor: 'middle',
      leaving: ['middle', 'last'],
      lands: 'first',
    },
    {
      case: 'every card leaves',
      cursor: 'first',
      leaving: ['first', 'middle', 'last'],
      lands: null,
    },
    {
      case: 'another card leaves',
      cursor: 'middle',
      leaving: ['first'],
      lands: 'middle',
    },
  ])(
    'inboxReducer keeps the cursor on the next card, else the previous, when its item leaves: $case',
    ({ cursor, leaving, lands }) => {
      const after = work(
        before.items.map((item) =>
          leaving.includes(item.id)
            ? { ...item, state: 'cleared' as const }
            : item,
        ),
      );

      const next = inboxReducer(view({ cursorId: cursor }), {
        type: 'workChanged',
        before,
        after,
      });

      expect(next.cursorId).toBe(lands);
    },
  );

  it('inboxReducer clears the filter back to the section shown before it', () => {
    const waiting = inboxReducer(view(), {
      type: 'showSection',
      section: 'waiting',
      work: MIXED,
    });
    const filtered = inboxReducer(waiting, {
      type: 'filter',
      ticketKey: 'ABC-2',
      work: MIXED,
    });

    const cleared = inboxReducer(filtered, {
      type: 'clearFilter',
      work: MIXED,
    });

    expect(cleared).toMatchObject({
      section: 'waiting',
      ticketFilter: null,
      cursorId: 'wait',
    });
  });

  const PLACE: WorkInboxPlace = {
    section: 'needs_you',
    ticketFilter: null,
    cursorId: null,
    drafts: {},
    paneOpen: true,
  };

  it.each<{
    case: string;
    state: InboxViewState;
    action: InboxAction;
    paneOpen: boolean;
  }>([
    {
      case: 'pane open from closed',
      state: view(),
      action: { type: 'pane', open: true },
      paneOpen: true,
    },
    {
      case: 'pane closed from open',
      state: view({ paneOpen: true }),
      action: { type: 'pane', open: false },
      paneOpen: false,
    },
    {
      case: 'placed with the pane open',
      state: view(),
      action: { type: 'placed', place: PLACE, work: MIXED },
      paneOpen: true,
    },
    {
      case: 'placed from a place saved before the pane',
      state: view({ paneOpen: true }),
      action: {
        type: 'placed',
        place: { ...PLACE, paneOpen: undefined } as unknown as WorkInboxPlace,
        work: MIXED,
      },
      paneOpen: false,
    },
  ])(
    'inboxReducer sets whether the pane is open: $case',
    ({ state, action, paneOpen }) => {
      expect(inboxReducer(state, action).paneOpen).toBe(paneOpen);
    },
  );

  it('inboxReducer returns the same state when the pane already is as asked', () => {
    const open = view({ paneOpen: true });

    expect(inboxReducer(open, { type: 'pane', open: true })).toBe(open);
  });
});

describe('cardInput', () => {
  it.each([
    {
      case: 'a thread never seen',
      item: workItem('a'),
      state: view(),
      expected: { isDigest: false, isUnseen: true, isSending: false },
    },
    {
      case: 'a thread seen at its latest message',
      item: workItem('a', { seenAt: '2026-11-23T10:00:00.000Z' }),
      state: view(),
      expected: { isUnseen: false },
    },
    {
      case: 'a thread with a message since it was seen',
      item: workItem('a', { seenAt: '2026-11-23T09:00:00.000Z' }),
      state: view(),
      expected: { isUnseen: true },
    },
    {
      case: 'a digest item',
      item: workItem('a', { section: 'worth_knowing', why: 'W' }),
      state: view(),
      expected: { isDigest: true, why: 'W' },
    },
    {
      case: 'a reply sending',
      item: workItem('a', { sending: 'x' }),
      state: view(),
      expected: { isSending: true },
    },
  ])(
    'cardInput marks unseen, digest and sending rows: $case',
    ({ item, state, expected }) => {
      expect(cardInput(item, state, NOW)).toMatchObject(expected);
    },
  );
});

describe('the thread as a chat', () => {
  const message = (author: string, byUser = false) => ({
    author,
    byUser,
    at: '2026-11-23T11:00:00.000Z',
    text: 'x',
  });

  it.each([
    {
      case: 'every reply shown: a run carries on from the root',
      replyCount: 4,
      runs: [true, false, true, true, false],
    },
    {
      case: 'hidden replies: the count line breaks the run',
      replyCount: 9,
      runs: [true, true, true, true, false],
    },
  ])(
    'detailInput starts a run on each change of person: $case',
    ({ replyCount, runs }) => {
      const detail = threadDetail('a', {
        root: message('Ann'),
        replies: [
          message('Ann'),
          message('Me', true),
          message('Bo'),
          message('Bo'),
        ],
        replyCount,
      });

      const input = detailInput(workItem('a'), view(), detail, NOW);

      expect(
        [input.root, ...input.replies].map((shown) => shown?.startsRun),
      ).toEqual(runs);
      expect(input.replies[1]).toMatchObject({ author: 'You', byUser: true });
    },
  );

  it('detailInput keeps a run of the user own messages under different author names', () => {
    const detail = threadDetail('a', {
      root: message('Ann'),
      replies: [message('Me', true), message('Jon W', true)],
      replyCount: 2,
    });

    const input = detailInput(workItem('a'), view(), detail, NOW);

    expect(input.replies.map((shown) => shown.startsRun)).toEqual([
      true,
      false,
    ]);
  });

  it.each([
    { name: 'Ann', initials: 'AN' },
    { name: 'Ann Lee', initials: 'AL' },
    { name: '  bo  ', initials: 'BO' },
    { name: 'Q', initials: 'Q' },
  ])('initialsOf takes two letters: $name', ({ name, initials }) => {
    expect(initialsOf(name)).toBe(initials);
  });

  it('personTone gives a name the same tone each time, within the five', () => {
    const names = ['Ann', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay'];
    const tones = names.map(personTone);

    expect(names.map(personTone)).toEqual(tones);
    expect(tones.every((tone) => tone >= 0 && tone < 5)).toBe(true);
    expect(new Set(tones).size).toBeGreaterThan(1);
  });
});

describe('detailInput', () => {
  const twoOfFour = threadDetail('a', {
    fetchedAt: new Date(NOW - 5 * 60_000).toISOString(),
    replies: [
      {
        author: 'Bo',
        byUser: false,
        at: new Date(NOW - 30 * 60_000).toISOString(),
        text: 'B',
      },
      {
        author: 'Ann',
        byUser: false,
        at: new Date(NOW - 2 * 60_000).toISOString(),
        text: 'C',
      },
    ],
    replyCount: 4,
  });
  const allShown = threadDetail('a', {
    fetchedAt: new Date(NOW - 20_000).toISOString(),
    replyCount: 1,
  });

  it.each<{
    case: string;
    item: WorkItem;
    detail: ThreadDetail | null;
    expected: Partial<DetailInput>;
  }>([
    {
      case: 'a detail showing 2 of 4 replies, fetched 5 minutes ago',
      item: workItem('a'),
      detail: twoOfFour,
      expected: {
        fetched: 'Fetched 5m ago',
        replyCountText: '2 of 4 replies',
        replies: [
          {
            author: 'Bo',
            age: '30m',
            text: 'B',
            byUser: false,
            initials: 'BO',
            tone: personTone('Bo'),
            startsRun: true,
          },
          {
            author: 'Ann',
            age: '2m',
            text: 'C',
            byUser: false,
            initials: 'AN',
            tone: personTone('Ann'),
            startsRun: true,
          },
        ],
      },
    },
    {
      case: 'a detail fetched 20 seconds ago with every reply shown',
      item: workItem('a'),
      detail: allShown,
      expected: { fetched: 'Fetched just now', replyCountText: null },
    },
    {
      case: 'no detail',
      item: workItem('a'),
      detail: null,
      expected: { fetched: null, root: null, replies: [] },
    },
    {
      case: 'a dismissed item',
      item: workItem('a', { state: 'dismissed' }),
      detail: null,
      expected: { draft: null, actions: ['restore'] },
    },
    {
      case: 'a sending item',
      item: workItem('a', { sending: 'x' }),
      detail: null,
      expected: { draft: 'x', isSending: true },
    },
    {
      case: 'an open digest item',
      item: workItem('a', { section: 'around' }),
      detail: null,
      expected: {
        draft: null,
        isDigest: true,
        actions: ['dismiss', 'startSession', 'addToBoard'],
      },
    },
    {
      case: 'an open My threads item with no reply typed',
      item: workItem('a', { section: 'my_threads' }),
      detail: null,
      expected: {
        draft: '',
        actions: ['send', 'dismiss', 'startSession', 'addToBoard'],
      },
    },
  ])(
    'detailInput reads the stored thread and the reply box: $case',
    ({ item, detail, expected }) => {
      expect(detailInput(item, view(), detail, NOW)).toMatchObject(expected);
    },
  );
});

describe('emptyReason', () => {
  it.each([
    { case: 'never', state: work([]), filter: null, reason: 'never' },
    {
      case: 'a job ran',
      state: work([], {
        last: {
          kind: 'sweep',
          state: 'done',
          rowId: null,
          at: at(0),
          note: null,
        },
      }),
      filter: null,
      reason: 'section',
    },
    {
      case: 'section',
      state: work([workItem('a', { section: 'around' })]),
      filter: null,
      reason: 'section',
    },
    {
      case: 'filter',
      state: work([workItem('a')]),
      filter: 'ABC-9',
      reason: 'filter',
    },
  ])(
    'emptyReason names never, section and filter: $case',
    ({ state, filter, reason }) => {
      expect(emptyReason(state, view({ ticketFilter: filter }))).toBe(reason);
    },
  );
});

describe('prunedDrafts', () => {
  it.each([
    { case: 'an open item', items: [workItem('a')], kept: { a: 'mine' } },
    {
      case: 'a dismissed item',
      items: [workItem('a', { state: 'dismissed' })],
      kept: { a: 'mine' },
    },
    {
      case: 'a cleared item, as a good send leaves it',
      items: [workItem('a', { state: 'cleared' })],
      kept: {},
    },
    { case: 'an item work no longer holds', items: [workItem('b')], kept: {} },
  ])(
    'prunedDrafts keeps edits of items not cleared and drops the rest: $case',
    ({ items, kept }) => {
      expect(prunedDrafts({ a: 'mine' }, work(items))).toEqual(kept);
    },
  );
});
