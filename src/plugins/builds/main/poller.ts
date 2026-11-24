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

// Polls each listed backend, arming its next poll as each one settles. `setBackends` lists the backends to poll: a new
// id, or a listed one in `replaced`, polls at once, even while a poll of it runs, and that running poll then arms
// nothing; another listed id keeps its timer; an id left out is no longer polled, and its running poll arms nothing.
// Otherwise one backend never has two polls at once: `pollNow` polls a listed id at once, or marks one more poll after
// its running one. `reschedule` polls at once each id whose slow wait is now fast. After `dispose`, nothing polls.
export interface BuildsPoller {
  setBackends(ids: readonly string[], replaced: readonly string[]): void;
  pollNow(id: string): void;
  reschedule(): void;
  dispose(): void;
}

export function createBuildsPoller(deps: BuildsPollerDeps): BuildsPoller {
  const listed = new Set<string>();
  const waits = new Map<string, { handle: number; isFast: boolean }>();
  // By id, the token of its running poll; a poll whose token is no longer here arms nothing.
  const running = new Map<string, symbol>();
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
    startFresh(id);
  }

  // Starts a poll of `id` with a token of its own, so a poll of it still running arms nothing.
  function startFresh(id: string) {
    clearWait(id);
    oneMore.delete(id);
    const token = Symbol(id);
    running.set(id, token);
    void pollAndArm(id, token);
  }

  async function pollAndArm(id: string, token: symbol): Promise<void> {
    try {
      await deps.poll(id);
    } catch (error) {
      deps.log(`poll handling failed: ${errorText(error)}`);
    }
    if (running.get(id) !== token) {
      return;
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
      for (const id of listed) {
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
          startFresh(id);
        }
      }
    },
    pollNow(id) {
      if (!isDisposed && listed.has(id)) {
        start(id);
      }
    },
    reschedule() {
      for (const [id, wait] of waits) {
        if (!wait.isFast && deps.isFast(id)) {
          start(id);
        }
      }
    },
    dispose() {
      isDisposed = true;
      listed.clear();
      oneMore.clear();
      for (const id of waits.keys()) {
        clearWait(id);
      }
    },
  };
}
