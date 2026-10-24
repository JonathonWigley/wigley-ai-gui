import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../contracts/files';
import type { SelfTestScript } from '../contracts/plugin';
import type { DrivenWindow } from './drive/driven-window';

const exit = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { exit } }));

// A page that is ready for keys at once and logs nothing, so every wait for a
// log line stays pending unless a test makes it resolve.
const press = vi.hoisted(() => vi.fn());
const waitForNewLogLine = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => new Promise<boolean>(() => {})),
);
vi.mock('./drive/page-driver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./drive/page-driver')>()),
  press,
  markLog: async () => ({ navigation: 0, length: 0 }),
  isReadyForKeys: async () => true,
  readStartFailure: async () => null,
  waitForNewLogLine,
}));
vi.mock('./electron-driven-window', () => ({
  electronDrivenWindow: () => ({
    focus: () => {},
    emulateFocus: async () => {},
    contentSize: () => ({ width: 800, height: 600 }),
  }),
}));

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
    const { settleWithin } = await import('./selftest-runner');

    expect(await settleWithin(Promise.resolve('done'), 1000)).toEqual({
      timedOut: false,
      value: 'done',
    });
  });

  it('times out on a result that never settles', async () => {
    vi.useFakeTimers();
    const { settleWithin } = await import('./selftest-runner');
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
    const { settleWithin } = await import('./selftest-runner');

    await expect(
      settleWithin(Promise.reject(new Error('boom')), 1000),
    ).rejects.toThrow('boom');
  });
});

describe('runScript', () => {
  it('stops the steps and rejects once the result rejects early', async () => {
    const { runScript } = await import('./selftest-runner');
    const script: SelfTestScript = {
      pageBinds: [],
      settings: {},
      open: () => ({
        shownLine: '[plugin] shown',
        result: Promise.reject(new Error('fixture failed')),
      }),
      groups: [
        {
          name: 'keys',
          why: 'a proves the keys',
          steps: [{ keys: ['a'], expect: '[plugin] a' }],
        },
      ],
      scrollsItself: [],
      problems: () => [],
    };

    await expect(
      runScript(
        {
          contentSize: () => ({ width: 800, height: 600 }),
        } as unknown as DrivenWindow,
        {} as Files,
        { pluginId: 'plugin', script },
        new Map(),
        800,
        1,
        () => true,
      ),
    ).rejects.toThrow('fixture failed');
    expect(press).not.toHaveBeenCalled();
  });
});

describe('startSelfTest', () => {
  let screenshotFolder: string;
  let lines: string[];

  beforeEach(() => {
    exit.mockClear();
    press.mockClear();
    screenshotFolder = mkdtempSync(path.join(tmpdir(), 'selftest-test-'));
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(screenshotFolder, { recursive: true, force: true });
  });

  it('stops a step left running once its result rejects mid-step', async () => {
    vi.resetModules();
    const { startSelfTest } = await import('./selftest');
    let rejectResult = (_error: Error) => {};
    const result = new Promise<never>((_resolve, reject) => {
      rejectResult = reject;
    });
    press.mockImplementationOnce(() =>
      rejectResult(new Error('fixture failed')),
    );
    waitForNewLogLine.mockResolvedValueOnce(true);
    const loaded: (() => void)[] = [];
    const window = {
      webContents: {
        on: (event: string, listener: () => void) => {
          if (event === 'did-finish-load') {
            loaded.push(listener);
          }
        },
      },
    } as unknown as BrowserWindow;
    const script: SelfTestScript = {
      pageBinds: [],
      settings: {},
      open: () => ({ shownLine: '[plugin] shown', result }),
      groups: [
        {
          name: 'keys',
          why: 'ab proves the keys',
          steps: [{ keys: ['a', 'b'], expect: '[plugin] ab' }],
        },
      ],
      scrollsItself: [],
      problems: () => [],
    };
    const driver = startSelfTest(
      window,
      {} as Files,
      async () => {},
      screenshotFolder,
    );
    driver.hostFor('plugin').run(script);
    driver.closeHandover();

    loaded[0]();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(press).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([
      '[selftest] PASS [plugin] shown',
      '[selftest] group plugin: keys',
      '[selftest] FAIL the steps run: fixture failed',
    ]);
  });
});
