// What a drive run leaves behind: `quit` deletes a run's scratch folders and
// keeps its captures, and every `start` deletes the run folders gone idle.

// The run folder's entries `quit` deletes: the app's home, which holds the
// fixtures' test repos, and Chromium's profile. Captures and `app.log` stay.
export const QUIT_REMOVED_ENTRIES: readonly string[] = ['home', 'user-data'];

// How long a run folder may go untouched before a `start` deletes it.
export const RUN_IDLE_MS = 24 * 60 * 60 * 1000;

export interface RunFolder {
  id: string;
  // The newest modification time of the folder or any entry directly in it.
  lastUsedMs: number;
  // Whether an app process the run recorded is still running.
  isLive: boolean;
}

// The ids of `runs` a start of `startingRun` deletes: each other run with no
// live app, untouched for longer than `RUN_IDLE_MS`.
export function idleRunIds(
  runs: readonly RunFolder[],
  startingRun: string,
  nowMs: number,
): string[] {
  return runs
    .filter((run) => {
      const isIdle = nowMs - run.lastUsedMs > RUN_IDLE_MS;
      return run.id !== startingRun && !run.isLive && isIdle;
    })
    .map((run) => run.id);
}
