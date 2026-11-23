import type { Timers } from '../../../contracts/ambient';
import { errorText } from '../../../shared/error-text';

// The wait between two polls of a backend while Builds mode shows or a linked build runs, and otherwise.
export const FAST_POLL_MS = 10_000;
export const SLOW_POLL_MS = 120_000;

// `poll` polls one backend; `isFast` is read at each arming; `log` hears a poll's rejection.
export interface BuildsPollerDeps {
  timers: Timers;
  poll(backendId: string): Promise<void>;
  isFast(backendId: string): boolean;
  log(message: string): void;
}

// Polls each listed backend, never two polls of one backend at once, arming its next poll as each one settles.
// `setBackends` lists the backends to poll: a new id, or a listed one in `replaced`, polls at once; another listed id
// keeps its timer; an id left out is no longer polled, and its running poll arms nothing. `pollNow` polls a listed id
// at once, or marks one more poll after its running one. `reschedule` polls at once each id whose slow wait is now
// fast. After `dispose`, nothing polls.
export interface BuildsPoller {
  setBackends(ids: readonly string[], replaced: readonly string[]): void;
  pollNow(id: string): void;
  reschedule(): void;
  dispose(): void;
}

export function createBuildsPoller(deps: BuildsPollerDeps): BuildsPoller {
  const listed = new Set<string>();
  const waits = new Map<string, { handle: number; isFast: boolean }>();
  const running = new Set<string>();
  // Ids whose `pollNow` came while their poll ran.
  const oneMore = new Set<string>();
  let isDisposed = false;

  function clearWait(id: string) {
    const wait = waits.get(id);
    if (wait !== undefined) {
      deps.timers.clear(wait.handle);
      waits.delete(id);
    }
  }

  function arm(id: string) {
    const isFast = deps.isFast(id);
    const handle = deps.timers.set(
      () => {
        waits.delete(id);
        start(id);
      },
      isFast ? FAST_POLL_MS : SLOW_POLL_MS,
    );
    waits.set(id, { handle, isFast });
  }

  function start(id: string) {
    if (running.has(id)) {
      oneMore.add(id);
      return;
    }
    clearWait(id);
    running.add(id);
    void pollAndArm(id);
  }

  async function pollAndArm(id: string): Promise<void> {
    try {
      await deps.poll(id);
    } catch (error) {
      deps.log(`poll handling failed: ${errorText(error)}`);
    }
    running.delete(id);
    const wantsOneMore = oneMore.delete(id);
    if (isDisposed || !listed.has(id)) {
      return;
    }
    if (wantsOneMore) {
      start(id);
    } else {
      arm(id);
    }
  }

  return {
    setBackends(ids, replaced) {
      if (isDisposed) {
        return;
      }
      const next = new Set(ids);
      for (const id of [...listed]) {
        if (!next.has(id)) {
          listed.delete(id);
          oneMore.delete(id);
          clearWait(id);
        }
      }
      for (const id of next) {
        const isNew = !listed.has(id);
        listed.add(id);
        if (isNew || replaced.includes(id)) {
          start(id);
        }
      }
    },
    pollNow(id) {
      if (!isDisposed && listed.has(id)) {
        start(id);
      }
    },
    reschedule() {
      for (const [id, wait] of [...waits]) {
        if (!wait.isFast && deps.isFast(id)) {
          start(id);
        }
      }
    },
    dispose() {
      isDisposed = true;
      listed.clear();
      oneMore.clear();
      for (const id of [...waits.keys()]) {
        clearWait(id);
      }
    },
  };
}
