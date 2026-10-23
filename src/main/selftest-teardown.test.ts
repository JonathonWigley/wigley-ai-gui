import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSelfTestTeardown } from './selftest-teardown';

const CAP_MS = 1000;

describe('createSelfTestTeardown', () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('settles every added teardown before it removes the home', async () => {
    const events: string[] = [];
    const teardown = createSelfTestTeardown(async () => {
      events.push('remove');
    }, CAP_MS);
    teardown.add('the store', async () => {
      await Promise.resolve();
      events.push('store');
    });
    teardown.add('a part', () => {
      events.push('part');
    });

    await teardown.run();

    expect(events).toEqual(['part', 'store', 'remove']);
    expect(errors).toEqual([]);
  });

  it('waits for a teardown added while it runs', async () => {
    const events: string[] = [];
    let finishFirst = () => {};
    const teardown = createSelfTestTeardown(async () => {
      events.push('remove');
    }, CAP_MS);
    teardown.add(
      'the store',
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );

    const running = teardown.run();
    let finishLate = () => {};
    teardown.add(
      'a late part',
      () =>
        new Promise<void>((resolve) => {
          finishLate = () => {
            events.push('late');
            resolve();
          };
        }),
    );
    finishFirst();
    await Promise.resolve();
    expect(events).toEqual([]);
    finishLate();
    await running;

    expect(events).toEqual(['late', 'remove']);
  });

  it('cuts off a teardown that never settles, reports it, and still removes the home', async () => {
    vi.useFakeTimers();
    const removeHome = vi.fn(async () => {});
    const teardown = createSelfTestTeardown(removeHome, CAP_MS);
    teardown.add('a hung part', () => new Promise<void>(() => {}));
    teardown.add('the store', () => {});

    const running = teardown.run();
    await vi.advanceTimersByTimeAsync(CAP_MS - 1);
    expect(removeHome).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await running;

    expect(removeHome).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([
      `[selftest] teardown of a hung part did not settle within ${CAP_MS} ms`,
    ]);
  });

  it('reports a teardown that throws and still removes the home', async () => {
    const removeHome = vi.fn(async () => {});
    const teardown = createSelfTestTeardown(removeHome, CAP_MS);
    teardown.add('a part', () => {
      throw new Error('watcher stuck');
    });

    await teardown.run();

    expect(removeHome).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([
      '[selftest] teardown of a part failed: watcher stuck',
    ]);
  });

  it('reports a home the removal left without rejecting', async () => {
    const teardown = createSelfTestTeardown(
      () => Promise.reject(new Error('EBUSY')),
      CAP_MS,
    );

    await teardown.run();

    expect(errors).toEqual(['[selftest] temp home left: EBUSY']);
  });
});
