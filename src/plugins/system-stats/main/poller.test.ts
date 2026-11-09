import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { SystemSample } from '../../../contracts/system-stats';
import { fakeSystemSample } from '../../../shared/fake-system-stats';
import { createStatsPoller, FIRST_GAP_MS } from './poller';

// A poller over a recording fake `Timers`, a settable clock and a `sample` whose promises the test settles in
// call order through `resolveNext` and `rejectNext`.
function setup(refreshSeconds = 3) {
  let nextHandle = 1;
  const armed = new Map<number, { run: () => void; ms: number; at: number }>();
  const clock = { at: 0, now: () => clock.at };
  const timers: Timers = {
    set: (run, ms) => {
      const handle = nextHandle++;
      armed.set(handle, { run, ms, at: clock.at });
      return handle;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  const settings = { refreshSeconds };
  const pending: {
    resolve(sample: SystemSample): void;
    reject(reason: unknown): void;
  }[] = [];
  let calls = 0;
  const sampled: number[] = [];
  const failed: unknown[] = [];
  const logs: string[] = [];
  const handlers = { throws: false };
  const poller = createStatsPoller({
    timers,
    clock,
    sample: () => {
      calls += 1;
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    refreshSeconds: () => settings.refreshSeconds,
    sampled: (_sample, at) => {
      sampled.push(at);
      if (handlers.throws) {
        throw new Error('bad snapshot');
      }
    },
    failed: (error) => failed.push(error),
    log: (message) => logs.push(message),
  });
  const flush = () => new Promise((settle) => setImmediate(settle));
  const resolveNext = async () => {
    pending.shift()?.resolve(fakeSystemSample(clock.at));
    await flush();
  };
  const rejectNext = async (reason: unknown) => {
    pending.shift()?.reject(reason);
    await flush();
  };
  const armedMs = () => [...armed.values()].map((timer) => timer.ms);
  const fire = () => {
    const due = [...armed.values()];
    armed.clear();
    for (const timer of due) {
      timer.run();
    }
  };
  return {
    poller,
    clock,
    settings,
    calls: () => calls,
    sampled,
    failed,
    logs,
    handlers,
    armed,
    armedMs,
    fire,
    resolveNext,
    rejectNext,
  };
}

describe('createStatsPoller', () => {
  it.each([
    { refreshSeconds: 3, intervalMs: 3000 },
    { refreshSeconds: 0.2, intervalMs: 1000 },
    { refreshSeconds: Number.NaN, intervalMs: 2000 },
  ])(
    'setShown_SamplesAtOnceThenFirstGapThenInterval: $refreshSeconds s',
    async ({ refreshSeconds, intervalMs }) => {
      const run = setup(refreshSeconds);
      const waits: number[][] = [];

      run.poller.setShown(true);
      expect(run.calls()).toBe(1);
      await run.resolveNext();
      waits.push(run.armedMs());
      run.fire();
      await run.resolveNext();
      waits.push(run.armedMs());
      run.fire();
      await run.resolveNext();
      waits.push(run.armedMs());

      expect(run.calls()).toBe(3);
      expect(waits).toEqual([[FIRST_GAP_MS], [intervalMs], [intervalMs]]);
    },
  );

  it('setShown_True_WhileShownDoesNothing', async () => {
    const run = setup();
    run.poller.setShown(true);
    await run.resolveNext();

    run.poller.setShown(true);

    expect(run.calls()).toBe(1);
    expect(run.armedMs()).toEqual([FIRST_GAP_MS]);
  });

  it('showDuringDroppedSample_WaitsThenSamples', async () => {
    const run = setup();
    run.poller.setShown(true);
    run.poller.setShown(false);

    run.poller.setShown(true);
    expect(run.calls()).toBe(1);
    await run.resolveNext();

    expect(run.calls()).toBe(2);
    expect(run.sampled).toEqual([]);
    expect(run.armedMs()).toEqual([]);
  });

  it('throwingHandler_KeepsPolling', async () => {
    const run = setup();
    run.handlers.throws = true;
    run.poller.setShown(true);

    await run.resolveNext();

    expect(run.armedMs()).toEqual([FIRST_GAP_MS]);
    expect(run.logs).toEqual(['sample handling failed: bad snapshot']);
  });

  it('setShown_False_ClearsTimerAndDropsInFlight', async () => {
    const run = setup();
    run.poller.setShown(true);
    await run.resolveNext();
    run.fire();

    run.poller.setShown(false);
    await run.resolveNext();

    expect(run.armedMs()).toEqual([]);
    expect(run.sampled).toEqual([0]);
    expect(run.failed).toEqual([]);
  });

  it.each([
    { case: 'before a good sample', goodSamples: 0 },
    { case: 'after the first good sample', goodSamples: 1 },
  ])(
    'rejectedSample_ReportsAndWaitsTheInterval: $case',
    async ({ goodSamples }) => {
      const run = setup(3);
      const reason = new Error('ps exited with code 1');
      run.poller.setShown(true);
      if (goodSamples === 1) {
        await run.resolveNext();
        run.fire();
      }

      await run.rejectNext(reason);

      expect(run.failed).toEqual([reason]);
      expect(run.armedMs()).toEqual([3000]);
    },
  );

  it('dispose_ClearsTimerAndStopsSampling', async () => {
    const run = setup();
    run.poller.setShown(true);
    await run.resolveNext();

    run.poller.dispose();
    run.poller.setShown(false);
    run.poller.setShown(true);

    expect(run.armedMs()).toEqual([]);
    expect(run.calls()).toBe(1);
  });

  it.each([
    { case: 'interval wait', goodSamples: 2, armedAt: 1500, ms: 5000 },
    { case: 'first-gap wait', goodSamples: 1, armedAt: 0, ms: FIRST_GAP_MS },
  ])(
    'reschedule_MovesTheWaitingTimer: $case',
    async ({ goodSamples, armedAt, ms }) => {
      const run = setup(3);
      run.poller.setShown(true);
      await run.resolveNext();
      if (goodSamples === 2) {
        run.fire();
        await run.resolveNext();
      }
      run.clock.at = 1500;

      run.settings.refreshSeconds = 5;
      run.poller.reschedule();

      expect(
        [...run.armed.values()].map((timer) => ({
          at: timer.at,
          ms: timer.ms,
        })),
      ).toEqual([{ at: armedAt, ms }]);
    },
  );
});
