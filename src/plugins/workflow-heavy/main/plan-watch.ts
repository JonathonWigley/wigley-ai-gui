import type { Files, FileWatch } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import {
  newestPlanCopy,
  planCopies,
  type PlanCopy,
  type PlanCopyDeps,
  readPlanCopy,
  repoTop,
} from '../../../shared/plan-copies';
import type { WorkflowSignal } from '../../workflow/contract';
import { heavySignal } from '../contract';

// Watches every copy of each session's plan folder (the folder in each
// checkout of its clone) and git's shared folder, signalling `planChanged`
// with the newest copy's progress on each read and `planGone` once when no
// copy is left, which closes the watch. `follow` moves the session's watch to
// `planDir` (null: none); following the folder it already watches does
// nothing, unless `planGone` closed that watch, which `follow` reopens.
// `check` lists the copies again and reads the newest, for a delete or a new
// worktree the OS watcher may not report; it does nothing while the watch is
// still opening or after `planGone` closed it. A change to git's worktree list
// lists the copies again too. A missing folder is never watched, since
// `Files.watch` creates the folder it is given. A read or a list that settles
// after the session's watch moved or closed, or after a newer one of its kind
// started, is dropped. A watch that fails to open is logged and forgotten, so
// the next `follow` of its folder tries again.
export interface PlanWatch {
  follow(sessionId: string, planDir: string | null): void;
  check(sessionId: string): void;
  dispose(): void;
}

interface Watched {
  planDir: string;
  // `opening` until every watch is open; `gone` once `planGone` closed it.
  status: 'opening' | 'open' | 'gone';
  // One watch per copy's folder, and one on `planDir` while it is a folder.
  copyWatches: FileWatch[];
  // Git's shared folder of the clone, and its `worktrees` folder.
  gitWatch: FileWatch | null;
  worktreesWatch: FileWatch | null;
}

// The entry of git's shared folder that holds one folder per linked worktree.
const WORKTREES = 'worktrees';

export function createPlanWatch(deps: {
  git: Pick<Git, 'topLevel' | 'worktrees' | 'commonDir'>;
  files: Pick<
    Files,
    'read' | 'modified' | 'list' | 'realPath' | 'stat' | 'watch'
  >;
  paths: Paths;
  log: PluginLog;
  signal(sessionId: string, signal: WorkflowSignal): void;
}): PlanWatch {
  const { git, files, paths, log } = deps;
  const copyDeps: PlanCopyDeps = { git, files, paths };
  const watched = new Map<string, Watched>();
  // Bumped each time a session's watch moves or closes: a read or a list
  // started under an earlier generation is dropped.
  const generations = new Map<string, number>();
  // The number of the session's newest read, and of its newest list: an older
  // one is dropped.
  const latestReads = new Map<string, number>();
  const latestLists = new Map<string, number>();

  const generationOf = (sessionId: string) => generations.get(sessionId) ?? 0;

  const nextGeneration = (sessionId: string) => {
    generations.set(sessionId, generationOf(sessionId) + 1);
  };

  // Starts a numbered call of the session in `latest`; the check it returns
  // is true while the watch has not moved or closed and no newer call of
  // `latest` started.
  const startCall = (sessionId: string, latest: Map<string, number>) => {
    const generation = generationOf(sessionId);
    const callNumber = (latest.get(sessionId) ?? 0) + 1;
    latest.set(sessionId, callNumber);
    return () =>
      generationOf(sessionId) === generation &&
      latest.get(sessionId) === callNumber;
  };

  const disposeWatches = (entry: Watched) => {
    for (const watch of entry.copyWatches) {
      watch.dispose();
    }
    entry.copyWatches = [];
    entry.gitWatch?.dispose();
    entry.gitWatch = null;
    entry.worktreesWatch?.dispose();
    entry.worktreesWatch = null;
  };

  // Closes the session's watch and drops every read and list still in flight
  // for it.
  const close = (sessionId: string) => {
    const entry = watched.get(sessionId);
    if (entry !== undefined) {
      disposeWatches(entry);
    }
    watched.delete(sessionId);
    latestReads.delete(sessionId);
    latestLists.delete(sessionId);
    nextGeneration(sessionId);
  };

  const signalGone = (sessionId: string, entry: Watched) => {
    disposeWatches(entry);
    entry.status = 'gone';
    nextGeneration(sessionId);
    deps.signal(sessionId, heavySignal({ type: 'planGone' }));
  };

  const logFailure = (entry: Watched) => (error: unknown) => {
    log(`plan.md not read in ${entry.planDir}: ${errorText(error)}`);
  };

  const read = (sessionId: string, entry: Watched) => {
    const isCurrent = startCall(sessionId, latestReads);
    const readNewest = async () => {
      const copy = await newestPlanCopy(entry.planDir, copyDeps);
      const progress =
        copy === null ? null : await readPlanCopy(copy, copyDeps);
      if (!isCurrent()) {
        return;
      }
      if (progress !== null) {
        deps.signal(sessionId, heavySignal({ type: 'planChanged', progress }));
        return;
      }
      if (copy !== null) {
        return;
      }
      const folder = await files.stat(entry.planDir);
      if (isCurrent() && folder === null) {
        signalGone(sessionId, entry);
      }
    };
    readNewest().catch(logFailure(entry));
  };

  // The folders that hold the plan's copies: `planDir` while it is a folder,
  // since `wigley:make` names a folder before its `plan.md` exists, and each
  // copy's folder, none twice.
  const copyFolders = async (
    planDir: string,
    copies: readonly PlanCopy[],
  ): Promise<string[]> => {
    const candidates: string[] = [];
    for (const folder of [planDir, ...copies.map((copy) => copy.planDir)]) {
      if (!candidates.some((seen) => paths.samePath(seen, folder))) {
        candidates.push(folder);
      }
    }
    const stats = await Promise.all(
      candidates.map((folder) => files.stat(folder)),
    );
    return candidates.filter((_, index) => stats[index]?.isFolder === true);
  };

  // A watch on each folder; when one throws, the ones it opened are disposed.
  const watchCopyFolders = (
    sessionId: string,
    entry: Watched,
    folders: readonly string[],
  ): FileWatch[] => {
    const opened: FileWatch[] = [];
    try {
      for (const folder of folders) {
        opened.push(
          files.watch(folder, () => read(sessionId, entry), {
            recursive: false,
            onError: () => read(sessionId, entry),
          }),
        );
      }
    } catch (error) {
      for (const watch of opened) {
        watch.dispose();
      }
      throw error;
    }
    return opened;
  };

  // Lists the copies again and moves the copy watches to them, then reads; a
  // failure keeps the copy watches it had.
  const listAgain = (sessionId: string, entry: Watched) => {
    const isCurrent = startCall(sessionId, latestLists);
    const list = async () => {
      const copies = await planCopies(entry.planDir, copyDeps);
      const folders = await copyFolders(entry.planDir, copies);
      if (!isCurrent()) {
        return;
      }
      const opened = watchCopyFolders(sessionId, entry, folders);
      for (const watch of entry.copyWatches) {
        watch.dispose();
      }
      entry.copyWatches = opened;
      read(sessionId, entry);
    };
    list().catch(logFailure(entry));
  };

  // Keeps a watch on git's `worktrees` folder while it exists: its entries are
  // the linked worktrees, which a watch of git's folder may not hear change.
  const syncWorktreesWatch = async (
    sessionId: string,
    entry: Watched,
    commonDir: string,
  ) => {
    const generation = generationOf(sessionId);
    const worktrees = paths.join(commonDir, WORKTREES);
    const folder = await files.stat(worktrees);
    if (generationOf(sessionId) !== generation) {
      return;
    }
    if (folder?.isFolder !== true) {
      entry.worktreesWatch?.dispose();
      entry.worktreesWatch = null;
      return;
    }
    entry.worktreesWatch ??= files.watch(
      worktrees,
      () => listAgain(sessionId, entry),
      {
        recursive: false,
        onError: () => {
          entry.worktreesWatch = null;
          listAgain(sessionId, entry);
        },
      },
    );
  };

  // Watches the git folder every checkout of the plan's clone shares, listing
  // the copies again when its worktree list changes; none outside a clone.
  const watchGitFolder = async (
    sessionId: string,
    entry: Watched,
    isCurrent: () => boolean,
  ) => {
    const top = await repoTop(entry.planDir, copyDeps);
    if (top === null) {
      return;
    }
    const commonDir = await git.commonDir(top);
    const folder = await files.stat(commonDir);
    if (!isCurrent() || folder?.isFolder !== true) {
      return;
    }
    const onWorktreesChange = () => {
      syncWorktreesWatch(sessionId, entry, commonDir).catch(logFailure(entry));
      listAgain(sessionId, entry);
    };
    entry.gitWatch = files.watch(
      commonDir,
      (changed) => {
        if (changed === WORKTREES) {
          onWorktreesChange();
        }
      },
      { recursive: false, onError: () => listAgain(sessionId, entry) },
    );
    await syncWorktreesWatch(sessionId, entry, commonDir);
  };

  const open = (sessionId: string, planDir: string) => {
    close(sessionId);
    const entry: Watched = {
      planDir,
      status: 'opening',
      copyWatches: [],
      gitWatch: null,
      worktreesWatch: null,
    };
    watched.set(sessionId, entry);
    const generation = generationOf(sessionId);
    const isCurrent = () => generationOf(sessionId) === generation;
    const startWatch = async () => {
      const copies = await planCopies(planDir, copyDeps);
      const folders = await copyFolders(planDir, copies);
      if (!isCurrent()) {
        return;
      }
      if (folders.length === 0) {
        signalGone(sessionId, entry);
        return;
      }
      entry.copyWatches = watchCopyFolders(sessionId, entry, folders);
      await watchGitFolder(sessionId, entry, isCurrent);
      if (!isCurrent()) {
        return;
      }
      entry.status = 'open';
      read(sessionId, entry);
    };
    startWatch().catch((error: unknown) => {
      if (isCurrent()) {
        close(sessionId);
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
        listAgain(sessionId, current);
      }
    },
    dispose() {
      for (const sessionId of watched.keys()) {
        close(sessionId);
      }
    },
  };
}
