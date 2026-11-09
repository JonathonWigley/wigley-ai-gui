import type { Timers } from '../contracts/ambient';
import type { PageRestores } from '../contracts/plugin';

// The latest a restore window settles after every part's `ready()` ran: well
// past a docs index rebuild, which can take seconds.
export const RESTORES_CAP_MS = 30_000;

export interface PageRestoresDeps {
  timers: Timers;
  log(message: string): void;
}

// The one host of the page's restore windows, created with the page load's
// window open. `reopen` opens the window of a live start: a new one once the
// last settled, else the open window again, its parts not ready and its cap
// cleared. The composition root and the `start` answer call `partsReady` once
// every part they started ran `ready()`, after which the window settles as
// soon as none of its tracked restores is pending, or at `RESTORES_CAP_MS`
// after it, logging the count still pending. Each window logs
// `restores settled` as it settles.
export interface PageRestoresHost extends PageRestores {
  reopen(): void;
  partsReady(): void;
}

interface RestoreWindow {
  arePartsReady: boolean;
  isSettled: boolean;
  pending: number;
  cap: number | null;
  listeners: Set<() => void>;
}

const openWindow = (): RestoreWindow => ({
  arePartsReady: false,
  isSettled: false,
  pending: 0,
  cap: null,
  listeners: new Set(),
});

export function createPageRestores(deps: PageRestoresDeps): PageRestoresHost {
  let current = openWindow();
  const clearCap = (restoreWindow: RestoreWindow) => {
    if (restoreWindow.cap !== null) {
      deps.timers.clear(restoreWindow.cap);
      restoreWindow.cap = null;
    }
  };
  const settle = (restoreWindow: RestoreWindow) => {
    restoreWindow.isSettled = true;
    clearCap(restoreWindow);
    deps.log('restores settled');
    const settledListeners = [...restoreWindow.listeners];
    restoreWindow.listeners.clear();
    for (const listener of settledListeners) {
      listener();
    }
  };
  const settleWhenIdle = (restoreWindow: RestoreWindow) => {
    if (
      restoreWindow.arePartsReady &&
      restoreWindow.pending === 0 &&
      !restoreWindow.isSettled
    ) {
      settle(restoreWindow);
    }
  };
  const settleAtCap = (restoreWindow: RestoreWindow) => {
    restoreWindow.cap = null;
    deps.log(
      `restores settled at the ${RESTORES_CAP_MS} ms cap, ${restoreWindow.pending} still pending`,
    );
    settle(restoreWindow);
  };
  return {
    track(restore) {
      const restoreWindow = current;
      if (restoreWindow.isSettled) {
        return;
      }
      restoreWindow.pending += 1;
      const restoreSettled = () => {
        restoreWindow.pending -= 1;
        settleWhenIdle(restoreWindow);
      };
      restore.then(restoreSettled, restoreSettled);
    },
    onSettled(listener) {
      const restoreWindow = current;
      if (restoreWindow.isSettled) {
        listener();
        return { dispose() {} };
      }
      restoreWindow.listeners.add(listener);
      return { dispose: () => restoreWindow.listeners.delete(listener) };
    },
    reopen() {
      if (current.isSettled) {
        current = openWindow();
        return;
      }
      current.arePartsReady = false;
      clearCap(current);
    },
    partsReady() {
      const restoreWindow = current;
      restoreWindow.arePartsReady = true;
      settleWhenIdle(restoreWindow);
      if (!restoreWindow.isSettled) {
        restoreWindow.cap = deps.timers.set(
          () => settleAtCap(restoreWindow),
          RESTORES_CAP_MS,
        );
      }
    },
  };
}
