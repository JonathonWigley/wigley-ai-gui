import type { Timers } from '../../../contracts/ambient';
import {
  type Files,
  type FileWatch,
  readIfPresent,
} from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { PoolSnapshot, PoolState } from '../contract';
import { readStateFile } from './state-file';

const SOURCE = 'unity-pool';
const STATE_FILE = 'state.json';
const MISSING_ROOT_CHECK_MS = 60_000;

// Holds every pool under unity-pool's state folder `stateRoot`, one folder per pool holding its `state.json`, and
// calls `changed` with the new snapshot after each change. Only reads: a missing root is checked again each minute
// and never created, since `Files.watch` creates the folder it watches. `rescan` closes the watch, lists the pools
// again and reads each one, for a change the OS watcher missed. A file that does not parse keeps the pool's last good
// state; one of an unknown version drops the pool. A read that settles after a newer read of its folder started is
// dropped.
export interface PoolWatch {
  snapshot(): PoolSnapshot;
  rescan(): void;
  dispose(): void;
}

export function createPoolWatch(deps: {
  files: Pick<Files, 'read' | 'stat' | 'list' | 'watch'>;
  paths: Paths;
  timers: Timers;
  log: Log;
  stateRoot: string;
  changed(snapshot: PoolSnapshot): void;
}): PoolWatch {
  const { files, paths, timers, log, stateRoot } = deps;
  // By pool folder name.
  const pools = new Map<string, PoolState>();
  // The number of each folder's newest read: an older read is dropped.
  const latestReads = new Map<string, number>();
  // `<folder> <version>` of each unknown version already logged.
  const loggedVersions = new Set<string>();
  let watch: FileWatch | null = null;
  let retryTimer: number | null = null;
  // Bumped by each rescan and by dispose: a scan started under an earlier one stops.
  let scanNumber = 0;
  let disposed = false;
  let lastSummary = summaryOf([]);

  const snapshot = (): PoolSnapshot => ({
    pools: [...pools.values()].sort((a, b) => a.pool.localeCompare(b.pool)),
  });

  const publish = () => {
    const current = snapshot();
    const summary = summaryOf(current.pools);
    if (summary !== lastSummary) {
      lastSummary = summary;
      log(SOURCE, `pools: ${summary}`);
    }
    deps.changed(current);
  };

  // Forgets the folder's pool and every read still in flight for it; true when it held one.
  const drop = (folder: string): boolean => {
    latestReads.set(folder, (latestReads.get(folder) ?? 0) + 1);
    return pools.delete(folder);
  };

  // Reads the folder's state file; true when the held pools changed.
  const read = async (folder: string): Promise<boolean> => {
    const readNumber = (latestReads.get(folder) ?? 0) + 1;
    latestReads.set(folder, readNumber);
    const text = await readIfPresent(
      files,
      paths.join(stateRoot, folder, STATE_FILE),
    );
    if (disposed || latestReads.get(folder) !== readNumber) {
      return false;
    }
    if (text === null) {
      return drop(folder);
    }
    const result = readStateFile(text);
    switch (result.kind) {
      case 'pool':
        pools.set(folder, result.pool);
        return true;
      case 'invalid':
        log(SOURCE, `state file of ${folder} not read: ${result.reason}`);
        return false;
      case 'unknownVersion':
        logVersionOnce(folder, result.version);
        return drop(folder);
    }
  };

  const logVersionOnce = (folder: string, version: unknown) => {
    const key = `${folder} ${String(version)}`;
    if (!loggedVersions.has(key)) {
      loggedVersions.add(key);
      log(
        SOURCE,
        `state file of ${folder} has version ${String(version)}; showing nothing`,
      );
    }
  };

  const logReadFailure = (folder: string) => (error: unknown) => {
    log(SOURCE, `state file of ${folder} not read: ${errorText(error)}`);
    return false;
  };

  const readAndPublish = (folder: string) => {
    read(folder)
      .catch(logReadFailure(folder))
      .then((changedPools) => {
        if (changedPools) {
          publish();
        }
      });
  };

  const onChange = (changedPath: string) => {
    const segments = changedPath.split('/');
    const folder = segments[0];
    const isStateFileOrPoolFolder =
      segments.length === 1 || segments[segments.length - 1] === STATE_FILE;
    if (folder !== '' && isStateFileOrPoolFolder) {
      readAndPublish(folder);
    }
  };

  const checkAgainLater = () => {
    retryTimer = timers.set(rescan, MISSING_ROOT_CHECK_MS);
  };

  const scan = async (current: number) => {
    const root = await files.stat(stateRoot);
    if (current !== scanNumber) {
      return;
    }
    if (root === null || !root.isFolder) {
      const heldAny = pools.size > 0;
      for (const folder of pools.keys()) {
        drop(folder);
      }
      if (heldAny) {
        publish();
      }
      checkAgainLater();
      return;
    }
    watch = files.watch(stateRoot, onChange, {
      recursive: true,
      onError: () => rescan(),
    });
    const entries = await files.list(stateRoot);
    if (current !== scanNumber) {
      return;
    }
    const folders = entries
      .filter((entry) => entry.kind === 'folder')
      .map((entry) => entry.path);
    let changedPools = false;
    for (const folder of pools.keys()) {
      if (!folders.includes(folder)) {
        changedPools = drop(folder) || changedPools;
      }
    }
    const reads = await Promise.all(
      folders.map((folder) => read(folder).catch(logReadFailure(folder))),
    );
    if (current === scanNumber && (changedPools || reads.includes(true))) {
      publish();
    }
  };

  // Closes the watch, clears the minute's check and stops any scan in flight.
  const stop = () => {
    scanNumber++;
    watch?.close();
    watch = null;
    if (retryTimer !== null) {
      timers.clear(retryTimer);
      retryTimer = null;
    }
  };

  function rescan() {
    stop();
    const current = scanNumber;
    scan(current).catch((error: unknown) => {
      log(SOURCE, `state folder not watched: ${errorText(error)}`);
      if (current === scanNumber) {
        checkAgainLater();
      }
    });
  }

  rescan();

  return {
    snapshot,
    rescan,
    dispose() {
      disposed = true;
      stop();
    },
  };
}

// Each pool as `<pool> <n> clones, <h> held, <q> queued`, joined with `; `, or `none`.
function summaryOf(pools: readonly PoolState[]): string {
  if (pools.length === 0) {
    return 'none';
  }
  return pools
    .map((pool) => {
      const held = pool.clones.filter((clone) => clone.claim !== null).length;
      return `${pool.pool} ${pool.clones.length} clones, ${held} held, ${pool.queue.length} queued`;
    })
    .join('; ');
}
