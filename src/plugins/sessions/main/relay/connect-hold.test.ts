import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../../../contracts/ambient';
import { CONNECT_HOLD_MS, createConnectHold } from './connect-hold';

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms) as unknown as number,
  clear: (handle) => clearTimeout(handle),
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createConnectHold', () => {
  it.each([
    { given: 'no hold', holds: () => [], resolvesAt: 0 },
    {
      given: 'one hold that resolves at 100 ms',
      holds: () => [
        new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        }),
      ],
      resolvesAt: 100,
    },
    {
      given: 'one hold that rejects at 100 ms',
      holds: () => [
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error('load failed')), 100);
        }),
      ],
      resolvesAt: 100,
    },
    {
      given: 'one hold that never settles',
      holds: () => [new Promise<void>(() => {})],
      resolvesAt: CONNECT_HOLD_MS,
    },
  ])(
    'ready_ResolvesWhenTheHoldsSettleOrTheBoundPasses given $given',
    async ({ holds, resolvesAt }) => {
      vi.useFakeTimers();
      const logged: string[] = [];
      const hold = createConnectHold(realTimers, (message) =>
        logged.push(message),
      );
      for (const until of holds()) {
        hold.hold(until);
      }
      let isReady = false;
      void hold.ready().then(() => {
        isReady = true;
      });

      await vi.advanceTimersByTimeAsync(Math.max(0, resolvesAt - 1));
      expect(isReady).toBe(resolvesAt === 0);
      await vi.advanceTimersByTimeAsync(1);
      expect(isReady).toBe(true);

      const heldPast = 'relay connects held past 5000 ms; connecting';
      const passedTheBound = resolvesAt === CONNECT_HOLD_MS;
      if (!passedTheBound) {
        expect(vi.getTimerCount()).toBe(0);
      }
      await vi.advanceTimersByTimeAsync(6_000 - resolvesAt);
      expect(logged).toEqual(passedTheBound ? [heldPast] : []);

      let isReadyAgain = false;
      void hold.ready().then(() => {
        isReadyAgain = true;
      });
      await Promise.resolve();
      expect(isReadyAgain).toBe(true);
    },
  );

  it('hold_AfterAWaitEnded_StartsANewWaitWithItsOwnBound', async () => {
    vi.useFakeTimers();
    const logged: string[] = [];
    const hold = createConnectHold(realTimers, (message) =>
      logged.push(message),
    );
    hold.hold(new Promise<void>(() => {}));
    await vi.advanceTimersByTimeAsync(CONNECT_HOLD_MS);
    hold.hold(new Promise<void>(() => {}));
    let isReady = false;
    void hold.ready().then(() => {
      isReady = true;
    });

    await vi.advanceTimersByTimeAsync(CONNECT_HOLD_MS - 1);
    expect(isReady).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(isReady).toBe(true);
    expect(logged).toHaveLength(2);
  });
});
