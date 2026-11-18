import type { PlanUsage } from '../../../contracts/agent';
import type { Clock, Timers } from '../../../contracts/ambient';
import { errorText } from '../../../shared/error-text';
import type { RegisteredProfile } from '../../../shared/harness-profiles';
import type { PollResult } from './usage-store';

// The shortest interval between rounds, whatever `intervalSeconds` reads.
export const MIN_POLL_SECONDS = 60;

// `profiles` and `intervalSeconds` are read at each round and each arming;
// `planUsage` reads one profile's plan through that profile's harness;
// `roundStarted` hears each round's profiles before its polls start, and
// `polled` each settled poll.
export interface PlanPollerDeps {
  timers: Timers;
  clock: Clock;
  profiles(): readonly RegisteredProfile[];
  intervalSeconds(): number;
  planUsage(profile: RegisteredProfile): Promise<PlanUsage>;
  roundStarted(profiles: readonly RegisteredProfile[]): void;
  polled(profile: RegisteredProfile, result: PollResult): void;
}

// `start` runs a round and arms the timer; each timer run does the same.
// `reschedule` re-arms for the last round's start plus the interval read now,
// running a round at once when that time has passed. `pollNow` runs a round,
// re-arms from it, and resolves when every profile's poll settles, one already
// running when it was called included. `dispose` clears the timer, and a poll
// settling after it reports nothing.
export interface PlanPoller {
  start(): void;
  pollNow(): Promise<void>;
  reschedule(): void;
  dispose(): void;
}

// Polls every profile's plan usage each interval, never running two polls of
// one profile at once: a round awaits a profile's running poll instead.
export function createPlanPoller(deps: PlanPollerDeps): PlanPoller {
  // Each running poll, by `configDir`, until it has settled and reported.
  const inFlight = new Map<string, Promise<void>>();
  let timer: number | null = null;
  let lastRoundAt: number | null = null;
  let disposed = false;

  const intervalMs = () =>
    Math.max(deps.intervalSeconds(), MIN_POLL_SECONDS) * 1000;

  function arm(ms: number) {
    clearTimer();
    timer = deps.timers.set(() => {
      timer = null;
      void roundAndArm();
    }, ms);
  }

  function clearTimer() {
    if (timer !== null) {
      deps.timers.clear(timer);
      timer = null;
    }
  }

  function roundAndArm(): Promise<void> {
    const settled = runRound();
    arm(intervalMs());
    return settled;
  }

  async function runRound(): Promise<void> {
    lastRoundAt = deps.clock.now();
    const profiles = deps.profiles();
    deps.roundStarted(profiles);
    await Promise.all(
      profiles.map(
        (profile) => inFlight.get(profile.configDir) ?? poll(profile),
      ),
    );
  }

  function poll(profile: RegisteredProfile): Promise<void> {
    const running = readAndReport(profile).finally(() =>
      inFlight.delete(profile.configDir),
    );
    inFlight.set(profile.configDir, running);
    return running;
  }

  async function readAndReport(profile: RegisteredProfile): Promise<void> {
    let result: PollResult;
    try {
      result = { ok: true, usage: await deps.planUsage(profile) };
    } catch (reason) {
      result = { ok: false, error: errorText(reason) };
    }
    if (!disposed) {
      deps.polled(profile, result);
    }
  }

  return {
    start() {
      void roundAndArm();
    },
    pollNow: roundAndArm,
    reschedule() {
      if (disposed || lastRoundAt === null) {
        return;
      }
      const dueAt = lastRoundAt + intervalMs();
      const now = deps.clock.now();
      if (dueAt <= now) {
        void roundAndArm();
      } else {
        arm(dueAt - now);
      }
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
