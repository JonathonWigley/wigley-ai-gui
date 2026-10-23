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
