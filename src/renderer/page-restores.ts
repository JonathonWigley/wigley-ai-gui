import type { PageRestores } from '../contracts/plugin';

// The page load's one `PageRestores`. The composition root calls `pageReady`
// once `core.pageReady` has been emitted, after which the restores settle as
// soon as no tracked restore is pending.
export interface PageRestoresHost extends PageRestores {
  pageReady(): void;
}

export function createPageRestores(): PageRestoresHost {
  let isPageReady = false;
  let isSettled = false;
  let pending = 0;
  const listeners = new Set<() => void>();
  const settleWhenIdle = () => {
    if (!isPageReady || pending > 0 || isSettled) {
      return;
    }
    isSettled = true;
    const settledListeners = [...listeners];
    listeners.clear();
    for (const listener of settledListeners) {
      listener();
    }
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
    pageReady() {
      isPageReady = true;
      settleWhenIdle();
    },
  };
}
