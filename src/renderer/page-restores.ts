import type { Timers } from '../contracts/ambient';
import type { PageRestores } from '../contracts/plugin';

// The latest the restores settle after every part's `ready()` ran: well past a
// docs index rebuild, which can take seconds.
export const RESTORES_CAP_MS = 30_000;

export interface PageRestoresDeps {
  timers: Timers;
  log(message: string): void;
}

// The page load's one `PageRestores`. The composition root calls `partsReady`
// once every part's `ready()` ran, after which the restores settle as
// soon as no tracked restore is pending, or at `RESTORES_CAP_MS` after it,
// logging the count still pending.
export interface PageRestoresHost extends PageRestores {
  partsReady(): void;
}

export function createPageRestores(deps: PageRestoresDeps): PageRestoresHost {
  let arePartsReady = false;
  let isSettled = false;
  let pending = 0;
  let cap: number | null = null;
  const listeners = new Set<() => void>();
  const settle = () => {
    isSettled = true;
    if (cap !== null) {
      deps.timers.clear(cap);
      cap = null;
    }
    const settledListeners = [...listeners];
    listeners.clear();
    for (const listener of settledListeners) {
      listener();
    }
  };
  const settleWhenIdle = () => {
    if (arePartsReady && pending === 0 && !isSettled) {
      settle();
    }
  };
  const settleAtCap = () => {
    cap = null;
    deps.log(
      `restores settled at the ${RESTORES_CAP_MS} ms cap, ${pending} still pending`,
    );
    settle();
  };
  return {
    track(restore) {
      if (isSettled) {
        return;
      }
      pending += 1;
      const restoreSettled = () => {
        pending -= 1;
        settleWhenIdle();
      };
      restore.then(restoreSettled, restoreSettled);
    },
    onSettled(listener) {
      if (isSettled) {
        listener();
        return { dispose() {} };
      }
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    partsReady() {
      arePartsReady = true;
      settleWhenIdle();
      if (!isSettled) {
        cap = deps.timers.set(settleAtCap, RESTORES_CAP_MS);
      }
    },
  };
}
