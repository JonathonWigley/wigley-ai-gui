import { describe, expect, it, vi } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import type {
  CloneClaim,
  PoolClone,
  PoolState,
  QueueTicket,
} from '../contract';
import type { PanelCloneInput, RowBadgeInput } from '../layouts/layout';
import {
  type PendingAction,
  type PoolRow,
  ordinal,
  panelInput,
  poolOfRow,
  rowBadges,
} from './pool-view-model';

const NOW = 1_000_000;

function clone(number: number, changes: Partial<PoolClone> = {}): PoolClone {
  return {
    number,
    path: `/x/repo-${number}`,
    facts: { branch: 'main', dirty: false, editor: 'ready', probedAt: 500 },
    claim: null,
    handoff: null,
    stranded: null,
    lastHolder: null,
    lastReleasedAt: null,
    warmup: null,
    ...changes,
  };
}

function claim(
  kind: CloneClaim['kind'],
  session: string | null,
  row: string | null,
  renewedAt = NOW - 4_000,
): CloneClaim {
  return { kind, session, row, since: NOW - 90_000, renewedAt };
}

function ticket(changes: Partial<QueueTicket> = {}): QueueTicket {
  return {
    session: 'host-other',
    row: null,
    branch: 'feature',
    enqueuedAt: NOW - 30_000,
    polledAt: NOW - 1_000,
    longWait: false,
    ...changes,
  };
}

function pool(
  name: string,
  clones: PoolClone[],
  queue: QueueTicket[] = [],
): PoolState {
  return { pool: name, updatedAt: NOW, clones, queue };
}

const ROW: PoolRow = {
  sessionId: 'row-7',
  label: 'gamma 2',
  projectDir: '/x/repo-1',
  hostSessionId: 'host-7',
};

const NO_PENDING: ReadonlyMap<number, PendingAction> = new Map();
const NO_ACTIONS = { select: () => {} };

const CLONE_1 = { pool: 'p', clone: 1 };

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
  ])('ordinal_Positions (%i → %s)', (position, expected) => {
    expect(ordinal(position)).toBe(expected);
  });
});

describe('rowBadges', () => {
  // `rows` is every row on the page, `[row]` when left out.
  it.each<{
    name: string;
    pools: PoolState[];
    rows?: PoolRow[];
    row: PoolRow;
    expected: RowBadgeInput[];
  }>([
    {
      name: 'claim matched by row',
      pools: [
        pool('a', [
          clone(1),
          clone(3, { claim: claim('agent', 'host-x', 'row-7') }),
        ]),
      ],
      row: ROW,
      expected: [{ text: 'Unity 3', queued: false }],
    },
    {
      name: 'claim with an earlier row matched by session',
      pools: [
        pool('a', [clone(2, { claim: claim('agent', 'host-7', 'row-old') })]),
      ],
      row: ROW,
      expected: [{ text: 'Unity 2', queued: false }],
    },
    {
      name: 'a claim whose row is another row on the page, its session ours',
      pools: [
        pool('a', [clone(2, { claim: claim('agent', 'host-7', 'row-3') })]),
      ],
      rows: [
        ROW,
        {
          sessionId: 'row-3',
          label: 'delta 1',
          projectDir: '/x/repo-2',
          hostSessionId: 'host-3',
        },
      ],
      row: ROW,
      expected: [],
    },
    {
      name: 'a hold shows no badge',
      pools: [
        pool('a', [clone(1, { claim: claim('hold', 'host-7', 'row-7') })]),
      ],
      row: ROW,
      expected: [],
    },
    {
      name: 'handoff matched by row',
      pools: [
        pool('a', [
          clone(4, {
            handoff: { session: 'host-x', row: 'row-7', until: NOW + 5_000 },
          }),
        ]),
      ],
      row: ROW,
      expected: [{ text: 'Unity 4', queued: false }],
    },
    {
      name: 'third in a queue',
      pools: [
        pool(
          'a',
          [clone(1, { claim: claim('agent', 'host-x', 'row-x') })],
          [
            ticket(),
            ticket({ session: 'host-y' }),
            ticket({ session: 'host-z', row: 'row-7' }),
          ],
        ),
      ],
      row: ROW,
      expected: [{ text: 'Unity: queued 3rd', queued: true }],
    },
    {
      name: 'queued in a and held in b, in pool name order',
      pools: [
        pool('a', [clone(1)], [ticket({ session: 'host-7' })]),
        pool('b', [clone(5, { claim: claim('agent', null, 'row-7') })]),
      ],
      row: ROW,
      expected: [
        { text: 'Unity: queued 1st', queued: true },
        { text: 'Unity 5', queued: false },
      ],
    },
    {
      name: 'held and queued in one pool shows the held badge',
      pools: [
        pool(
          'a',
          [clone(2, { claim: claim('agent', 'host-7', 'row-7') })],
          [ticket({ session: 'host-7', row: 'row-7' })],
        ),
      ],
      row: ROW,
      expected: [{ text: 'Unity 2', queued: false }],
    },
    {
      name: 'a stranded mark shows no badge',
      pools: [
        pool('a', [
          clone(1, {
            stranded: {
              session: 'host-7',
              row: 'row-7',
              since: NOW - 1_000,
              reason: 'expired-dirty',
            },
          }),
        ]),
      ],
      row: ROW,
      expected: [],
    },
    {
      name: 'a null never matches a null',
      pools: [pool('a', [clone(1, { claim: claim('agent', null, null) })])],
      row: { ...ROW, hostSessionId: null },
      expected: [],
    },
  ])('rowBadges_Matches ($name)', ({ pools, rows, row, expected }) => {
    expect(rowBadges(pools, rows ?? [row], row)).toEqual(expected);
  });
});

describe('poolOfRow', () => {
  const games = pool('games', [
    clone(1, { path: '/x/new-games-prototypes' }),
    clone(2, { path: '/x/new-games-prototypes-2' }),
  ]);
  const tools = pool('tools', [clone(1, { path: '/y/tools' })]);
  const outer = pool('aaa-outer', [clone(1, { path: '/x' })]);

  it.each<{
    name: string;
    pools: PoolState[];
    projectDir: string | null;
    originName: string | null;
    paths: typeof posixPaths;
    expected: string | null;
  }>([
    {
      name: "inside clone 2's path, not clone 1's string prefix",
      pools: [games, tools],
      projectDir: '/x/new-games-prototypes-2/sub',
      originName: null,
      paths: posixPaths,
      expected: 'games',
    },
    {
      name: 'equal to a clone path',
      pools: [games, tools],
      projectDir: '/y/tools',
      originName: null,
      paths: posixPaths,
      expected: 'tools',
    },
    {
      name: 'outside every clone, origin name a pool name',
      pools: [games, tools],
      projectDir: '/z/worktree',
      originName: 'tools',
      paths: posixPaths,
      expected: 'tools',
    },
    {
      name: 'outside every clone, no origin name',
      pools: [games, tools],
      projectDir: '/z/worktree',
      originName: null,
      paths: posixPaths,
      expected: null,
    },
    {
      name: 'no folder',
      pools: [games, tools],
      projectDir: null,
      originName: 'tools',
      paths: posixPaths,
      expected: null,
    },
    {
      name: 'inside clones of two pools, the first by name',
      pools: [outer, games],
      projectDir: '/x/new-games-prototypes/a',
      originName: null,
      paths: posixPaths,
      expected: 'aaa-outer',
    },
    {
      name: 'Windows, a differently cased path',
      pools: [pool('games', [clone(1, { path: 'C:\\Dev\\Games' })])],
      projectDir: 'c:\\dev\\games\\src',
      originName: null,
      paths: windowsPaths,
      expected: 'games',
    },
  ])(
    'poolOfRow ($name)',
    ({ pools, projectDir, originName, paths, expected }) => {
      const found = poolOfRow(pools, { ...ROW, projectDir }, originName, paths);
      expect(found?.pool ?? null).toBe(expected);
    },
  );
});

// A clone's input with its holder's `select` replaced by whether it selects.
function plainClone(input: PanelCloneInput) {
  const { holder, action, ...rest } = input;
  return {
    ...rest,
    holder:
      holder === null
        ? null
        : {
            kind: holder.kind,
            label: holder.label,
            idleMs: holder.idleMs,
            selects: holder.select !== null,
          },
    action,
  };
}

const BASE_EXPECTED = {
  title: 'Unity 1',
  path: '/x/repo-1',
  branch: 'main',
  dirty: false,
  editor: 'editor ready',
  holder: null,
  handoffMs: null,
  stranded: null,
  warmup: null,
  blocking: false,
  action: null,
  result: null,
};

describe('panelInput', () => {
  const rows = [ROW];

  it.each<{
    name: string;
    clone: PoolClone;
    pending?: ReadonlyMap<number, PendingAction>;
    expected: object;
  }>([
    {
      name: 'free',
      clone: clone(1),
      expected: {
        ...BASE_EXPECTED,
        action: {
          label: 'Hold',
          command: 'unity-pool.hold',
          arg: CLONE_1,
          running: false,
        },
      },
    },
    {
      name: 'user hold',
      clone: clone(1, { claim: claim('hold', null, null) }),
      expected: {
        ...BASE_EXPECTED,
        holder: {
          kind: 'user',
          label: 'Held by you',
          idleMs: null,
          selects: false,
        },
        action: {
          label: 'Release',
          command: 'unity-pool.release',
          arg: CLONE_1,
          running: false,
        },
      },
    },
    {
      name: 'agent claim with a row',
      clone: clone(1, {
        claim: claim('agent', 'host-x', 'row-7', NOW - 4_000),
      }),
      expected: {
        ...BASE_EXPECTED,
        holder: {
          kind: 'session',
          label: 'gamma 2',
          idleMs: 4_000,
          selects: true,
        },
      },
    },
    {
      name: 'agent claim with no row',
      clone: clone(1, {
        facts: { branch: 'main', dirty: false, editor: 'play', probedAt: 500 },
        claim: claim('agent', '1a2b3c4d-5e6f', 'row-gone', NOW - 7_000),
      }),
      expected: {
        ...BASE_EXPECTED,
        editor: 'in Play Mode',
        holder: {
          kind: 'agent',
          label: 'session 1a2b3c4d',
          idleMs: 7_000,
          selects: false,
        },
      },
    },
    {
      name: 'handoff matched by row',
      clone: clone(1, {
        handoff: { session: 'host-x', row: 'row-7', until: NOW + 12_000 },
      }),
      expected: {
        ...BASE_EXPECTED,
        holder: {
          kind: 'session',
          label: 'gamma 2',
          idleMs: null,
          selects: true,
        },
        handoffMs: 12_000,
      },
    },
    {
      name: 'stranded with no row',
      clone: clone(1, {
        facts: { branch: 'main', dirty: true, editor: 'closed', probedAt: 500 },
        stranded: {
          session: '9f8e7d6c5b',
          row: null,
          since: NOW - 60_000,
          reason: 'session-ended-dirty',
        },
      }),
      expected: {
        ...BASE_EXPECTED,
        dirty: true,
        editor: 'editor closed',
        holder: {
          kind: 'agent',
          label: 'session 9f8e7d6c',
          idleMs: null,
          selects: false,
        },
        stranded: { reason: 'session ended with changes', forMs: 60_000 },
      },
    },
    {
      name: 'stranded expired',
      clone: clone(1, {
        stranded: {
          session: null,
          row: null,
          since: NOW - 5_000,
          reason: 'expired-dirty',
        },
      }),
      expected: {
        ...BASE_EXPECTED,
        holder: {
          kind: 'agent',
          label: 'unknown session',
          idleMs: null,
          selects: false,
        },
        stranded: { reason: 'claim expired with changes', forMs: 5_000 },
      },
    },
    {
      name: 'warm-up done',
      clone: clone(1, {
        warmup: {
          state: 'done',
          startedAt: NOW - 9_000,
          finishedAt: NOW - 1_000,
          error: null,
        },
      }),
      expected: {
        ...BASE_EXPECTED,
        action: {
          label: 'Hold',
          command: 'unity-pool.hold',
          arg: CLONE_1,
          running: false,
        },
      },
    },
    {
      name: 'warm-up failed',
      clone: clone(1, {
        facts: { branch: 'main', dirty: false, editor: 'busy', probedAt: 500 },
        warmup: {
          state: 'failed',
          startedAt: NOW - 9_000,
          finishedAt: NOW - 1_000,
          error: 'license',
        },
      }),
      expected: {
        ...BASE_EXPECTED,
        editor: 'editor busy',
        warmup: { state: 'failed', error: 'license' },
        action: {
          label: 'Hold',
          command: 'unity-pool.hold',
          arg: CLONE_1,
          running: false,
        },
      },
    },
    {
      name: 'pending running hold',
      clone: clone(1),
      pending: new Map([[1, { action: 'hold', running: true, result: null }]]),
      expected: {
        ...BASE_EXPECTED,
        action: {
          label: 'Hold',
          command: 'unity-pool.hold',
          arg: CLONE_1,
          running: true,
        },
      },
    },
    {
      name: 'finished release with its result',
      clone: clone(1),
      pending: new Map([
        [
          1,
          {
            action: 'release',
            running: false,
            result: { ok: true, text: 'Released Unity 1' },
          },
        ],
      ]),
      expected: {
        ...BASE_EXPECTED,
        action: {
          label: 'Hold',
          command: 'unity-pool.hold',
          arg: CLONE_1,
          running: false,
        },
        result: { ok: true, text: 'Released Unity 1' },
      },
    },
    {
      name: 'unknown editor word',
      clone: clone(1, {
        facts: {
          branch: 'main',
          dirty: false,
          editor: 'unknown',
          probedAt: 500,
        },
        claim: claim('agent', 'host-7', null, NOW - 1_000),
      }),
      expected: {
        ...BASE_EXPECTED,
        editor: 'editor state unknown',
        holder: {
          kind: 'session',
          label: 'gamma 2',
          idleMs: 1_000,
          selects: true,
        },
      },
    },
  ])('panelInput_Clones ($name)', ({ clone: given, pending, expected }) => {
    const input = panelInput(
      pool('p', [given]),
      rows,
      NOW,
      pending ?? NO_PENDING,
      NO_ACTIONS,
    );
    expect(plainClone(input.clones[0])).toEqual(expected);
  });

  const agentClaimed = clone(1, { claim: claim('agent', 'host-x', null) });
  const held = clone(2, { claim: claim('hold', null, null) });
  const stranded = clone(3, {
    stranded: {
      session: 'host-y',
      row: null,
      since: NOW - 1_000,
      reason: 'expired-dirty',
    },
  });
  const freeClean = clone(4);
  const freeDirty = clone(5, {
    facts: { branch: 'main', dirty: true, editor: 'ready', probedAt: 500 },
  });
  const fiveClones = [agentClaimed, held, stranded, freeClean, freeDirty];

  it.each<{
    name: string;
    queue: QueueTicket[];
    blocking: boolean[];
    longWait: boolean;
  }>([
    {
      name: 'long wait',
      queue: [ticket(), ticket({ session: 'host-z', longWait: true })],
      blocking: [true, true, true, false, true],
      longWait: true,
    },
    {
      name: 'no long wait',
      queue: [ticket()],
      blocking: [false, false, false, false, false],
      longWait: false,
    },
  ])(
    'panelInput_LongWait_MarksBlockingClones ($name)',
    ({ queue, blocking, longWait }) => {
      const input = panelInput(
        pool('p', fiveClones, queue),
        rows,
        NOW,
        NO_PENDING,
        NO_ACTIONS,
      );
      expect(input.clones.map((each) => each.blocking)).toEqual(blocking);
      expect(input.longWait).toBe(longWait);
    },
  );

  it.each<{ name: string; queue: QueueTicket[]; counts: object }>([
    {
      name: 'long wait',
      queue: [ticket({ longWait: true }), ticket({ session: 'host-z' })],
      counts: { held: 2, free: 2, queued: 2, blocking: 5 },
    },
    {
      name: 'no queue',
      queue: [],
      counts: { held: 2, free: 2, queued: 0, blocking: 0 },
    },
  ])('panelInput_Counts ($name)', ({ queue, counts }) => {
    const handedOff = clone(6, {
      handoff: { session: 'host-q', row: null, until: NOW + 3_000 },
    });
    const warmingFailed = clone(7, {
      warmup: {
        state: 'failed',
        startedAt: NOW - 9_000,
        finishedAt: NOW - 1_000,
        error: 'boom',
      },
    });
    const clones = [...fiveClones, handedOff, warmingFailed];
    const input = panelInput(
      pool('p', clones, queue),
      rows,
      NOW,
      NO_PENDING,
      NO_ACTIONS,
    );
    expect(input.counts).toEqual(counts);
  });

  it.each<{
    name: string;
    facts: PoolClone['facts'];
    branch: string;
    dirty: boolean;
  }>([
    {
      name: 'detached HEAD',
      facts: { branch: null, dirty: false, editor: 'ready', probedAt: 500 },
      branch: 'detached',
      dirty: false,
    },
    {
      name: 'never probed',
      facts: { branch: null, dirty: null, editor: 'unknown', probedAt: null },
      branch: 'unknown',
      dirty: false,
    },
    {
      name: 'dirty unknown',
      facts: { branch: 'main', dirty: null, editor: 'ready', probedAt: 500 },
      branch: 'main',
      dirty: false,
    },
  ])('panelInput_NullFacts ($name)', ({ facts, branch, dirty }) => {
    const longWaitQueue = [ticket({ longWait: true })];
    const input = panelInput(
      pool('p', [clone(1, { facts })], longWaitQueue),
      rows,
      NOW,
      NO_PENDING,
      NO_ACTIONS,
    );
    expect(input.clones[0]).toMatchObject({ branch, dirty, blocking: false });
  });

  it('panelInput_Queue', () => {
    const input = panelInput(
      pool(
        'p',
        [clone(1)],
        [
          ticket({
            session: 'host-a',
            row: 'row-7',
            branch: 'one',
            enqueuedAt: NOW - 20_000,
          }),
          ticket({
            session: 'host-7',
            row: 'row-gone',
            branch: 'two',
            enqueuedAt: NOW - 8_000,
            longWait: true,
          }),
          ticket({
            session: 'abcdef0123',
            row: null,
            branch: 'three',
            enqueuedAt: NOW - 2_000,
          }),
        ],
      ),
      rows,
      NOW,
      NO_PENDING,
      NO_ACTIONS,
    );
    expect(
      input.queue.map(({ holder, ...rest }) => ({
        ...rest,
        holder: {
          kind: holder.kind,
          label: holder.label,
          idleMs: holder.idleMs,
        },
      })),
    ).toEqual([
      {
        position: '1st',
        holder: { kind: 'session', label: 'gamma 2', idleMs: null },
        branch: 'one',
        waitedMs: 20_000,
        longWait: false,
      },
      {
        position: '2nd',
        holder: { kind: 'session', label: 'gamma 2', idleMs: null },
        branch: 'two',
        waitedMs: 8_000,
        longWait: true,
      },
      {
        position: '3rd',
        holder: { kind: 'agent', label: 'session abcdef01', idleMs: null },
        branch: 'three',
        waitedMs: 2_000,
        longWait: false,
      },
    ]);
  });

  it('panelInput_SelectAndAction_TargetTheirRowAndClone', () => {
    const actions = { select: vi.fn() };
    const input = panelInput(
      pool('p', [
        clone(3, { claim: claim('agent', 'host-7', null) }),
        clone(4),
      ]),
      rows,
      NOW,
      NO_PENDING,
      actions,
    );
    input.clones[0].holder?.select?.();
    expect(actions.select.mock.calls).toEqual([['row-7']]);
    expect(input.clones[1].action).toMatchObject({
      command: 'unity-pool.hold',
      arg: { pool: 'p', clone: 4 },
    });
  });
});
