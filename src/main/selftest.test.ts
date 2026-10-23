import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exit = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { exit } }));

// `failSelfTest` keeps whether the self-test has exited in module state, so
// each test loads a fresh copy.
async function loadFailSelfTest() {
  vi.resetModules();
  return (await import('./selftest')).failSelfTest;
}

describe('failSelfTest', () => {
  let errors: string[];

  beforeEach(() => {
    exit.mockClear();
    errors = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exits only once the cleanup settles', async () => {
    const failSelfTest = await loadFailSelfTest();
    let finishCleanUp = () => {};
    const cleanedUp = new Promise<void>((resolve) => {
      finishCleanUp = resolve;
    });

    failSelfTest('a step', new Error('boom'), () => cleanedUp);
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    finishCleanUp();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(errors).toEqual([]);
  });

  it('exits with its code and reports a cleanup that throws', async () => {
    const failSelfTest = await loadFailSelfTest();

    failSelfTest('a step', new Error('boom'), () => {
      throw new Error('home still held');
    });

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(errors).toEqual(['[selftest] cleanup failed: home still held']);
  });

  it('exits with its code and reports a cleanup that rejects', async () => {
    const failSelfTest = await loadFailSelfTest();

    failSelfTest('a step', new Error('boom'), () =>
      Promise.reject(new Error('home still held')),
    );

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(errors).toEqual(['[selftest] cleanup failed: home still held']);
  });

  it('exits with its code once the teardown cap cuts off a hung teardown', async () => {
    vi.useFakeTimers();
    const failSelfTest = await loadFailSelfTest();
    const { createSelfTestTeardown } = await import('./selftest-teardown');
    const removeHome = vi.fn(async () => {});
    const teardown = createSelfTestTeardown(removeHome, 1000);
    teardown.add('a hung part', () => new Promise<void>(() => {}));

    failSelfTest('a step', new Error('boom'), () => teardown.run());
    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(removeHome).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors).toEqual([
      '[selftest] teardown of a hung part did not settle within 1000 ms',
    ]);
  });

  it('does nothing on a second exit', async () => {
    const failSelfTest = await loadFailSelfTest();
    const firstCleanUp = vi.fn(async () => {});
    const secondCleanUp = vi.fn(async () => {});

    failSelfTest('a step', new Error('boom'), firstCleanUp);
    failSelfTest('a later step', new Error('again'), secondCleanUp);

    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledTimes(1);
    expect(firstCleanUp).toHaveBeenCalledTimes(1);
    expect(secondCleanUp).not.toHaveBeenCalled();
  });
});

describe('settleWithin', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the value of a result that settles in time', async () => {
    const { settleWithin } = await import('./selftest');

    expect(await settleWithin(Promise.resolve('done'), 1000)).toEqual({
      timedOut: false,
      value: 'done',
    });
  });

  it('times out on a result that never settles', async () => {
    vi.useFakeTimers();
    const { settleWithin } = await import('./selftest');
    let outcome: unknown = null;

    void settleWithin(new Promise(() => {}), 1000).then((settled) => {
      outcome = settled;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome).toEqual({ timedOut: true });
  });

  it('rejects with a result that rejects', async () => {
    const { settleWithin } = await import('./selftest');

    await expect(
      settleWithin(Promise.reject(new Error('boom')), 1000),
    ).rejects.toThrow('boom');
  });
});
