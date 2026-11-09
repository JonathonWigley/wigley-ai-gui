import { describe, expect, it, vi } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { PoolClaimRequest } from '../../chat/contract';
import type {
  PoolClone,
  PoolSnapshot,
  PoolState,
  QueueTicket,
} from '../contract';
import type { ClaimAnswer } from './pool-cli';
import {
  createPoolProvider,
  mergeOriginBranches,
  type OriginBranch,
  parseOriginBranches,
  type PoolProviderDeps,
} from './pool-provider';

function exited(code: number, stdout: string, stderr = ''): ProcessResult {
  return { code, stdout, stderr, timedOut: false };
}

function clone(
  number: number,
  path: string,
  session: string | null = null,
): PoolClone {
  return {
    number,
    path,
    facts: { branch: 'main', dirty: false, editor: 'ready', probedAt: 1_000 },
    claim:
      session === null
        ? null
        : { kind: 'agent', session, row: null, since: 1_000, renewedAt: 1_000 },
    handoff: null,
    stranded: null,
    lastHolder: null,
    lastReleasedAt: null,
    warmup: null,
  };
}

function pool(
  name: string,
  clones: PoolClone[],
  queue: QueueTicket[] = [],
): PoolState {
  return { pool: name, updatedAt: 1_000, clones, queue };
}

function ticket(session: string): QueueTicket {
  return {
    session,
    row: null,
    branch: 'main',
    enqueuedAt: 1_000,
    polledAt: 1_000,
    longWait: false,
  };
}

const POOLS: PoolSnapshot = {
  pools: [
    pool('p', [clone(1, '/c/1'), clone(2, '/c/2')]),
    pool('q', [clone(1, '/q/1')]),
  ],
};

const REQUEST: PoolClaimRequest = {
  pool: 'p',
  branch: 'main',
  hostSessionId: 'host-1',
  rowId: 'row-1',
};

function fetchArgs(clone: string): string[] {
  return ['-C', clone, 'fetch', '--no-recurse-submodules', 'origin'];
}

function listArgs(clone: string): string[] {
  return [
    '-C',
    clone,
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(committerdate:unix) %(refname:short)',
    'refs/remotes/origin',
  ];
}

// A provider over `snapshot`, every git run scripted on its `processes`.
function providerOver(
  snapshot: PoolSnapshot = POOLS,
  changes: Partial<PoolProviderDeps> = {},
) {
  const processes = new FakeProcesses();
  const logs: string[] = [];
  const rescan = vi.fn();
  const provider = createPoolProvider({
    processes,
    snapshot: () => snapshot,
    readPool: async () => null,
    runClaim: async () => ({ ok: true, path: '/c/1' }),
    rescan,
    log: (line) => logs.push(line),
    ...changes,
  });
  return { provider, processes, logs, rescan };
}

// Clone 1 lists `main` at 200 and `old` at 100; clone 2 lists `old` at 300.
function scriptListings(processes: FakeProcesses) {
  processes.script(
    'git',
    listArgs('/c/1'),
    exited(0, '200 origin/main\n100 origin/old\n'),
  );
  processes.script('git', listArgs('/c/2'), exited(0, '300 origin/old\n'));
}

function at(name: string, committedAt: number): OriginBranch {
  return { name, committedAt };
}

describe('parseOriginBranches', () => {
  it.each<{ name: string; stdout: string; expected: OriginBranch[] }>([
    {
      name: 'strips the remote once',
      stdout: '300 origin/feature/x\n200 origin/main\n',
      expected: [at('feature/x', 300), at('main', 200)],
    },
    {
      name: 'drops HEAD and bare origin',
      stdout: '500 origin/HEAD\n500 origin\n400 origin/main\n',
      expected: [at('main', 400)],
    },
    {
      name: 'CRLF and blank lines',
      stdout: '100 origin/a\r\n\r\n90 origin/b\r\n',
      expected: [at('a', 100), at('b', 90)],
    },
    { name: 'empty', stdout: '', expected: [] },
  ])('parseOriginBranches: $name', ({ stdout, expected }) => {
    expect(parseOriginBranches(stdout)).toEqual(expected);
  });
});

describe('mergeOriginBranches', () => {
  it.each<{ name: string; perClone: OriginBranch[][]; expected: string[] }>([
    {
      name: 'one clone keeps its order',
      perClone: [[at('main', 300), at('b', 200), at('a', 100)]],
      expected: ['main', 'b', 'a'],
    },
    {
      name: 'newer in another clone moves ahead',
      perClone: [[at('main', 200), at('old', 100)], [at('old', 300)]],
      expected: ['old', 'main'],
    },
    {
      name: 'same name once, newest date',
      perClone: [
        [at('a', 100), at('b', 50)],
        [at('a', 40), at('b', 60)],
      ],
      expected: ['a', 'b'],
    },
    {
      name: 'tie by name',
      perClone: [[at('z', 100)], [at('y', 100)]],
      expected: ['y', 'z'],
    },
    { name: 'no clones', perClone: [], expected: [] },
  ])('mergeOriginBranches: $name', ({ perClone, expected }) => {
    expect(mergeOriginBranches(perClone)).toEqual(expected);
  });
});

describe('createPoolProvider', () => {
  it.each([
    { pool: 'p', expected: ['/c/1', '/c/2'] },
    { pool: 'q', expected: ['/q/1'] },
    { pool: 'r', expected: [] },
  ])('folders: $pool', ({ pool: name, expected }) => {
    expect(providerOver().provider.folders(name)).toEqual(expected);
  });

  it('branches_NoRefresh_ListsEveryCloneAndMerges', async () => {
    const { provider, processes } = providerOver();
    scriptListings(processes);

    expect(await provider.branches('p', false)).toEqual(['old', 'main']);
    expect(processes.runs.map(({ args }) => args)).toEqual([
      listArgs('/c/1'),
      listArgs('/c/2'),
    ]);
  });

  it('branches_Refresh_FetchesInTheLowestCloneFirst', async () => {
    const { provider, processes } = providerOver();
    scriptListings(processes);
    processes.script('git', fetchArgs('/c/1'), exited(0, ''));

    expect(await provider.branches('p', true)).toEqual(['old', 'main']);
    expect(processes.runs.map(({ command, args }) => [command, args])).toEqual([
      ['git', fetchArgs('/c/1')],
      ['git', listArgs('/c/1')],
      ['git', listArgs('/c/2')],
    ]);
  });

  it('branches_FetchFails_StillLists', async () => {
    const { provider, processes, logs } = providerOver();
    scriptListings(processes);
    processes.script(
      'git',
      fetchArgs('/c/1'),
      exited(1, '', 'fatal: unable to access'),
    );

    expect(await provider.branches('p', true)).toEqual(['old', 'main']);
    expect(logs).toEqual(['fetch in /c/1 failed: fatal: unable to access']);
  });

  it('branches_OneCloneFails_ListsTheOthers', async () => {
    const { provider, processes, logs } = providerOver();
    scriptListings(processes);
    processes.script('git', listArgs('/c/2'), new Error('spawn failed'));

    expect(await provider.branches('p', false)).toEqual(['main', 'old']);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('/c/2');
  });

  it('branches_RefreshWhileFetching_RunsOneFetch', async () => {
    const { provider, processes } = providerOver();
    scriptListings(processes);
    const fetch = deferred<ProcessResult>();
    processes.script('git', fetchArgs('/c/1'), fetch.promise);

    const first = provider.branches('p', true);
    const second = provider.branches('p', true);
    fetch.resolve(exited(0, ''));

    expect(await first).toEqual(['old', 'main']);
    expect(await second).toEqual(['old', 'main']);
    expect(
      processes.runs.filter(({ args }) => args.includes('fetch')),
    ).toHaveLength(1);
  });

  // The watch's snapshot is stale: it shows clone 1 claimed by the session.
  const STALE = {
    pools: [pool('p', [clone(1, '/c/1', 'host-1'), clone(2, '/c/2')])],
  };
  const DIVERGED: ClaimAnswer = { ok: false, error: 'diverged', message: 'm' };

  it.each<{
    name: string;
    answer: ClaimAnswer;
    fresh: PoolState | null;
    expected: unknown;
  }>([
    {
      name: 'ok',
      answer: { ok: true, path: '/c/2' },
      fresh: null,
      expected: { ok: true, path: '/c/2', note: null },
    },
    {
      name: 'diverged, held in the fresh state',
      answer: DIVERGED,
      fresh: pool('p', [clone(1, '/c/1'), clone(2, '/c/2', 'host-1')]),
      expected: { ok: true, path: '/c/2', note: 'm' },
    },
    {
      name: 'diverged, held by another session',
      answer: DIVERGED,
      fresh: pool('p', [clone(1, '/c/1'), clone(2, '/c/2', 'host-9')]),
      expected: DIVERGED,
    },
    {
      name: 'diverged, no state file',
      answer: DIVERGED,
      fresh: null,
      expected: DIVERGED,
    },
    {
      name: 'dirty',
      answer: { ok: false, error: 'dirty', message: 'd' },
      fresh: null,
      expected: { ok: false, error: 'dirty', message: 'd' },
    },
    {
      name: 'cancelled',
      answer: { ok: false, error: 'cancelled', message: 'claim cancelled' },
      fresh: null,
      expected: { ok: false, error: 'cancelled', message: 'claim cancelled' },
    },
  ])('claim: $name', async ({ answer, fresh, expected }) => {
    const { provider, rescan } = providerOver(STALE, {
      runClaim: async () => answer,
      readPool: async () => fresh,
    });

    expect(
      await provider.claim(REQUEST, new AbortController().signal, () => {}),
    ).toEqual(expected);
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it('claim_QueueTicket_FiresQueuedOnceWhileRunning', async () => {
    const run = deferred<ClaimAnswer>();
    const { provider } = providerOver(POOLS, { runClaim: () => run.promise });
    const queued = vi.fn();
    const ownTicket = {
      pools: [pool('p', [clone(1, '/c/1')], [ticket('host-1')])],
    };

    const claim = provider.claim(REQUEST, new AbortController().signal, queued);
    provider.snapshotChanged({
      pools: [pool('p', [clone(1, '/c/1')], [ticket('host-9')])],
    });
    provider.snapshotChanged({
      pools: [
        pool('p', [clone(1, '/c/1')]),
        pool('q', [clone(1, '/q/1')], [ticket('host-1')]),
      ],
    });
    expect(queued).not.toHaveBeenCalled();
    provider.snapshotChanged(ownTicket);
    provider.snapshotChanged(ownTicket);
    expect(queued).toHaveBeenCalledTimes(1);
    run.resolve({ ok: true, path: '/c/1' });
    await claim;
    provider.snapshotChanged(ownTicket);

    expect(queued).toHaveBeenCalledTimes(1);
  });

  it.each(['chat aborts', 'provider disposed'])(
    'claim_SignalAndDispose_AbortTheRun: %s',
    async (action) => {
      let runSignal: AbortSignal | null = null;
      const run = deferred<ClaimAnswer>();
      const { provider } = providerOver(POOLS, {
        runClaim: (_request, signal) => {
          runSignal = signal;
          return run.promise;
        },
      });
      const chat = new AbortController();

      const claim = provider.claim(REQUEST, chat.signal, () => {});
      if (action === 'chat aborts') {
        chat.abort();
      } else {
        provider.dispose();
      }

      expect((runSignal as AbortSignal | null)?.aborted).toBe(true);
      run.resolve({
        ok: false,
        error: 'cancelled',
        message: 'claim cancelled',
      });
      await claim;
    },
  );
});
