import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../../contracts/agent';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ChatAgentEvent, ChatSessionInfo } from '../../chat/contract';
import type { CloneClaim, PoolSnapshot } from '../../unity-pool/contract';
import type { SessionFlow } from '../../workflow/contract';
import type { Claim, Participant } from '../contract';
import {
  type BoardInputs,
  type BoardSession,
  buildBoard,
  createTouchTracker,
  type GitFolderState,
  readGitFolder,
  staleTouchPaths,
  type Touch,
  type TouchTracker,
} from './board';
import { chatInfo, cloneClaim, flow, poolClone } from './board.test-support';

const FINISHING_STAGE = 'land';

function session(fields: Partial<BoardSession> = {}): BoardSession {
  return {
    rowId: 'A',
    room: 'a',
    name: 'Alpha',
    harness: 'claude',
    folder: '/r/c2/src',
    root: '/r/c2',
    hostSessionId: null,
    connected: false,
    ...fields,
  };
}

function inputs(fields: Partial<BoardInputs> = {}): BoardInputs {
  return {
    room: 'a',
    now: 100,
    sessions: [session()],
    chat: new Map(),
    flows: new Map(),
    stageFinishes: (candidate) => candidate.stage === FINISHING_STAGE,
    waitingOnUser: new Set(),
    pools: null,
    git: new Map(),
    claims: [],
    touches: [],
    ...fields,
  };
}

function gitState(fields: Partial<GitFolderState> = {}): GitFolderState {
  return {
    root: '/r/c2',
    branch: 'feat',
    changed: [],
    unpushed: null,
    readAt: 50,
    ...fields,
  };
}

function gitMap(...states: GitFolderState[]): Map<string, GitFolderState> {
  return new Map(states.map((state) => [state.root, state]));
}

function touch(path: string, rowId: string, at: number): Touch {
  return { path, rowId, agentId: 'main', at };
}

function agent(rowId: string, agentId: string | null): Participant {
  return { kind: 'agent', rowId, agentId, mirrorId: null, name: rowId };
}

function claim(
  id: string,
  room: string,
  holder: Participant,
  expiresAt: number,
): Claim {
  return {
    id,
    room,
    holder,
    target: { paths: ['src/**'] },
    reason: '',
    expiresAt,
  };
}

// File names whose plain string order is their number order, listed last
// first so the board must sort them.
function numberedFiles(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `f${String(count - 1 - index).padStart(3, '0')}.ts`,
  );
}

function onlyRow(board: BoardInputs) {
  return buildBoard(board, posixPaths)[0];
}

describe('buildBoard', () => {
  it.each<{
    name: string;
    chat: Partial<ChatSessionInfo> | null;
    connected?: boolean;
    waitingOnUser?: boolean;
    flow?: Partial<SessionFlow>;
    expected: string;
  }>([
    {
      name: 'no chat key, connected',
      chat: null,
      connected: true,
      expected: 'connected',
    },
    { name: 'no chat key, not connected', chat: null, expected: 'gone' },
    {
      name: 'waiting on the user while working',
      chat: { activity: 'working' },
      waitingOnUser: true,
      expected: 'waiting',
    },
    {
      name: 'activity waiting',
      chat: { activity: 'waiting' },
      expected: 'waiting',
    },
    {
      name: 'activity working',
      chat: { activity: 'working' },
      expected: 'working',
    },
    {
      name: 'idle with background work',
      chat: { background: 2 },
      expected: 'working',
    },
    {
      name: 'idle with a busy flow in a finishing stage',
      chat: {},
      flow: { stage: FINISHING_STAGE, runningSubagents: ['s1'] },
      expected: 'working',
    },
    {
      name: 'idle with a flow in a finishing stage',
      chat: {},
      flow: { stage: FINISHING_STAGE },
      expected: 'done',
    },
    {
      name: 'idle with a flow in another stage',
      chat: {},
      flow: { stage: 'build' },
      expected: 'idle',
    },
    {
      name: 'resting with no flow',
      chat: { running: false },
      expected: 'idle',
    },
    {
      name: 'waiting with a flow in a finishing stage',
      chat: { activity: 'waiting' },
      flow: { stage: FINISHING_STAGE },
      expected: 'waiting',
    },
  ])('state: $name → $expected', (row) => {
    const board = inputs({
      sessions: [session({ connected: row.connected ?? false })],
      chat:
        row.chat === null ? new Map() : new Map([['A', chatInfo(row.chat)]]),
      flows:
        row.flow === undefined ? new Map() : new Map([['A', flow(row.flow)]]),
      waitingOnUser: new Set(row.waitingOnUser === true ? ['A'] : []),
    });
    expect(onlyRow(board).state).toBe(row.expected);
  });

  it("lists the room's sessions only, in input order", () => {
    const board = inputs({
      sessions: [
        session({ rowId: 'A', room: 'a' }),
        session({ rowId: 'B', room: 'b' }),
        session({ rowId: 'C', room: 'a' }),
      ],
    });
    expect(buildBoard(board, posixPaths).map((row) => row.rowId)).toEqual([
      'A',
      'C',
    ]);
  });

  it.each([
    {
      name: 'git and chat branch',
      git: 'feat',
      chat: 'main',
      expected: 'feat',
    },
    { name: 'chat branch only', git: null, chat: 'main', expected: 'main' },
    { name: 'neither', git: null, chat: null, expected: null },
  ])('branch: $name → $expected', ({ git, chat, expected }) => {
    const board = inputs({
      chat: new Map([['A', chatInfo({ branch: chat })]]),
      git: git === null ? new Map() : gitMap(gitState({ branch: git })),
    });
    expect(onlyRow(board).branch).toBe(expected);
  });

  it.each<{
    name: string;
    claim: CloneClaim | null;
    hostSessionId?: string | null;
    root?: string;
    pools?: 'none';
    expected: string | null;
  }>([
    { name: 'no claim', claim: null, expected: 'none' },
    { name: 'a hold', claim: cloneClaim({ kind: 'hold' }), expected: 'user' },
    {
      name: 'claimed by this row',
      claim: cloneClaim({ row: 'A', session: 'x' }),
      expected: 'this',
    },
    {
      name: 'claimed by another row',
      claim: cloneClaim({ row: 'B', session: 'x' }),
      expected: 'other',
    },
    {
      name: "claimed by this row's host session",
      claim: cloneClaim({ session: 's1' }),
      hostSessionId: 's1',
      expected: 'this',
    },
    {
      name: 'claimed by a host session, row has none',
      claim: cloneClaim({ session: 's1' }),
      hostSessionId: null,
      expected: 'other',
    },
    {
      name: 'claimed by another host session',
      claim: cloneClaim({ session: 's1' }),
      hostSessionId: 's2',
      expected: 'other',
    },
    {
      name: 'root in no pool',
      claim: null,
      root: '/elsewhere',
      expected: null,
    },
    { name: 'no pool snapshot', claim: null, pools: 'none', expected: null },
  ])('clone: $name → $expected', (row) => {
    const pools: PoolSnapshot = {
      pools: [
        {
          pool: 'other',
          updatedAt: 0,
          clones: [poolClone(1, '/q/c1', null)],
          queue: [],
        },
        {
          pool: 'proj',
          updatedAt: 0,
          clones: [
            poolClone(1, '/r/c1', null),
            poolClone(2, '/r/c2/', row.claim),
          ],
          queue: [],
        },
      ],
    };
    const board = inputs({
      sessions: [
        session({
          root: row.root ?? '/r/c2',
          hostSessionId: row.hostSessionId ?? null,
        }),
      ],
      pools: row.pools === 'none' ? null : pools,
    });
    const expected =
      row.expected === null
        ? null
        : { pool: 'proj', number: 2, holder: row.expected };
    expect(onlyRow(board).clone).toEqual(expected);
  });

  it('attributes each changed file to the newest touch below the root', () => {
    const board = inputs({
      sessions: [
        session({ rowId: 'A', name: 'Alpha', root: '/r/c2' }),
        session({ rowId: 'B', name: 'Beta', root: '/r/c3' }),
        session({ rowId: 'C', name: 'Gamma', root: null }),
      ],
      git: gitMap(
        gitState({ root: '/r/c2', changed: ['b.ts', 'a.ts', 'c.ts'] }),
      ),
      touches: [
        touch('/r/c2/a.ts', 'A', 1),
        touch('/r/c2/a.ts', 'B', 2),
        touch('/r/c2/c.ts', 'Z', 3),
        touch('/r/c3/b.ts', 'A', 4),
      ],
    });
    const rows = buildBoard(board, posixPaths);
    expect(rows[0].uncommitted).toEqual([
      { path: 'a.ts', byRowId: 'B', by: 'Beta' },
      { path: 'b.ts', byRowId: null, by: null },
      { path: 'c.ts', byRowId: 'Z', by: 'an ended session' },
    ]);
    expect(rows[2].uncommitted).toEqual([]);
  });

  it.each([
    {
      name: 'a root with no git state',
      sessions: [session()],
      git: gitMap(gitState({ root: '/r/c9', changed: ['a.ts'] })),
      touches: [],
      expected: [],
    },
    {
      name: 'two touches with one at',
      sessions: [session(), session({ rowId: 'B', name: 'Beta' })],
      git: gitMap(gitState({ changed: ['a.ts'] })),
      touches: [touch('/r/c2/a.ts', 'A', 5), touch('/r/c2/a.ts', 'B', 5)],
      expected: [{ path: 'a.ts', byRowId: 'B', by: 'Beta' }],
    },
    {
      name: 'a touch by a session of another room',
      sessions: [session(), session({ rowId: 'B', room: 'b', name: 'Beta' })],
      git: gitMap(gitState({ changed: ['a.ts'] })),
      touches: [touch('/r/c2/a.ts', 'B', 5)],
      expected: [{ path: 'a.ts', byRowId: 'B', by: 'Beta' }],
    },
    {
      name: 'a git root spelled with a trailing slash',
      sessions: [session()],
      git: gitMap(gitState({ root: '/r/c2/', changed: ['a.ts'] })),
      touches: [],
      expected: [],
    },
  ])('uncommitted: $name', ({ sessions, git, touches, expected }) => {
    expect(onlyRow(inputs({ sessions, git, touches })).uncommitted).toEqual(
      expected,
    );
  });

  it.each([
    { count: 250, more: 50 },
    { count: 200, more: 0 },
  ])(
    'uncommitted: $count changed files → 200 listed, $more more',
    ({ count, more }) => {
      const changed = numberedFiles(count);
      const row = onlyRow(inputs({ git: gitMap(gitState({ changed })) }));
      expect(row.uncommitted.map((file) => file.path)).toEqual(
        [...changed].reverse().slice(0, 200),
      );
      expect(row.uncommittedMore).toBe(more);
    },
  );

  it.each<{
    name: string;
    git: GitFolderState | null;
    expected: string[] | null;
    more: number;
  }>([
    {
      name: 'sorted',
      git: gitState({ unpushed: ['z', 'a'] }),
      expected: ['a', 'z'],
      more: 0,
    },
    {
      name: 'no upstream',
      git: gitState({ unpushed: null }),
      expected: null,
      more: 0,
    },
    { name: 'no git state', git: null, expected: null, more: 0 },
    {
      name: 'capped',
      git: gitState({ unpushed: numberedFiles(250) }),
      expected: numberedFiles(250).reverse().slice(0, 200),
      more: 50,
    },
  ])('unpushed: $name', ({ git, expected, more }) => {
    const row = onlyRow(
      inputs({ git: git === null ? new Map() : gitMap(git) }),
    );
    expect(row.unpushedPaths).toEqual(expected);
    expect(row.unpushedMore).toBe(more);
  });

  it("lists the row's live claims in the room, its subagents' included", () => {
    const own = claim('own', 'a', agent('A', null), 101);
    const subagent = claim('subagent', 'a', agent('A', 'sub1'), 200);
    const board = inputs({
      now: 100,
      claims: [
        own,
        claim('expired', 'a', agent('A', null), 100),
        claim('other row', 'a', agent('B', null), 200),
        subagent,
        claim('other room', 'b', agent('A', null), 200),
      ],
    });
    expect(onlyRow(board).claims).toEqual([own, subagent]);
  });
});

describe('readGitFolder', () => {
  it.each([
    { upstream: true, unpushed: ['u.ts'] },
    { upstream: false, unpushed: null },
  ])(
    'upstream $upstream → unpushed $unpushed',
    async ({ upstream, unpushed }) => {
      const git = {
        currentBranch: vi.fn(async () => 'feat'),
        changedPaths: vi.fn(async () => ['c.ts']),
        hasUpstream: vi.fn(async () => upstream),
        unpushedPaths: vi.fn(async () => ['u.ts']),
      };
      const state = await readGitFolder(git, '/r/c2', 42);
      expect(state).toEqual({
        root: '/r/c2',
        branch: 'feat',
        changed: ['c.ts'],
        unpushed,
        readAt: 42,
      });
      expect(git.currentBranch).toHaveBeenCalledWith('/r/c2');
      expect(git.changedPaths).toHaveBeenCalledWith('/r/c2', '.');
      expect(git.hasUpstream).toHaveBeenCalledWith('/r/c2');
      expect(git.unpushedPaths.mock.calls).toEqual(
        upstream ? [['/r/c2', '.']] : [],
      );
    },
  );
});

function agentEvent(event: AgentEvent, replayed: boolean): ChatAgentEvent {
  return {
    sessionId: 'A',
    profileDir: null,
    hostSessionId: 'h1',
    event,
    replayed,
  };
}

describe('createTouchTracker', () => {
  const written = (replayed: boolean) =>
    agentEvent(
      { type: 'fileWritten', at: 7, agentId: 'sub1', path: '/r/a.ts' },
      replayed,
    );

  it.each<{
    name: string;
    act: (tracker: TouchTracker) => void;
    path: string;
    expected: Touch | null;
  }>([
    {
      name: 'a fileWritten event',
      act: (tracker) => tracker.fromAgentEvent(written(false)),
      path: '/r/a.ts',
      expected: { path: '/r/a.ts', rowId: 'A', agentId: 'sub1', at: 7 },
    },
    {
      name: 'a replayed fileWritten event',
      act: (tracker) => tracker.fromAgentEvent(written(true)),
      path: '/r/a.ts',
      expected: { path: '/r/a.ts', rowId: 'A', agentId: 'sub1', at: 7 },
    },
    {
      name: 'a toolStarted event',
      act: (tracker) =>
        tracker.fromAgentEvent(
          agentEvent(
            {
              type: 'toolStarted',
              at: 7,
              agentId: 'main',
              toolUseId: 't1',
              tool: 'Write',
              summary: '',
            },
            false,
          ),
        ),
      path: '/r/a.ts',
      expected: null,
    },
    {
      name: 'a relative path',
      act: (tracker) => tracker.touched('A', 'main', 'src/a.ts', 1),
      path: 'src/a.ts',
      expected: null,
    },
    {
      name: 'an older touch after a newer one',
      act: (tracker) => {
        tracker.touched('B', 'main', '/r/a.ts', 5);
        tracker.touched('A', 'main', '/r/a.ts', 3);
      },
      path: '/r/a.ts',
      expected: touch('/r/a.ts', 'B', 5),
    },
    {
      name: 'a newer touch after an older one',
      act: (tracker) => {
        tracker.touched('A', 'main', '/r/a.ts', 3);
        tracker.touched('B', 'main', '/r/a.ts', 5);
      },
      path: '/r/a.ts',
      expected: touch('/r/a.ts', 'B', 5),
    },
    {
      name: 'two touches with one at',
      act: (tracker) => {
        tracker.touched('A', 'main', '/r/a.ts', 5);
        tracker.touched('B', 'main', '/r/a.ts', 5);
      },
      path: '/r/a.ts',
      expected: touch('/r/a.ts', 'B', 5),
    },
    {
      name: 'an unnormalized path',
      act: (tracker) => tracker.touched('A', 'main', '/r/./a.ts', 1),
      path: '/r/a.ts',
      expected: touch('/r/a.ts', 'A', 1),
    },
    {
      name: 'a forgotten path',
      act: (tracker) => {
        tracker.touched('A', 'main', '/r/a.ts', 1);
        tracker.forget(['/r/a.ts']);
      },
      path: '/r/a.ts',
      expected: null,
    },
    {
      name: 'a path forgotten by another spelling',
      act: (tracker) => {
        tracker.touched('A', 'main', '/r/a.ts', 1);
        tracker.forget(['/r/./a.ts']);
      },
      path: '/r/a.ts',
      expected: null,
    },
  ])('latest after $name', ({ act, path, expected }) => {
    const tracker = createTouchTracker(posixPaths);
    act(tracker);
    expect(tracker.latest(path)).toEqual(expected);
  });

  it('orders touches by at, then by the call that stored them, without the forgotten', () => {
    const tracker = createTouchTracker(posixPaths);
    tracker.touched('A', 'main', '/r/a.ts', 5);
    tracker.touched('A', 'main', '/r/b.ts', 3);
    tracker.touched('A', 'main', '/r/c.ts', 3);
    tracker.touched('A', 'main', '/r/d.ts', 1);
    tracker.forget(['/r/d.ts']);
    expect(tracker.touches().map((stored) => stored.path)).toEqual([
      '/r/b.ts',
      '/r/c.ts',
      '/r/a.ts',
    ]);
  });
});

describe('staleTouchPaths', () => {
  it('names the touches under the read root, at or before the read, of unchanged files', () => {
    const touches = [
      touch('/r/a.ts', 'A', 1),
      touch('/r/b.ts', 'A', 5),
      touch('/r/c.ts', 'A', 4),
      touch('/r/o/d.ts', 'A', 1),
      touch('/q/e.ts', 'A', 1),
      touch('/r/f.ts', 'A', 2),
      touch('/r/g.ts', 'A', 2),
    ];
    const state = gitState({
      root: '/r',
      readAt: 3,
      changed: ['b.ts', 'g.ts'],
    });

    expect(
      staleTouchPaths(touches, state, ['/r', '/r/o', '/q'], posixPaths),
    ).toEqual(['/r/a.ts', '/r/f.ts']);
  });
});
