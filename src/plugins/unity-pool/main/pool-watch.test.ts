import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { Files, WatchOptions } from '../../../contracts/files';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { PoolSnapshot } from '../contract';
import { createPoolWatch } from './pool-watch';

const ROOT = '/h/.local/state/unity-pool';

const settled = () => new Promise((settle) => setImmediate(settle));

// Timers the test fires by hand: `pending` holds each timer set and not yet
// cleared or fired.
function handTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let nextHandle = 1;
  const timers: Timers = {
    set(run, ms) {
      const handle = nextHandle++;
      pending.set(handle, { run, ms });
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  const fire = (ms: number) => {
    for (const [handle, timer] of pending) {
      if (timer.ms === ms) {
        pending.delete(handle);
        timer.run();
      }
    }
  };
  return { timers, pending, fire };
}

// A version 1 state file with `clones` clones, the first `held` of them
// claimed, and `queued` tickets.
function stateText(
  pool: string,
  counts: { clones: number; held: number; queued: number; updatedAt?: number },
): string {
  const clones: Record<string, unknown> = {};
  for (let number = 1; number <= counts.clones; number++) {
    clones[String(number)] = {
      path: `/dev/${pool}-${number}`,
      facts: { branch: 'main', dirty: false, editor: 'ready', probedAt: 100 },
      claim:
        number <= counts.held
          ? {
              kind: number % 2 === 0 ? 'hold' : 'agent',
              session: null,
              row: null,
              since: 50,
              renewedAt: 60,
            }
          : null,
    };
  }
  const queue = Array.from({ length: counts.queued }, (_, index) => ({
    session: `waiting-${index}`,
    row: null,
    branch: 'main',
    enqueuedAt: 70,
    polledAt: 80,
    longWait: false,
  }));
  return JSON.stringify({
    version: 1,
    pool,
    updatedAt: counts.updatedAt ?? 90,
    clones,
    queue,
  });
}

const ONE_CLONE = { clones: 1, held: 0, queued: 0 };

// A watch over the memory files whose watch the test drives itself: no write
// reaches it, and `opened` and `closed` count its watches.
function handWatchedFiles(files: MemoryFiles) {
  const watches: {
    onChange: (path: string) => void;
    options?: WatchOptions;
  }[] = [];
  let opened = 0;
  let closed = 0;
  let lists = 0;
  const wrapped: Pick<Files, 'read' | 'stat' | 'list' | 'watch'> = {
    read: (path) => files.read(path),
    stat: (path) => files.stat(path),
    list: (folder, options) => {
      lists++;
      return files.list(folder, options);
    },
    watch: (_folder, onChange, options) => {
      opened++;
      watches.push({ onChange, options });
      return { close: () => closed++ };
    },
  };
  return {
    files: wrapped,
    watches,
    counts: () => ({ opened, closed, lists }),
  };
}

function startWatch(files: Pick<Files, 'read' | 'stat' | 'list' | 'watch'>) {
  const hand = handTimers();
  const changes: PoolSnapshot[] = [];
  const logs: string[] = [];
  const watch = createPoolWatch({
    files,
    paths: posixPaths,
    timers: hand.timers,
    log: (_source, message) => logs.push(message),
    stateRoot: ROOT,
    changed: (snapshot) => changes.push(snapshot),
  });
  return { watch, hand, changes, logs };
}

const poolNames = (snapshot: PoolSnapshot | undefined) =>
  snapshot?.pools.map((pool) => pool.pool);

describe('createPoolWatch', () => {
  it('poolWatch_MissingRoot_MakesNoFolderAndFindsItLater', async () => {
    const files = createMemoryFiles();
    const { watch, hand, changes } = startWatch(files);
    await settled();

    expect(watch.snapshot()).toEqual({ pools: [] });
    expect(await files.stat(ROOT)).toBeNull();

    await files.write(`${ROOT}/p/state.json`, stateText('p', ONE_CLONE));
    hand.fire(60_000);
    await settled();

    expect(changes.map(poolNames)).toEqual([['p']]);
  });

  it('poolWatch_StateChange_RereadsOnlyThatPool', async () => {
    const files = createMemoryFiles();
    await files.write(`${ROOT}/a/state.json`, stateText('a', ONE_CLONE));
    await files.write(`${ROOT}/b/state.json`, stateText('b', ONE_CLONE));
    const reads: string[] = [];
    startWatch({
      read: (path) => {
        reads.push(path);
        return files.read(path);
      },
      stat: (path) => files.stat(path),
      list: (folder) => files.list(folder),
      watch: (folder, onChange, options) =>
        files.watch(folder, onChange, options),
    });
    await settled();
    reads.length = 0;

    await files.write(`${ROOT}/a/state.json`, stateText('a', ONE_CLONE));
    await settled();
    expect(reads).toEqual([`${ROOT}/a/state.json`]);

    await files.write(`${ROOT}/a/state.lock`, '');
    await files.write(`${ROOT}/a/tmpab12cd34`, '{');
    await settled();
    expect(reads).toEqual([`${ROOT}/a/state.json`]);
  });

  it.each<{
    name: string;
    change: (files: MemoryFiles) => Promise<void>;
    pools: string[];
    clones: number;
    logs: string[];
  }>([
    {
      name: 'a half-written file keeps the last good state',
      change: async (files) => {
        await files.write(`${ROOT}/a/state.json`, '{"version": 1, "po');
      },
      pools: ['a'],
      clones: 2,
      logs: ['state file of a not read: not JSON'],
    },
    {
      name: 'version 2 drops the pool, logged once over two writes',
      change: async (files) => {
        const text = JSON.stringify({ version: 2, pool: 'a' });
        await files.write(`${ROOT}/a/state.json`, text);
        await settled();
        await files.write(`${ROOT}/a/state.json`, text);
      },
      pools: [],
      clones: 0,
      logs: ['state file of a has version 2; showing nothing'],
    },
    {
      name: 'a deleted file drops the pool',
      change: async (files) => {
        files.remove(`${ROOT}/a/state.json`);
      },
      pools: [],
      clones: 0,
      logs: [],
    },
  ])('poolWatch_Reads: $name', async ({ change, pools, clones, logs }) => {
    const files = createMemoryFiles();
    await files.write(
      `${ROOT}/a/state.json`,
      stateText('a', { clones: 2, held: 0, queued: 0 }),
    );
    const started = startWatch(files);
    await settled();

    await change(files);
    await settled();

    const snapshot = started.watch.snapshot();
    expect(poolNames(snapshot)).toEqual(pools);
    expect(
      snapshot.pools.reduce((sum, pool) => sum + pool.clones.length, 0),
    ).toBe(clones);
    expect(
      started.logs.filter((line) => line.startsWith('state file')),
    ).toEqual(logs);
  });

  it('poolWatch_Rescan_ReopensOnceAndDropsGonePools', async () => {
    const files = createMemoryFiles();
    await files.write(`${ROOT}/a/state.json`, stateText('a', ONE_CLONE));
    await files.write(`${ROOT}/b/state.json`, stateText('b', ONE_CLONE));
    await files.write(`${ROOT}/notes.txt`, 'not a pool');
    await files.makeFolder(`${ROOT}/empty`);
    const hand = handWatchedFiles(files);
    const { watch, changes } = startWatch(hand.files);
    await settled();
    expect(poolNames(watch.snapshot())).toEqual(['a', 'b']);

    files.remove(`${ROOT}/b`);
    watch.rescan();
    await settled();

    expect(hand.counts()).toMatchObject({ opened: 2, closed: 1 });
    expect(poolNames(watch.snapshot())).toEqual(['a']);
    expect(poolNames(changes.at(-1))).toEqual(['a']);
  });

  it('poolWatch_OnError_Rescans', async () => {
    const files = createMemoryFiles();
    await files.write(`${ROOT}/a/state.json`, stateText('a', ONE_CLONE));
    const hand = handWatchedFiles(files);
    startWatch(hand.files);
    await settled();

    hand.watches[0].options?.onError?.(new Error('watcher died'));
    await settled();

    expect(hand.counts()).toEqual({ opened: 2, closed: 1, lists: 2 });
  });

  it('poolWatch_FirstScan_CallsChangedWithPools', async () => {
    const files = createMemoryFiles();
    await files.write(`${ROOT}/p/state.json`, stateText('p', ONE_CLONE));
    const { changes } = startWatch(files);
    await settled();

    expect(changes.map(poolNames)).toEqual([['p']]);
  });

  it('poolWatch_StaleRead_Dropped', async () => {
    const files = createMemoryFiles();
    const first = stateText('a', { clones: 1, held: 0, queued: 0 });
    const second = stateText('a', { clones: 3, held: 0, queued: 0 });
    await files.write(`${ROOT}/a/state.json`, first);
    let settleFirstRead: (text: string) => void = () => undefined;
    let reads = 0;
    const { watch } = startWatch({
      read: (path) => {
        reads++;
        if (reads === 1) {
          return new Promise((settle) => {
            settleFirstRead = settle;
          });
        }
        return files.read(path);
      },
      stat: (path) => files.stat(path),
      list: (folder) => files.list(folder),
      watch: (folder, onChange, options) =>
        files.watch(folder, onChange, options),
    });
    await settled();

    await files.write(`${ROOT}/a/state.json`, second);
    await settled();
    settleFirstRead(first);
    await settled();

    expect(watch.snapshot().pools[0].clones).toHaveLength(3);
  });

  it('poolWatch_Summary_LoggedOnChangeOnly', async () => {
    const files = createMemoryFiles();
    const counts = { clones: 3, held: 2, queued: 1 };
    await files.write(`${ROOT}/a/state.json`, stateText('a', counts));
    const { logs } = startWatch(files);
    await settled();

    await files.write(
      `${ROOT}/a/state.json`,
      stateText('a', { ...counts, updatedAt: 91 }),
    );
    await settled();
    await files.write(
      `${ROOT}/a/state.json`,
      stateText('a', { ...counts, updatedAt: 92 }),
    );
    await settled();

    expect(logs.filter((line) => line.startsWith('pools:'))).toEqual([
      'pools: a 3 clones, 2 held, 1 queued',
    ]);
  });
});
