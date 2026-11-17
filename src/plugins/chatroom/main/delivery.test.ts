import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserMessage } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import { createListeners, type Listeners } from '../../../shared/listeners';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { AgentSession } from '../../sessions/contract';
import type { Participant } from '../contract';
import { startDelivery } from './delivery';
import { createMemoryRoomStore } from './memory-room-store';
import {
  createRoomService,
  type HumanPostRequest,
  type PostRequest,
  type RoomService,
} from './room-service';
import { createRoster, type Roster } from './roster';

const ROOM = 'game';
const TITLES: Record<string, string> = { rA: 'Lead', rB: 'Peer', rC: 'Term' };
const PROFILES: Record<string, string> = { rA: 'work', rB: 'work' };

let roster: Roster;
let room: RoomService;
let sends: [string, UserMessage][];
let idle: Set<string>;
let turnsFinished: Listeners<{ sessionId: string; how: 'idle' | 'rested' }>;
let sessionsEnded: Listeners<string>;
let bodyCount: number;
let delivery: Disposable;

function agentSession(id: string): AgentSession {
  return {
    id,
    info: {
      sessionId: null,
      projectDir: `/r/${id}`,
      harness: 'claude',
      rowId: null,
    },
  };
}

function mainAgent(rowId: string): Participant {
  return roster.participant(rowId, null);
}

function post(from: string, fields: Partial<PostRequest>) {
  return room.post({
    room: ROOM,
    from: mainAgent(from),
    kind: 'note',
    body: `${from} ${bodyCount++}`,
    to: [],
    thread: 'plan-x',
    refs: [],
    replyTo: null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    ...fields,
  });
}

function postAsUser(fields: Partial<HumanPostRequest>) {
  return room.postHuman({
    room: ROOM,
    kind: 'note',
    body: `you ${bodyCount++}`,
    to: [],
    thread: 'plan-x',
    refs: [],
    replyTo: null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    ...fields,
  });
}

async function settle(): Promise<void> {
  await room.settled();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function finishTurn(sessionId: string, how: 'idle' | 'rested' = 'idle'): void {
  turnsFinished.tell({ sessionId, how });
}

const USER_WAKE = (thread: string) =>
  `Chatroom: the user wrote to you in thread ${thread}. Call chatroom_read to read it.`;

beforeEach(() => {
  roster = createRoster({
    sessions: {
      project: (rowId) => (rowId in TITLES ? ROOM : null),
      titles: (rowId) => ({
        user: null,
        agent: TITLES[rowId] ?? null,
        firstMessage: null,
      }),
      label: () => null,
    },
  });
  for (const id of ['rA', 'rB', 'rC']) {
    roster.connected(agentSession(id), id in PROFILES);
  }
  room = createRoomService({
    store: createMemoryRoomStore(),
    files: createMemoryFiles(),
    clock: { now: () => 1_700_000_000_000 },
    randomHex: () => '00000001',
    limits: () => ({ bodyCap: 1500, postsPerMinute: 100, claimMinutes: 30 }),
    participants: (roomName) => roster.participants(roomName),
    log: () => undefined,
  });
  sends = [];
  bodyCount = 0;
  idle = new Set(['rA', 'rB', 'rC']);
  turnsFinished = createListeners();
  sessionsEnded = createListeners();
  delivery = startDelivery({
    room,
    roster,
    chat: {
      profileOf: (rowId) => PROFILES[rowId] ?? null,
      send: vi.fn(async (rowId: string, message: UserMessage) => {
        sends.push([rowId, message]);
      }),
    },
    isIdle: (rowId) => idle.has(rowId),
    onTurnFinished: (listener) =>
      turnsFinished.add(({ sessionId, how }) => listener(sessionId, how)),
    onSessionEnded: (listener) => sessionsEnded.add(listener),
    log: () => undefined,
  });
});

describe('startDelivery', () => {
  it.each<{
    case: string;
    act: () => Promise<unknown>;
    expected: [string, string][];
  }>([
    {
      case: 'addressed question to an idle app-run row',
      act: () => post('rB', { kind: 'question', to: ['Lead'] }),
      expected: [
        [
          'rA',
          'Chatroom: Peer sent you a question in thread plan-x. Call chatroom_read to read it.',
        ],
      ],
    },
    {
      case: 'addressed note',
      act: () => post('rB', { to: ['Lead'] }),
      expected: [],
    },
    {
      case: 'progress',
      act: () => post('rB', { kind: 'progress', to: ['Lead'] }),
      expected: [],
    },
    {
      case: 'terminal row with no profile',
      act: () => post('rB', { kind: 'blocker', to: ['Term'] }),
      expected: [],
    },
    {
      case: 'user word with empty to in a thread the row posted in',
      act: async () => {
        await post('rA', { thread: 'plan-y' });
        await postAsUser({ thread: 'plan-y' });
      },
      expected: [['rA', USER_WAKE('plan-y')]],
    },
    {
      case: 'user word in the row thread',
      act: () => postAsUser({ thread: 'session:rB' }),
      expected: [['rB', USER_WAKE('session:rB')]],
    },
    {
      case: 'user-word question addressed to the row',
      act: () => postAsUser({ kind: 'question', to: ['Lead'] }),
      expected: [['rA', USER_WAKE('plan-x')]],
    },
  ])('wake_Rules: $case', async ({ act, expected }) => {
    await act();
    await settle();

    expect(sends).toEqual(
      expected.map(([rowId, text]) => [rowId, { text, images: [] }]),
    );
  });

  describe('wake_BusyThenIdle', () => {
    beforeEach(() => idle.delete('rA'));

    it('sends a busy row its wake once, at its idle turn end', async () => {
      await post('rB', { kind: 'handoff', to: ['Lead'] });
      await settle();
      expect(sends).toEqual([]);

      finishTurn('rA', 'rested');
      await settle();
      expect(sends).toEqual([]);

      finishTurn('rA');
      await settle();
      finishTurn('rA');
      await settle();
      expect(sends.map(([rowId]) => rowId)).toEqual(['rA']);
    });

    it('sends nothing for a message read before the turn ends', async () => {
      await post('rB', { kind: 'question', to: ['Lead'] });
      await settle();
      await room.read(ROOM, mainAgent('rA'), { kind: 'unread' });

      finishTurn('rA');
      await settle();

      expect(sends).toEqual([]);
    });

    it('drops a pending wake when the session ends', async () => {
      await post('rB', { kind: 'question', to: ['Lead'] });
      await settle();

      sessionsEnded.tell('rA');
      finishTurn('rA');
      await settle();

      expect(sends).toEqual([]);
    });

    it('sends the user word in the row thread at the turn end', async () => {
      await postAsUser({ thread: 'session:rA' });
      await settle();
      expect(sends).toEqual([]);

      finishTurn('rA');
      await settle();

      expect(sends).toEqual([
        ['rA', { text: USER_WAKE('session:rA'), images: [] }],
      ]);
    });

    it('drops a pending wake on dispose', async () => {
      await post('rB', { kind: 'question', to: ['Lead'] });
      await settle();

      delivery.dispose();
      finishTurn('rA');
      await settle();

      expect(sends).toEqual([]);
    });
  });
});
