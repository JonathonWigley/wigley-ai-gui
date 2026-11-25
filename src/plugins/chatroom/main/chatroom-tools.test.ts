import { describe, expect, it, vi } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { AgentSession, ToolResult } from '../../sessions/contract';
import type { BoardRow, Claim, Participant } from '../contract';
import { type ChatroomToolsDeps, createChatroomTools } from './chatroom-tools';
import { createMemoryRoomStore } from './memory-room-store';
import {
  createRoomService,
  type PostRequest,
  type PostResult,
  type RoomService,
} from './room-service';
import { createRoster, type Roster } from './roster';

const ROOM = 'game';
const TITLES: Record<string, string> = { rA: 'Lead', rB: 'Peer' };

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

function agent(
  rowId: string,
  agentId: string | null,
  name: string,
): Participant {
  return { kind: 'agent', rowId, agentId, mirrorId: null, name };
}

function newRoster(): Roster {
  const roster = createRoster({
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
  roster.connected(agentSession('rA'));
  roster.connected(agentSession('rB'));
  return roster;
}

type FakeRoom = Pick<
  RoomService,
  'post' | 'read' | 'claim' | 'release' | 'rooms'
>;

function fakeRoom(): FakeRoom {
  return {
    post: vi.fn<RoomService['post']>(async () => ({
      ok: true,
      id: 1,
      room: ROOM,
      thread: 'general',
      duplicate: false,
    })),
    rooms: vi.fn<RoomService['rooms']>(async () => [ROOM]),
    read: vi.fn<RoomService['read']>(async () => ({ ok: true, items: [] })),
    claim: vi.fn<RoomService['claim']>(),
    release: vi.fn<RoomService['release']>(),
  };
}

function toolsOver(overrides: Partial<ChatroomToolsDeps> = {}) {
  return createChatroomTools({
    room: fakeRoom(),
    roster: newRoster(),
    boardFeed: { refresh: async () => undefined, rows: () => [] },
    git: { topLevel: async (folder) => folder },
    paths: posixPaths,
    toolCaller: async () => null,
    arrive: () => undefined,
    ...overrides,
  });
}

function call(
  deps: ReturnType<typeof toolsOver>,
  name: string,
  args: unknown,
  sessionId = 'rA',
  toolUseId: string | null = 'tu-1',
): Promise<ToolResult> {
  return deps
    .startSession(agentSession(sessionId))
    .call(name, args, { toolUseId, signal: new AbortController().signal });
}

function textOf(result: ToolResult): string {
  return result.content.map((part) => part.text).join('');
}

describe('chatroom_post', () => {
  it.each([
    {
      case: 'chat names main',
      named: MAIN_AGENT_ID,
      toolUseId: 'tu-1',
      expected: agent('rA', null, 'Lead'),
    },
    {
      case: 'chat names a subagent',
      named: 'agent-7',
      toolUseId: 'tu-1',
      expected: agent('rA', 'agent-7', 'Lead ▸ worker'),
    },
    {
      case: 'chat names none',
      named: null,
      toolUseId: 'tu-1',
      expected: agent('rA', null, 'Lead'),
    },
    {
      case: 'no toolUseId',
      named: 'agent-7',
      toolUseId: null,
      expected: agent('rA', null, 'Lead'),
    },
  ])('post_CallerIdentity: $case', async ({ named, toolUseId, expected }) => {
    const room = fakeRoom();
    const roster = newRoster();
    roster.subagentSpawned('rA', 'agent-7', 'worker');
    const toolCaller = vi.fn(async () => named);
    const tools = toolsOver({ room, roster, toolCaller });

    await call(
      tools,
      'chatroom_post',
      { kind: 'progress', body: 'half way' },
      'rA',
      toolUseId,
    );

    expect(vi.mocked(room.post).mock.calls[0][0].from).toEqual(expected);
    expect(toolCaller).toHaveBeenCalledTimes(toolUseId === null ? 0 : 1);
  });

  it.each([
    {
      case: 'missing kind',
      args: { body: 'x' },
      expected:
        'kind must be one of question, answer, blocker, heads-up, handoff, decision, result, progress, note.',
    },
    {
      case: 'unknown kind',
      args: { kind: 'shout', body: 'x' },
      expected:
        'kind must be one of question, answer, blocker, heads-up, handoff, decision, result, progress, note.',
    },
    {
      case: 'body not a string',
      args: { kind: 'note', body: 4 },
      expected: 'body must be a string.',
    },
    {
      case: 'answerBy not a date',
      args: { kind: 'question', body: 'x', answerBy: 'soon' },
      expected: 'answerBy must be an ISO 8601 date-time.',
    },
    {
      case: 'refs item with an unknown type',
      args: { kind: 'note', body: 'x', refs: [{ type: 'url', value: 'x' }] },
      expected:
        'refs must be an array of { type, value }, type one of file, branch, commit, plan, message and value a string.',
    },
  ])('post_ArgErrors: $case', async ({ args, expected }) => {
    const room = fakeRoom();
    const result = await call(toolsOver({ room }), 'chatroom_post', args);

    expect(result).toEqual({
      content: [{ type: 'text', text: expected }],
      isError: true,
    });
    expect(room.post).not.toHaveBeenCalled();
  });

  it.each([
    {
      case: 'thread given',
      args: { kind: 'note', body: 'x', thread: ' plan-x ' },
      thread: ' plan-x ',
    },
    { case: 'thread omitted', args: { kind: 'note', body: 'x' }, thread: null },
  ])('post_ArgErrors: $case', async ({ args, thread }) => {
    const room = fakeRoom();
    await call(toolsOver({ room }), 'chatroom_post', args);

    expect(vi.mocked(room.post).mock.calls[0][0]).toEqual<PostRequest>({
      room: ROOM,
      followTargets: true,
      from: agent('rA', null, 'Lead'),
      kind: 'note',
      body: 'x',
      to: [],
      thread,
      refs: [],
      replyTo: null,
      answerBy: null,
      onNoAnswer: null,
      key: null,
    });
  });

  it.each<{ result: PostResult; expected: ToolResult }>([
    {
      result: {
        ok: true,
        id: 4,
        room: ROOM,
        thread: 'plan-x',
        duplicate: false,
      },
      expected: {
        content: [{ type: 'text', text: 'Posted #4 in plan-x.' }],
        structuredContent: { id: 4, room: ROOM },
      },
    },
    {
      result: {
        ok: true,
        id: 4,
        room: ROOM,
        thread: 'plan-x',
        duplicate: true,
      },
      expected: {
        content: [{ type: 'text', text: 'Already posted as #4 in plan-x.' }],
        structuredContent: { id: 4, room: ROOM },
      },
    },
    {
      result: {
        ok: true,
        id: 2,
        room: 'ai',
        thread: 'session:rA',
        duplicate: false,
      },
      expected: {
        content: [
          { type: 'text', text: 'Posted #2 in session:rA of room ai.' },
        ],
        structuredContent: { id: 2, room: 'ai' },
      },
    },
    {
      result: {
        ok: false,
        reason: 'dropped: the same body was posted as #3 5 seconds ago',
      },
      expected: {
        content: [
          {
            type: 'text',
            text: 'dropped: the same body was posted as #3 5 seconds ago',
          },
        ],
        isError: true,
      },
    },
    {
      result: { ok: false, reason: 'could not save the message: EIO' },
      expected: {
        content: [{ type: 'text', text: 'could not save the message: EIO' }],
        isError: true,
      },
    },
  ])('post_Replies: $result', async ({ result, expected }) => {
    const room = fakeRoom();
    vi.mocked(room.post).mockResolvedValue(result);

    expect(
      await call(toolsOver({ room }), 'chatroom_post', {
        kind: 'note',
        body: 'x',
      }),
    ).toEqual(expected);
  });

  it('post_GivenRoom_PostsThereWithoutFollowingTargets', async () => {
    const room = fakeRoom();
    vi.mocked(room.rooms).mockResolvedValue([ROOM, 'ai']);

    await call(toolsOver({ room }), 'chatroom_post', {
      kind: 'note',
      body: 'x',
      room: 'ai',
    });

    expect(vi.mocked(room.post).mock.calls[0][0]).toMatchObject({
      room: 'ai',
      followTargets: false,
    });
  });

  it.each([
    {
      tool: 'chatroom_post',
      args: { kind: 'note', body: 'x', room: 'nowhere' },
      text: 'no room named "nowhere"; the rooms are: game',
    },
    {
      tool: 'chatroom_board',
      args: { room: 'nowhere' },
      text: 'no room named "nowhere"; the rooms are: game',
    },
    {
      tool: 'chatroom_read',
      args: { thread: 'plan-x', room: 'nowhere' },
      text: 'no room named "nowhere"; the rooms are: game',
    },
    {
      tool: 'chatroom_read',
      args: { room: ROOM },
      text: 'room goes with thread or id: an unread read already spans every room.',
    },
  ])('room_Refusals: $tool $args', async ({ tool, args, text }) => {
    const room = fakeRoom();

    expect(await call(toolsOver({ room }), tool, args)).toEqual({
      content: [{ type: 'text', text }],
      isError: true,
    });
    expect(room.post).not.toHaveBeenCalled();
    expect(room.read).not.toHaveBeenCalled();
  });

  it('replies an error for a session with no room', async () => {
    const room = fakeRoom();
    const result = await call(
      toolsOver({ room }),
      'chatroom_post',
      { kind: 'note', body: 'x' },
      'rZ',
    );

    expect(result.isError).toBe(true);
    expect(room.post).not.toHaveBeenCalled();
  });
});

describe('chatroom_read', () => {
  it('read_Formats', async () => {
    const now = 1_700_000_000_000;
    const roster = newRoster();
    const room = createRoomService({
      store: createMemoryRoomStore(),
      files: createMemoryFiles(),
      clock: { now: () => now },
      randomHex: () => '00000001',
      limits: () => ({ bodyCap: 1500, postsPerMinute: 10, claimMinutes: 30 }),
      directory: () => roster.directory(),
      log: () => undefined,
    });
    const peer = agent('rB', null, 'Peer');
    const post = (fields: Partial<PostRequest>) =>
      room.post({
        room: ROOM,
        followTargets: false,
        from: peer,
        kind: 'note',
        body: 'x',
        to: ['Lead'],
        thread: 'general',
        refs: [],
        replyTo: null,
        answerBy: null,
        onNoAnswer: null,
        key: null,
        ...fields,
      });
    await post({
      body: 'first line\nsecond line',
      refs: [
        { type: 'file', value: 'src/a.ts' },
        { type: 'branch', value: 'feat' },
      ],
    });
    await post({ body: 'plain', kind: 'question', thread: 'plan-x' });
    const tools = toolsOver({ room, roster });

    const unread = await call(tools, 'chatroom_read', {});
    const again = await call(tools, 'chatroom_read', {});
    const thread = await call(tools, 'chatroom_read', { thread: 'general' });
    const unknown = await call(tools, 'chatroom_read', { id: 99 });
    const both = await call(tools, 'chatroom_read', {
      thread: 'general',
      id: 1,
    });

    expect(textOf(unread)).toBe(
      [
        '#1 Peer · note · general · first line · refs: file:src/a.ts, branch:feat',
        '#2 Peer · question · plan-x · plain',
      ].join('\n'),
    );
    expect(textOf(again)).toBe('No unread chatroom messages.');
    expect(textOf(thread)).toBe(
      `#1 Peer · note · ${new Date(now).toISOString()}\nfirst line\nsecond line`,
    );
    expect(thread.structuredContent).toEqual({
      items: [
        expect.objectContaining({ id: 1, text: 'first line\nsecond line' }),
      ],
    });
    expect(unknown).toEqual({
      content: [{ type: 'text', text: 'no message #99 in game' }],
      isError: true,
    });
    expect(both).toEqual({
      content: [{ type: 'text', text: 'Give thread or id, not both.' }],
      isError: true,
    });
  });
});

describe('chatroom_board', () => {
  it('board_Reply', async () => {
    const order: string[] = [];
    const row = (
      rowId: string,
      name: string,
      uncommittedMore: number,
      unpushedMore: number,
    ): BoardRow => ({
      rowId,
      name,
      harness: 'claude',
      state: 'idle',
      folder: null,
      branch: null,
      clone: null,
      uncommitted: [],
      uncommittedMore,
      unpushedPaths: null,
      unpushedMore,
      claims: [],
    });
    const rows = [
      row('rA', 'Lead', 50, 3),
      row('rB', 'Peer', 0, 2),
      row('rC', 'Quiet', 0, 0),
    ];
    const tools = toolsOver({
      boardFeed: {
        refresh: async (roomName) => {
          await Promise.resolve();
          order.push(`refresh ${roomName}`);
        },
        rows: (roomName) => {
          order.push(`rows ${roomName}`);
          return rows;
        },
      },
    });

    const result = await call(tools, 'chatroom_board', {});

    expect(order).toEqual(['refresh game', 'rows game']);
    expect(textOf(result)).toBe(
      [
        JSON.stringify({ room: ROOM, rows }, null, 2),
        'Lead: +50 more uncommitted, +3 more unpushed',
        'Peer: +2 more unpushed',
      ].join('\n'),
    );
    expect(result.structuredContent).toEqual({ room: ROOM, rows });
  });
});

describe('chatroom_claim and chatroom_release', () => {
  // rA's folder is /r/rA; `root` is the clone git names for it.
  it.each<{ case: string; root: string | null; path: string; sent: string }>([
    {
      case: 'relative, from a subfolder',
      root: '/r',
      path: 'notes/**',
      sent: 'rA/notes/**',
    },
    {
      case: 'absolute, from a subfolder',
      root: '/r',
      path: '/r/rA/notes/a.md',
      sent: 'rA/notes/a.md',
    },
    {
      case: 'relative, climbing to a sibling folder',
      root: '/r',
      path: '../rB/src/*.ts',
      sent: 'rB/src/*.ts',
    },
    {
      case: 'relative, climbing out of the clone',
      root: '/r',
      path: '../../etc/x',
      sent: '/etc/x',
    },
    {
      case: 'absolute, outside the clone',
      root: '/r',
      path: '/q/a.md',
      sent: '/q/a.md',
    },
    {
      case: 'relative, from the clone root',
      root: '/r/rA',
      path: 'src/**',
      sent: 'src/**',
    },
    {
      case: 'relative, from a folder in no clone',
      root: null,
      path: 'notes/**',
      sent: 'notes/**',
    },
  ])('claim_PathsRelativeToTheClone: $case', async ({ root, path, sent }) => {
    const room = fakeRoom();
    vi.mocked(room.claim).mockResolvedValue({ ok: false, reason: 'stub' });
    const tools = toolsOver({
      room,
      git: {
        topLevel: async () => {
          if (root === null) {
            throw new Error('not a git repository');
          }
          return root;
        },
      },
    });

    await call(tools, 'chatroom_claim', { paths: [path], reason: 'r' });

    expect(vi.mocked(room.claim).mock.calls[0]?.[0].target).toEqual({
      paths: [sent],
    });
  });

  it('claimAndRelease_Replies', async () => {
    const room = fakeRoom();
    const lead = agent('rA', null, 'Lead');
    const claim: Claim = {
      id: 'c2',
      room: ROOM,
      holder: lead,
      target: { paths: ['src/shop/**', 'docs/a.md'] },
      reason: 'shop revamp',
      expiresAt: Date.UTC(2026, 0, 1, 12, 30),
    };
    const overlap: Claim = {
      id: 'c1',
      room: ROOM,
      holder: agent('rB', null, 'Old Peer Title'),
      target: { branch: 'main' },
      reason: 'landing',
      expiresAt: Date.UTC(2026, 0, 1, 12, 10),
    };
    vi.mocked(room.claim).mockResolvedValue({
      ok: true,
      claim,
      overlaps: [overlap],
    });
    vi.mocked(room.release).mockResolvedValue({
      ok: true,
      released: [claim, overlap],
    });
    const tools = toolsOver({ room, git: { topLevel: async () => '/r/rA' } });

    const claimed = await call(tools, 'chatroom_claim', {
      paths: ['/r/rA/src/shop/**', 'docs/a.md'],
      reason: 'shop revamp',
    });
    const released = await call(tools, 'chatroom_release', { all: true });
    const twoTargets = await call(tools, 'chatroom_claim', {
      paths: ['src/a.ts'],
      branch: 'main',
      reason: 'x',
    });

    expect(room.claim).toHaveBeenCalledWith({
      room: ROOM,
      holder: lead,
      target: { paths: ['src/shop/**', 'docs/a.md'] },
      reason: 'shop revamp',
      minutes: null,
    });
    expect(textOf(claimed)).toBe(
      [
        'Claim c2 holds src/shop/**, docs/a.md until 2026-01-01T12:30:00.000Z.',
        'Overlaps claim c1 by Old Peer Title: branch main (landing).',
      ].join('\n'),
    );
    expect(room.release).toHaveBeenCalledWith(ROOM, lead, null);
    expect(textOf(released)).toBe('Released 2 claim(s).');
    expect(twoTargets).toEqual({
      content: [
        {
          type: 'text',
          text: 'Give exactly one of paths, branch or resource.',
        },
      ],
      isError: true,
    });
  });
});

describe('every tool', () => {
  it('arrives with the calling session first', async () => {
    const arrived: string[] = [];
    const tools = toolsOver({ arrive: (session) => arrived.push(session.id) });

    await call(tools, 'chatroom_board', {}, 'rB');

    expect(arrived).toEqual(['rB']);
  });
});
