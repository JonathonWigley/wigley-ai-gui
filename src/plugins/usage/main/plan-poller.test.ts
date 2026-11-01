import { describe, expect, it } from 'vitest';
import type { PlanUsage } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import type { ChatProfile } from '../../chat/contract';
import { createPlanPoller, MIN_POLL_SECONDS } from './plan-poller';
import type { PollResult } from './usage-store';

const DEFAULT: ChatProfile = { name: 'default', configDir: '~/.claude' };
const PERSONAL: ChatProfile = {
  name: 'personal',
  configDir: '~/.claude-personal',
};

function usageAt(at: number): PlanUsage {
  return { rows: [], extraUsage: null, at };
}

// A poller over a recording fake `Timers`, a settable clock and a
// `planUsage` whose promises the test settles through `pending`.
function setup(intervalSeconds = 300) {
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
  const clock = { at: 0, now: () => clock.at };
  const settings = { intervalSeconds };
  const calls: (string | null)[] = [];
  const pending = new Map<
    string | null,
    { resolve(usage: PlanUsage): void; reject(reason: unknown): void }
  >();
  const reports: { profile: string; result: PollResult }[] = [];
  const rounds: string[][] = [];
  const poller = createPlanPoller({
    timers,
    clock,
    profiles: () => [DEFAULT, PERSONAL],
    intervalSeconds: () => settings.intervalSeconds,
    planUsage: (profileDir) => {
      calls.push(profileDir);
      return new Promise((resolve, reject) => {
        pending.set(profileDir, { resolve, reject });
      });
    },
    roundStarted: (profiles) =>
      rounds.push(profiles.map((profile) => profile.name)),
    polled: (profile, result) =>
      reports.push({ profile: profile.name, result }),
  });
  const armedMs = () => [...armed.values()].map((timer) => timer.ms);
  const fire = () => {
    const due = [...armed.values()];
    armed.clear();
    for (const timer of due) {
      timer.run();
    }
  };
  const settleAll = async () => {
    for (const [profileDir, poll] of pending) {
      pending.delete(profileDir);
      poll.resolve(usageAt(clock.at));
    }
    await new Promise((settle) => setImmediate(settle));
  };
  return {
    poller,
    clock,
    settings,
    calls,
    pending,
    reports,
    rounds,
    armedMs,
    fire,
    settleAll,
  };
}

describe('createPlanPoller', () => {
  it('poller_Start_PollsEveryProfileThenArmsTheInterval', () => {
    const run = setup();

    run.poller.start();

    expect(run.rounds).toEqual([['default', 'personal']]);
    expect(run.calls).toEqual(['~/.claude', '~/.claude-personal']);
    expect(run.armedMs()).toEqual([300_000]);
  });

  it.each([
    { seconds: 300, expectedMs: 300_000 },
    { seconds: 120, expectedMs: 120_000 },
    { seconds: 0, expectedMs: MIN_POLL_SECONDS * 1000 },
    {
      seconds: MIN_POLL_SECONDS + 1,
      expectedMs: (MIN_POLL_SECONDS + 1) * 1000,
    },
  ])(
    'poller_Interval_ReadAtEachArming_$seconds',
    async ({ seconds, expectedMs }) => {
      const run = setup(300);
      run.poller.start();
      await run.settleAll();

      run.settings.intervalSeconds = seconds;
      run.fire();

      expect(run.armedMs()).toEqual([expectedMs]);
    },
  );

  it('poller_RunningPoll_IsNotDoubled', async () => {
    const run = setup();
    run.poller.start();
    run.pending.get('~/.claude-personal')?.resolve(usageAt(0));
    await new Promise((settle) => setImmediate(settle));
    run.calls.length = 0;

    run.fire();

    expect(run.calls).toEqual(['~/.claude-personal']);
  });

  it.each([
    {
      case: 'ShorterIntervalPassed',
      seconds: 120,
      expectedRounds: 2,
      expectedMs: 120_000,
    },
    {
      case: 'LongerInterval',
      seconds: 600,
      expectedRounds: 1,
      expectedMs: 450_000,
    },
  ])(
    'poller_Reschedule_$case',
    async ({ seconds, expectedRounds, expectedMs }) => {
      const run = setup(300);
      run.poller.start();
      await run.settleAll();
      run.clock.at = 150_000;

      run.settings.intervalSeconds = seconds;
      run.poller.reschedule();

      expect(run.rounds).toHaveLength(expectedRounds);
      expect(run.armedMs()).toEqual([expectedMs]);
    },
  );

  it('poller_Polled_ReportsResultOrErrorText', async () => {
    const run = setup();
    run.poller.start();

    run.pending.get('~/.claude')?.resolve(usageAt(1_000));
    run.pending.get('~/.claude-personal')?.reject(new Error('exit 1'));
    await new Promise((settle) => setImmediate(settle));

    expect(run.reports).toEqual([
      { profile: 'default', result: { ok: true, usage: usageAt(1_000) } },
      { profile: 'personal', result: { ok: false, error: 'exit 1' } },
    ]);
  });

  it('poller_PollNow_ResolvesWhenTheRoundSettles', async () => {
    const run = setup();
    let resolved = false;

    void run.poller.pollNow().then(() => {
      resolved = true;
    });
    run.pending.get('~/.claude')?.resolve(usageAt(0));
    await new Promise((settle) => setImmediate(settle));
    expect(resolved).toBe(false);
    run.pending.get('~/.claude-personal')?.resolve(usageAt(0));
    await new Promise((settle) => setImmediate(settle));

    expect(resolved).toBe(true);
    expect(run.armedMs()).toEqual([300_000]);
  });

  it('poller_Dispose_ClearsTimerAndDropsLateResults', async () => {
    const run = setup();
    run.poller.start();

    run.poller.dispose();
    await run.settleAll();

    expect(run.armedMs()).toEqual([]);
    expect(run.reports).toEqual([]);
  });
});
