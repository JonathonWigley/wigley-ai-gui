import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import { createSweepTimer, MIN_SWEEP_MINUTES } from './sweep-timer';

const MINUTE_MS = 60_000;

// A sweep timer over a recording fake `Timers`, a settable clock and a settable interval.
function setup(intervalMinutes = 10) {
  let nextHandle = 1;
  const armed = new Map<number, { run: () => void; ms: number }>();
  const timers: Timers = {
    set: (run, ms) => {
      const handle = nextHandle++;
      armed.set(handle, { run, ms });
      return handle;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  const clock = { at: 1_000_000, now: () => clock.at };
  const settings = { intervalMinutes };
  let sweeps = 0;
  const timer = createSweepTimer({
    timers,
    clock,
    intervalMinutes: () => settings.intervalMinutes,
    sweep: () => {
      sweeps += 1;
    },
  });
  const armedMs = () => [...armed.values()].map((entry) => entry.ms);
  const fire = () => {
    const due = [...armed.values()];
    armed.clear();
    for (const entry of due) {
      entry.run();
    }
  };
  return {
    timer,
    clock,
    settings,
    armedMs,
    fire,
    sweeps: () => sweeps,
  };
}

describe('createSweepTimer', () => {
  it.each([
    { case: 'Interval', minutes: 10, expectedMs: [10 * MINUTE_MS] },
    { case: 'Zero', minutes: 0, expectedMs: [] },
    {
      case: 'BelowMinimum',
      minutes: 0.2,
      expectedMs: [MIN_SWEEP_MINUTES * MINUTE_MS],
    },
  ])('sweepTimer_SweepEnded_$case', ({ minutes, expectedMs }) => {
    const run = setup(minutes);

    run.timer.sweepEnded();

    expect(run.armedMs()).toEqual(expectedMs);
  });

  it('sweepTimer_Fire_SweepsOnceAndArmsNothing', () => {
    const run = setup(10);
    run.timer.sweepEnded();

    run.fire();

    expect(run.sweeps()).toBe(1);
    expect(run.armedMs()).toEqual([]);
  });

  it('sweepTimer_SweepEndedTwice_KeepsOneTimer', () => {
    const run = setup(10);
    run.timer.sweepEnded();
    run.clock.at += 3 * MINUTE_MS;

    run.timer.sweepEnded();

    expect(run.armedMs()).toEqual([10 * MINUTE_MS]);
  });

  it.each([
    {
      case: 'LongerInterval',
      minutes: 30,
      expectedSweeps: 0,
      expectedMs: [26 * MINUTE_MS],
    },
    { case: 'PastDue', minutes: 3, expectedSweeps: 1, expectedMs: [] },
    { case: 'ToZero', minutes: 0, expectedSweeps: 0, expectedMs: [] },
  ])(
    'sweepTimer_Reschedule_$case',
    ({ minutes, expectedSweeps, expectedMs }) => {
      const run = setup(10);
      run.timer.sweepEnded();
      run.clock.at += 4 * MINUTE_MS;

      run.settings.intervalMinutes = minutes;
      run.timer.reschedule();

      expect(run.sweeps()).toBe(expectedSweeps);
      expect(run.armedMs()).toEqual(expectedMs);
    },
  );

  it('sweepTimer_RescheduleBeforeAnySweepEnded_DoesNothing', () => {
    const run = setup(10);

    run.settings.intervalMinutes = 5;
    run.timer.reschedule();

    expect(run.sweeps()).toBe(0);
    expect(run.armedMs()).toEqual([]);
  });

  it('sweepTimer_Dispose_ClearsAndLaterCallsDoNothing', () => {
    const run = setup(10);
    run.timer.sweepEnded();

    run.timer.dispose();
    run.timer.sweepEnded();
    run.clock.at += 20 * MINUTE_MS;
    run.timer.reschedule();

    expect(run.armedMs()).toEqual([]);
    expect(run.sweeps()).toBe(0);
  });
});
