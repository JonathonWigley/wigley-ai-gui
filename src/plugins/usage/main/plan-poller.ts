import type { PlanUsage } from '../../../contracts/agent';
import type { Clock, Timers } from '../../../contracts/ambient';
import { errorText } from '../../../shared/error-text';
import type { ChatProfile } from '../../chat/contract';
import type { PollResult } from './usage-store';

// The shortest interval between rounds, whatever `intervalSeconds` reads.
export const MIN_POLL_SECONDS = 60;

// `profiles` and `intervalSeconds` are read at each round and each arming;
// `roundStarted` hears each round's profiles before its polls start, and
// `polled` each settled poll.
export interface PlanPollerDeps {
  timers: Timers;
  clock: Clock;
  profiles(): readonly ChatProfile[];
  intervalSeconds(): number;
  planUsage(profileDir: string | null): Promise<PlanUsage>;
  roundStarted(profiles: readonly ChatProfile[]): void;
  polled(profile: ChatProfile, result: PollResult): void;
}

// `start` runs a round and arms the timer; each timer run does the same.
// `reschedule` re-arms for the last round's start plus the interval read now,
// running a round at once when that time has passed. `pollNow` runs a round,
// re-arms from it, and resolves when that round's polls settle. `dispose`
// clears the timer, and a poll settling after it reports nothing.
export interface PlanPoller {
  start(): void;
  pollNow(): Promise<void>;
  reschedule(): void;
  dispose(): void;
}

// Polls every profile's plan usage each interval, never running two polls of
// one profile at once.
export function createPlanPoller(deps: PlanPollerDeps): PlanPoller {
  const running = new Set<string>();
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
    const polls: Promise<void>[] = [];
    for (const profile of profiles) {
      if (!running.has(profile.configDir)) {
        polls.push(poll(profile));
      }
    }
    await Promise.all(polls);
  }

  async function poll(profile: ChatProfile): Promise<void> {
    running.add(profile.configDir);
    let result: PollResult;
    try {
      result = { ok: true, usage: await deps.planUsage(profile.configDir) };
    } catch (reason) {
      result = { ok: false, error: errorText(reason) };
    } finally {
      running.delete(profile.configDir);
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
