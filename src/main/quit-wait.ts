import type { Timers } from '../contracts/ambient';
import type { Log } from '../contracts/log';
import type { RunMode } from '../contracts/plugin';

// How long a quit runs before it logs the parts it is still waiting on.
export const QUIT_WAIT_LOG_MS = 5000;

// What a will-quit does: the first quit starts the quit work in every mode; a
// second quit during the hold exits a drive run, whose SIGTERM must end it, and
// is held by the live app, so a stop still running keeps its save.
export function quitStep(
  runMode: RunMode,
  quitStarted: boolean,
): 'start' | 'exit' | 'hold' {
  if (!quitStarted) {
    return 'start';
  }
  return runMode === 'drive' ? 'exit' : 'hold';
}

// Logs `quit is waiting on <ids>` under source `quit`, once, when `work` has not settled after
// QUIT_WAIT_LOG_MS and `stopping()` names a part. Clears its timer when `work` settles first.
export function logSlowQuit(
  work: Promise<unknown>,
  stopping: () => readonly string[],
  timers: Timers,
  log: Log,
): void {
  const handle = timers.set(() => {
    const ids = stopping();
    if (ids.length > 0) {
      log('quit', `quit is waiting on ${ids.join(', ')}`);
    }
  }, QUIT_WAIT_LOG_MS);
  const clearTimer = () => timers.clear(handle);
  void work.then(clearTimer, clearTimer);
}
