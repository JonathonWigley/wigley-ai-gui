import { beforeEach, describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ChatSessionInfo } from '../../chat/contract';
import {
  NEEDS_YOU_ACTIVITY,
  type RowActivitySource,
  type SessionTitles,
} from '../../sessions/contract';
import type { PoolSnapshot } from '../../unity-pool/contract';
import type { SessionFlow } from '../../workflow/contract';
import type { BoardRow } from '../contract';
import { createTouchTracker, type TouchTracker } from './board';
import { chatInfo, cloneClaim, flow, poolClone } from './board.test-support';
import {
  type BoardFeed,
  type BoardFeedDeps,
  createBoardFeed,
} from './board-feed';
import { createRoster, type Roster } from './roster';

const FINISHING_STAGE = 'land';
// Row id → [room, title, folder].
const ROWS: Record<string, [string, string, string]> = {
  rA: ['a', 'Alpha', '/r/c2/src'],
  rB: ['a', 'Beta', '/r/c2'],
  rC: ['b', 'Gamma', '/r/c9'],
};

let now: number;
let timerQueue: { id: number; at: number; run: () => void }[];
let nextTimerId: number;
let changedByRoot: Record<string, string[]>;
let failingRoots: Set<string>;
let gitReads: { root: string; at: number }[];
let logs: string[];
let roster: Roster;
let tracker: TouchTracker;

const timers: Timers = {
  set(run, ms) {
    const id = nextTimerId++;
    timerQueue.push({ id, at: now + ms, run });
    return id;
  },
  clear(handle) {
    timerQueue = timerQueue.filter((timer) => timer.id !== handle);
  },
};

const git: BoardFeedDeps['git'] = {
  topLevel: async (folder) => (folder.startsWith('/r/c2') ? '/r/c2' : folder),
  currentBranch: async () => 'feat',
  changedPaths: async (root) => {
    gitReads.push({ root, at: now });
    if (failingRoots.has(root)) {
      throw new Error('index.lock exists');
    }
    return changedByRoot[root] ?? [];
  },
  hasUpstream: async () => false,
  unpushedPaths: async () => [],
};

// Lets every settled promise chain run; the feed's timers are the fake ones.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function advance(ms: number): Promise<void> {
  const until = now + ms;
  for (;;) {
    const due = timerQueue
      .filter((timer) => timer.at <= until)
      .sort((a, b) => a.at - b.at)[0];
    if (due === undefined) {
      break;
    }
    timerQueue = timerQueue.filter((timer) => timer !== due);
    now = due.at;
    due.run();
    await flush();
  }
  now = until;
}

interface Inputs {
  chat?: Map<string, ChatSessionInfo>;
  flows?: SessionFlow[];
  activities?: Map<string, RowActivitySource[]>;
  pools?: PoolSnapshot | null;
}

function feedOver(inputs: Inputs = {}): BoardFeed {
  return createBoardFeed({
    roster,
    tracker,
    git,
    paths: posixPaths,
    clock: { now: () => now },
    timers,
    chat: () => inputs.chat ?? new Map(),
    flows: () => inputs.flows ?? [],
    stageFinishes: (candidate) => candidate.stage === FINISHING_STAGE,
    activities: () => inputs.activities ?? new Map(),
    pools: () => inputs.pools ?? null,
    claims: async () => [],
    log: (line) => logs.push(line),
  });
}

async function trackAll(feed: BoardFeed, rowIds: string[]): Promise<void> {
  for (const rowId of rowIds) {
    feed.track(rowId, ROWS[rowId][2]);
  }
  await feed.settled();
}

function rowOf(rows: BoardRow[], rowId: string): BoardRow {
  const row = rows.find((candidate) => candidate.rowId === rowId);
  if (row === undefined) {
    throw new Error(`no board row ${rowId}`);
  }
  return row;
}

beforeEach(() => {
  now = 0;
  timerQueue = [];
  nextTimerId = 1;
  changedByRoot = {};
  failingRoots = new Set();
  gitReads = [];
  logs = [];
  tracker = createTouchTracker(posixPaths);
  roster = createRoster({
    sessions: {
      project: (rowId) => ROWS[rowId]?.[0] ?? null,
      titles: (rowId): SessionTitles => ({
        user: null,
        agent: ROWS[rowId]?.[1] ?? null,
        firstMessage: null,
      }),
      label: () => null,
    },
  });
  for (const [rowId, [, , folder]] of Object.entries(ROWS)) {
    roster.connected({
      id: rowId,
      info: {
        sessionId: `host-${rowId}`,
        projectDir: folder,
        harness: 'claude',
        rowId: null,
      },
    });
  }
});

describe('createBoardFeed', () => {
  it('rows_FromInputs', async () => {
    changedByRoot['/r/c2'] = ['src/a.ts', 'src/c.ts'];
    const feed = feedOver({
      chat: new Map([
        ['rA', chatInfo({ sessionId: 'rA' })],
        ['rB', chatInfo({ sessionId: 'rB' })],
      ]),
      flows: [flow({ sessionId: 'rA', stage: FINISHING_STAGE })],
      activities: new Map([
        ['rB', [{ sourceId: 'forms', activity: NEEDS_YOU_ACTIVITY }]],
      ]),
      pools: {
        pools: [
          {
            pool: 'games',
            updatedAt: 0,
            queue: [],
            clones: [poolClone(2, '/r/c2', cloneClaim({ session: 'host-rA' }))],
          },
        ],
      },
    });
    feed.noteTouched('rA', 'main', ['/r/c2/src/a.ts']);
    feed.noteTouched('rC', 'main', ['/r/c2/src/c.ts']);
    await trackAll(feed, ['rA', 'rB', 'rC']);

    const rows = feed.rows('a');

    expect(rowOf(rows, 'rA').state).toBe('done');
    expect(rowOf(rows, 'rB').state).toBe('waiting');
    expect(rowOf(rows, 'rB').uncommitted).toEqual([
      { path: 'src/a.ts', byRowId: 'rA', by: 'Alpha' },
      { path: 'src/c.ts', byRowId: 'rC', by: 'Gamma' },
    ]);
    expect(rowOf(rows, 'rA').clone).toEqual({
      pool: 'games',
      number: 2,
      holder: 'this',
    });
    expect(rowOf(rows, 'rB').clone).toEqual({
      pool: 'games',
      number: 2,
      holder: 'other',
    });
  });

  it('refresh_ThrottlesAndForgets: three refreshes inside the window read git twice', async () => {
    const feed = feedOver();
    await trackAll(feed, ['rB']);
    await advance(5_000);
    gitReads = [];

    const first = feed.refresh('a');
    await flush();
    await advance(500);
    const second = feed.refresh('a');
    await advance(500);
    let isThirdDone = false;
    const third = feed.refresh('a').then(() => {
      isThirdDone = true;
    });
    await flush();

    expect(gitReads).toEqual([{ root: '/r/c2', at: 5_000 }]);
    expect(isThirdDone).toBe(false);

    await advance(1_000);
    await Promise.all([first, second, third]);

    expect(gitReads).toEqual([
      { root: '/r/c2', at: 5_000 },
      { root: '/r/c2', at: 7_000 },
    ]);
  });

  it('refresh_ThrottlesAndForgets: a read forgets the touches it shows committed', async () => {
    const feed = feedOver();
    await trackAll(feed, ['rB']);
    await advance(5_000);
    changedByRoot['/r/c2'] = ['src/kept.ts'];
    tracker.touched('rA', 'main', '/r/c2/src/old.ts', 5_000);
    tracker.touched('rA', 'main', '/r/c2/src/late.ts', 5_001);
    tracker.touched('rA', 'main', '/r/c2/src/kept.ts', 4_000);
    tracker.touched('rA', 'main', '/r/c9/other.ts', 4_000);

    await feed.refresh('a');

    expect(
      tracker
        .touches()
        .map((touch) => touch.path)
        .sort(),
    ).toEqual(['/r/c2/src/kept.ts', '/r/c2/src/late.ts', '/r/c9/other.ts']);
  });

  it('refresh_ThrottlesAndForgets: onChanged fires only when rows differ', async () => {
    const feed = feedOver();
    const heard: string[] = [];
    feed.onChanged((room) => heard.push(room));
    await trackAll(feed, ['rB']);
    heard.length = 0;

    await advance(5_000);
    await feed.refresh('a');
    expect(heard).toEqual([]);

    changedByRoot['/r/c2'] = ['src/new.ts'];
    await advance(5_000);
    await feed.refresh('a');
    expect(heard).toEqual(['a']);
  });

  it('refresh_GitRejects', async () => {
    changedByRoot['/r/c2'] = ['src/a.ts'];
    const feed = feedOver();
    await trackAll(feed, ['rB']);
    failingRoots.add('/r/c2');
    changedByRoot['/r/c2'] = [];

    await advance(5_000);
    await feed.refresh('a');

    expect(logs).toEqual([
      'board git read failed for /r/c2: index.lock exists',
    ]);
    expect(rowOf(feed.rows('a'), 'rB').uncommitted).toEqual([
      { path: 'src/a.ts', byRowId: null, by: null },
    ]);
  });

  it.each<{
    case: string;
    touchedBy: string;
    asked: string;
    under: boolean;
    expected: string[];
  }>([
    {
      case: 'touched by another row and changed',
      touchedBy: 'rA',
      asked: '/r/c2/src/a.ts',
      under: false,
      expected: ['/r/c2/src/a.ts'],
    },
    {
      case: 'touched by the asker',
      touchedBy: 'rB',
      asked: '/r/c2/src/a.ts',
      under: false,
      expected: [],
    },
    {
      case: 'touched by another row, not changed',
      touchedBy: 'rA',
      asked: '/r/c2/src/z.ts',
      under: false,
      expected: [],
    },
    {
      case: 'a folder, under',
      touchedBy: 'rA',
      asked: '/r/c2/src',
      under: true,
      expected: ['/r/c2/src/a.ts', '/r/c2/src/b.ts'],
    },
  ])(
    'uncommittedByOthers: $case',
    async ({ touchedBy, asked, under, expected }) => {
      changedByRoot['/r/c2'] = ['src/a.ts', 'src/b.ts', 'docs/c.md'];
      const feed = feedOver();
      await trackAll(feed, ['rA', 'rB']);
      for (const path of [
        '/r/c2/src/a.ts',
        '/r/c2/src/b.ts',
        '/r/c2/src/z.ts',
        '/r/c2/docs/c.md',
      ]) {
        tracker.touched(touchedBy, 'main', path, 1);
      }

      const found = feed.uncommittedByOthers('rB', [asked], under);

      expect(found.map((touch) => touch.path)).toEqual(expected);
    },
  );
});
