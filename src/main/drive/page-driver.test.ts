import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHORD_NOTATION_RULE } from '../../shared/chord-notation';
import { fakeDrivenWindow } from './fake-driven-window';
import {
  click,
  cutOffAtWidth,
  drag,
  linesAfter,
  markLog,
  press,
  waitFor,
  waitForNewLogLine,
  waitForRedraw,
  withPrimitiveClipping,
} from './page-driver';

describe('waitForNewLogLine', () => {
  it('waitForNewLogLine_LineLoggedOnThirdRead_ResolvesTrue', async () => {
    let reads = 0;
    const { window } = fakeDrivenWindow([
      ['#log li', () => (++reads >= 3 ? ['[x] done'] : [])],
    ]);

    const isLogged = await waitForNewLogLine(window, '[x] done', {
      navigation: 0,
      length: 0,
    });

    expect(isLogged).toBe(true);
  });

  it('waitForNewLogLine_PageReloadedToFewerLinesThanSeen_FindsTheLineAmongThemAll', async () => {
    const { window } = fakeDrivenWindow([['#log li', () => ['[x] done']]]);

    const isLogged = await waitForNewLogLine(
      window,
      '[x] done',
      { navigation: 0, length: 5 },
      100,
    );

    expect(isLogged).toBe(true);
  });

  it('waitForNewLogLine_PageReloadedToAsManyLinesAsSeen_FindsTheLineAmongThemAll', async () => {
    let reads = 0;
    const { window, navigate } = fakeDrivenWindow([
      [
        '#log li',
        () => {
          reads += 1;
          if (reads === 2) {
            navigate();
          }
          return reads >= 2
            ? ['[x] later', '[x] done']
            : ['[x] old', '[x] older'];
        },
      ],
    ]);

    const isLogged = await waitForNewLogLine(
      window,
      '[x] done',
      { navigation: 0, length: 2 },
      500,
    );

    expect(isLogged).toBe(true);
  });

  it('waitForNewLogLine_NoNavigationAndNoNewLines_ResolvesFalse', async () => {
    const { window } = fakeDrivenWindow([
      ['#log li', () => ['[x] later', '[x] done']],
    ]);

    const isLogged = await waitForNewLogLine(
      window,
      '[x] done',
      { navigation: 0, length: 2 },
      100,
    );

    expect(isLogged).toBe(false);
  });

  it('waitForNewLogLine_PageNavigatedSinceTheMark_FindsALineAmongTheOldest', async () => {
    let log = ['[x] 5', '[x] 4', '[x] 3', '[x] 2', '[x] 1'];
    const { window, navigate } = fakeDrivenWindow([['#log li', () => log]]);
    const mark = await markLog(window);
    navigate();
    log = ['[x] g', '[x] f', '[x] e', '[x] d', '[x] c', '[x] b', '[x] done'];

    const isLogged = await waitForNewLogLine(window, '[x] done', mark, 100);

    expect(isLogged).toBe(true);
  });

  it('waitForNewLogLine_LineLoggedBeforeTheMarkAndNoNavigation_ResolvesFalse', async () => {
    const log = ['[x] 5', '[x] 4', '[x] done', '[x] 2', '[x] 1'];
    const { window } = fakeDrivenWindow([['#log li', () => log]]);
    const mark = await markLog(window);

    const isLogged = await waitForNewLogLine(window, '[x] done', mark, 100);

    expect(isLogged).toBe(false);
  });
});

describe('markLog', () => {
  it('markLog_PageNavigatesDuringTheRead_MarksSoTheWholeReloadedLogIsNew', async () => {
    let log = ['[x] 2', '[x] 1'];
    let reads = 0;
    const { window, navigate } = fakeDrivenWindow([
      [
        '#log li',
        () => {
          reads += 1;
          if (reads === 1) {
            navigate();
          }
          return log;
        },
      ],
    ]);

    const mark = await markLog(window);
    log = ['[x] b', '[x] a'];

    expect(await linesAfter(window, mark)).toEqual(['[x] a', '[x] b']);
  });
});

describe('linesAfter', () => {
  it('linesAfter_PageNavigatesDuringTheRead_ReadsAgainAndReturnsTheWholeNewLog', async () => {
    let log = ['[x] 2', '[x] 1'];
    let reads = 0;
    const { window, navigate } = fakeDrivenWindow([
      [
        '#log li',
        () => {
          reads += 1;
          if (reads === 2) {
            navigate();
          }
          return log;
        },
      ],
    ]);
    const mark = await markLog(window);
    log = ['[x] c', '[x] b', '[x] a'];

    const lines = await linesAfter(window, mark);

    expect(lines).toEqual(['[x] a', '[x] b', '[x] c']);
  });

  it('linesAfter_PageNavigatedSinceTheMark_ReturnsTheWholeNewLogOldestFirst', async () => {
    let log = ['[x] 5', '[x] 4', '[x] 3', '[x] 2', '[x] 1'];
    const { window, navigate } = fakeDrivenWindow([['#log li', () => log]]);
    const mark = await markLog(window);
    navigate();
    log = ['[x] g', '[x] f', '[x] e', '[x] d', '[x] c', '[x] b', '[x] a'];

    const lines = await linesAfter(window, mark);

    expect(lines).toEqual([
      '[x] a',
      '[x] b',
      '[x] c',
      '[x] d',
      '[x] e',
      '[x] f',
      '[x] g',
    ]);
  });
});

describe('waitFor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { check: async () => false, name: 'never holds' },
    { check: () => new Promise<boolean>(() => {}), name: 'never answers' },
  ])('gives up at its timeout when the check $name', async ({ check }) => {
    const waiting = waitFor(check, 100);

    await vi.advanceTimersByTimeAsync(100);

    expect(await waiting).toBe(false);
  });

  it('waitFor_CheckUnansweredForItsCap_PollsAgainInsideTheWait', async () => {
    let checks = 0;

    const waiting = waitFor(
      () =>
        ++checks === 1 ? new Promise<boolean>(() => {}) : Promise.resolve(true),
      10_000,
    );
    // Less than the wait's timeout: only a capped first check lets a second
    // run.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(checks).toBe(2);
    expect(await waiting).toBe(true);
  });

  it('waitFor_PageNavigatesUnderTheCheck_RetriesWithoutWaitingOutItsCap', async () => {
    let runs = 0;
    const { window, navigate } = fakeDrivenWindow([
      ['ready', () => (++runs === 1 ? new Promise(() => {}) : true)],
    ]);

    const waiting = waitFor(() => window.run<boolean>('ready'), 10_000);
    navigate();
    // One poll gap, far short of the first check's cap.
    await vi.advanceTimersByTimeAsync(100);

    expect(runs).toBe(2);
    expect(await waiting).toBe(true);
  });

  it('waitFor_CheckFailsForAnotherReason_RejectsWithItsError', async () => {
    const failure = new Error('the script threw');

    const waiting = waitFor(() => Promise.reject(failure), 10_000);

    await expect(waiting).rejects.toBe(failure);
  });
});

describe('waitForRedraw', () => {
  it('waitForRedraw_PageNavigatesDuringSetup_ResolvesFalse', async () => {
    const { window, navigate } = fakeDrivenWindow([
      ['window.redrawFrames = 0', () => navigate()],
    ]);

    expect(await waitForRedraw(window)).toBe(false);
  });

  it('waitForRedraw_PageNavigatesDuringThePoll_ResolvesFalseWithoutPollingAgain', async () => {
    let reads = 0;
    const { window, navigate } = fakeDrivenWindow([
      ['window.redrawFrames = 0', () => undefined],
      [
        'window.redrawFrames',
        () => {
          reads += 1;
          navigate();
          return undefined;
        },
      ],
    ]);

    expect(await waitForRedraw(window)).toBe(false);
    expect(reads).toBe(1);
  });
});

// A page that reports the window's content width as its own, redraws at once,
// and answers the cut-off script with `cutOff`.
function pageListingCutOff(cutOff: () => unknown) {
  const fake = fakeDrivenWindow([
    ['scrollsItself', cutOff],
    ['innerWidth', () => fake.window.contentSize().width],
    ['window.redrawFrames = 0', () => undefined],
    ['window.redrawFrames', () => 3],
  ]);
  return fake;
}

describe('cutOffAtWidth', () => {
  it('cutOffAtWidth_PageNavigatesDuringTheCutOffScript_ListsItAndRestoresTheWidth', async () => {
    const fake = pageListingCutOff(() => fake.navigate());

    const problems = await cutOffAtWidth(fake.window, 400, []);

    expect(problems).toEqual([expect.stringMatching(/navigated.*400px/)]);
    expect(fake.window.contentSize().width).toBe(800);
  });

  it('cutOffAtWidth_RunNoLongerCurrentAfterTheList_LeavesTheNarrowWidth', async () => {
    let isCurrent = true;
    const fake = pageListingCutOff(() => {
      isCurrent = false;
      return [];
    });

    await cutOffAtWidth(fake.window, 400, [], () => isCurrent);

    expect(fake.window.contentSize().width).toBe(400);
  });

  it('cutOffAtWidth_RunNoLongerCurrentAtTheCall_ResizesNothing', async () => {
    const fake = pageListingCutOff(() => []);
    const widthsSet: number[] = [];
    const window = {
      ...fake.window,
      setContentWidth: (width: number) => {
        widthsSet.push(width);
        fake.window.setContentWidth(width);
      },
    };

    const problems = await cutOffAtWidth(window, 400, [], () => false);

    expect(widthsSet).toEqual([]);
    expect(problems).toEqual([expect.stringContaining('400px')]);
  });
});

describe('press', () => {
  it('press_AltChord_SendsKeyDownAndUpWithAltAndNoChar', () => {
    const { window, inputs } = fakeDrivenWindow();

    press(window, '<A-o>');

    expect(inputs).toEqual([
      { type: 'keyDown', keyCode: 'o', modifiers: ['alt'] },
      { type: 'keyUp', keyCode: 'o', modifiers: ['alt'] },
    ]);
  });

  it('press_CapitalLetter_SendsShiftAndTheChar', () => {
    const { window, inputs } = fakeDrivenWindow();

    press(window, 'G');

    expect(inputs).toEqual([
      { type: 'keyDown', keyCode: 'G', modifiers: ['shift'] },
      { type: 'char', keyCode: 'G' },
      { type: 'keyUp', keyCode: 'G', modifiers: ['shift'] },
    ]);
  });

  it('press_MalformedChord_ThrowsNamingTheChordRule', () => {
    const { window } = fakeDrivenWindow();

    expect(() => press(window, '<X-q>')).toThrow(CHORD_NOTATION_RULE);
  });
});

// A page whose element the press script finds centred at (60, 40), with
// `cover` hit there in its place, or nothing in its place when null.
function pageWithTargetAt60x40(cover: string | null) {
  return fakeDrivenWindow([
    [
      'elementFromPoint',
      () => ({ x: 60, y: 40, isShown: true, isInWindow: true, cover }),
    ],
  ]);
}

describe('click', () => {
  it('click_LeftOnce_PressesHoldingTheButtonAndReleasesAtTheCentre', async () => {
    const { window, inputs } = pageWithTargetAt60x40(null);

    await click(window, '.target', 'left', 1);

    const buttonInputs = inputs.filter(
      (input) => input.type === 'mouseDown' || input.type === 'mouseUp',
    );
    expect(buttonInputs).toEqual([
      {
        type: 'mouseDown',
        x: 60,
        y: 40,
        button: 'left',
        clickCount: 1,
        modifiers: ['leftbuttondown'],
      },
      {
        type: 'mouseUp',
        x: 60,
        y: 40,
        button: 'left',
        clickCount: 1,
        modifiers: [],
      },
    ]);
  });

  it('click_AnotherElementCoversTheCentre_RejectsNamingItAndSendsNothing', async () => {
    const { window, inputs } = pageWithTargetAt60x40('div.ui-scrim');

    await expect(click(window, '.target', 'left', 1)).rejects.toThrow(
      /\.target.*div\.ui-scrim/,
    );
    expect(inputs).toEqual([]);
  });
});

describe('drag', () => {
  it('drag_ToTheRight_EveryMoveHoldsTheLeftButton', async () => {
    const { window, inputs } = pageWithTargetAt60x40(null);

    await drag(window, '.target', 80, 0);

    const moves = inputs.filter((input) => input.type === 'mouseMove');
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(move).toMatchObject({ modifiers: ['leftbuttondown'] });
    }
    expect(inputs.at(-1)).toMatchObject({
      type: 'mouseUp',
      x: 140,
      y: 40,
      modifiers: [],
    });
  });
});

describe('withPrimitiveClipping', () => {
  it('withPrimitiveClipping_ListHoldingOne_KeepsTheListFirstAndRepeatsNone', () => {
    const scrollsItself = ['.scroller', '.ui-tab-label'];

    const selectors = withPrimitiveClipping(scrollsItself);

    expect(selectors.slice(0, 2)).toEqual(scrollsItself);
    expect(selectors.length).toBeGreaterThan(scrollsItself.length);
    expect(new Set(selectors).size).toBe(selectors.length);
  });
});
