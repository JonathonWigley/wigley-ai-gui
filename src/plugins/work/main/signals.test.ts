import { describe, expect, it, vi } from 'vitest';
import type { Git, GitBranch, GitCommit } from '../../../contracts/git';
import type {
  PullRequestInfo,
  PullRequests,
} from '../../../contracts/pull-requests';
import type { KeyedSlotReader } from '../../../contracts/state';
import { fakeTimers } from '../../../shared/fake-timers.test-support';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { ChatProject, ChatSessionInfo } from '../../chat/contract';
import type { SessionRow, SessionTitles } from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { PoolClone, PoolSnapshot } from '../../unity-pool/contract';
import type {
  WorkCard,
  WorkColumnSetting,
  WorkSignalSetting,
} from '../contract';
import { jiraCard, localCard } from '../contract.test-support';
import type { SeenSignal } from './detection';
import {
  BRANCH_CHANGE_DEBOUNCE_MS,
  COMMIT_LOOKBACK_DAYS,
  createSignalWatch,
  GATHER_DEADLINE_MS,
  type SignalDeps,
  watchedRoots,
} from './signals';

const HOME = '/home/me';
const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const NOW_ISO = new Date(NOW).toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;

const COLUMNS: WorkColumnSetting[] = [
  { name: 'Backlog', jiraStatuses: ['Backlog'] },
  { name: 'Todo', jiraStatuses: ['To Do'] },
  { name: 'In Progress', jiraStatuses: ['In Progress'] },
  { name: 'In QA', jiraStatuses: ['In QA'] },
  { name: 'Done', jiraStatuses: ['Done'] },
];

const SIGNALS: WorkSignalSetting = {
  branch: 'In Progress',
  commit: 'In Progress',
  pr_opened: 'In QA',
  pr_merged: 'Done',
  session: 'In Progress',
};

const settled = () => new Promise((settle) => setImmediate(settle));

// A keyed slot the test writes, whose reader tells each listener of each write; `undefined` deletes.
function keyedSlot<V>() {
  const values = new Map<string, V>();
  const listeners = new Set<(key: string, value: V | undefined) => void>();
  const reader: KeyedSlotReader<V> = {
    get: (key) => values.get(key),
    all: () => new Map(values),
    on: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
  };
  const set = (key: string, value: V | undefined) => {
    if (value === undefined) {
      values.delete(key);
    } else {
      values.set(key, value);
    }
    for (const listener of listeners) {
      listener(key, value);
    }
  };
  return { reader, set };
}

function folderProject(folder: string): ChatProject {
  return { kind: 'folder', name: folder, folder, profile: null };
}

function poolClone(number: number, path: string): PoolClone {
  return {
    number,
    path,
    facts: { branch: null, dirty: null, editor: 'unknown', probedAt: null },
    claim: null,
    handoff: null,
    stranded: null,
    lastHolder: null,
    lastReleasedAt: null,
    warmup: null,
  };
}

function poolSnapshot(pool: string, paths: string[]): PoolSnapshot {
  return {
    pools: [
      {
        pool,
        updatedAt: 0,
        clones: paths.map((path, index) => poolClone(index + 1, path)),
        queue: [],
      },
    ],
  };
}

function gitBranch(name: string, at: string, isRemote = false): GitBranch {
  return { name, at, isRemote };
}

function gitCommit(sha: string, subject: string, at: string): GitCommit {
  return { sha, subject, at, paths: [] };
}

function pullRequest(
  number: number,
  state: PullRequestInfo['state'],
  title: string,
  headBranch: string,
  updatedAt = '2026-11-22T08:00:00Z',
): PullRequestInfo {
  return {
    number,
    title,
    url: `https://github.example/pull/${number}`,
    headBranch,
    state,
    updatedAt,
  };
}

function chatSession(
  sessionId: string,
  branch: string | null,
  overrides: Partial<ChatSessionInfo> = {},
): ChatSessionInfo {
  return {
    sessionId,
    projectDir: '/dev/app',
    harness: 'claude',
    profile: 'default',
    activity: 'idle',
    background: 0,
    activeTime: { totalMs: 0, since: null },
    running: true,
    pid: null,
    compaction: null,
    repo: 'app',
    branch,
    worktrees: [],
    headless: false,
    ...overrides,
  };
}

const titles = (overrides: Partial<SessionTitles>): SessionTitles => ({
  user: null,
  agent: null,
  firstMessage: null,
  ...overrides,
});

interface WorldOptions {
  projects?: ChatProject[];
  pools?: PoolSnapshot;
  repoFolders?: string[];
  cards?: WorkCard[];
  signals?: Partial<WorkSignalSetting>;
  git?: Partial<SignalDeps['git']>;
  forRepo?: PullRequests['forRepo'];
}

// A signal watch's deps over fakes: every folder its own top folder, named by its base name, with no branches,
// commits or PRs unless `options` gives them; the gathers' reports and log lines recorded.
function world(options: WorldOptions = {}) {
  const logs: string[] = [];
  const reports: (readonly SeenSignal[])[] = [];
  const chatSessions = keyedSlot<ChatSessionInfo>();
  const sessionRows = keyedSlot<SessionRow>();
  const time = { now: NOW };
  const timers = fakeTimers();
  const git = {
    topLevel: vi.fn<Git['topLevel']>(
      options.git?.topLevel ?? (async (folder) => folder),
    ),
    originRepoName: vi.fn<Git['originRepoName']>(
      options.git?.originRepoName ??
        (async (folder) => posixPaths.base(folder)),
    ),
    branches: vi.fn<Git['branches']>(options.git?.branches ?? (async () => [])),
    commitsMatching: vi.fn<Git['commitsMatching']>(
      options.git?.commitsMatching ?? (async () => []),
    ),
  };
  const forRepo = vi.fn<PullRequests['forRepo']>(
    options.forRepo ?? (async () => []),
  );
  const deps: SignalDeps = {
    git,
    pullRequests: { forRepo },
    chat: { projects: () => options.projects ?? [] },
    chatSessions: chatSessions.reader,
    sessionRows: sessionRows.reader,
    pools: {
      get: () => options.pools,
      on: () => ({ dispose: () => undefined }),
    },
    repoFolders: () => options.repoFolders ?? [],
    cards: () => options.cards ?? [],
    signals: () => ({ ...SIGNALS, ...options.signals }),
    columns: () => COLUMNS,
    homeDir: HOME,
    paths: posixPaths,
    clock: { now: () => time.now },
    timers: timers.timers,
    log: (line) => logs.push(line),
    onSeen: (seen) => reports.push(seen),
  };
  // Opens session `rowId` as chat does: its sessions row first, its chat.session entry last.
  const openSession = (
    rowId: string,
    branch: string | null,
    row: Partial<SessionRow> = {},
  ) => {
    sessionRows.set(rowId, sessionRow(rowId, row));
    chatSessions.set(rowId, chatSession(rowId, branch));
  };
  return {
    deps,
    git,
    forRepo,
    logs,
    reports,
    chatSessions,
    sessionRows,
    time,
    timers,
    openSession,
  };
}

type World = ReturnType<typeof world>;

// The signals one gather of a new watch reports.
async function gatherOnce(w: World): Promise<readonly SeenSignal[]> {
  const watch = createSignalWatch(w.deps);
  watch.refresh();
  await settled();
  watch.dispose();
  expect(w.reports).toHaveLength(1);
  return w.reports[0] as readonly SeenSignal[];
}

const reasons = (seen: readonly SeenSignal[]) =>
  seen.map((signal) => signal.reason);

describe('watchedRoots', () => {
  it('folders, pool clones and repoFolders deduped by top level', async () => {
    const tops: Record<string, string | null> = {
      [`${HOME}/dev/app`]: `${HOME}/dev/app`,
      [`${HOME}/dev/app/sub`]: `${HOME}/dev/app/`,
      '/clones/game-1': '/clones/game-1',
      '/clones/game-2': '/clones/game-2',
      '/scratch/loose': null,
    };
    const w = world({
      projects: [
        folderProject('~/dev/app'),
        { kind: 'pool', name: 'game', pool: 'game', profile: null },
        folderProject('/scratch/loose'),
      ],
      pools: poolSnapshot('game', ['/clones/game-1', '/clones/game-2']),
      repoFolders: ['~/dev/app/sub'],
      git: { topLevel: async (folder) => tops[folder] ?? null },
    });

    const roots = await watchedRoots(w.deps);

    expect(roots).toEqual([
      `${HOME}/dev/app`,
      '/clones/game-1',
      '/clones/game-2',
    ]);
    expect(w.git.topLevel.mock.calls.map(([folder]) => folder)).toEqual([
      `${HOME}/dev/app`,
      '/clones/game-1',
      '/clones/game-2',
      '/scratch/loose',
      `${HOME}/dev/app/sub`,
    ]);
  });

  it('a rejected topLevel logs and adds no root; an undefined pool snapshot adds none', async () => {
    const w = world({
      projects: [
        folderProject('/a'),
        folderProject('/b'),
        { kind: 'pool', name: 'game', pool: 'game', profile: null },
      ],
      git: {
        topLevel: async (folder) => {
          if (folder === '/a') {
            throw new Error('git rev-parse failed');
          }
          return folder;
        },
      },
    });

    const roots = await watchedRoots(w.deps);

    expect(roots).toEqual(['/b']);
    expect(w.logs).toEqual(['signals: /a: git rev-parse failed']);
  });
});

describe('gather', () => {
  it('signals per source', async () => {
    const p1 = '2026-11-22T07:00:00Z';
    const p2 = '2026-11-22T08:00:00Z';
    const w = world({
      projects: [folderProject('/dev/app')],
      cards: [jiraCard('ABC-12', 'To Do')],
      git: {
        branches: async () => [
          gitBranch('abc-12-fix', '2026-11-21T09:00:00+02:00'),
          gitBranch('abc-12-bad', 'not a time'),
          gitBranch('main', '2026-11-21T10:00:00Z'),
        ],
        commitsMatching: async () => [
          gitCommit('abcdef1234', 'ABC-12: tidy', '2026-11-21T11:00:00Z'),
        ],
      },
      forRepo: async () => [
        pullRequest(1, 'open', 'ABC-12 add parser', 'abc-12-fix', p1),
        pullRequest(2, 'merged', 'Fix ABC-12 crash', 'abc-12-old', p2),
        pullRequest(3, 'closed', 'ABC-12 drop', 'abc-12-drop'),
      ],
    });
    w.openSession('J', 'abc-12-fix', { owner: 'work' });
    w.openSession('S', 'feature/abc-12', {
      titles: titles({ user: 'Fix it', firstMessage: 'look at abc-12' }),
    });
    w.openSession('T', null, {
      titles: titles({ firstMessage: 'hello there' }),
    });

    const seen = await gatherOnce(w);

    expect(seen).toEqual([
      {
        signal: 'branch',
        at: '2026-11-21T09:00:00+02:00',
        reason: 'Branch abc-12-fix in app',
        keys: ['ABC-12'],
        rowId: null,
        branch: 'abc-12-fix',
        prState: null,
      },
      {
        signal: 'commit',
        at: '2026-11-21T11:00:00Z',
        reason: 'Commit abcdef1 "ABC-12: tidy" in app',
        keys: ['ABC-12'],
        rowId: null,
        branch: null,
        prState: null,
      },
      {
        signal: 'pr_opened',
        at: p1,
        reason: 'PR #1 open: ABC-12 add parser',
        keys: ['ABC-12'],
        rowId: null,
        branch: 'abc-12-fix',
        prState: 'open',
      },
      {
        signal: 'pr_merged',
        at: p2,
        reason: 'PR #2 merged: Fix ABC-12 crash',
        keys: ['ABC-12'],
        rowId: null,
        branch: 'abc-12-old',
        prState: null,
      },
      {
        signal: 'session',
        at: NOW_ISO,
        reason: 'Session "Fix it" on feature/abc-12',
        keys: ['ABC-12'],
        rowId: 'S',
        branch: 'feature/abc-12',
        prState: null,
      },
      {
        signal: 'session',
        at: NOW_ISO,
        reason: 'Session "hello there"',
        keys: [],
        rowId: 'T',
        branch: null,
        prState: null,
      },
    ]);
  });

  it('a remote branch with a local twin is dropped; one without stays', async () => {
    const w = world({
      projects: [folderProject('/dev/app')],
      cards: [jiraCard('ABC-12', 'To Do')],
      git: {
        branches: async () => [
          gitBranch('abc-12-fix', '2026-11-21T09:00:00Z'),
          gitBranch('origin/abc-12-fix', '2026-11-21T09:00:00Z', true),
          gitBranch('origin/abc-12-wip', '2026-11-20T09:00:00Z', true),
        ],
      },
    });

    const seen = await gatherOnce(w);

    expect(reasons(seen)).toEqual([
      'Branch abc-12-fix in app',
      'Branch origin/abc-12-wip in app',
    ]);
  });

  it('a PR is kept by a card key or a session branch, and an unrelated PR is dropped', async () => {
    const w = world({
      projects: [folderProject('/dev/app')],
      cards: [jiraCard('ABC-12', 'To Do')],
      forRepo: async () => [
        pullRequest(1, 'open', 'ABC-12 parser', 'parser'),
        pullRequest(2, 'open', 'Spike', 'spike/x'),
        pullRequest(3, 'open', 'Other', 'other'),
      ],
    });
    w.openSession('S', 'spike/x');

    const seen = await gatherOnce(w);

    expect(
      seen
        .filter((signal) => signal.signal === 'pr_opened')
        .map((pr) => pr.reason),
    ).toEqual(['PR #1 open: ABC-12 parser', 'PR #2 open: Spike']);
  });

  it('seen order is fixed whatever order the calls settle in', async () => {
    const r1Branches = deferred<GitBranch[]>();
    const r1Commits = deferred<GitCommit[]>();
    const r1PullRequests = deferred<PullRequestInfo[] | null>();
    const w = world({
      projects: [folderProject('/r1'), folderProject('/r2')],
      cards: [jiraCard('ABC-1', 'To Do')],
      git: {
        branches: async (root) =>
          root === '/r1'
            ? r1Branches.promise
            : [gitBranch('abc-1-b', '2026-11-21T09:00:00Z')],
        commitsMatching: async (root) =>
          root === '/r1'
            ? r1Commits.promise
            : [gitCommit('2222222aa', 'ABC-1 two', '2026-11-21T09:00:00Z')],
      },
      forRepo: async (root) =>
        root === '/r1'
          ? r1PullRequests.promise
          : [pullRequest(2, 'open', 'ABC-1 r2', 'r2-head')],
    });
    w.openSession('S', null, { titles: titles({ user: 's1' }) });
    const watch = createSignalWatch(w.deps);

    watch.refresh();
    await settled();
    r1PullRequests.resolve([pullRequest(1, 'open', 'ABC-1 r1', 'r1-head')]);
    await settled();
    r1Commits.resolve([
      gitCommit('1111111aa', 'ABC-1 one', '2026-11-21T09:00:00Z'),
    ]);
    await settled();
    r1Branches.resolve([gitBranch('abc-1-a', '2026-11-21T09:00:00Z')]);
    await settled();

    expect(w.reports).toHaveLength(1);
    expect(reasons(w.reports[0] as readonly SeenSignal[])).toEqual([
      'Branch abc-1-a in r1',
      'Commit 1111111 "ABC-1 one" in r1',
      'Branch abc-1-b in r2',
      'Commit 2222222 "ABC-1 two" in r2',
      'PR #1 open: ABC-1 r1',
      'PR #2 open: ABC-1 r2',
      'Session "s1"',
    ]);
    watch.dispose();
  });

  it('one commitsMatching per Jira card, since its movedAt or 30 days back', async () => {
    const movedAt = '2026-11-10T09:00:00+01:00';
    const w = world({
      projects: [folderProject('/dev/app')],
      cards: [
        jiraCard('ABC-1', 'To Do', { movedAt }),
        jiraCard('ABC-2', 'Backlog'),
        localCard('local-1', 'Todo'),
      ],
    });

    await gatherOnce(w);

    expect(w.git.commitsMatching.mock.calls).toEqual([
      ['/dev/app', '(^|[^A-Za-z0-9])ABC-1([^0-9]|$)', movedAt],
      [
        '/dev/app',
        '(^|[^A-Za-z0-9])ABC-2([^0-9]|$)',
        new Date(NOW - COMMIT_LOOKBACK_DAYS * DAY_MS).toISOString(),
      ],
    ]);
  });

  it.each([
    {
      case: 'signals.commit off',
      commit: 'off',
      card: jiraCard('ABC-1', 'To Do'),
      searches: 0,
    },
    {
      case: 'a Todo card',
      commit: 'In Progress',
      card: jiraCard('ABC-1', 'To Do'),
      searches: 1,
    },
    {
      case: 'an In Progress card',
      commit: 'In Progress',
      card: jiraCard('ABC-1', 'In Progress'),
      searches: 0,
    },
    {
      case: 'an Other card',
      commit: 'In Progress',
      card: jiraCard('ABC-1', 'Blocked'),
      searches: 0,
    },
    {
      case: 'a movingTo card',
      commit: 'In Progress',
      card: jiraCard('ABC-1', 'To Do', { movingTo: 'In Progress' }),
      searches: 0,
    },
  ])(
    'commit bound: $case runs $searches',
    async ({ commit, card, searches }) => {
      const w = world({
        projects: [folderProject('/dev/app')],
        cards: [card],
        signals: { commit },
      });

      await gatherOnce(w);

      expect(w.git.commitsMatching).toHaveBeenCalledTimes(searches);
    },
  );

  it("one forRepo per origin repo name, on the group's first root", async () => {
    const origins: Record<string, string | null> = {
      '/c1': 'game',
      '/c2': 'game',
      '/app': 'app',
      '/loose': null,
    };
    const w = world({
      projects: ['/c1', '/c2', '/app', '/loose'].map(folderProject),
      git: { originRepoName: async (root) => origins[root] ?? null },
    });

    await gatherOnce(w);

    expect(w.forRepo.mock.calls).toEqual([['/c1'], ['/app']]);
  });

  it('forRepo null gives no PR signals and no log line', async () => {
    const w = world({
      projects: [folderProject('/dev/app')],
      cards: [jiraCard('ABC-12', 'To Do')],
      forRepo: async () => null,
    });

    const seen = await gatherOnce(w);

    expect(seen).toEqual([]);
    expect(w.logs).toEqual([]);
  });

  const HAPPY = [
    'Branch abc-2-y in r1',
    'Commit 1111111 "ABC-1 work" in r1',
    'Commit 2222222 "ABC-2 work" in r1',
    'Branch abc-1-x in r2',
    'PR #1 open: ABC-1 pr',
    'PR #2 open: ABC-2 pr',
  ];

  it.each([
    { fail: 'branches', dropped: 'Branch abc-2-y in r1' },
    { fail: 'commitsMatching', dropped: 'Commit 1111111 "ABC-1 work" in r1' },
    { fail: 'forRepo', dropped: 'PR #1 open: ABC-1 pr' },
  ])('failure table: a rejected $fail on /r1', async ({ fail, dropped }) => {
    const failure = new Error(`${fail} failed`);
    const w = world({
      projects: [folderProject('/r1'), folderProject('/r2')],
      cards: [jiraCard('ABC-1', 'To Do'), jiraCard('ABC-2', 'To Do')],
      git: {
        branches: async (root) => {
          if (fail === 'branches' && root === '/r1') {
            throw failure;
          }
          return root === '/r1'
            ? [gitBranch('abc-2-y', '2026-11-21T09:00:00Z')]
            : [gitBranch('abc-1-x', '2026-11-21T09:00:00Z')];
        },
        commitsMatching: async (root, pattern) => {
          if (root !== '/r1') {
            return [];
          }
          if (pattern.includes('ABC-1')) {
            if (fail === 'commitsMatching') {
              throw failure;
            }
            return [
              gitCommit('1111111aa', 'ABC-1 work', '2026-11-21T09:00:00Z'),
            ];
          }
          return [gitCommit('2222222aa', 'ABC-2 work', '2026-11-21T09:00:00Z')];
        },
      },
      forRepo: async (root) => {
        if (fail === 'forRepo' && root === '/r1') {
          throw failure;
        }
        return root === '/r1'
          ? [pullRequest(1, 'open', 'ABC-1 pr', 'h1')]
          : [pullRequest(2, 'open', 'ABC-2 pr', 'h2')];
      },
    });

    const seen = await gatherOnce(w);

    expect(reasons(seen)).toEqual(HAPPY.filter((reason) => reason !== dropped));
    expect(w.logs).toEqual([`signals: /r1: ${fail} failed`]);
  });

  it('no Jira card runs no commitsMatching', async () => {
    const w = world({
      projects: [folderProject('/dev/app')],
      cards: [localCard('local-1', 'Todo')],
    });

    await gatherOnce(w);

    expect(w.git.commitsMatching).not.toHaveBeenCalled();
  });

  it('past the deadline it logs, reports nothing, and the next refresh gathers', async () => {
    const hung = deferred<GitBranch[]>();
    const w = world({
      projects: [folderProject('/dev/app')],
      cards: [jiraCard('ABC-12', 'To Do')],
    });
    w.git.branches.mockImplementationOnce(() => hung.promise);
    const watch = createSignalWatch(w.deps);

    watch.refresh();
    await settled();
    w.timers.runAfter(GATHER_DEADLINE_MS);

    expect(w.logs).toEqual(['signals: gather passed 60 s, dropped']);
    expect(w.reports).toEqual([]);

    watch.refresh();
    await settled();
    expect(w.git.branches).toHaveBeenCalledTimes(2);
    expect(w.reports).toEqual([[]]);

    hung.resolve([gitBranch('abc-12-fix', '2026-11-21T09:00:00Z')]);
    await settled();
    expect(w.reports).toEqual([[]]);
    expect(watch.latest()).toEqual([]);
    watch.dispose();
  });
});

describe('watch', () => {
  it('branch changes debounce to one gather', async () => {
    const w = world();
    w.openSession('S', 'a');
    const watch = createSignalWatch(w.deps);

    w.chatSessions.set('S', chatSession('S', 'b'));
    w.chatSessions.set('S', chatSession('S', 'c'));

    expect([...w.timers.armed.values()].map((timer) => timer.ms)).toEqual([
      BRANCH_CHANGE_DEBOUNCE_MS,
    ]);
    expect(w.reports).toEqual([]);
    w.timers.runAfter(BRANCH_CHANGE_DEBOUNCE_MS);
    await settled();
    expect(w.reports).toHaveLength(1);
    watch.dispose();
  });

  it.each([
    {
      change: 'a session leaving',
      apply: (w: World) => w.chatSessions.set('S', undefined),
    },
    {
      change: 'a first message changing',
      apply: (w: World) =>
        w.sessionRows.set(
          'S',
          sessionRow('S', {
            titles: titles({ firstMessage: 'look at ABC-12' }),
          }),
        ),
    },
  ])('$change re-gathers after the quiet', async ({ apply }) => {
    const w = world();
    w.openSession('S', 'a');
    const watch = createSignalWatch(w.deps);

    apply(w);

    expect(w.timers.armed.size).toBe(1);
    w.timers.runAfter(BRANCH_CHANGE_DEBOUNCE_MS);
    await settled();
    expect(w.reports).toHaveLength(1);
    watch.dispose();
  });

  it('activity-only chat.session changes neither gather nor re-arm the timer', () => {
    const w = world();
    w.openSession('S', 'a');
    const watch = createSignalWatch(w.deps);

    w.chatSessions.set('S', chatSession('S', 'a', { activity: 'working' }));
    w.sessionRows.set('S', sessionRow('S', { marked: true }));
    expect(w.timers.armed.size).toBe(0);

    w.chatSessions.set('S', chatSession('S', 'b'));
    const [armedHandle] = [...w.timers.armed.keys()];
    w.chatSessions.set(
      'S',
      chatSession('S', 'b', { activity: 'idle', background: 1 }),
    );

    expect([...w.timers.armed.keys()]).toEqual([armedHandle]);
    expect(w.timers.cleared).toEqual([]);
    watch.dispose();
  });

  // A watch over one root whose first `branches` waits on the returned deferred, every later one answering at once.
  function blockedWorld() {
    const firstBranches = deferred<GitBranch[]>();
    const w = world({ projects: [folderProject('/dev/app')] });
    w.git.branches.mockImplementationOnce(() => firstBranches.promise);
    return { w, firstBranches };
  }

  it('refresh during a gather runs one more, not two', async () => {
    const { w, firstBranches } = blockedWorld();
    const watch = createSignalWatch(w.deps);

    watch.refresh();
    await settled();
    watch.refresh();
    watch.refresh();
    expect(w.git.branches).toHaveBeenCalledTimes(1);

    firstBranches.resolve([]);
    await settled();

    expect(w.git.branches).toHaveBeenCalledTimes(2);
    expect(w.reports).toHaveLength(2);
    watch.dispose();
  });

  it('dispose drops a settling gather', async () => {
    const { w, firstBranches } = blockedWorld();
    w.openSession('S', 'a');
    const watch = createSignalWatch(w.deps);

    watch.refresh();
    await settled();
    w.chatSessions.set('S', chatSession('S', 'b'));
    watch.dispose();
    firstBranches.resolve([]);
    await settled();

    expect(w.reports).toEqual([]);
    expect(w.timers.armed.size).toBe(0);
    w.chatSessions.set('S', chatSession('S', 'c'));
    expect(w.timers.armed.size).toBe(0);
  });

  it('latest is null until the first gather finishes', async () => {
    const { w, firstBranches } = blockedWorld();
    const watch = createSignalWatch(w.deps);

    expect(watch.latest()).toBeNull();
    watch.refresh();
    await settled();
    expect(watch.latest()).toBeNull();

    firstBranches.resolve([]);
    await settled();

    expect(watch.latest()).toBe(w.reports[0]);
    watch.dispose();
  });

  const SEEDED: SeenSignal[] = [
    {
      signal: 'branch',
      at: '2026-11-21T09:00:00Z',
      reason: 'Branch abc-12-fix in app',
      keys: ['ABC-12'],
      rowId: null,
      branch: 'abc-12-fix',
      prState: null,
    },
  ];

  it('seed reports with no git call', () => {
    const w = world({ projects: [folderProject('/dev/app')] });
    const watch = createSignalWatch(w.deps);

    watch.seed(SEEDED);

    expect(w.reports).toEqual([SEEDED]);
    expect(watch.latest()).toBe(SEEDED);
    expect(w.git.topLevel).not.toHaveBeenCalled();
    expect(w.git.branches).not.toHaveBeenCalled();
    watch.dispose();
  });

  it('a seeded watch ignores refresh and drops a gather in flight', async () => {
    const { w, firstBranches } = blockedWorld();
    w.openSession('S', 'a');
    const watch = createSignalWatch(w.deps);

    watch.refresh();
    await settled();
    watch.seed(SEEDED);
    firstBranches.resolve([]);
    await settled();
    watch.refresh();
    await settled();
    w.chatSessions.set('S', chatSession('S', 'b'));

    expect(w.reports).toEqual([SEEDED]);
    expect(watch.latest()).toBe(SEEDED);
    expect(w.git.branches).toHaveBeenCalledTimes(1);
    expect(w.timers.armed.size).toBe(0);
    watch.dispose();
  });

  it("a session's first sighting keeps its at across gathers", async () => {
    const w = world();
    w.openSession('S', null);
    const watch = createSignalWatch(w.deps);

    watch.refresh();
    await settled();
    w.time.now = NOW + 60 * 60 * 1000;
    w.openSession('T', null);
    watch.refresh();
    await settled();

    const atByRow = (seen: readonly SeenSignal[] | undefined) =>
      seen?.map((signal) => [signal.rowId, signal.at]);
    expect(atByRow(w.reports[0])).toEqual([['S', NOW_ISO]]);
    expect(atByRow(w.reports[1])).toEqual([
      ['S', NOW_ISO],
      ['T', new Date(NOW + 60 * 60 * 1000).toISOString()],
    ]);
    watch.dispose();
  });

  it('a session that left and came back is sighted anew', async () => {
    const w = world();
    w.openSession('S', null);
    const watch = createSignalWatch(w.deps);
    const back = NOW + 2 * 60 * 60 * 1000;

    watch.refresh();
    await settled();
    w.chatSessions.set('S', undefined);
    watch.refresh();
    await settled();
    w.time.now = back;
    w.openSession('S', null);
    watch.refresh();
    await settled();

    expect(w.reports.at(-1)?.map((signal) => signal.at)).toEqual([
      new Date(back).toISOString(),
    ]);
    watch.dispose();
  });
});
