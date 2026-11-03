import path from 'node:path';
import {
  type Files,
  type FileWatch,
  readIfPresent,
} from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { WorkflowSignal } from '../contract';
import { readPlanProgress } from '../plan-reader';

// Watches each session's plan folder, signalling `planChanged` with the
// plan's progress on each read of its plan.md and `planGone` once when the
// folder is missing, which closes the watch. `follow` moves the session's
// watch to `planDir` (null: none); following the folder it already watches
// does nothing, unless `planGone` closed that watch, which `follow` reopens.
// `check` reads the watched plan now, for a delete the OS watcher may not
// report; it does nothing while the watch is still opening or after `planGone`
// closed it. A missing folder is
// never watched, since `Files.watch` creates the folder it is given. A read
// that settles after the session's watch moved or closed, or after a newer
// read of the session started, is dropped. A watch that fails to open is
// logged and forgotten, so the next `follow` of its folder tries again.
export interface PlanWatch {
  follow(sessionId: string, planDir: string | null): void;
  check(sessionId: string): void;
  dispose(): void;
}

interface Watched {
  planDir: string;
  // `opening` until the folder's stat settles; `gone` once `planGone` closed it.
  status: 'opening' | 'open' | 'gone';
  watch: FileWatch | null;
}

export function createPlanWatch(deps: {
  files: Pick<Files, 'read' | 'stat' | 'watch'>;
  log: PluginLog;
  signal(sessionId: string, signal: WorkflowSignal): void;
}): PlanWatch {
  const { files, log } = deps;
  const watched = new Map<string, Watched>();
  // Bumped each time a session's watch moves or closes: a read started under
  // an earlier generation is dropped.
  const generations = new Map<string, number>();

  const generationOf = (sessionId: string) => generations.get(sessionId) ?? 0;
  // The number of the session's newest read: an older read is dropped.
  const latestReads = new Map<string, number>();

  const nextGeneration = (sessionId: string) => {
    generations.set(sessionId, generationOf(sessionId) + 1);
  };

  // Closes the session's watch and drops every read still in flight for it.
  const close = (sessionId: string) => {
    watched.get(sessionId)?.watch?.dispose();
    watched.delete(sessionId);
    latestReads.delete(sessionId);
    nextGeneration(sessionId);
  };

  const signalGone = (sessionId: string, entry: Watched) => {
    entry.watch?.dispose();
    entry.watch = null;
    entry.status = 'gone';
    nextGeneration(sessionId);
    deps.signal(sessionId, { type: 'planGone' });
  };

  const logFailure = (entry: Watched) => (error: unknown) => {
    log(`plan.md not read in ${entry.planDir}: ${errorText(error)}`);
  };

  const read = (sessionId: string, entry: Watched) => {
    const generation = generationOf(sessionId);
    const readNumber = (latestReads.get(sessionId) ?? 0) + 1;
    latestReads.set(sessionId, readNumber);
    const isCurrent = () =>
      generationOf(sessionId) === generation &&
      latestReads.get(sessionId) === readNumber;
    const readPlan = async () => {
      const text = await readIfPresent(
        files,
        path.join(entry.planDir, 'plan.md'),
      );
      if (!isCurrent()) {
        return;
      }
      if (text !== null) {
        deps.signal(sessionId, {
          type: 'planChanged',
          progress: readPlanProgress(text),
        });
        return;
      }
      const folder = await files.stat(entry.planDir);
      if (isCurrent() && folder === null) {
        signalGone(sessionId, entry);
      }
    };
    readPlan().catch(logFailure(entry));
  };

  const open = (sessionId: string, planDir: string) => {
    close(sessionId);
    const entry: Watched = { planDir, status: 'opening', watch: null };
    watched.set(sessionId, entry);
    const generation = generationOf(sessionId);
    const startWatch = async () => {
      const folder = await files.stat(planDir);
      if (generationOf(sessionId) !== generation) {
        return;
      }
      if (folder === null || !folder.isFolder) {
        signalGone(sessionId, entry);
        return;
      }
      entry.watch = files.watch(planDir, () => read(sessionId, entry), {
        recursive: false,
        onError: () => read(sessionId, entry),
      });
      entry.status = 'open';
      read(sessionId, entry);
    };
    startWatch().catch((error: unknown) => {
      if (generationOf(sessionId) === generation) {
        watched.delete(sessionId);
      }
      logFailure(entry)(error);
    });
  };

  return {
    follow(sessionId, planDir) {
      const current = watched.get(sessionId);
      const watchesItAlready =
        current !== undefined &&
        current.planDir === planDir &&
        current.status !== 'gone';
      if (watchesItAlready) {
        return;
      }
      if (planDir === null) {
        close(sessionId);
        return;
      }
      open(sessionId, planDir);
    },
    check(sessionId) {
      const current = watched.get(sessionId);
      if (current?.status === 'open') {
        read(sessionId, current);
      }
    },
    dispose() {
      for (const sessionId of watched.keys()) {
        close(sessionId);
      }
    },
  };
}
