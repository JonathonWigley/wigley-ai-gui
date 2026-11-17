import { describe, expect, it, vi } from 'vitest';
import type { UserMessage } from '../../../contracts/agent';
import type { Git } from '../../../contracts/git';
import type { SlotChange } from '../../../contracts/state';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { createSlotStore } from '../../../shared/state/slot-store';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type AgentSession,
  type ContributeToolsOptions,
  type HookHandler,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsRowsSlot,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  type WorkflowMainExports,
  workflowMainKey,
} from '../../workflow/contract';
import {
  type ChatroomMainExports,
  type ChatroomMirror,
  chatroomRoomsSlot,
  HOOK_POST,
  HOOK_PRE,
  type RoomMessage,
  type RoomView,
  type UserPostResult,
} from '../contract';
import { chatroomMainPart, STANDING_NOTE } from './start';

const TITLES: Record<string, string> = { rA: 'Lead', rB: 'Peer', rC: 'Quiet' };
const CONTEXT = { toolUseId: null, signal: new AbortController().signal };

// A macrotask, so every pending promise chain settles first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function agentSession(id: string): AgentSession {
  return {
    id,
    info: {
      sessionId: `host-${id}`,
      projectDir: `/r/${id}`,
      harness: 'claude',
      rowId: null,
    },
  };
}

function startChatroom(
  options: { state?: ReturnType<typeof createSlotStore> } = {},
) {
  const projects: Record<string, string | null> = {
    rA: 'game',
    rB: 'game',
    rC: 'game',
    rS: 'game',
  };
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
    options: ContributeToolsOptions | undefined;
  }[] = [];
  const hooks = new Map<string, HookHandler>();
  const instructions: string[] = [];
  const sends: [string, UserMessage][] = [];
  const git = {
    topLevel: async (folder: string) => folder,
    currentBranch: async () => null,
    changedPaths: vi.fn(async () => [] as string[]),
    hasUpstream: async () => false,
    unpushedPaths: async () => [] as string[],
  };
  const harness = startMainPart(chatroomMainPart, {
    dependencies: [
      fakeDependency(
        sessionsMainKey,
        (consumer) =>
          ({
            contributeTools: (
              tools: ToolDefinition[],
              start: (session: AgentSession) => ToolSession,
              contributeOptions?: ContributeToolsOptions,
            ) => {
              contributions.push({ tools, start, options: contributeOptions });
              return consumer.track({ dispose() {} });
            },
            addHookHandler: (name: string, handler: HookHandler) => {
              hooks.set(name, handler);
              return consumer.track({ dispose() {} });
            },
            project: (rowId: string) => projects[rowId] ?? null,
            titles: (rowId: string) => ({
              user: null,
              agent: TITLES[rowId] ?? null,
              firstMessage: null,
            }),
            label: () => null,
          }) as unknown as SessionsMainExports,
      ),
      fakeDependency(
        chatMainKey,
        () =>
          ({
            addInstructions: (text: string) => {
              instructions.push(text);
              return { dispose() {} };
            },
            profileOf: () => null,
            send: async (rowId: string, message: UserMessage) => {
              sends.push([rowId, message]);
            },
            toolCaller: async () => null,
          }) as unknown as ChatMainExports,
      ),
      fakeDependency(
        workflowMainKey,
        () =>
          ({
            flows: () => [],
            stageFinishes: () => false,
          }) as unknown as WorkflowMainExports,
      ),
    ],
    services: { git: git as unknown as Git },
    state: options.state,
  });
  const callTool = (
    sessionId: string,
    name: string,
    args: unknown,
  ): Promise<ToolResult> =>
    contributions[0]!.start(agentSession(sessionId)).call(name, args, CONTEXT);
  const roomView = (room: string): RoomView | undefined =>
    harness.state.read(chatroomRoomsSlot, 'test').get(room);
  const thread = async (room: string, name: string, afterId = 0) =>
    (await harness.invoke('readThread', room, name, afterId)) as RoomMessage[];
  const postAsUser = (thread: string, fields: Record<string, unknown> = {}) =>
    harness.invoke('postAsUser', 'game', thread, {
      kind: 'note',
      body: 'from the user',
      to: [],
      replyTo: null,
      ...fields,
    }) as Promise<UserPostResult>;
  return {
    harness,
    projects,
    contributions,
    hooks,
    instructions,
    git,
    callTool,
    roomView,
    thread,
    postAsUser,
  };
}

describe('chatroomMainPart', () => {
  it('start_Wires', async () => {
    const { contributions, hooks, instructions, callTool, roomView } =
      startChatroom();

    await callTool('rA', 'chatroom_post', { kind: 'note', body: 'hello room' });
    await settle();

    expect(
      contributions.map(({ tools, options }) => [
        tools.map(({ name }) => name),
        options,
      ]),
    ).toEqual([
      [
        [
          'chatroom_post',
          'chatroom_read',
          'chatroom_board',
          'chatroom_claim',
          'chatroom_release',
        ],
        undefined,
      ],
    ]);
    expect([...hooks.keys()]).toEqual([HOOK_PRE, HOOK_POST]);
    expect(instructions).toEqual([STANDING_NOTE]);
    expect(roomView('game')?.threads.map(({ thread }) => thread)).toEqual([
      'session:rA',
    ]);
  });

  it('start_SeedsRooms: a stored room shows after a restart with no live session', async () => {
    const { harness, projects, callTool, roomView } = startChatroom();
    projects.rB = 'side';
    await callTool('rA', 'chatroom_post', { kind: 'note', body: 'in game' });
    await callTool('rB', 'chatroom_post', { kind: 'note', body: 'in side' });
    await settle();

    await harness.restart();
    await settle();

    expect(roomView('game')).toEqual(
      expect.objectContaining({
        room: 'game',
        board: [],
        threads: [expect.objectContaining({ thread: 'session:rA' })],
      }),
    );
    expect(roomView('side')).toEqual(
      expect.objectContaining({
        room: 'side',
        board: [],
        threads: [expect.objectContaining({ thread: 'session:rB' })],
      }),
    );
  });

  it('start_SeedsRooms: a row in sessionsRowsSlot at start joins the roster', async () => {
    const state = createSlotStore(() => undefined);
    state
      .publish(sessionsRowsSlot)
      .set(
        'rS',
        sessionRow('rS', { projectDir: '/r/rS', hostSessionId: 'host-rS' }),
      );
    const { roomView } = startChatroom({ state });
    await settle();

    expect(roomView('game')?.board.map(({ rowId }) => rowId)).toEqual(['rS']);
  });

  describe('joinedAndLeft', () => {
    it('writes joined at the first call, not at connect, and once', async () => {
      const { harness, callTool, thread } = startChatroom();
      harness.emit('sessions.connected', {
        ...agentSession('rA'),
        owned: true,
      });
      await settle();
      expect(await thread('game', 'session:rA')).toEqual([]);

      await callTool('rA', 'chatroom_board', {});
      await callTool('rA', 'chatroom_board', {});
      await settle();

      expect(
        (await thread('game', 'session:rA')).map(({ kind, body }) => [
          kind,
          body,
        ]),
      ).toEqual([['joined', 'Lead joined']]);
    });

    it('a hook call from a session that connected before start joins it', async () => {
      const { hooks, thread, roomView } = startChatroom();

      await hooks.get(HOOK_POST)!(agentSession('rB'), {
        tool: 'edit',
        paths: ['/r/rB/a.ts'],
        agentId: null,
        cwd: '/r/rB',
      });
      await settle();

      expect(
        (await thread('game', 'session:rB')).map(({ kind }) => kind),
      ).toEqual(['joined']);
      expect(roomView('game')?.board.map(({ rowId }) => rowId)).toEqual(['rB']);
    });

    it('writes left in the joined room and ends the claims', async () => {
      const { harness, projects, callTool, thread, roomView } = startChatroom();
      await callTool('rA', 'chatroom_claim', {
        paths: ['src/**'],
        reason: 'refactor',
      });
      await settle();
      expect(roomView('game')?.claims).toHaveLength(1);
      projects.rA = 'other';

      harness.emit('sessions.ended', { sessionId: 'rA' });
      await settle();

      expect(
        (await thread('game', 'session:rA')).map(({ kind, body }) => [
          kind,
          body,
        ]),
      ).toEqual([
        ['joined', 'Lead joined'],
        ['left', 'Lead left'],
      ]);
      expect(roomView('game')?.claims).toEqual([]);
    });

    it('writes no left for a session that never called', async () => {
      const { harness, thread } = startChatroom();
      harness.emit('sessions.connected', {
        ...agentSession('rC'),
        owned: true,
      });
      await settle();

      harness.emit('sessions.ended', { sessionId: 'rC' });
      await settle();

      expect(await thread('game', 'session:rC')).toEqual([]);
    });

    it('a project change in the rows slot rewrites both rooms', async () => {
      const { harness, projects, callTool, roomView } = startChatroom();
      await callTool('rB', 'chatroom_board', {});
      await settle();
      expect(roomView('game')?.board.map(({ rowId }) => rowId)).toEqual(['rB']);

      projects.rB = 'side';
      harness.state
        .publish(sessionsRowsSlot)
        .set('rB', sessionRow('rB', { project: 'side' }));
      await settle();

      expect(roomView('game')?.board).toEqual([]);
      expect(roomView('side')?.board.map(({ rowId }) => rowId)).toEqual(['rB']);
    });
  });

  it('rebuilds_InOrder', async () => {
    const { harness, roomView, postAsUser } = startChatroom();
    await settle();
    const read = harness.files.read.bind(harness.files);
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(harness.files, 'read').mockImplementation(async (path) => {
      if (path.endsWith('user-cursors.json')) {
        await gate;
      }
      return read(path);
    });

    await postAsUser('plan-x', { body: 'first' });
    await postAsUser('plan-x', { body: 'second' });
    await settle();
    release();
    await settle();

    expect(roomView('game')?.threads).toEqual([
      expect.objectContaining({ thread: 'plan-x', lastId: 2 }),
    ]);
  });

  it('pageChannel', async () => {
    const { callTool, thread, postAsUser } = startChatroom();
    await callTool('rA', 'chatroom_post', {
      kind: 'progress',
      body: 'half way',
    });

    const posted = await postAsUser('plan-x', {
      kind: 'note',
      body: 'hi',
      to: ['Lead'],
    });
    const refused = await postAsUser('plan-x', { kind: 'answer', body: 'yes' });
    await settle();

    expect(posted).toEqual({ ok: true, id: 3 });
    expect(refused).toEqual({
      ok: false,
      reason: 'an answer must set replyTo',
    });
    expect(await thread('game', 'plan-x')).toEqual([
      expect.objectContaining({
        id: 3,
        body: 'hi',
        from: expect.objectContaining({ kind: 'human' }),
        to: [expect.objectContaining({ rowId: 'rA' })],
        refs: [],
        userWord: true,
      }),
    ]);
    expect(
      (await thread('game', 'session:rA')).map(({ id, kind }) => [id, kind]),
    ).toEqual([
      [1, 'joined'],
      [2, 'progress'],
    ]);
    expect((await thread('game', 'session:rA', 1)).map(({ id }) => id)).toEqual(
      [2],
    );
  });

  it('pageChannel: markUserRead moves the cursor and rewrites the key', async () => {
    const { harness, callTool, roomView } = startChatroom();
    await callTool('rA', 'chatroom_post', { kind: 'note', body: 'look' });
    await settle();
    const sessionThread = () =>
      roomView('game')?.threads.find((view) => view.thread === 'session:rA');
    expect(sessionThread()?.userUnread).toBe(1);

    await harness.invoke('markUserRead', 'game', 'session:rA', 2);
    await settle();

    expect(sessionThread()?.userUnread).toBe(0);
  });

  it('dispose_StopsTimers', async () => {
    const { harness, git } = startChatroom();
    harness.emit('sessions.connected', { ...agentSession('rA'), owned: true });
    await settle();
    expect(git.changedPaths).toHaveBeenCalledTimes(1);
    harness.emit('chat.turnFinished', { sessionId: 'rA', how: 'idle' });
    await settle();

    await harness.stop();
    const writes: SlotChange[] = [];
    harness.state.onWrite((change) => writes.push(change));
    harness.advance(10_000);
    await settle();

    expect(git.changedPaths).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });

  it('addMirror_ReachesTheRoomService', async () => {
    const { harness, postAsUser } = startChatroom();
    const consumer = createRegistrations();
    const exports = harness
      .started()
      .exports?.(consumer) as ChatroomMainExports;
    const published: string[] = [];
    const mirror: ChatroomMirror = {
      id: 'cloud',
      verified: false,
      publish: async (message) => {
        published.push(message.body);
      },
      onHumanMessage: () => ({ dispose() {} }),
    };

    exports.addMirror(mirror);
    await postAsUser('plan-x', { body: 'one' });
    await settle();
    consumer.dispose();
    await postAsUser('plan-x', { body: 'two' });
    await settle();

    expect(published).toEqual(['one']);
  });
});
