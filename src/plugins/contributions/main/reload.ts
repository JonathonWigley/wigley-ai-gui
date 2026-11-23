import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';

// How long a change waits for the next before the rescan runs.
export const RESCAN_DELAY_MS = 300;

export interface ReloadDeps {
  files: Pick<Files, 'stat' | 'watch'>;
  paths: Paths;
  timers: Timers;
  log: PluginLog;
  // Scans once and returns the files whose change calls for the next scan.
  scan(): Promise<readonly string[]>;
}

// `start` runs the first scan and settles when it does, fulfilled whatever
// the scan did. `changed` restarts the `RESCAN_DELAY_MS` timer, whose firing
// runs a scan; a scan asked for while one runs is queued once. After each
// scan the watched folders are the folders holding its files: a folder
// `files.stat` reports absent, or not a folder, is not watched, and a watch no
// longer needed is disposed. A watch hears only its files' names, and a
// failed one is logged and started again by the next scan. `stop` ends every
// watch and the timer, and runs no further scan.
export interface Reload {
  start(): Promise<void>;
  changed(): void;
  stop(): void;
}

// A live watch on one folder and the file names in it a scan named.
interface FolderWatch {
  names: Set<string>;
  handle: Disposable;
}

export function createReload(deps: ReloadDeps): Reload {
  const { files, paths, timers, log, scan } = deps;
  const watches = new Map<string, FolderWatch>();
  let timer: number | null = null;
  let running: Promise<void> | null = null;
  let isQueued = false;
  let isStopped = false;

  const changed = () => {
    if (isStopped) {
      return;
    }
    if (timer !== null) {
      timers.clear(timer);
    }
    timer = timers.set(() => {
      timer = null;
      void requestScan();
    }, RESCAN_DELAY_MS);
  };

  const startWatch = (folder: string, names: Set<string>) => {
    const failed = (error: unknown) =>
      log(`watch of ${folder} failed: ${errorText(error)}`);
    const held: { watch: FolderWatch | null } = { watch: null };
    try {
      const handle = files.watch(
        folder,
        (path) => {
          if (held.watch?.names.has(path) === true) {
            changed();
          }
        },
        {
          recursive: false,
          onError(error) {
            failed(error);
            if (watches.get(folder) === held.watch) {
              watches.delete(folder);
            }
          },
          onMissed: changed,
        },
      );
      held.watch = { names, handle };
      watches.set(folder, held.watch);
    } catch (error) {
      failed(error);
    }
  };

  const syncWatches = async (watched: readonly string[]) => {
    const wanted = new Map<string, Set<string>>();
    for (const file of watched) {
      const folder = paths.parent(file);
      const names = wanted.get(folder) ?? new Set();
      names.add(paths.base(file));
      wanted.set(folder, names);
    }
    for (const [folder, watch] of watches) {
      if (!wanted.has(folder)) {
        watch.handle.dispose();
        watches.delete(folder);
      }
    }
    for (const [folder, names] of wanted) {
      const held = watches.get(folder);
      if (held !== undefined) {
        held.names = names;
        continue;
      }
      const stat = await files.stat(folder);
      if (isStopped) {
        return;
      }
      if (stat !== null && stat.isFolder && !watches.has(folder)) {
        startWatch(folder, names);
      }
    }
  };

  const scanOnce = async () => {
    try {
      const watched = await scan();
      if (!isStopped) {
        await syncWatches(watched);
      }
    } catch (error) {
      log(`scan failed: ${errorText(error)}`);
    }
  };

  const requestScan = (): Promise<void> => {
    if (running !== null) {
      isQueued = true;
      return running;
    }
    running = (async () => {
      do {
        isQueued = false;
        await scanOnce();
      } while (isQueued && !isStopped);
      running = null;
    })();
    return running;
  };

  return {
    start: () => requestScan(),
    changed,
    stop() {
      isStopped = true;
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
      }
      for (const watch of watches.values()) {
        watch.handle.dispose();
      }
      watches.clear();
    },
  };
}
