import type { Timers } from '../contracts/ambient';
import type { Registrations } from '../contracts/disposable';

// setTimeout fires at once for a delay above a signed 32-bit millisecond count.
export const MAX_TIMER_MS = 2 ** 31 - 1;

// One plugin's view of `timers`: `registrations` disposing it clears the timers
// still pending, and a timer set after that never runs. A delay past the limit
// waits the longest delay a timer takes.
export function trackedTimers(
  timers: Timers,
  registrations: Registrations,
): Timers {
  const pending = new Set<number>();
  let isDisposed = false;
  registrations.track({
    dispose() {
      isDisposed = true;
      for (const handle of pending) {
        timers.clear(handle);
      }
      pending.clear();
    },
  });
  return {
    set(run, ms) {
      const handle = timers.set(
        () => {
          if (pending.delete(handle)) {
            run();
          }
        },
        Math.min(ms, MAX_TIMER_MS),
      );
      if (isDisposed) {
        timers.clear(handle);
      } else {
        pending.add(handle);
      }
      return handle;
    },
    clear(handle) {
      pending.delete(handle);
      timers.clear(handle);
    },
  };
}
