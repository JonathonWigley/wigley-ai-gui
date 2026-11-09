import type { SystemSample } from '../../../contracts/system-stats';
import type { Clock, Timers } from '../../../contracts/ambient';
import { errorText } from '../../../shared/error-text';
import { refreshSecondsOf } from './snapshot';

// The wait after a show's first good sample, so the panel gets its first numbers fast.
export const FIRST_GAP_MS = 1000;

// `refreshSeconds` is read at each arming. `sampled` hears each good sample with the clock's time when `sample` was
// called; `failed` each rejection. `log` hears a throw from either.
export interface StatsPollerDeps {
  timers: Timers;
  clock: Clock;
  sample(): Promise<SystemSample>;
  refreshSeconds(): number;
  sampled(sample: SystemSample, at: number): void;
  failed(error: unknown): void;
  log(message: string): void;
}

// `setShown(true)` from hidden samples at once, the next sample `FIRST_GAP_MS` after the show's first good one
// settles, and every other one the refresh interval after the last settles, a rejection's included; two samples never
// overlap. `setShown(false)` clears
// the timer and drops a running sample's result. `reschedule` re-arms a waiting interval timer from now with the
// interval read now. After `dispose`, nothing samples or reports.
export interface StatsPoller {
  setShown(shown: boolean): void;
  reschedule(): void;
  dispose(): void;
}

type Outcome =
  | { ok: true; sample: SystemSample; at: number }
  | { ok: false; error: unknown };

export function createStatsPoller(deps: StatsPollerDeps): StatsPoller {
  let shown = false;
  let disposed = false;
  // Bumped by each hide and the dispose, so a sample started before reports nothing.
  let generation = 0;
  let sampling = false;
  // Good samples since the last show: the wait after the first is `FIRST_GAP_MS`.
  let goodSamples = 0;
  let timer: { handle: number; isInterval: boolean } | null = null;

  const intervalMs = () => refreshSecondsOf(deps.refreshSeconds()) * 1000;

  function arm(isInterval: boolean) {
    clearTimer();
    const handle = deps.timers.set(
      () => {
        timer = null;
        void sampleAndArm();
      },
      isInterval ? intervalMs() : FIRST_GAP_MS,
    );
    timer = { handle, isInterval };
  }

  function clearTimer() {
    if (timer !== null) {
      deps.timers.clear(timer.handle);
      timer = null;
    }
  }

  async function sampleAndArm(): Promise<void> {
    const startedIn = generation;
    sampling = true;
    const outcome = await takeSample();
    sampling = false;
    if (disposed || !shown) {
      return;
    }
    if (startedIn !== generation) {
      // Shown again while a dropped sample ran: sample now that it settled.
      void sampleAndArm();
      return;
    }
    if (outcome.ok) {
      goodSamples += 1;
    }
    const isFirstGood = outcome.ok && goodSamples === 1;
    arm(!isFirstGood);
    try {
      if (outcome.ok) {
        deps.sampled(outcome.sample, outcome.at);
      } else {
        deps.failed(outcome.error);
      }
    } catch (error) {
      deps.log(`sample handling failed: ${errorText(error)}`);
    }
  }

  async function takeSample(): Promise<Outcome> {
    const at = deps.clock.now();
    try {
      return { ok: true, sample: await deps.sample(), at };
    } catch (error) {
      return { ok: false, error };
    }
  }

  return {
    setShown(next) {
      if (disposed || next === shown) {
        return;
      }
      shown = next;
      if (!next) {
        generation += 1;
        clearTimer();
        return;
      }
      goodSamples = 0;
      if (!sampling) {
        void sampleAndArm();
      }
    },
    reschedule() {
      const waitsOnInterval = timer?.isInterval === true;
      if (disposed || !shown || sampling || !waitsOnInterval) {
        return;
      }
      arm(true);
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearTimer();
    },
  };
}
