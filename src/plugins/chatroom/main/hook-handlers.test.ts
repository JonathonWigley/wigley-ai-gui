import { describe, expect, it, vi } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { AgentSession } from '../../sessions/contract';
import type {
  ChatroomHookRequest,
  Claim,
  Participant,
  RoomMessage,
} from '../contract';
import type { BoardFeed } from './board-feed';
import type { Touch } from './board';
import { createHookHandlers, type HookHandlersDeps } from './hook-handlers';
import type { RoomService } from './room-service';
import { createRoster } from './roster';

const NOW = 1_700_000_000_000;
const ROOT = '/r/c2';
const TITLES: Record<string, string> = { rA: 'Lead', rB: 'Peer', rC: 'Third' };
const SESSION: AgentSession = {
  id: 'rA',
  info: { sessionId: null, projectDir: ROOT, harness: 'claude', rowId: null },
};

function agent(
  rowId: string,
  agentId: string | null,
  name: string,
): Participant {
  return { kind: 'agent', rowId, agentId, mirrorId: null, name };
}

function claimBy(
  holder: string,
  minutesLeftMs: number,
  reason = 'shop revamp',
): Claim {
  return {
    id: `c-${holder}-${reason}`,
    room: 'game',
    holder: agent('rB', null, holder),
    target: { paths: ['src/shop/**'] },
    reason,
    expiresAt: NOW + minutesLeftMs,
  };
}

function touchBy(rowId: string, path: string, agentId = 'main'): Touch {
  return { path, rowId, agentId, at: 1 };
}

function request(
  fields: Partial<ChatroomHookRequest> = {},
): ChatroomHookRequest {
  return {
    tool: 'edit',
    paths: [`${ROOT}/src/shop/a.ts`],
    agentId: null,
    cwd: ROOT,
    ...fields,
  };
}

interface Fakes {
  claims?: readonly Claim[];
  touches?: readonly Touch[];
  unread?: number;
  warnAtPost?: boolean;
}

function handlersOver(fakes: Fakes = {}) {
  const roster = createRoster({
    sessions: {
      project: (rowId) => (rowId in TITLES ? 'game' : null),
      titles: (rowId) => ({
        user: null,
        agent: TITLES[rowId] ?? null,
        firstMessage: null,
      }),
      label: () => null,
    },
  });
  roster.connected({ ...SESSION, id: 'rB' }, true);
  roster.subagentSpawned('rB', 'agent-9', 'worker');
  const room = {
    claimsTouching: vi.fn<RoomService['claimsTouching']>(async () => [
      ...(fakes.claims ?? []),
    ]),
    unreadAddressed: vi.fn<RoomService['unreadAddressed']>(async () =>
      Array.from({ length: fakes.unread ?? 0 }, () => ({}) as RoomMessage),
    ),
  };
  const boardFeed = {
    noteTouched: vi.fn<BoardFeed['noteTouched']>(),
    uncommittedByOthers: vi.fn<BoardFeed['uncommittedByOthers']>(
      () => fakes.touches ?? [],
    ),
  };
  const deps: HookHandlersDeps = {
    room,
    roster,
    boardFeed,
    git: { topLevel: async () => ROOT },
    paths: posixPaths,
    clock: { now: () => NOW },
    log: () => undefined,
    warnAtPost: fakes.warnAtPost ?? false,
    arrive: () => undefined,
  };
  return { handlers: createHookHandlers(deps), room, boardFeed };
}

const CLAIM_LINE = (
  path: string,
  holder: string,
  reason: string,
  minutes: number,
) =>
  `Chatroom: ${path} is claimed by ${holder} (${reason}; ${minutes} min left) — ask them in the room before you change it.`;
const TOUCH_LINE = (path: string, name: string) =>
  `Chatroom: ${path} has uncommitted changes from ${name} — ask them in the room before you change or commit it.`;

describe('pre', () => {
  it.each<{
    case: string;
    fakes: Fakes;
    request: unknown;
    expected: string | null;
  }>([
    { case: 'no hit', fakes: {}, request: request(), expected: null },
    {
      case: 'claim hit, minutes rounded up',
      fakes: { claims: [claimBy('Peer', 90_001)] },
      request: request(),
      expected: CLAIM_LINE('src/shop/a.ts', 'Peer', 'shop revamp', 2),
    },
    {
      case: 'claim hit at its end, at least 1 minute',
      fakes: { claims: [claimBy('Peer', 0)] },
      request: request(),
      expected: CLAIM_LINE('src/shop/a.ts', 'Peer', 'shop revamp', 1),
    },
    {
      case: 'path shown relative to a cwd below the root',
      fakes: { claims: [claimBy('Peer', 60_000)] },
      request: request({ cwd: `${ROOT}/src` }),
      expected: CLAIM_LINE('shop/a.ts', 'Peer', 'shop revamp', 1),
    },
    {
      case: 'uncommitted hit by a subagent',
      fakes: { touches: [touchBy('rB', `${ROOT}/src/shop/a.ts`, 'agent-9')] },
      request: request(),
      expected: TOUCH_LINE('src/shop/a.ts', 'Peer ▸ worker'),
    },
    {
      case: '7 hits',
      fakes: {
        claims: [1, 2, 3, 4, 5, 6, 7].map((n) =>
          claimBy('Peer', 60_000, `r${n}`),
        ),
      },
      request: request(),
      expected: [
        ...[1, 2, 3, 4, 5].map((n) =>
          CLAIM_LINE('src/shop/a.ts', 'Peer', `r${n}`, 1),
        ),
        '… and 2 more.',
      ].join('\n'),
    },
    {
      case: 'request that does not parse',
      fakes: { claims: [claimBy('Peer', 60_000)] },
      request: { tool: 'read', paths: [], agentId: null, cwd: ROOT },
      expected: null,
    },
    {
      case: 'path outside the root',
      fakes: { claims: [claimBy('Peer', 60_000)] },
      request: request({ paths: ['/elsewhere/a.ts'] }),
      expected: null,
    },
    {
      case: 'one path hit by two claims',
      fakes: {
        claims: [
          claimBy('Peer', 60_000, 'one'),
          claimBy('Third', 120_000, 'two'),
        ],
      },
      request: request(),
      expected: [
        CLAIM_LINE('src/shop/a.ts', 'Peer', 'one', 1),
        CLAIM_LINE('src/shop/a.ts', 'Third', 'two', 2),
      ].join('\n'),
    },
    {
      case: 'a claim hit and an uncommitted hit',
      fakes: {
        claims: [claimBy('Peer', 60_000)],
        touches: [touchBy('rC', `${ROOT}/src/shop/a.ts`)],
      },
      request: request(),
      expected: [
        CLAIM_LINE('src/shop/a.ts', 'Peer', 'shop revamp', 1),
        TOUCH_LINE('src/shop/a.ts', 'Third'),
      ].join('\n'),
    },
  ])('pre_Text: $case', async ({ fakes, request: sent, expected }) => {
    const { handlers, room } = handlersOver(fakes);

    expect(await handlers.pre(SESSION, sent)).toEqual({ text: expected });
    for (const [, , asker] of room.claimsTouching.mock.calls) {
      expect(asker).toEqual(agent('rA', null, 'Lead'));
    }
  });

  it('pre_CommitFolder: a claim inside the folder', async () => {
    const { handlers, room } = handlersOver({
      claims: [claimBy('Peer', 60_000)],
    });

    const reply = await handlers.pre(
      SESSION,
      request({ tool: 'commit', paths: [`${ROOT}/src/shop`] }),
    );

    expect(room.claimsTouching.mock.calls[0][1]).toEqual({
      paths: ['src/shop/**'],
    });
    expect(reply).toEqual({
      text: CLAIM_LINE('src/shop', 'Peer', 'shop revamp', 1),
    });
  });

  it('pre_CommitFolder: a changed file inside the folder', async () => {
    const { handlers, boardFeed } = handlersOver({
      touches: [touchBy('rB', `${ROOT}/src/shop/b.ts`)],
    });

    const reply = await handlers.pre(
      SESSION,
      request({ tool: 'commit', paths: [`${ROOT}/src/shop`] }),
    );

    expect(boardFeed.uncommittedByOthers).toHaveBeenCalledWith(
      'rA',
      [`${ROOT}/src/shop`],
      true,
    );
    expect(reply).toEqual({ text: TOUCH_LINE('src/shop/b.ts', 'Peer') });
  });
});

describe('post', () => {
  it.each<{
    tool: ChatroomHookRequest['tool'];
    agentId: string | null;
    recordedAs: string | null;
  }>([
    { tool: 'edit', agentId: null, recordedAs: 'main' },
    { tool: 'write', agentId: 'agent-7', recordedAs: 'agent-7' },
    { tool: 'commit', agentId: null, recordedAs: null },
  ])(
    'post_RecordsAndCounts: records a $tool',
    async ({ tool, agentId, recordedAs }) => {
      const { handlers, boardFeed } = handlersOver();

      await handlers.post(SESSION, request({ tool, agentId }));

      if (recordedAs === null) {
        expect(boardFeed.noteTouched).not.toHaveBeenCalled();
      } else {
        expect(boardFeed.noteTouched).toHaveBeenCalledWith('rA', recordedAs, [
          `${ROOT}/src/shop/a.ts`,
        ]);
      }
    },
  );

  it.each([
    { unread: 0, expected: null },
    { unread: 1, expected: '1 chatroom message for you — chatroom_read' },
    { unread: 3, expected: '3 chatroom messages for you — chatroom_read' },
  ])('post_RecordsAndCounts: $unread unread', async ({ unread, expected }) => {
    const { handlers, room } = handlersOver({ unread });

    expect(
      await handlers.post(SESSION, request({ agentId: 'agent-7' })),
    ).toEqual({ text: expected });
    expect(room.unreadAddressed).toHaveBeenCalledWith(
      'game',
      agent('rA', 'agent-7', 'Lead ▸ subagent'),
    );
  });

  it.each([
    {
      warnAtPost: false,
      expected: '1 chatroom message for you — chatroom_read',
    },
    {
      warnAtPost: true,
      expected: `${CLAIM_LINE('src/shop/a.ts', 'Peer', 'shop revamp', 1)}\n1 chatroom message for you — chatroom_read`,
    },
  ])('post_WarnAtPost: $warnAtPost', async ({ warnAtPost, expected }) => {
    const { handlers } = handlersOver({
      claims: [claimBy('Peer', 60_000)],
      unread: 1,
      warnAtPost,
    });

    expect(await handlers.post(SESSION, request())).toEqual({ text: expected });
  });
});
