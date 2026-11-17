import type { Files, FileWatch } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import {
  planCopies,
  type PlanCopy,
  type PlanCopyDeps,
  readCopyAt,
  readMovedCopy,
  repoTop,
} from '../../../shared/plan-copies';
import type { WorkflowSignal } from '../../workflow/contract';
import { type LargeState, largeSignal } from '../contract';

// Watches every copy of each session's plan folder (the folder in each
// checkout of its clone) and git's shared folder, signalling `planChanged`
// on each read and `planGone` once when no copy is left and `planDir` is
// gone, which closes the watch. A read takes a reported folder's own copy
// alone; with no report, or once the reported folder holds no `plan.md`, it
// takes the moved copy, listed from the main tree's copy folder the watch last
// listed, else from `unreportedPlanDir`. Once a reported folder lists no
// copies, as a worktree removed after its merge does, the copies, their
// watches and the git folder watch come from that folder too, so a fresh
// watch still finds the main tree's copy. `follow` moves the session's watch
// to the plan's `planDir` (null: none); following the folder it already
// watches with the same report fields does nothing, changed ones read again
// on the same watches, and a watch `planGone` closed reopens.
// `check` lists the copies again and reads, for a delete or a new worktree
// the OS watcher may not report; it does nothing while the watch is
// still opening or after `planGone` closed it. A change to git's worktree list
// lists the copies again too, and each list reopens a git folder watch that
// failed and opens or closes the `worktrees` watch with its folder, keeping
// each copy watch whose folder it lists again; a copy watch that fails lists
// again, which reopens it. A watch that may have missed changes acts as on a
// change: a copy's reads, git's and `worktrees`' list again. A missing folder
// is never watched, since `Files.watch` creates the folder it is given. A
// read, list,
// git folder watch or `worktrees` sync that settles after the session's watch
// moved or closed, or after a newer one of its kind started, is dropped. A
// watch that fails to open is logged and forgotten, so the next `follow` of
// its folder tries again. Each failure of an open watch is logged, and a
// folder's watch that fails more than `MAX_WATCH_REOPENS` times with no change
// heard on it between stops listing again; a later list still reopens it.
export type FollowedPlan = Pick<
  LargeState,
  'planDir' | 'planReported' | 'unreportedPlanDir'
>;

export interface PlanWatch {
  follow(sessionId: string, plan: FollowedPlan): void;
  check(sessionId: string): void;
  dispose(): void;
}

interface CopyWatch {
  folder: string;
  watch: FileWatch;
}

interface Watched {
  planDir: string;
  // Whether the run reported `planDir` as the copy it works in.
  reported: boolean;
  // The unreported folder the flow held before the report moved it.
  unreportedPlanDir: string | null;
  // The main tree's copy folder at the last list that held one.
  mainCopyDir: string | null;
  // `opening` until every watch is open; `gone` once `planGone` closed it.
  status: 'opening' | 'open' | 'gone';
  // One watch per copy's folder, and one on `planDir` while it is a folder.
  copyWatches: CopyWatch[];
  // Git's shared folder of the clone, set when its watch opens; the watch on
  // it, null outside a clone, until it opens and after it failed; and the
  // watch on its `worktrees` folder while that exists.
  commonDir: string | null;
  gitWatch: FileWatch | null;
  worktreesWatch: FileWatch | null;
  // Per watched folder, its watch's failures since a change was last heard
  // on it.
  watchFailures: Map<string, number>;
}

export const MAX_WATCH_REOPENS = 3;

// Keeps the main tree's copy folder in `entry` when `copies` holds one.
function rememberMainCopy(entry: Watched, copies: readonly PlanCopy[]): void {
  const main = copies.find((copy) => copy.isMainTree);
  if (main !== undefined) {
    entry.mainCopyDir = main.planDir;
  }
}

// The folder the moved copy is listed from: a reported folder's main tree
// copy the watch last listed, else the unreported folder the flow held before
// the report; `planDir` when there is neither, or no report.
function movedFromDir(entry: Watched): string {
  return entry.reported
    ? (entry.mainCopyDir ?? entry.unreportedPlanDir ?? entry.planDir)
    : entry.planDir;
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
  // Bumped each time a session's watch moves or closes: a call started under
  // an earlier generation is dropped.
  const generations = new Map<string, number>();
  // The number of the session's newest call of each kind: an older one is
  // dropped.
  const latestReads = new Map<string, number>();
  const latestLists = new Map<string, number>();
  const latestGitWatches = new Map<string, number>();
  const latestWorktreesSyncs = new Map<string, number>();

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
    for (const { watch } of entry.copyWatches) {
      watch.dispose();
    }
    entry.copyWatches = [];
    entry.gitWatch?.dispose();
    entry.gitWatch = null;
    entry.worktreesWatch?.dispose();
    entry.worktreesWatch = null;
  };

  // Closes the session's watch and drops every call still in flight for it.
  const close = (sessionId: string) => {
    const entry = watched.get(sessionId);
    if (entry !== undefined) {
      disposeWatches(entry);
    }
    watched.delete(sessionId);
    for (const latest of [
      latestReads,
      latestLists,
      latestGitWatches,
      latestWorktreesSyncs,
    ]) {
      latest.delete(sessionId);
    }
    nextGeneration(sessionId);
  };

  const signalGone = (sessionId: string, entry: Watched) => {
    disposeWatches(entry);
    entry.status = 'gone';
    nextGeneration(sessionId);
    deps.signal(sessionId, largeSignal({ type: 'planGone' }));
  };

  // Logs a failed step, `failed` naming it.
  const logFailure = (entry: Watched, failed: string) => (error: unknown) => {
    log(`${failed} in ${entry.planDir}: ${errorText(error)}`);
  };

  // Counts and logs a failure of the watch on `folder`, `failed` naming it;
  // true while the folder's failures are within `MAX_WATCH_REOPENS`.
  const isReopenedAfter = (
    entry: Watched,
    folder: string,
    failed: string,
    error: unknown,
  ): boolean => {
    logFailure(entry, `${failed} on ${folder}`)(error);
    const failures = (entry.watchFailures.get(folder) ?? 0) + 1;
    entry.watchFailures.set(folder, failures);
    const isWithinBound = failures <= MAX_WATCH_REOPENS;
    if (!isWithinBound) {
      log(
        `${folder} not watched again after ${failures} failures in ${entry.planDir}`,
      );
    }
    return isWithinBound;
  };

  const heard = (entry: Watched, folder: string) => {
    entry.watchFailures.delete(folder);
  };

  // The plan's copies listed from `planDir`, else, when it lists none, from
  // the folder the moved copy is listed from.
  const listCopies = async (entry: Watched): Promise<PlanCopy[]> => {
    const movedFrom = movedFromDir(entry);
    const copies = await planCopies(entry.planDir, copyDeps);
    return copies.length === 0 && movedFrom !== entry.planDir
      ? planCopies(movedFrom, copyDeps)
      : copies;
  };

  const read = (sessionId: string, entry: Watched) => {
    const isCurrent = startCall(sessionId, latestReads);
    const { planDir, reported } = entry;
    const movedFrom = movedFromDir(entry);
    const readCopy = async () => {
      const reportedCopy = reported
        ? await readCopyAt(planDir, copyDeps)
        : null;
      const copy = reportedCopy ?? (await readMovedCopy(movedFrom, copyDeps));
      if (!isCurrent()) {
        return;
      }
      if (copy !== null) {
        deps.signal(
          sessionId,
          largeSignal({ type: 'planChanged', progress: copy.progress }),
        );
        return;
      }
      const folder = await files.stat(entry.planDir);
      if (isCurrent() && folder === null) {
        signalGone(sessionId, entry);
      }
    };
    readCopy().catch(logFailure(entry, 'plan.md not read'));
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

  // A watch on each folder, the entry's open one where it has one, else a new
  // one that reads on a change or a missed burst and drops itself and lists
  // again when it fails, within the bound; when one throws, the ones it
  // opened are disposed. Keeping an open watch matters on macOS, where each
  // watch opening or closing tells every other watch it may have missed
  // changes.
  const watchCopyFolders = (
    sessionId: string,
    entry: Watched,
    folders: readonly string[],
  ): CopyWatch[] => {
    const kept: CopyWatch[] = [];
    const opened: CopyWatch[] = [];
    try {
      for (const folder of folders) {
        const held = entry.copyWatches.find((copyWatch) =>
          paths.samePath(copyWatch.folder, folder),
        );
        if (held !== undefined) {
          kept.push(held);
          continue;
        }
        const onChange = () => {
          heard(entry, folder);
          read(sessionId, entry);
        };
        const copyWatch: CopyWatch = {
          folder,
          watch: files.watch(folder, onChange, {
            recursive: false,
            onMissed: onChange,
            onError: (error) => {
              entry.copyWatches = entry.copyWatches.filter(
                (each) => each !== copyWatch,
              );
              if (
                isReopenedAfter(
                  entry,
                  folder,
                  'plan folder watch failed',
                  error,
                )
              ) {
                listAgain(sessionId, entry);
              }
            },
          }),
        };
        opened.push(copyWatch);
      }
    } catch (error) {
      for (const { watch } of opened) {
        watch.dispose();
      }
      throw error;
    }
    return [...kept, ...opened];
  };

  // Lists the copies again and moves the copy watches to them, keeping the
  // open watch of each folder still listed, then reads; a failure keeps the
  // copy watches it had. Reopens the git folder watch when it has none, else
  // syncs the `worktrees` watch with its folder.
  const listAgain = (sessionId: string, entry: Watched) => {
    if (entry.gitWatch === null || entry.commonDir === null) {
      watchGitFolder(sessionId, entry).catch(
        logFailure(entry, 'git folder not watched'),
      );
    } else {
      syncWorktreesWatch(sessionId, entry, entry.commonDir).catch(
        logFailure(entry, 'git worktrees folder not watched'),
      );
    }
    const isCurrent = startCall(sessionId, latestLists);
    const list = async () => {
      const copies = await listCopies(entry);
      const folders = await copyFolders(entry.planDir, copies);
      if (!isCurrent()) {
        return;
      }
      rememberMainCopy(entry, copies);
      const next = watchCopyFolders(sessionId, entry, folders);
      for (const copyWatch of entry.copyWatches) {
        if (!next.includes(copyWatch)) {
          copyWatch.watch.dispose();
        }
      }
      entry.copyWatches = next;
      read(sessionId, entry);
    };
    list().catch(logFailure(entry, 'plan copies not listed'));
  };

  // Keeps a watch on git's `worktrees` folder while it exists: its entries are
  // the linked worktrees, which a watch of git's folder may not hear change.
  // A watch that fails drops itself and lists again, within the bound, which
  // reopens it.
  const syncWorktreesWatch = async (
    sessionId: string,
    entry: Watched,
    commonDir: string,
  ) => {
    const isCurrent = startCall(sessionId, latestWorktreesSyncs);
    const worktrees = paths.join(commonDir, WORKTREES);
    const folder = await files.stat(worktrees);
    if (!isCurrent()) {
      return;
    }
    if (folder?.isFolder !== true) {
      entry.worktreesWatch?.dispose();
      entry.worktreesWatch = null;
      return;
    }
    if (entry.worktreesWatch !== null) {
      return;
    }
    const onChange = () => {
      heard(entry, worktrees);
      listAgain(sessionId, entry);
    };
    const watch = files.watch(worktrees, onChange, {
      recursive: false,
      onMissed: onChange,
      onError: (error) => {
        if (entry.worktreesWatch === watch) {
          entry.worktreesWatch = null;
        }
        if (
          isReopenedAfter(entry, worktrees, 'git worktrees watch failed', error)
        ) {
          listAgain(sessionId, entry);
        }
      },
    });
    entry.worktreesWatch = watch;
  };

  // Watches the git folder every checkout of the plan's clone shares, the
  // clone found from `planDir`, else from the folder the moved copy is listed
  // from; lists the copies again when its worktree list changes, then syncs
  // the `worktrees` watch; none outside a clone. A watch that fails drops
  // itself and lists again, within the bound, which reopens it.
  const watchGitFolder = async (sessionId: string, entry: Watched) => {
    const isCurrent = startCall(sessionId, latestGitWatches);
    const movedFrom = movedFromDir(entry);
    const top =
      (await repoTop(entry.planDir, copyDeps)) ??
      (movedFrom !== entry.planDir ? await repoTop(movedFrom, copyDeps) : null);
    if (top === null) {
      return;
    }
    const commonDir = await git.commonDir(top);
    const folder = await files.stat(commonDir);
    if (!isCurrent() || folder?.isFolder !== true) {
      return;
    }
    entry.gitWatch?.dispose();
    const watch = files.watch(
      commonDir,
      (changed) => {
        heard(entry, commonDir);
        if (changed === WORKTREES) {
          listAgain(sessionId, entry);
        }
      },
      {
        recursive: false,
        onMissed: () => {
          heard(entry, commonDir);
          listAgain(sessionId, entry);
        },
        onError: (error) => {
          if (entry.gitWatch === watch) {
            entry.gitWatch = null;
          }
          if (
            isReopenedAfter(entry, commonDir, 'git folder watch failed', error)
          ) {
            listAgain(sessionId, entry);
          }
        },
      },
    );
    entry.gitWatch = watch;
    entry.commonDir = commonDir;
    await syncWorktreesWatch(sessionId, entry, commonDir);
  };

  const open = (
    sessionId: string,
    planDir: string,
    { planReported, unreportedPlanDir }: FollowedPlan,
  ) => {
    close(sessionId);
    const entry: Watched = {
      planDir,
      reported: planReported,
      unreportedPlanDir,
      mainCopyDir: null,
      status: 'opening',
      copyWatches: [],
      commonDir: null,
      gitWatch: null,
      worktreesWatch: null,
      watchFailures: new Map(),
    };
    watched.set(sessionId, entry);
    const generation = generationOf(sessionId);
    const isCurrent = () => generationOf(sessionId) === generation;
    const startWatch = async () => {
      const copies = await listCopies(entry);
      const folders = await copyFolders(planDir, copies);
      if (!isCurrent()) {
        return;
      }
      rememberMainCopy(entry, copies);
      if (folders.length === 0) {
        signalGone(sessionId, entry);
        return;
      }
      entry.copyWatches = watchCopyFolders(sessionId, entry, folders);
      await watchGitFolder(sessionId, entry);
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
      logFailure(entry, 'plan watch not opened')(error);
    });
  };

  return {
    follow(sessionId, plan) {
      const { planDir, planReported, unreportedPlanDir } = plan;
      const current = watched.get(sessionId);
      const watchesItAlready =
        current !== undefined &&
        current.planDir === planDir &&
        current.status !== 'gone';
      if (watchesItAlready) {
        const reportChanged =
          current.reported !== planReported ||
          current.unreportedPlanDir !== unreportedPlanDir;
        if (reportChanged) {
          current.reported = planReported;
          current.unreportedPlanDir = unreportedPlanDir;
          read(sessionId, current);
        }
        return;
      }
      if (planDir === null) {
        close(sessionId);
        return;
      }
      open(sessionId, planDir, plan);
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
