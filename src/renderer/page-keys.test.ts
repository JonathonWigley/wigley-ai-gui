import { describe, expect, it, vi } from 'vitest';
import { fakeTimers } from '../shared/fake-timers.test-support';
import type { EditorHost } from '../contracts/editor';
import type { PageBind, ViewScope } from '../contracts/keymap';
import type { PlatformKeys } from '../contracts/platform';
import { parseChord } from '../shared/chord-notation';
import {
  type ChordPress,
  createChordMatcher,
  createSequenceMatcher,
} from './key-sequences';
import {
  capturedKeys,
  createPendingTimeout,
  dropPendingKeys,
  feedChordKey,
  feedPageKey,
  installPageKeys,
} from './page-keys';

const TIMEOUT_MS = 1000;

const MAC_KEYS: PlatformKeys = {
  optionMatchesByCode: true,
  altGraphTypes: false,
};
const PC_KEYS: PlatformKeys = {
  optionMatchesByCode: false,
  altGraphTypes: true,
};

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

  // A Control chord on `key`, pressed on `code`.
  const ctrl = (key: string, code: string): ChordPress => ({
    key,
    code,
    ctrl: true,
    alt: false,
    shift: false,
    meta: false,
    altGraph: false,
  });

  it('runs a chord bind and drops the pending sequence', () => {
    const chords = createChordMatcher(chordBinds, MAC_KEYS);
    const matcher = createSequenceMatcher(chordBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    expect(feedChordKey(chords, matcher, ctrl('h', 'KeyH'), target)).toBe(true);
    expect(page.reports).toEqual([['g'], []]);
    feedPageKey(matcher, 'u', 200, target);
    expect(page.ran).toEqual(['test.chord', 'test.openReview']);
  });

  it('passes an unbound chord through and keeps the pending sequence', () => {
    const chords = createChordMatcher(chordBinds, MAC_KEYS);
    const matcher = createSequenceMatcher(chordBinds, TIMEOUT_MS);
    const { page, target } = fakePage();
    feedPageKey(matcher, 'g', 0, target);
    expect(feedChordKey(chords, matcher, ctrl('a', 'KeyA'), target)).toBe(
      false,
    );
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

// A press of `key` on `code`, holding the modifiers `held` sets.
function press(
  key: string,
  code: string,
  held: Partial<ChordPress> = {},
): ChordPress {
  return {
    key,
    code,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    altGraph: false,
    ...held,
  };
}

const ALL_MODIFIERS = {
  ctrl: true,
  alt: true,
  shift: true,
  meta: true,
};

const CHORD_ROWS: [ChordPress, string][] = [
  [press('t', 'KeyT', { ctrl: true }), '<C-t>'],
  [press('ø', 'KeyO', { alt: true }), '<A-o>'],
  [press('Ø', 'KeyO', { alt: true, shift: true }), '<A-S-o>'],
  [press('w', 'KeyW', { meta: true }), '<D-w>'],
  [press('æ', 'Quote', { alt: true }), "<A-'>"],
  [press('1', 'Digit1', { ctrl: true }), '<C-1>'],
  [press(':', 'Semicolon', ALL_MODIFIERS), '<C-A-D-:>'],
  [press('Enter', 'Enter', { shift: true }), '<S-Enter>'],
  [press('Enter', 'Enter', { ctrl: true }), '<C-Enter>'],
  [press('Dead', 'KeyE', { alt: true }), '<A-e>'],
  [press('/', 'Slash', { ctrl: true }), '<C-/>'],
  [press('?', 'Slash', { ctrl: true, shift: true }), '<C-?>'],
  [press('<', 'Comma', { ctrl: true, shift: true }), '<C-lt>'],
  [press(' ', 'Space', { ctrl: true }), '<C-Space>'],
  [press('ArrowUp', 'ArrowUp', { alt: true }), '<A-Up>'],
  [press('Backspace', 'Backspace', { meta: true }), '<D-BS>'],
  [press('F5', 'F5'), '<F5>'],
  [press('[', 'BracketLeft', { ctrl: true }), '<C-[>'],
];

describe('capturedKeys', () => {
  it.each<[ChordPress, string | null]>([
    [press('t', 'KeyT'), 't'],
    [press('T', 'KeyT', { shift: true }), 'T'],
    [press(':', 'Semicolon', { shift: true }), ':'],
    [press(';', 'Semicolon'), ';'],
    [press(' ', 'Space'), '<Space>'],
    [press('Enter', 'Enter'), '<CR>'],
    [press('Tab', 'Tab'), '<Tab>'],
    [press('Tab', 'Tab', { shift: true }), '<S-Tab>'],
    [press('Backspace', 'Backspace'), '<BS>'],
    [press('<', 'Comma', { shift: true }), '<lt>'],
    [press('\\', 'Backslash'), '<Bslash>'],
    ...CHORD_ROWS,
    [press('Shift', 'ShiftLeft', { shift: true }), null],
    [press('Meta', 'MetaLeft', { meta: true }), null],
    [press('ArrowUp', 'ArrowUp'), null],
    [press('Dead', 'Backquote'), null],
  ])('capturedKeys_Press_SpellsTheKeyAsABindIsWritten %#', (pressed, keys) => {
    expect(capturedKeys(pressed, MAC_KEYS)).toBe(keys);
  });

  it.each(CHORD_ROWS)(
    'capturedKeys_Chord_MatchesTheChordBindItSpells %#',
    (pressed, keys) => {
      const captured = capturedKeys(pressed, MAC_KEYS)!;
      const bind: PageBind = { keys: [captured], scope: 'any', command: 'p.x' };

      expect(captured).toBe(keys);
      expect(parseChord(captured)).not.toBeNull();
      expect(createChordMatcher([bind], MAC_KEYS).match(pressed, 'any')).toBe(
        bind,
      );
    },
  );

  it('capturedKeys_AltGrTyping_SpellsTheCharacter', () => {
    const altGrAt = press('@', 'KeyQ', {
      ctrl: true,
      alt: true,
      altGraph: true,
    });

    expect(capturedKeys(altGrAt, PC_KEYS)).toBe('@');
  });
});

describe('installPageKeys', () => {
  // The fields of a key event a test's press sets, and whether AltGr is down.
  type PressedEvent = Partial<
    Pick<
      KeyboardEvent,
      'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'repeat'
    > & { altGraph: boolean }
  >;

  // Installs the engine over stubbed page globals, with no binds; `press` sends a
  // key, stopping at the listener that stops its propagation, and reports
  // whether a listener prevented its default.
  function installed(
    has = true,
    editors: Partial<EditorHost> = {},
    platformKeys: PlatformKeys = MAC_KEYS,
  ) {
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
        ...editors,
      } as unknown as EditorHost,
      {
        run: async (...args) => {
          runs.push(args);
          return 'ran';
        },
        has: () => has,
        requireRegistered: () => {},
      },
      (source, message) => void logs.push(`${source}: ${message}`),
      fakeTimers().timers,
      { where: () => 'page', onChanged: () => ({ dispose: () => {} }) },
      platformKeys,
    );
    const press = (key: string, pressed: PressedEvent = {}) => {
      let isPrevented = false;
      let isStopped = false;
      const { altGraph = false, ...held } = pressed;
      const event = {
        key,
        code: '',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...held,
        getModifierState: (name: string) => name === 'AltGraph' && altGraph,
        target: null,
        timeStamp: 0,
        preventDefault: () => {
          isPrevented = true;
        },
        stopPropagation: () => {
          isStopped = true;
        },
      };
      for (const keydown of keydowns) {
        if (isStopped) {
          break;
        }
        keydown(event);
      }
      return isPrevented;
    };
    return { engine, press, runs, logs };
  }

  // A capture armed on `engine`, recording what it hears.
  function armed(engine: ReturnType<typeof installed>['engine']) {
    const heard: string[] = [];
    const handle = engine.capture(
      (keys) => heard.push(keys),
      () => heard.push('cancel'),
    );
    return { heard, handle };
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

  it.each<[string, string, PressedEvent, string]>([
    ['x', 'KeyX', {}, 'x'],
    ['x', 'KeyX', { ctrlKey: true }, '<C-x>'],
  ])(
    'capture_Armed_TakesTheNextKeyAheadOfBindsAndRunsNothing %s %j',
    (key, code, held, keys) => {
      const { engine, press, runs } = installed();
      engine.setBinds(
        [
          { keys: ['x'], scope: 'any', command: 'p.x' },
          { keys: ['<C-x>'], scope: 'any', command: 'p.cx' },
        ],
        TIMEOUT_MS,
      );
      const { heard } = armed(engine);

      const isPrevented = press(key, { code, ...held });

      expect(heard).toEqual([keys]);
      expect(runs).toEqual([]);
      expect(isPrevented).toBe(true);
      press(key, { code, ...held });
      vi.unstubAllGlobals();
      expect(heard).toEqual([keys]);
      expect(runs).toHaveLength(1);
    },
  );

  it('capture_ArmedOverAPendingSequence_TheKeyJoinsNoSequence', () => {
    const { engine, press, runs } = installed();
    engine.setBinds(
      [{ keys: ['g', 'g'], scope: 'any', command: 'p.top' }],
      TIMEOUT_MS,
    );
    press('g', { code: 'KeyG' });
    const { heard } = armed(engine);

    press('g', { code: 'KeyG' });
    expect(heard).toEqual(['g']);
    expect(runs).toEqual([]);

    press('g', { code: 'KeyG' });
    press('g', { code: 'KeyG' });
    vi.unstubAllGlobals();

    expect(runs).toEqual([['p.top', undefined, {}]]);
  });

  it.each<[string, PressedEvent]>([
    ['Shift', { code: 'ShiftLeft', shiftKey: true }],
    ['ArrowUp', { code: 'ArrowUp' }],
    ['Dead', { code: 'Backquote' }],
  ])('capture_NotAKey_WaitsForTheNext %s', (key, pressed) => {
    const { engine, press } = installed();
    const { heard } = armed(engine);

    const isPrevented = press(key, pressed);
    expect(heard).toEqual([]);
    expect(isPrevented).toBe(false);

    press('t', { code: 'KeyT' });
    vi.unstubAllGlobals();

    expect(heard).toEqual(['t']);
  });

  it('capture_Escape_CancelsAndIsNotCaptured', () => {
    const { engine, press, runs } = installed();
    engine.setBinds(
      [{ keys: ['Escape'], scope: 'any', command: 'p.esc' }],
      TIMEOUT_MS,
    );
    const { heard } = armed(engine);

    const isPrevented = press('Escape', { code: 'Escape' });
    vi.unstubAllGlobals();

    expect(heard).toEqual(['cancel']);
    expect(runs).toEqual([]);
    expect(isPrevented).toBe(true);
  });

  it('capture_ArmedAgain_CancelsTheFirst', () => {
    const { engine, press } = installed();
    const first = armed(engine);
    const second = armed(engine);

    press('t', { code: 'KeyT' });
    vi.unstubAllGlobals();

    expect(first.heard).toEqual(['cancel']);
    expect(second.heard).toEqual(['t']);
  });

  it('capture_ArmedInTheReplacedOnesCancel_TheLastArmedTakesTheKey', () => {
    const { engine, press } = installed();
    const heard: string[] = [];
    engine.capture(
      (keys) => heard.push(`first ${keys}`),
      () => {
        heard.push('first cancel');
        engine.capture(
          (keys) => heard.push(`third ${keys}`),
          () => heard.push('third cancel'),
        );
      },
    );
    engine.capture(
      (keys) => heard.push(`second ${keys}`),
      () => heard.push('second cancel'),
    );

    press('t', { code: 'KeyT' });
    vi.unstubAllGlobals();

    expect(heard).toEqual(['first cancel', 'second cancel', 'third t']);
  });

  it.each<[string, string]>([
    ['x', 'KeyX'],
    ['Escape', 'Escape'],
  ])('capture_AutoRepeat_SwallowedAndStaysArmed %s', (key, code) => {
    const { engine, press, runs } = installed();
    engine.setBinds(
      [
        { keys: ['x'], scope: 'any', command: 'p.x' },
        { keys: ['Escape'], scope: 'any', command: 'p.esc' },
      ],
      TIMEOUT_MS,
    );
    const { heard } = armed(engine);

    const isPrevented = press(key, { code, repeat: true });
    expect(heard).toEqual([]);
    expect(runs).toEqual([]);
    expect(isPrevented).toBe(true);

    press('t', { code: 'KeyT' });
    vi.unstubAllGlobals();

    expect(heard).toEqual(['t']);
  });

  it('capture_Disposed_DisarmsWithNoCallback', () => {
    const { engine, press, runs } = installed();
    engine.setBinds(
      [{ keys: ['x'], scope: 'any', command: 'p.x' }],
      TIMEOUT_MS,
    );
    const { heard, handle } = armed(engine);

    handle.dispose();
    press('x', { code: 'KeyX' });
    vi.unstubAllGlobals();

    expect(heard).toEqual([]);
    expect(runs).toEqual([['p.x', undefined, {}]]);
  });

  it('capture_CallbackArmsAgain_NextKeyReachesTheNewCapture', () => {
    const { engine, press } = installed();
    const heard: string[] = [];
    engine.capture(
      (keys) => {
        heard.push(`first ${keys}`);
        engine.capture(
          (next) => heard.push(`second ${next}`),
          () => heard.push('second cancel'),
        );
      },
      () => heard.push('first cancel'),
    );

    press('t', { code: 'KeyT' });
    press('<', { code: 'Comma', shiftKey: true });
    vi.unstubAllGlobals();

    expect(heard).toEqual(['first t', 'second <lt>']);
  });

  it('capture_EditorTakesTheChord_CaptureStillTakesIt', () => {
    const { engine, press } = installed(true, {
      takesChordKey: () => true,
      contains: () => true,
    });
    const { heard } = armed(engine);

    press('n', { code: 'KeyN', ctrlKey: true });
    vi.unstubAllGlobals();

    expect(heard).toEqual(['<C-n>']);
  });

  const altGraphBinds: PageBind[] = [
    { keys: ['<C-A-q>'], scope: 'any', command: 'p.chord' },
    { keys: ['@'], scope: 'any', command: 'p.at' },
  ];

  it('keydown_AltGrTyping_RunsTheCharacterBindNotTheChord', () => {
    const { engine, press, runs } = installed(true, {}, PC_KEYS);
    engine.setBinds(altGraphBinds, TIMEOUT_MS);

    press('@', { code: 'KeyQ', ctrlKey: true, altKey: true, altGraph: true });
    vi.unstubAllGlobals();

    expect(runs.map(([command]) => command)).toEqual(['p.at']);
  });

  it('keydown_CtrlAltWithoutAltGr_RunsTheChord', () => {
    const { engine, press, runs } = installed(true, {}, PC_KEYS);
    engine.setBinds(altGraphBinds, TIMEOUT_MS);

    press('q', { code: 'KeyQ', ctrlKey: true, altKey: true });
    vi.unstubAllGlobals();

    expect(runs.map(([command]) => command)).toEqual(['p.chord']);
  });
});
