import { describe, expect, it } from 'vitest';
import type { Clock } from '../../../contracts/ambient';
import type { DemoMainStep } from '../../../contracts/demo';
import type { SystemStats } from '../../../contracts/system-stats';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { fakeSystemSample } from '../../../shared/fake-system-stats';
import {
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { systemStatsSnapshotSlot } from '../contract';
import { systemStatsManifest } from '../manifest';
import { FIRST_GAP_MS } from './poller';
import { systemStatsMainPart } from './start';
import { statsFixture } from './stats-fixture';

// The fake machine's time between two steps.
const STEP_MS = 2000;
const REFRESH_MS = systemStatsManifest.settings.refreshSeconds * 1000;

// Each `sample` takes the next outcome: `good` is the fake machine's reading at the next step, an Error rejects.
// Past the queue every sample is good.
function queuedStats(outcomes: readonly ('good' | Error)[]) {
  const queue = [...outcomes];
  let step = 0;
  const stats = {
    calls: 0,
    sample() {
      stats.calls += 1;
      const outcome = queue.shift() ?? 'good';
      return outcome === 'good'
        ? Promise.resolve(fakeSystemSample(step++ * STEP_MS))
        : Promise.reject(outcome);
    },
  } satisfies SystemStats & { calls: number };
  return stats;
}

function startOnHarness(
  outcomes: readonly ('good' | Error)[] = [],
  clock?: Clock,
) {
  const stats = queuedStats(outcomes);
  const demoSteps = createDemoStepRegistry<DemoMainStep>();
  const harness = startMainPart(systemStatsMainPart, {
    drive: true,
    services: { systemStats: stats, demoSteps, ...(clock && { clock }) },
  });
  const slot = harness.state.read(systemStatsSnapshotSlot, 'test');
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const show = async (shown: boolean) => {
    harness.invoke('setShown', shown);
    await settle();
  };
  const advance = async (ms: number) => {
    harness.advance(ms);
    await settle();
  };
  const logged = (message: string) =>
    harness.logs.filter((line) => line.message === message).length;
  const enterDemoStep = () => {
    const step = demoSteps.list().find(({ id }) => id === 'system-stats.panel');
    if (step === undefined) {
      throw new Error('system-stats registered no system-stats.panel step');
    }
    return step.enter({
      scratchDir: '/scratch',
      launchSession: () => Promise.reject(new Error('no demo session')),
      processEvents: () => {
        throw new Error('no process events');
      },
    });
  };
  return { harness, stats, slot, show, advance, logged, enterDemoStep };
}

describe('systemStatsMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness, show } = startOnHarness();
    await show(true);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('setShown_PublishesFromTheSecondSample', async () => {
    const run = startOnHarness();

    await run.show(true);
    expect(run.slot.get()).toBeNull();
    await run.advance(FIRST_GAP_MS);

    expect(run.slot.get()?.rows.map(({ id }) => id)).toEqual([
      'pid:1',
      'app:Fake Browser.app',
      'app:node',
      'pid:4242',
      'other',
    ]);
  });

  it('rejectedSample_PublishesErrorAndLogsOnce', async () => {
    const failure = new Error('ps exited with code 1');
    const run = startOnHarness([failure, failure]);

    await run.show(true);
    await run.advance(REFRESH_MS);

    expect(run.stats.calls).toBe(2);
    expect(run.slot.get()?.error).toBe('ps exited with code 1');
    expect(run.logged('sample failed: ps exited with code 1')).toBe(1);
  });

  it('goodSampleBetween_LogsTheSameFailureAgain', async () => {
    const failure = new Error('ps exited with code 1');
    const run = startOnHarness([failure, 'good', 'good', failure]);

    await run.show(true);
    await run.advance(REFRESH_MS);
    await run.advance(FIRST_GAP_MS);
    await run.advance(REFRESH_MS);

    expect(run.stats.calls).toBe(4);
    expect(run.logged('sample failed: ps exited with code 1')).toBe(2);
  });

  it('rejectThenGood_ClearsTheError', async () => {
    const run = startOnHarness([new Error('ps exited with code 1'), 'good']);
    await run.show(true);
    expect(run.slot.get()?.error).toBe('ps exited with code 1');

    await run.advance(REFRESH_MS);

    expect(run.slot.get()?.error).toBeNull();
  });

  it('hideThenShow_StartsFromAFreshFirstSampleAndHistory', async () => {
    const run = startOnHarness();
    await run.show(true);
    await run.advance(FIRST_GAP_MS);
    await run.advance(REFRESH_MS);
    expect(run.slot.get()?.cpu.history).toHaveLength(2);

    await run.show(false);
    await run.show(true);
    expect(run.slot.get()).toBeNull();
    await run.advance(FIRST_GAP_MS);
    expect(run.slot.get()?.cpu.history).toHaveLength(1);

    const fixture = await run.harness.drive?.run('seed');
    await run.show(false);
    await run.show(true);
    expect(run.slot.get()).toEqual(fixture);
  });

  it('elapsedZero_PublishesNothing', async () => {
    const clock = { at: 5_000, now: () => clock.at };
    const run = startOnHarness([], clock);
    await run.show(true);

    await run.advance(FIRST_GAP_MS);
    expect(run.slot.get()).toBeNull();

    // The third sample compares with the first: the browser's two processes grew 3600 ms of CPU time per step,
    // so two steps over 2000 ms on 8 cores is 45%, where one step would be 22.5%.
    clock.at = 7_000;
    await run.advance(REFRESH_MS);
    const browser = run.slot
      .get()
      ?.rows.find(({ id }) => id === 'app:Fake Browser.app');
    expect(browser?.cpuPercent).toBe(45);
  });

  it('settingsChange_RearmsTheWaitingTimer', async () => {
    const run = startOnHarness();
    await run.show(true);
    await run.advance(FIRST_GAP_MS);
    await run.advance(500);
    const calls = run.stats.calls;

    run.harness.pushSettings({
      ...systemStatsManifest.settings,
      refreshSeconds: 5,
    });
    await run.advance(4_999);
    expect(run.stats.calls).toBe(calls);
    await run.advance(1);

    expect(run.stats.calls).toBe(calls + 1);
  });

  it('settingsChange_KeepsTheHistory', async () => {
    const run = startOnHarness();
    await run.show(true);
    await run.advance(FIRST_GAP_MS);
    await run.advance(REFRESH_MS);
    const before = run.slot.get()?.cpu.history ?? [];

    run.harness.pushSettings({
      ...systemStatsManifest.settings,
      processRows: 25,
    });
    await run.advance(REFRESH_MS);

    expect(run.slot.get()?.cpu.history.slice(0, -1)).toEqual(before);
    expect(before).toHaveLength(2);
  });

  it('setShownTwice_LogsStartedOnce', async () => {
    const run = startOnHarness();

    await run.show(true);
    await run.show(true);

    expect(run.logged('sampling started')).toBe(1);
  });

  it('seed_WritesFixtureAndStopsSampling', async () => {
    const run = startOnHarness();

    await run.harness.drive?.run('seed');
    await run.show(true);
    await run.show(true);

    expect(run.slot.get()).toEqual(statsFixture('busy', 0));
    expect(run.harness.sent).toEqual([{ message: 'seeded', data: 'busy' }]);
    expect(run.stats.calls).toBe(0);
    expect(run.logged('sampling stopped by a seed')).toBe(1);
  });

  it('demoStep_HoldsTheFixtureOverSamples_AndLeavingSamplesAgain', async () => {
    const run = startOnHarness();
    await run.show(true);
    // The harness clock starts at 0 and nothing has advanced it before the enter.
    const stage = await run.enterDemoStep();

    await run.advance(FIRST_GAP_MS);
    await run.advance(REFRESH_MS);
    expect(run.slot.get()).toEqual(statsFixture('busy', 0));

    stage.dispose();
    expect(run.slot.get()).toBeNull();
    await run.advance(REFRESH_MS);
    await run.advance(REFRESH_MS);

    expect(run.slot.get()?.rows.map(({ id }) => id)).toEqual([
      'pid:1',
      'app:Fake Browser.app',
      'app:node',
      'pid:4242',
      'other',
    ]);
  });
});
