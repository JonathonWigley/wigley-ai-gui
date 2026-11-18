import { describe, expect, it, vi } from 'vitest';
import type { UserMessage } from '../../../contracts/agent';
import type { DemoMainStep } from '../../../contracts/demo';
import type { Git } from '../../../contracts/git';
import type { SlotChange } from '../../../contracts/state';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type ChatMainExports,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  type AgentSession,
  type ContributeToolsOptions,
  type HookHandler,
  NEEDS_YOU_ACTIVITY,
  type SessionsMainExports,
  sessionsActivitySlot,
  sessionsMainKey,
  sessionsRowsSlot,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { unityPoolSnapshotSlot } from '../../unity-pool/contract';
import {
  type SessionFlow,
  type WorkflowMainExports,
  workflowFlowsSlot,
  workflowMainKey,
} from '../../workflow/contract';
import {
  type BoardRow,
  type ChatroomMainExports,
  type ChatroomMirror,
  chatroomRoomsSlot,
  HOOK_POST,
  HOOK_PRE,
  type RoomMessage,
  type RoomView,
  sessionThread,
  type UserPostResult,
} from '../contract';
import { GIT_READ_WINDOW_MS } from './board-feed';
import { chatInfo, cloneClaim, flow, poolClone } from './board.test-support';
import { createDemoRooms } from './demo-rooms';
import { FIXTURE_THREAD } from './selftest-fixture';
import { chatroomMainPart, STANDING_NOTE } from './start';

const FINISHING_STAGE = 'land';

// Once armed, the next `userUnread` call holds its result until the gate
// resolves, so one room rebuild can be held while a later one runs.
const userUnreadGate = vi.hoisted(() => ({
  next: null as Promise<void> | null,
}));
vi.mock('./room-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./room-service')>();
  return {
    ...actual,
    createRoomService(...args: Parameters<typeof actual.createRoomService>) {
      const service = actual.createRoomService(...args);
      return {
        ...service,
        async userUnread(room: string) {
          const gate = userUnreadGate.next;
          userUnreadGate.next = null;
          const unread = await service.userUnread(room);
          await gate;
          return unread;
        },
      };
    },
  };
});

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
  userUnreadGate.next = null;
  const sends: [string, UserMessage][] = [];
  const flows: SessionFlow[] = [];
  // Root → its changed files, `/`-separated below it.
  const changedByRoot: Record<string, string[]> = {};
  const git = {
    topLevel: async (folder: string) => folder,
    currentBranch: async () => null,
    changedPaths: vi.fn(async (root: string) => changedByRoot[root] ?? []),
    hasUpstream: async () => false,
    unpushedPaths: async () => [] as string[],
  };
  const demoSteps = createDemoStepRegistry<DemoMainStep>();
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
            flows: () => flows,
            stageFinishes: (candidate: SessionFlow) =>
              candidate.stage === FINISHING_STAGE,
          }) as unknown as WorkflowMainExports,
      ),
    ],
    services: { git: git as unknown as Git, demoSteps },
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
    flows,
    changedByRoot,
    git,
    demoSteps,
    callTool,
    roomView,
    thread,
    postAsUser,
  };
}

type Chatroom = ReturnType<typeof startChatroom>;

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
      sessionThread('rA'),
    ]);
  });

  it('start_ClaimFromASubfolderWarnsAPeersEdit', async () => {
    const { git, hooks, callTool } = startChatroom();
    git.topLevel = async () => '/r';

    await callTool('rA', 'chatroom_claim', {
      paths: ['notes/**'],
      reason: 'notes pass',
    });
    const reply = await hooks.get(HOOK_PRE)!(agentSession('rB'), {
      tool: 'write',
      paths: ['/r/rA/notes/a.md'],
      agentId: null,
      cwd: '/r/rB',
    });

    expect(reply.text).toContain('is claimed by Lead (notes pass;');
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
        threads: [expect.objectContaining({ thread: sessionThread('rA') })],
      }),
    );
    expect(roomView('side')).toEqual(
      expect.objectContaining({
        room: 'side',
        board: [],
        threads: [expect.objectContaining({ thread: sessionThread('rB') })],
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
      expect(await thread('game', sessionThread('rA'))).toEqual([]);

      // A board call reads git once the read window allows, so the window
      // passes before each call answers.
      for (let call = 0; call < 2; call += 1) {
        const answered = callTool('rA', 'chatroom_board', {});
        await settle();
        harness.advance(GIT_READ_WINDOW_MS);
        await answered;
      }
      await settle();

      expect(
        (await thread('game', sessionThread('rA'))).map(({ kind, body }) => [
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
        (await thread('game', sessionThread('rB'))).map(({ kind }) => kind),
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
        (await thread('game', sessionThread('rA'))).map(({ kind, body }) => [
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

      expect(await thread('game', sessionThread('rC'))).toEqual([]);
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

  it.each<{
    source: string;
    before?: (chatroom: Chatroom) => void;
    act: (chatroom: Chatroom) => void;
    read: (row: BoardRow) => unknown;
    expected: unknown;
  }>([
    {
      source: 'the chat slot',
      act: ({ harness }) =>
        harness.state
          .publish(chatSessionSlot)
          .set('rA', chatInfo({ sessionId: 'rA', activity: 'working' })),
      read: (row) => row.state,
      expected: 'working',
    },
    {
      source: 'the activity slot',
      before: ({ harness }) =>
        harness.state
          .publish(chatSessionSlot)
          .set('rA', chatInfo({ sessionId: 'rA' })),
      act: ({ harness }) =>
        harness.state
          .publish(sessionsActivitySlot)
          .set('rA', [{ sourceId: 'forms', activity: NEEDS_YOU_ACTIVITY }]),
      read: (row) => row.state,
      expected: 'waiting',
    },
    {
      source: 'the flows slot',
      before: ({ harness }) =>
        harness.state
          .publish(chatSessionSlot)
          .set('rA', chatInfo({ sessionId: 'rA' })),
      act: ({ harness, flows }) => {
        const finishing = flow({ sessionId: 'rA', stage: FINISHING_STAGE });
        flows.push(finishing);
        harness.state.publish(workflowFlowsSlot).set('rA', finishing);
      },
      read: (row) => row.state,
      expected: 'done',
    },
    {
      source: 'the pool slot',
      act: ({ harness }) =>
        harness.state.publish(unityPoolSnapshotSlot).set({
          pools: [
            {
              pool: 'games',
              updatedAt: 0,
              queue: [],
              clones: [poolClone(1, '/r/rA', cloneClaim({ row: 'rA' }))],
            },
          ],
        }),
      read: (row) => row.clone,
      expected: { pool: 'games', number: 1, holder: 'this' },
    },
    {
      source: 'sessions.hostSessionChanged',
      before: ({ harness }) =>
        harness.state.publish(unityPoolSnapshotSlot).set({
          pools: [
            {
              pool: 'games',
              updatedAt: 0,
              queue: [],
              clones: [
                poolClone(1, '/r/rA', cloneClaim({ session: 'host-new' })),
              ],
            },
          ],
        }),
      act: ({ harness }) => {
        const session = agentSession('rA');
        harness.emit('sessions.hostSessionChanged', {
          ...session,
          info: { ...session.info, sessionId: 'host-new' },
        });
      },
      read: (row) => row.clone?.holder,
      expected: 'this',
    },
    {
      source: 'a fileWritten agent event',
      before: ({ changedByRoot }) => {
        changedByRoot['/r/rA'] = ['a.ts'];
      },
      act: ({ harness }) =>
        harness.emit('chat.agentEvent', {
          sessionId: 'rA',
          profileDir: null,
          hostSessionId: 'host-rA',
          event: {
            type: 'fileWritten',
            at: 1,
            agentId: 'main',
            path: '/r/rA/a.ts',
          },
          replayed: false,
        }),
      read: (row) => row.uncommitted,
      expected: [{ path: 'a.ts', byRowId: 'rA', by: 'Lead' }],
    },
    {
      source: 'chat.turnFinished',
      act: ({ harness, changedByRoot }) => {
        changedByRoot['/r/rA'] = ['a.ts'];
        harness.emit('chat.turnFinished', { sessionId: 'rA', how: 'idle' });
      },
      read: (row) => row.uncommitted.map(({ path }) => path),
      expected: ['a.ts'],
    },
    {
      source: 'a repeated sessions.connected',
      act: ({ harness, changedByRoot }) => {
        changedByRoot['/r/rA'] = ['a.ts'];
        harness.emit('sessions.connected', {
          ...agentSession('rA'),
          owned: true,
        });
      },
      read: (row) => row.uncommitted.map(({ path }) => path),
      expected: ['a.ts'],
    },
  ])('board_FollowsLiveSources: $source', async (row) => {
    const chatroom = startChatroom();
    row.before?.(chatroom);
    chatroom.harness.emit('sessions.connected', {
      ...agentSession('rA'),
      owned: true,
    });
    await settle();

    row.act(chatroom);
    await settle();
    chatroom.harness.advance(GIT_READ_WINDOW_MS);
    await settle();

    const board = chatroom.roomView('game')?.board ?? [];
    expect(board.map(({ rowId }) => rowId)).toEqual(['rA']);
    expect(row.read(board[0])).toEqual(row.expected);
  });

  it('rebuilds_InOrder', async () => {
    const { roomView, postAsUser } = startChatroom();
    await settle();
    let release = () => undefined as void;
    userUnreadGate.next = new Promise<void>((resolve) => {
      release = resolve;
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
      (await thread('game', sessionThread('rA'))).map(({ id, kind }) => [
        id,
        kind,
      ]),
    ).toEqual([
      [1, 'joined'],
      [2, 'progress'],
    ]);
    expect(
      (await thread('game', sessionThread('rA'), 1)).map(({ id }) => id),
    ).toEqual([2]);
  });

  it('pageChannel: markUserRead moves the cursor and rewrites the key', async () => {
    const { harness, callTool, roomView } = startChatroom();
    await callTool('rA', 'chatroom_post', { kind: 'note', body: 'look' });
    await settle();
    const leadThread = () =>
      roomView('game')?.threads.find(
        (view) => view.thread === sessionThread('rA'),
      );
    expect(leadThread()?.userUnread).toBe(1);

    await harness.invoke('markUserRead', 'game', sessionThread('rA'), 2);
    await settle();

    expect(leadThread()?.userUnread).toBe(0);
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

describe('chatroom demo step', () => {
  const DEMO_ROOM = 'demo';
  const DATA_FOLDER = '/data/chatroom';

  // Each launch opens a titled row in DEMO_ROOM and connects its session.
  async function enterRoomStep(chatroom: Chatroom) {
    const { harness, projects, demoSteps } = chatroom;
    const rows = harness.state.publish(sessionsRowsSlot);
    const launchSession = async (title: string) => {
      const rowId = title === 'chatroom lead' ? 'rL' : 'rP';
      projects[rowId] = DEMO_ROOM;
      rows.set(
        rowId,
        sessionRow(rowId, {
          project: DEMO_ROOM,
          projectDir: '/scratch',
          hostSessionId: `host-${rowId}`,
          titles: { user: null, agent: null, firstMessage: title },
        }),
      );
      harness.emit('sessions.connected', {
        id: rowId,
        info: {
          sessionId: `host-${rowId}`,
          projectDir: '/scratch',
          harness: 'demo',
          rowId: null,
        },
        owned: true,
      });
      return rowId;
    };
    const step = demoSteps.list().find(({ id }) => id === 'chatroom.room');
    if (step === undefined) {
      throw new Error('chatroom registered no chatroom.room step');
    }
    const entering = step.enter({
      scratchDir: '/scratch',
      launchSession,
      processEvents: () => {
        throw new Error('no process events in this test');
      },
    });
    // The fixture polls its waits on the harness's timers.
    for (let poll = 0; poll < 20; poll += 1) {
      await settle();
      harness.advance(20);
    }
    return entering;
  }

  it('keeps the demo room in memory', async () => {
    const chatroom = startChatroom();
    const { harness, roomView } = chatroom;

    const stage = await enterRoomStep(chatroom);
    const answer = (await harness.invoke(
      'postAsUser',
      DEMO_ROOM,
      FIXTURE_THREAD,
      { kind: 'note', body: 'from the user', to: [], replyTo: null },
    )) as UserPostResult;
    if (!answer.ok) {
      throw new Error(answer.reason);
    }
    await harness.invoke('markUserRead', DEMO_ROOM, FIXTURE_THREAD, answer.id);
    await settle();

    const dataFiles =
      (await harness.files.stat(DATA_FOLDER)) === null
        ? []
        : await harness.files.list(DATA_FOLDER, { recursive: true });
    expect(dataFiles).toEqual([]);
    expect(stage.sessions).toEqual({ lead: 'rL', peer: 'rP' });
    expect(roomView(DEMO_ROOM)?.threads.map(({ thread }) => thread)).toContain(
      FIXTURE_THREAD,
    );

    stage.dispose();
    await settle();
    expect(roomView(DEMO_ROOM)).toBeUndefined();
  });

  it('holds one demo room per name', async () => {
    const released: string[] = [];
    const lead = {
      kind: 'agent' as const,
      rowId: 'rA',
      agentId: null,
      mirrorId: null,
      name: 'Lead',
    };
    const demoRooms = createDemoRooms({
      clock: { now: () => 1_000 },
      randomHex: () => 'abcd',
      limits: () => ({ bodyCap: 2_000, postsPerMinute: 60, claimMinutes: 30 }),
      participants: () => [lead],
      log: () => undefined,
      rewriteRoom: () => undefined,
      released: (roomName) => released.push(roomName),
    });

    const first = demoRooms.hold('p');
    const second = demoRooms.hold('p');
    const posted = await first.post({
      room: 'p',
      from: lead,
      kind: 'note',
      body: 'held once',
      to: [],
      thread: null,
      refs: [],
      replyTo: null,
      answerBy: null,
      onNoAnswer: null,
      key: null,
    });

    expect(second).toBe(first);
    expect(posted.ok).toBe(true);
    expect((await second.messages('p', 0)).map(({ body }) => body)).toEqual([
      'held once',
    ]);
    first.dispose();
    expect(demoRooms.serviceFor('p')).toBeNull();
    expect(released).toEqual(['p']);
  });
});
