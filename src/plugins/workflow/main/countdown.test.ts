import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { withHeavyState } from '../stages/heavy-contract';
import { createCountdown } from './countdown';

const NOW = 50_000;

// Timers the test fires by hand: `pending` holds each timer set and not yet
// cleared or fired.
function handTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let nextHandle = 1;
  const timers: Timers = {
    set(run, ms) {
      const handle = nextHandle++;
      pending.set(handle, { run, ms });
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  const fireAll = () => {
    for (const [handle, { run }] of pending) {
      pending.delete(handle);
      run();
    }
  };
  return { timers, pending, fireAll };
}

function countingDown(endsAt: number | null): SessionFlow {
  return withHeavyState(newFlow('s1', '/r'), { countdownEndsAt: endsAt });
}

function startCountdown() {
  const hand = handTimers();
  const fired: string[] = [];
  const countdown = createCountdown({
    timers: hand.timers,
    clock: { now: () => NOW },
    fire: (sessionId) => fired.push(sessionId),
  });
  return { ...hand, fired, countdown };
}

describe('createCountdown', () => {
  it('sync_CountingDown_ArmsOneTimerForTheTimeLeft', () => {
    const { countdown, pending } = startCountdown();

    countdown.sync(countingDown(NOW + 7_000));
    countdown.sync(countingDown(NOW + 7_000));

    expect([...pending.values()].map(({ ms }) => ms)).toEqual([7_000]);
  });

  it.each([
    {
      name: 'syncing a stopped flow',
      end: (countdown: ReturnType<typeof createCountdown>) =>
        countdown.sync(countingDown(null)),
    },
    {
      name: 'stop',
      end: (countdown: ReturnType<typeof createCountdown>) =>
        countdown.stop('s1'),
    },
  ])('$name clears the timer', ({ end }) => {
    const { countdown, pending } = startCountdown();
    countdown.sync(countingDown(NOW + 7_000));

    end(countdown);

    expect(pending.size).toBe(0);
  });

  it('fire_CallsFireOnce_AndTheNextCountdownArmsAgain', () => {
    const { countdown, pending, fired, fireAll } = startCountdown();
    countdown.sync(countingDown(NOW + 7_000));

    fireAll();
    countdown.sync(countingDown(NOW + 3_000));

    expect(fired).toEqual(['s1']);
    expect([...pending.values()].map(({ ms }) => ms)).toEqual([3_000]);
  });
});
