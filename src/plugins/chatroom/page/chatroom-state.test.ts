import { describe, expect, it } from 'vitest';
import type {
  BoardRow,
  Participant,
  RoomMessage,
  RoomView,
  ThreadView,
} from '../contract';
import { USER_PARTICIPANT } from '../contract';
import {
  ASKS_YOU_ACTIVITY,
  badgeText,
  type ComposerIntent,
  rowActivities,
  threadList,
  userPostFor,
} from './chatroom-state';

function agent(rowId: string, agentId: string | null, name: string) {
  return {
    kind: 'agent',
    rowId,
    agentId,
    mirrorId: null,
    name,
  } satisfies Participant;
}

function message(
  id: number,
  from: Participant,
  kind: RoomMessage['kind'],
): RoomMessage {
  return {
    id,
    room: 'shop',
    thread: 'plan-demo',
    from,
    to: [USER_PARTICIPANT],
    kind,
    body: `body ${id}`,
    refs: [],
    replyTo: null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    at: 0,
    userWord: false,
  };
}

function boardRow(rowId: string, name: string): BoardRow {
  return {
    rowId,
    name,
    harness: 'claude',
    state: 'working',
    folder: null,
    branch: null,
    clone: null,
    uncommitted: [],
    uncommittedMore: 0,
    unpushedPaths: null,
    unpushedMore: 0,
    claims: [],
  };
}

function thread(
  name: string,
  lastId: number,
  resolved: boolean,
  unread = 0,
): ThreadView {
  return {
    thread: name,
    resolved,
    lastId,
    userUnread: unread,
    userMentions: 0,
  };
}

function room(name: string, overrides: Partial<RoomView> = {}): RoomView {
  return {
    room: name,
    threads: [],
    board: [],
    claims: [],
    rowUnread: [],
    userAsks: [],
    ...overrides,
  };
}

describe('badgeText', () => {
  it.each([
    { name: 'mentions over unread', unread: 5, mentions: 2, text: '@2' },
    { name: 'unread only', unread: 3, mentions: 0, text: '3 new' },
    { name: 'both zero', unread: 0, mentions: 0, text: null },
  ])('badgeText_$name', ({ unread, mentions, text }) => {
    expect(badgeText({ unread, mentions })).toBe(text);
  });
});

describe('rowActivities', () => {
  it.each([
    {
      name: 'question to you',
      asks: [message(4, agent('r1', null, 'A'), 'question')],
      r1: ASKS_YOU_ACTIVITY,
    },
    {
      name: 'blocker to you from a subagent',
      asks: [message(7, agent('r1', 'w2', 'A ▸ Explore'), 'blocker')],
      r1: ASKS_YOU_ACTIVITY,
    },
    {
      name: 'ask from another row',
      asks: [message(4, agent('r2', null, 'B'), 'question')],
      r1: null,
    },
    { name: 'no asks', asks: [], r1: null },
  ])('rowActivities_$name', ({ asks, r1 }) => {
    const rooms = [room('other'), room('shop', { userAsks: asks })];

    expect(rowActivities(rooms, ['r1']).get('r1')).toEqual(r1);
  });
});

describe('threadList', () => {
  it('threadList_RoomsAndThreads_SortsRoomsByNameOpenNewestFirstResolvedLast', () => {
    const rooms = [
      room('zeta', { threads: [thread('only', 3, false)] }),
      room('alpha', {
        board: [boardRow('r9', 'Shop Revamp')],
        threads: [
          thread('old-open', 2, false, 1),
          thread('done-new', 40, true),
          thread('session:r9', 17, false),
          thread('session:gone', 9, false),
          thread('done-old', 5, true),
        ],
      }),
    ];

    const list = threadList(rooms).map((group) => ({
      room: group.room,
      threads: group.threads.map((row) => [
        row.label,
        row.resolved,
        row.unread,
      ]),
    }));

    expect(list).toEqual([
      {
        room: 'alpha',
        threads: [
          ['Shop Revamp (session)', false, 0],
          ['session:gone', false, 0],
          ['old-open', false, 1],
          ['done-new', true, 0],
          ['done-old', true, 0],
        ],
      },
      { room: 'zeta', threads: [['only', false, 0]] },
    ]);
  });
});

describe('userPostFor', () => {
  const board = [boardRow('r1', 'Shop Revamp'), boardRow('r2', 'Docs Pass')];
  const note: ComposerIntent = { kind: 'note' };
  const reply = (replied: RoomMessage): ComposerIntent => ({
    kind: 'reply',
    message: replied,
  });

  it.each([
    {
      name: 'note in a topic thread',
      intent: note,
      thread: 'plan-demo',
      post: { kind: 'note', body: 'hi', to: [], replyTo: null },
    },
    {
      name: 'note in a session thread',
      intent: note,
      thread: 'session:r2',
      post: { kind: 'note', body: 'hi', to: ['Docs Pass'], replyTo: null },
    },
    {
      name: 'note in a session thread off the board',
      intent: note,
      thread: 'session:r7',
      post: { kind: 'note', body: 'hi', to: [], replyTo: null },
    },
    {
      name: 'reply on a main agent question',
      intent: reply(message(12, agent('r1', null, 'Shop Revamp'), 'question')),
      thread: 'plan-demo',
      post: { kind: 'answer', body: 'hi', to: ['Shop Revamp'], replyTo: 12 },
    },
    {
      name: 'reply on a subagent blocker',
      intent: reply(
        message(15, agent('r2', 'w3', 'Docs Pass ▸ Explore'), 'blocker'),
      ),
      thread: 'plan-demo',
      post: { kind: 'answer', body: 'hi', to: ['Docs Pass'], replyTo: 15 },
    },
    {
      name: 'reply to a sender off the board',
      intent: reply(message(18, agent('r8', null, 'Gone'), 'question')),
      thread: 'plan-demo',
      post: { kind: 'answer', body: 'hi', to: [], replyTo: 18 },
    },
    {
      name: 'reply on a result',
      intent: reply(message(21, agent('r1', null, 'Shop Revamp'), 'result')),
      thread: 'plan-demo',
      post: null,
    },
  ])('userPostFor_$name', ({ intent, thread: shown, post }) => {
    expect(userPostFor(intent, shown, board, 'hi')).toEqual(post);
  });
});
