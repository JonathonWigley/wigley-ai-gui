import { describe, expect, it } from 'vitest';
import type { Timers } from '../contracts/ambient';
import { createRegistrations } from './registrations';
import { trackedTimers } from './tracked-timers';

// Timers numbering their handles from 1. `fire` runs one timer's run, and
// `fireAll` every timer's, cleared or not, as a clear that came too late would.
function fakeTimers() {
  const runs = new Map<number, () => void>();
  const cleared: number[] = [];
  const timers: Timers = {
    set(run) {
      const handle = runs.size + 1;
      runs.set(handle, run);
      return handle;
    },
    clear: (handle) => cleared.push(handle),
  };
  return {
    timers,
    cleared,
    fire: (handle: number) => runs.get(handle)?.(),
    fireAll: () => runs.forEach((run) => run()),
  };
}

describe('trackedTimers', () => {
  it('clears only the timers still pending when its registrations are disposed', () => {
    const { timers, cleared, fire } = fakeTimers();
    const registrations = createRegistrations();
    const tracked = trackedTimers(timers, registrations);
    const ran: number[] = [];
    tracked.set(() => ran.push(1), 10);
    const second = tracked.set(() => ran.push(2), 10);
    tracked.set(() => ran.push(3), 10);

    fire(1);
    tracked.clear(second);
    registrations.dispose();

    expect(ran).toEqual([1]);
    expect(cleared).toEqual([2, 3]);
  });

  it('runs nothing set after its registrations are disposed', () => {
    const { timers, fireAll } = fakeTimers();
    const registrations = createRegistrations();
    const tracked = trackedTimers(timers, registrations);
    registrations.dispose();
    const ran: string[] = [];

    tracked.set(() => ran.push('late'), 10);
    fireAll();

    expect(ran).toEqual([]);
  });
});
