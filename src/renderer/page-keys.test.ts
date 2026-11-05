import { describe, expect, it, vi } from 'vitest';
import type { Timers } from '../contracts/ambient';
import type { EditorHost } from '../contracts/editor';
import type { PageBind, ViewScope } from '../contracts/keymap';
import { createChordMatcher, createSequenceMatcher } from './key-sequences';
import {
  createPendingTimeout,
  dropPendingKeys,
  feedChordKey,
  feedPageKey,
  installPageKeys,
} from './page-keys';

const TIMEOUT_MS = 1000;

const binds: PageBind[] = [
  { keys: ['g', 'u', 'x'], scope: 'forms', command: 'test.long' },
  { keys: ['u'], scope: 'forms', command: 'test.openReview' },
  { keys: ['a'], scope: 'forms', command: 'test.editBox' },
  { keys: ['j'], scope: 'forms', command: 'test.down' },
  { keys: ['j'], scope: 'review', command: 'test.reviewDown' },
];

// A page whose commands change its scope or focus an editor, as the forms
// view's do, recording each command it runs, the keys typed into its editor
// and each pending-keys report.
function fakePage() {
  const page = {
    scope: 'forms' as ViewScope,
    isEditorFocused: false,
    ran: [] as string[],
    typed: [] as string[],
    reports: [] as string[][],
  };
  const target = {
    scope: () => page.scope,
    editorHasFocus: () => page.isEditorFocused,
    run: (bind: PageBind) => {
      page.ran.push(bind.command);
      if (bind.command === 'test.openReview') {
        page.scope = 'review';
      }
      if (bind.command === 'test.editBox') {
        page.isEditorFocused = true;
      }
    },
    typeIntoEditor: (keys: string[]) => {
      page.typed.push(...keys);
    },
    report: (keys: string[]) => {
      page.reports.push(keys);
    },
  };
  return { page, target };
}

// Timers that run only when the test fires them.
function fakeTimers() {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  const timers: Timers = {
    set: (run) => {
      armed.set(nextHandle, run);
      return nextHandle++;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  const fireAll = () => {
    const runs = [...armed.values()];
    armed.clear();
    for (const run of runs) {
      run();
    }
  };
  return { timers, armed, fireAll };
}

const leaderBinds: PageBind[] = [
  { keys: [' ', '2'], scope: 'forms', command: 'test.second' },
  { keys: ['Escape'], scope: 'forms', command: 'test.escape' },
];

describe('feedPageKey', () => {
  it('feeds the keys after a broken sequence in the scope its bind left', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    feedPageKey(matcher, 'u', 100, target);
    expect(feedPageKey(matcher, 'j', 200, target)).toBe(true);
    expect(page.ran).toEqual(['test.openReview', 'test.reviewDown']);
    expect(page.typed).toEqual([]);
  });

  it('types the keys after a bind that focused an editor into the editor', () => {
    const editBinds: PageBind[] = [
      { keys: ['g', 'a', 'x', 'y'], scope: 'forms', command: 'test.long' },
      ...binds.slice(2),
    ];
    const matcher = createSequenceMatcher(editBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    feedPageKey(matcher, 'a', 100, target);
    feedPageKey(matcher, 'x', 200, target);
    expect(feedPageKey(matcher, 'j', 300, target)).toBe(true);
    expect(page.ran).toEqual(['test.editBox']);
    expect(page.typed).toEqual(['x', 'j']);
  });

  it('cancels a pending sequence on Escape, running nothing', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, ' ', 0, target);

    expect(feedPageKey(matcher, 'Escape', 100, target)).toBe(true);

    expect(page.ran).toEqual([]);
    expect(page.reports).toEqual([[' '], []]);
    feedPageKey(matcher, '2', 200, target);
    expect(page.ran).toEqual([]);
  });

  it('runs the Escape bind when nothing is pending', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const { page, target } = fakePage();

    expect(feedPageKey(matcher, 'Escape', 0, target)).toBe(true);

    expect(page.ran).toEqual(['test.escape']);
    expect(page.reports).toEqual([]);
  });

  it('reports the pending keys each time they change', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const { page, target } = fakePage();

    feedPageKey(matcher, ' ', 0, target);
    feedPageKey(matcher, '2', 100, target);

    expect(page.reports).toEqual([[' '], []]);
    expect(page.ran).toEqual(['test.second']);
  });

  it('leaves a key with no bind unconsumed', () => {
    const matcher = createSequenceMatcher(binds, TIMEOUT_MS);
    const { page, target } = fakePage();
    expect(feedPageKey(matcher, 'q', 0, target)).toBe(false);
    expect(page.ran).toEqual([]);
  });
});

describe('feedChordKey', () => {
  const chordBinds: PageBind[] = [
    ...binds,
    { keys: ['<C-h>'], scope: 'forms', command: 'test.chord' },
  ];

  // A Control chord on `code`.
  const ctrl = (code: string) => ({
    code,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  });

  it('runs a chord bind and drops the pending sequence', () => {
    const chords = createChordMatcher(chordBinds);
    const matcher = createSequenceMatcher(chordBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    expect(feedChordKey(chords, matcher, ctrl('KeyH'), target)).toBe(true);
    expect(page.reports).toEqual([['g'], []]);
    feedPageKey(matcher, 'u', 200, target);
    expect(page.ran).toEqual(['test.chord', 'test.openReview']);
  });

  it('passes an unbound chord through and keeps the pending sequence', () => {
    const chords = createChordMatcher(chordBinds);
    const matcher = createSequenceMatcher(chordBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    expect(feedChordKey(chords, matcher, ctrl('KeyA'), target)).toBe(false);
    feedPageKey(matcher, 'u', 100, target);
    feedPageKey(matcher, 'x', 200, target);
    expect(page.ran).toEqual(['test.long']);
  });
});

describe('dropPendingKeys', () => {
  it('drops held keys so the next key starts a new sequence', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, ' ', 0, target);
    matcher.hold();

    dropPendingKeys(matcher, target.report);
    feedPageKey(matcher, '2', 100, target);

    expect(page.ran).toEqual([]);
    expect(page.reports).toEqual([[' '], []]);
  });

  it('reports nothing when no keys were pending', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const reports: string[][] = [];

    dropPendingKeys(matcher, (keys) => reports.push(keys));

    expect(reports).toEqual([]);
  });
});

describe('createPendingTimeout', () => {
  it('drops the pending keys and reports none when the wait lapses', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const { timers, fireAll } = fakeTimers();
    const reports: string[][] = [];
    const timeout = createPendingTimeout(matcher, timers, TIMEOUT_MS, (keys) =>
      reports.push(keys),
    );
    matcher.feed(' ', 'forms', 0);
    timeout.arm();

    fireAll();

    expect(matcher.pendingKeys()).toEqual([]);
    expect(reports).toEqual([[]]);
  });

  it('keeps held keys past the wait, and the next key completes them', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    const { timers, fireAll } = fakeTimers();
    const timeout = createPendingTimeout(
      matcher,
      timers,
      TIMEOUT_MS,
      target.report,
    );
    feedPageKey(matcher, ' ', 0, target);
    timeout.arm();
    matcher.hold();

    fireAll();
    feedPageKey(matcher, '2', 5000, target);

    expect(page.ran).toEqual(['test.second']);
    expect(page.reports).toEqual([[' '], []]);
  });

  it('sets no timer while nothing is pending', () => {
    const matcher = createSequenceMatcher(leaderBinds, TIMEOUT_MS);
    const { timers, armed } = fakeTimers();
    const timeout = createPendingTimeout(matcher, timers, TIMEOUT_MS, () => {});

    timeout.arm();

    expect(armed.size).toBe(0);
  });
});

describe('installPageKeys', () => {
  // Installs the engine over stubbed page globals, with no binds; `press` sends a
  // key.
  function installed(has = true) {
    const keydowns: ((event: unknown) => void)[] = [];
    const target = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === 'keydown') {
          keydowns.push(listener);
        }
      },
      activeElement: null,
    };
    vi.stubGlobal('document', target);
    vi.stubGlobal('window', target);
    const runs: unknown[][] = [];
    const logs: string[] = [];
    const engine = installPageKeys(
      TIMEOUT_MS,
      () => 'any',
      {
        contains: () => false,
        takesChordKey: () => false,
      } as unknown as EditorHost,
      {
        run: (...args) => {
          runs.push(args);
          return Promise.resolve();
        },
        has: () => has,
        requireRegistered: () => {},
      },
      (source, message) => void logs.push(`${source}: ${message}`),
      fakeTimers().timers,
      { where: () => 'page', onChanged: () => ({ dispose: () => {} }) },
    );
    const press = (key: string) => {
      for (const keydown of keydowns) {
        keydown({
          key,
          target: null,
          timeStamp: 0,
          preventDefault: () => {},
          stopPropagation: () => {},
        });
      }
    };
    return { engine, press, runs, logs };
  }

  it('setBinds_FirstCall_KeysStartFiring', () => {
    const { engine, press, runs } = installed();

    press('x');
    expect(runs).toEqual([]);

    engine.setBinds(
      [{ keys: ['x'], scope: 'any', command: 'p.x' }],
      TIMEOUT_MS,
    );
    press('x');
    vi.unstubAllGlobals();

    expect(runs).toEqual([['p.x', undefined, {}]]);
  });

  it('runBind_Arg_PassesItToTheRun', () => {
    const { engine, press, runs, logs } = installed();
    engine.setBinds(
      [{ keys: ['1'], scope: 'any', command: 'forms.choose', arg: 1 }],
      TIMEOUT_MS,
    );

    press('1');
    vi.unstubAllGlobals();

    expect(runs).toEqual([['forms.choose', 1, {}]]);
    expect(logs).toEqual(['page: 1 ran forms.choose 1']);
  });

  it('runBind_RuntimeCommandGone_LogsAndRunsNothing', () => {
    const { engine, press, runs, logs } = installed(false);
    engine.setBinds(
      [{ keys: ['r'], scope: 'any', command: 'r.gone' }],
      TIMEOUT_MS,
    );

    press('r');
    vi.unstubAllGlobals();

    expect(runs).toEqual([]);
    expect(logs).toEqual(['page: r names no command r.gone']);
  });
});
