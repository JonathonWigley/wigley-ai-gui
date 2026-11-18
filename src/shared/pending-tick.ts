import type { Timers } from '../contracts/ambient';

export interface PendingTick {
  setNeeded(isNeeded: boolean): void;
}

// One pending one-shot of `run` after `ms`, kept while needed:
// `setNeeded(true)` sets it when none is pending, `setNeeded(false)` clears a
// pending one. The handle is dropped before `run`, so `run` may ask for the
// next tick.
export function createPendingTick(
  timers: Timers,
  ms: number,
  run: () => void,
): PendingTick {
  let pending: number | null = null;
  const fire = () => {
    pending = null;
    run();
  };
  return {
    setNeeded(isNeeded) {
      if (isNeeded && pending === null) {
        pending = timers.set(fire, ms);
      } else if (!isNeeded && pending !== null) {
        timers.clear(pending);
        pending = null;
      }
    },
  };
}
