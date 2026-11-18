import type { Timers } from '../contracts/ambient';

// Timers that run only when the test fires them, handles numbered from 1.
// `armed` holds each pending timer's run and delay by handle; `clear` removes
// it from `armed` and records the handle in `cleared`.
export function fakeTimers(): {
  timers: Timers;
  armed: Map<number, { run: () => void; ms: number }>;
  cleared: number[];
  fireAll(): void;
  runAfter(ms: number): void;
} {
  let nextHandle = 1;
  const armed = new Map<number, { run: () => void; ms: number }>();
  const cleared: number[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      armed.set(nextHandle, { run, ms });
      return nextHandle++;
    },
    clear: (handle) => {
      cleared.push(handle);
      armed.delete(handle);
    },
  };
  // Runs every armed timer once, emptying `armed` first, so a timer set while
  // they run waits for the next call.
  const fireAll = () => {
    const runs = [...armed.values()];
    armed.clear();
    for (const { run } of runs) {
      run();
    }
  };
  // Runs and removes each armed timer set for exactly `ms`, none set while
  // they run.
  const runAfter = (ms: number) => {
    const due = [...armed].filter(([, timer]) => timer.ms === ms);
    for (const [handle, timer] of due) {
      armed.delete(handle);
      timer.run();
    }
  };
  return { timers, armed, cleared, fireAll, runAfter };
}
