import type { Clock, Timers } from '../../../contracts/ambient';

// The shortest interval between sweeps, for any non-zero `intervalMinutes`.
export const MIN_SWEEP_MINUTES = 1;

const MINUTE_MS = 60_000;

export interface SweepTimerDeps {
  timers: Timers;
  clock: Clock;
  intervalMinutes(): number; // work.intervalMinutes, read at each arming
  sweep(): void; // queues a sweep
}

// - `sweepEnded` records the end and arms one timer for the interval, replacing any armed one; nothing is armed
//   before the first end. An interval of 0 arms nothing; one above 0 and below `MIN_SWEEP_MINUTES` counts as
//   `MIN_SWEEP_MINUTES`. The timer's fire calls `sweep` and arms nothing.
// - `reschedule`, after an `intervalMinutes` change: clears the timer at 0; does nothing before the first end; sweeps
//   at once when the last end plus the interval has passed; else arms for the time left.
// - `dispose` clears the timer, and every later call does nothing.
export interface SweepTimer {
  sweepEnded(): void;
  reschedule(): void;
  dispose(): void;
}

// Sweeps every `intervalMinutes` counted from each sweep's end, so a slow sweep never stacks the next one behind it.
export function createSweepTimer(deps: SweepTimerDeps): SweepTimer {
  let timer: number | null = null;
  let lastEndAt: number | null = null;
  let isDisposed = false;

  // The interval in ms, null for never.
  const intervalMs = (): number | null => {
    const minutes = deps.intervalMinutes();
    if (minutes <= 0) {
      return null;
    }
    return Math.max(minutes, MIN_SWEEP_MINUTES) * MINUTE_MS;
  };

  const clearTimer = () => {
    if (timer !== null) {
      deps.timers.clear(timer);
      timer = null;
    }
  };

  const arm = (ms: number) => {
    clearTimer();
    timer = deps.timers.set(() => {
      timer = null;
      deps.sweep();
    }, ms);
  };

  return {
    sweepEnded() {
      if (isDisposed) {
        return;
      }
      lastEndAt = deps.clock.now();
      const ms = intervalMs();
      if (ms === null) {
        clearTimer();
        return;
      }
      arm(ms);
    },
    reschedule() {
      if (isDisposed) {
        return;
      }
      const ms = intervalMs();
      if (ms === null) {
        clearTimer();
        return;
      }
      if (lastEndAt === null) {
        return;
      }
      const dueAt = lastEndAt + ms;
      const now = deps.clock.now();
      if (dueAt <= now) {
        clearTimer();
        deps.sweep();
        return;
      }
      arm(dueAt - now);
    },
    dispose() {
      isDisposed = true;
      clearTimer();
    },
  };
}
