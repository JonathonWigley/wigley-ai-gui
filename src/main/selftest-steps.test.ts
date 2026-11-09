import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Files } from '../contracts/files';
import type { SelfTestGroup, SelfTestStep } from '../contracts/plugin';
import { type DrivenWindow, PageNavigatedError } from './drive/driven-window';
import { fakeDrivenWindow } from './drive/fake-driven-window';
import { checkPlacement, isOnLoad, runScript } from './selftest-runner';

const START_WIDTH = 800;

// A page over the fake window: its log (newest first) answers `#log li`, its
// width is the window's content width, every redraw lands at once, and each
// key pressed runs `onKey`, which may log lines and navigate the page. The
// keys plugin's placement check logs `placementLines`, oldest first.
// `widthsAtKeys` holds the content width at each key press.
function page(
  onKey: (key: string, log: string[], navigate: () => void) => void,
  placementLines: readonly string[] = [],
) {
  const log: string[] = [];
  const widthsAtKeys: number[] = [];
  const fake = fakeDrivenWindow([
    ['#log li', () => [...log]],
    [
      'keys-check-placement',
      () => log.unshift(...[...placementLines].reverse()),
    ],
    ['innerWidth', () => fake.window.contentSize().width],
    ['redrawFrames', () => 3],
  ]);
  fake.screen.captured = new Uint8Array([1]);
  const window: DrivenWindow = {
    ...fake.window,
    sendInput: (input) => {
      fake.window.sendInput(input);
      if (input.type === 'keyDown') {
        widthsAtKeys.push(fake.window.contentSize().width);
        onKey(input.keyCode, log, fake.navigate);
      }
    },
  };
  return { window, log, widthsAtKeys };
}

// Runs one script of `groups` for plugin `t` over `window`, its fixture
// logging `[t] shown` as it opens, as the run `isCurrent` says is current,
// waiting `stepTimeoutMs` for each line when given.
function runGroups(
  window: DrivenWindow,
  log: string[],
  groups: SelfTestGroup[],
  screenshots: ReadonlyMap<SelfTestStep, readonly string[]> = new Map(),
  isCurrent: () => boolean = () => true,
  stepTimeoutMs?: number,
) {
  return runScript(
    window,
    {} as Files,
    {
      pluginId: 't',
      script: {
        pageBinds: [],
        settings: {},
        open: () => {
          log.unshift('[t] shown');
          return { shownLine: '[t] shown', result: Promise.resolve(null) };
        },
        groups,
        scrollsItself: [],
        problems: () => [],
      },
      checksResult: true,
    },
    screenshots,
    START_WIDTH,
    1,
    isCurrent,
    stepTimeoutMs,
  );
}

// A page that logs `[t] <key>` for each key pressed.
const echo = (key: string, log: string[]) => log.unshift(`[t] ${key}`);

// A page that logs `next page` for its first `pages - 1` presses of `n` and
// `last page` from then on.
function pager(pages: number) {
  let presses = 0;
  return (_key: string, log: string[]) => {
    presses++;
    log.unshift(presses < pages ? 'next page' : 'last page');
  };
}

const PAGES_STEP: SelfTestStep = {
  keys: ['n'],
  expect: 'next page',
  repeat: { until: 'last page', max: 5 },
};

describe('runScript', () => {
  let lines: string[];
  let folder: string;

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });
    folder = mkdtempSync(path.join(tmpdir(), 'selftest-steps-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(folder, { recursive: true, force: true });
  });

  it('holds a step width for the steps after it and restores the start width once the script ends', async () => {
    const { window, log, widthsAtKeys } = page(echo);

    const failures = await runGroups(window, log, [
      {
        name: 'narrow',
        why: 'the page fits 600',
        steps: [
          { keys: ['a'], expect: '[t] a', width: 600 },
          { keys: ['b'], expect: '[t] b' },
        ],
      },
    ]);

    expect(failures).toBe(0);
    expect(widthsAtKeys).toEqual([600, 600]);
    expect(window.contentSize().width).toBe(START_WIDTH);
  });

  it("returns to the start width on a step whose width is 'start'", async () => {
    const { window, log, widthsAtKeys } = page(echo);

    await runGroups(window, log, [
      {
        name: 'narrow',
        why: 'the page fits 600',
        steps: [
          { keys: ['a'], expect: '[t] a', width: 600 },
          { keys: ['b'], expect: '[t] b', width: 'start' },
        ],
      },
    ]);

    expect(widthsAtKeys).toEqual([600, START_WIDTH]);
  });

  it('resizes back to the start width when it opens on another', async () => {
    const { window, log, widthsAtKeys } = page(echo);
    window.setContentWidth(500);

    await runGroups(window, log, [
      {
        name: 'keys',
        why: 'keys log',
        steps: [{ keys: ['a'], expect: '[t] a' }],
      },
    ]);

    expect(widthsAtKeys).toEqual([START_WIDTH]);
  });

  it('fails a step whose width never lands before its keys', async () => {
    const { window, log, widthsAtKeys } = page(echo);
    // The page reloads while it redraws at 600.
    const reloadingWindow: DrivenWindow = {
      ...window,
      run: (script) => {
        const isRedrawAt600 =
          script.includes('redrawFrames = 0') &&
          window.contentSize().width === 600;
        return isRedrawAt600
          ? Promise.reject(new PageNavigatedError())
          : window.run(script);
      },
    };

    const failures = await runGroups(reloadingWindow, log, [
      {
        name: 'narrow',
        why: 'the page fits 600',
        steps: [{ keys: ['a'], expect: '[t] a', width: 600 }],
      },
    ]);

    expect(failures).toBe(1);
    expect(widthsAtKeys).toEqual([]);
    expect(lines).toContain(
      '[selftest] FAIL a -> [t] a: width 600 never landed',
    );
  });

  it('opens nothing when a reload lands while it resizes back to the start width', async () => {
    const { window, log } = page(echo);
    window.setContentWidth(500);
    let isCurrent = true;
    const reloadingWindow: DrivenWindow = {
      ...window,
      setContentWidth: (width) => {
        window.setContentWidth(width);
        isCurrent = false;
      },
    };

    const failures = await runGroups(
      reloadingWindow,
      log,
      [
        {
          name: 'keys',
          why: 'keys log',
          steps: [{ keys: ['a'], expect: '[t] a' }],
        },
      ],
      new Map(),
      () => isCurrent,
    );

    expect(failures).toBeNull();
    expect(log).not.toContain('[t] shown');
  });

  it('stands down once the page navigates past its load, resizing, pressing and reporting nothing more', async () => {
    const { window, log, widthsAtKeys } = page((key, pageLog, navigate) => {
      pageLog.unshift(`[t] ${key}`);
      if (key === 'a') {
        navigate();
      }
    });
    const widthsSet: number[] = [];
    const watchedWindow: DrivenWindow = {
      ...window,
      setContentWidth: (width) => {
        widthsSet.push(width);
        window.setContentWidth(width);
      },
    };

    const failures = await runGroups(
      watchedWindow,
      log,
      [
        {
          name: 'keys',
          why: 'keys log and fit',
          steps: [
            { keys: ['a'], expect: '[t] a', checksFit: true },
            { keys: ['b'], expect: '[t] b', width: 600 },
          ],
        },
      ],
      new Map(),
      isOnLoad(watchedWindow, watchedWindow.navigationCount(), () => false),
    );

    expect(failures).toBeNull();
    expect(widthsAtKeys).toEqual([START_WIDTH]);
    expect(widthsSet).toEqual([]);
    expect(lines.filter((line) => /PASS|FAIL/.test(line))).toEqual([
      '[selftest] PASS [t] shown',
    ]);
  });

  it('presses a repeating step until its until line and saves one file per press', async () => {
    const { window, log } = page(pager(3));
    const pngs = [1, 2, 3, 4, 5].map((n) =>
      path.join(folder, `t-pages-${n}.png`),
    );

    const failures = await runGroups(
      window,
      log,
      [{ name: 'pages', why: 'every page shows', steps: [PAGES_STEP] }],
      new Map([[PAGES_STEP, pngs]]),
    );

    expect(failures).toBe(0);
    expect(lines).toContain('[selftest] PASS n ×3 -> last page');
    expect(pngs.map((png) => existsSync(png))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it.each([
    ['[t] id 4f2a', 0],
    ['[t] id none', 1],
  ])(
    'a step whose key logs %s before its expect line fails %s times on its alsoExpect pattern',
    async (earlier, expected) => {
      const { window, log } = page((key, pageLog) => {
        pageLog.unshift(earlier);
        pageLog.unshift(`[t] ${key}`);
      });

      const failures = await runGroups(
        window,
        log,
        [
          {
            name: 'ids',
            why: 'the new id is listed',
            steps: [
              {
                keys: ['j'],
                expect: '[t] j',
                alsoExpect: [/^\[t\] id [0-9a-f]+$/],
              },
            ],
          },
        ],
        new Map(),
        () => true,
        50,
      );

      expect(failures).toBe(expected);
    },
  );

  it.each([
    {
      given: 'the expect line',
      logs: ['[t] id', '[t] end'],
      missing: '[t] j',
    },
    {
      given: 'one alsoExpect pattern',
      logs: ['[t] j', '[t] end'],
      missing: '/^\\[t\\] id$/',
    },
    {
      given: 'a pattern past a missing expect line',
      logs: ['[t] end'],
      missing: '[t] j and /^\\[t\\] id$/',
    },
  ])(
    "a step's FAIL line names the lines never logged: $given",
    async ({ logs, missing }) => {
      const { window, log } = page((_key, pageLog) => {
        pageLog.unshift(...logs);
      });

      await runGroups(
        window,
        log,
        [
          {
            name: 'lines',
            why: 'the step logs its lines',
            steps: [
              {
                keys: ['j'],
                expect: '[t] j',
                alsoExpect: [/^\[t\] id$/, /^\[t\] end$/],
              },
            ],
          },
        ],
        new Map(),
        () => true,
        50,
      );

      expect(lines).toContain(
        `[selftest] FAIL j -> [t] j and /^\\[t\\] id$/ and /^\\[t\\] end$/: ${missing} never logged`,
      );
    },
  );

  it.each([
    ['[t] id 4f2a', 0],
    ['[t] id none', 1],
  ])(
    'a fixture whose opening logs %s beside its shown line fails %s times on its alsoShown pattern',
    async (opened, expected) => {
      const { window, log } = page(echo);

      const failures = await runScript(
        window,
        {} as Files,
        {
          pluginId: 't',
          script: {
            pageBinds: [],
            settings: {},
            open: () => {
              log.unshift('[t] shown', opened);
              return {
                shownLine: '[t] shown',
                alsoShown: [/^\[t\] id [0-9a-f]+$/],
                result: Promise.resolve(null),
              };
            },
            groups: [
              {
                name: 'keys',
                why: 'keys log',
                steps: [{ keys: ['a'], expect: '[t] a' }],
              },
            ],
            scrollsItself: [],
            problems: () => [],
          },
          checksResult: true,
        },
        new Map(),
        START_WIDTH,
        1,
        () => true,
        50,
      );

      expect(failures).toBe(expected);
      expect(lines).toContain(
        expected === 0
          ? '[selftest] PASS [t] shown and /^\\[t\\] id [0-9a-f]+$/'
          : '[selftest] FAIL [t] shown and /^\\[t\\] id [0-9a-f]+$/: /^\\[t\\] id [0-9a-f]+$/ never logged',
      );
    },
  );

  it('passes a repeating step whose first press logs its until line', async () => {
    const { window, log } = page(pager(1));

    const failures = await runGroups(window, log, [
      { name: 'pages', why: 'every page shows', steps: [PAGES_STEP] },
    ]);

    expect(failures).toBe(0);
    expect(lines).toContain('[selftest] PASS n ×1 -> last page');
  });

  it('stops a repeating step at a press that logs both its expect and until lines', async () => {
    let presses = 0;
    const { window, log } = page((_key, pageLog) => {
      presses++;
      pageLog.unshift('next page');
      pageLog.unshift('last page');
    });

    const failures = await runGroups(window, log, [
      { name: 'pages', why: 'every page shows', steps: [PAGES_STEP] },
    ]);

    expect(failures).toBe(0);
    expect(presses).toBe(1);
    expect(lines).toContain('[selftest] PASS n ×1 -> last page');
  });

  it("waits a step's own timeoutMs for its line in place of the run's step wait", async () => {
    const slowKey = (key: string, log: string[]) => {
      setTimeout(() => log.unshift(`[t] ${key}`), 150);
    };
    const step: SelfTestStep = { keys: ['a'], expect: '[t] a' };
    const group = (each: SelfTestStep): SelfTestGroup[] => [
      { name: 'slow', why: 'a slow line lands', steps: [each] },
    ];

    const sharedWait = page(slowKey);
    const sharedFailures = await runGroups(
      sharedWait.window,
      sharedWait.log,
      group(step),
      undefined,
      undefined,
      20,
    );
    const ownWait = page(slowKey);
    const ownFailures = await runGroups(
      ownWait.window,
      ownWait.log,
      group({ ...step, timeoutMs: 2000 }),
      undefined,
      undefined,
      20,
    );

    expect(sharedFailures).toBe(1);
    expect(ownFailures).toBe(0);
  });

  it('fails a repeating step whose until line never comes in max presses', async () => {
    const { window, log } = page(pager(Number.POSITIVE_INFINITY));

    const failures = await runGroups(window, log, [
      {
        name: 'pages',
        why: 'every page shows',
        steps: [{ ...PAGES_STEP, repeat: { until: 'last page', max: 3 } }],
      },
    ]);

    expect(failures).toBe(1);
    expect(lines).toContain(
      '[selftest] FAIL n ×3 -> last page: last page not reached in 3 presses',
    );
  });

  it('fails a repeating step at a press that logs neither its expect nor its until line', async () => {
    let presses = 0;
    const { window, log } = page((_key, pageLog) => {
      presses++;
      if (presses === 1) {
        pageLog.unshift('next page');
      }
    });

    const failures = await runGroups(
      window,
      log,
      [{ name: 'pages', why: 'every page shows', steps: [PAGES_STEP] }],
      new Map(),
      () => true,
      100,
    );

    expect(failures).toBe(1);
    expect(lines).toContain(
      '[selftest] FAIL n ×2 -> last page: next page or last page never logged after press 2',
    );
  });

  it("prints the group's name before its steps, and a failed step's group why and its own", async () => {
    const { window, log } = page(pager(Number.POSITIVE_INFINITY));
    const neverLast = { ...PAGES_STEP, repeat: { until: 'last page', max: 2 } };

    await runGroups(window, log, [
      {
        name: 'pages',
        why: 'every page shows',
        steps: [neverLast, { ...neverLast, why: 'the last page is reachable' }],
      },
    ]);

    expect(lines.filter((line) => !line.startsWith('[selftest] PASS'))).toEqual(
      [
        '[selftest] group t: pages',
        '[selftest] FAIL n ×2 -> last page: last page not reached in 2 presses',
        '[selftest]   group why: every page shows',
        '[selftest] FAIL n ×2 -> last page: last page not reached in 2 presses',
        '[selftest]   group why: every page shows',
        '[selftest]   step why: the last page is reachable',
      ],
    );
  });
});

describe('checkPlacement', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checkPlacement fails once for each unplaced line, printing the line', async () => {
    const { window, log } = page(echo);
    log.unshift('[t] done', '[keys] unplaced x a.trash in a.s');

    const failures = await checkPlacement(window);

    expect(failures).toBe(1);
    expect(lines).toContain('[selftest] FAIL [keys] unplaced x a.trash in a.s');
  });

  it('checkPlacement counts the lines the check event logs', async () => {
    const { window, log } = page(echo, ['[keys] unplaced y a.copy in a.t']);
    log.unshift('[t] done');

    const failures = await checkPlacement(window);

    expect(failures).toBe(1);
    expect(lines).toContain('[selftest] FAIL [keys] unplaced y a.copy in a.t');
  });

  it('checkPlacement passes when no unplaced line is logged', async () => {
    const { window, log } = page(echo);
    log.unshift('[t] done');

    const failures = await checkPlacement(window);

    expect(failures).toBe(0);
    expect(lines).toContain('[selftest] PASS every key placed');
  });
});
