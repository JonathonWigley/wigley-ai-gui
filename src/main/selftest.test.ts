import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../contracts/files';
import type { SelfTestScript } from '../contracts/plugin';
import type { DrivenWindow } from './drive/driven-window';
import type { SelfTestFilter } from './selftest-config';

const NO_FILTER: SelfTestFilter = { plugins: [], groups: [] };

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
// The window's navigation count, which a test moves to stand in for a new
// navigation, and the page log (newest first) its `#log li` read answers; any
// other script the window runs answers nothing.
const navigation = vi.hoisted(() => ({ count: 1 }));
const pageLog = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('./electron-driven-window', () => ({
  electronDrivenWindow: () => ({
    focus: () => {},
    emulateFocus: async () => {},
    contentSize: () => ({ width: 800, height: 600 }),
    navigationCount: () => navigation.count,
    run: async (script: string) =>
      script.includes('#log li') ? [...pageLog.lines] : undefined,
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

  it.each([
    {
      cleanup: 'throws',
      cleanUp: () => {
        throw new Error('home still held');
      },
    },
    {
      cleanup: 'rejects',
      cleanUp: () => Promise.reject(new Error('home still held')),
    },
  ])(
    'exits with its code and reports a cleanup that $cleanup',
    async ({ cleanUp }) => {
      const failSelfTest = await loadFailSelfTest();

      failSelfTest('a step', new Error('boom'), cleanUp);

      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
      expect(errors).toEqual(['[selftest] cleanup failed: home still held']);
    },
  );

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

describe('runScript', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
        { pluginId: 'plugin', script, checksResult: true },
        new Map(),
        800,
        1,
        () => true,
      ),
    ).rejects.toThrow('fixture failed');
    expect(press).not.toHaveBeenCalled();
  });

  it('fails the run once a result that never settles reaches the step timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runScript } = await import('./selftest-runner');
    waitForNewLogLine.mockResolvedValueOnce(true);
    let failures: number | null | undefined;

    void runScript(
      {
        contentSize: () => ({ width: 800, height: 600 }),
      } as unknown as DrivenWindow,
      {} as Files,
      {
        pluginId: 'plugin',
        script: {
          pageBinds: [],
          settings: {},
          open: () => ({
            shownLine: '[plugin] shown',
            result: new Promise(() => {}),
          }),
          groups: [],
          scrollsItself: [],
          problems: () => [],
        },
        checksResult: true,
      },
      new Map(),
      800,
      1,
      () => true,
      1000,
    ).then((settled) => {
      failures = settled;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(failures).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(failures).toBe(1);
  });

  it('leaves the result unchecked when the run left out later groups', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });
    const { runScript } = await import('./selftest-runner');
    waitForNewLogLine.mockResolvedValueOnce(true);
    const problems = vi.fn(() => ['never checked']);

    const failures = await runScript(
      {
        contentSize: () => ({ width: 800, height: 600 }),
      } as unknown as DrivenWindow,
      {} as Files,
      {
        pluginId: 'plugin',
        script: {
          pageBinds: [],
          settings: {},
          open: () => ({
            shownLine: '[plugin] shown',
            result: new Promise(() => {}),
          }),
          groups: [],
          scrollsItself: [],
          problems,
        },
        checksResult: false,
      },
      new Map(),
      800,
      1,
      () => true,
    );

    expect(failures).toBe(0);
    expect(problems).not.toHaveBeenCalled();
    expect(lines).toContain(
      '[selftest] SKIP plugin result: the run left out its later groups',
    );
  });
});

// A window whose `did-finish-load` listeners land in `loaded`, for the test to
// fire as page loads.
function windowFiringLoads() {
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
  return { window, loaded };
}

describe('startSelfTest', () => {
  let screenshotFolder: string;
  let lines: string[];

  beforeEach(() => {
    exit.mockClear();
    press.mockClear();
    navigation.count = 1;
    pageLog.lines = [];
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
    const { window, loaded } = windowFiringLoads();
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
      NO_FILTER,
    );
    driver.hostFor('plugin').run(script);
    driver.closeHandover();

    loaded[0]();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(press).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([
      '[selftest] page load 1 starts its run',
      '[selftest] PASS [plugin] shown',
      '[selftest] group plugin: keys',
      '[selftest] FAIL the steps run: fixture failed',
    ]);
  });

  it('starts one run per page load however often the load finishes', async () => {
    vi.resetModules();
    const { startSelfTest } = await import('./selftest');
    const open = vi.fn(() => ({
      shownLine: '[plugin] shown',
      result: new Promise<void>(() => {}),
    }));
    const { window, loaded } = windowFiringLoads();
    const driver = startSelfTest(
      window,
      {} as Files,
      async () => {},
      screenshotFolder,
      NO_FILTER,
    );
    driver.hostFor('plugin').run({
      pageBinds: [],
      settings: {},
      open,
      groups: [
        {
          name: 'keys',
          why: 'a proves the keys',
          steps: [{ keys: ['a'], expect: '[plugin] a' }],
        },
      ],
      scrollsItself: [],
      problems: () => [],
    });
    driver.closeHandover();

    loaded[0]();
    loaded[0]();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    navigation.count = 2;
    loaded[0]();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));

    expect(open.mock.calls).toEqual([[1], [2]]);
    expect(lines).toEqual([
      '[selftest] page load 1 starts its run',
      '[selftest] page load 2 starts its run',
    ]);
  });

  it.each([
    {
      run: 'a whole run',
      filter: NO_FILTER,
      code: 1,
      line: '[selftest] FAIL [keys] unplaced x a.trash in a.s',
    },
    {
      run: 'a filtered run',
      filter: { plugins: ['plugin'], groups: [] },
      code: 0,
      line: '[selftest] SKIP every key placed: a filtered run leaves out the binds of the scripts and groups it skips',
    },
  ])(
    'startSelfTest on $run checks the unplaced lines logged before the first script only when whole',
    async ({ filter, code, line }) => {
      vi.resetModules();
      const { startSelfTest } = await import('./selftest');
      pageLog.lines = ['[keys] unplaced x a.trash in a.s'];
      waitForNewLogLine.mockResolvedValueOnce(true);
      const { window, loaded } = windowFiringLoads();
      const driver = startSelfTest(
        window,
        {} as Files,
        async () => {},
        screenshotFolder,
        filter,
      );
      driver.hostFor('plugin').run({
        pageBinds: [],
        settings: {},
        open: () => ({
          shownLine: '[plugin] shown',
          result: Promise.resolve(),
        }),
        groups: [],
        scrollsItself: [],
        problems: () => [],
      });
      driver.closeHandover();

      loaded[0]();
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(code));

      expect(lines).toContain(line);
    },
  );

  it('startSelfTest fails a filter naming an unknown plugin before any page load runs', async () => {
    vi.resetModules();
    const { startSelfTest } = await import('./selftest');
    const open = vi.fn();
    const { window, loaded } = windowFiringLoads();
    const driver = startSelfTest(
      window,
      {} as Files,
      async () => {},
      screenshotFolder,
      { plugins: ['nope'], groups: [] },
    );
    driver.hostFor('plugin').run({
      pageBinds: [],
      settings: {},
      open,
      groups: [],
      scrollsItself: [],
      problems: () => [],
    });
    driver.closeHandover();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(loaded).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(
      /FAIL the self-test filter: .*nope.*plugin/,
    );
  });
});
