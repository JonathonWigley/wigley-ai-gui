import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coreThemeSlot } from '../../../contracts/core-state';
import type { TerminalExit } from '../../../contracts/terminals';
import { createFakeTerminalEmulator } from '../../../shared/fake-terminal-emulator';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import {
  asFake,
  type FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  deferred,
  fakeDependency,
  noCounts,
} from '../../../shared/plugin-part-harness.test-support';
import {
  NEEDS_YOU_ACTIVITY,
  type RowActivity,
  type SessionDrawerHandle,
  type SessionDrawerView,
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { TerminalOpened } from '../contract';
import { terminalPagePart } from './start';

const EXIT_0: TerminalExit = { code: 0, signal: null, error: null };
const EXIT_LINE =
  '\r\n[shell exited: code 0] Press Enter to start a new shell.\r\n';
const R: TerminalOpened = {
  shell: 'A',
  buffer: 'ab',
  seq: 2,
  folder: '/work/alpha',
  exit: null,
};
const REPLY_B: TerminalOpened = { ...R, shell: 'B', buffer: '$ z', seq: 1 };
const RESTARTED: TerminalOpened = { ...R, shell: 'B', buffer: '', seq: 0 };

// Lets a settled reply's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// One drawer sessions was handed, with what the part did to its handle.
interface FakeDrawer {
  view: SessionDrawerView;
  opens: { focus: boolean }[];
  closes: number;
  returnFocuses: number;
  isOpen: boolean;
  disposed: boolean;
}

// Sessions' page exports, faked: each drawer added by session id, each
// `setActivity` call, and a shown session the test sets.
function fakeSessions() {
  const drawers = new Map<string, FakeDrawer>();
  const activities: [string, string, RowActivity | null][] = [];
  const state = { shown: 's1' as string | null };
  const dependency = fakeDependency(
    sessionsPageKey,
    (consumer) =>
      ({
        addDrawer(sessionId: string, view: SessionDrawerView) {
          const drawer: FakeDrawer = {
            view,
            opens: [],
            closes: 0,
            returnFocuses: 0,
            isOpen: false,
            disposed: false,
          };
          drawers.set(sessionId, drawer);
          const handle: SessionDrawerHandle = {
            open(options) {
              drawer.opens.push(options);
              drawer.isOpen = true;
            },
            close() {
              drawer.closes += 1;
              drawer.isOpen = false;
            },
            isOpen: () => drawer.isOpen,
            returnFocus() {
              drawer.returnFocuses += 1;
            },
            dispose() {
              drawer.disposed = true;
            },
          };
          return consumer.track(handle);
        },
        shownSessionId: () => state.shown,
        setActivity(
          sessionId: string,
          sourceId: string,
          activity: RowActivity | null,
        ) {
          activities.push([sessionId, sourceId, activity]);
        },
      }) as unknown as SessionsPageExports,
  );
  return { dependency, drawers, activities, state };
}

// The part over faked sessions, the fake emulator and an `invoke` that holds
// each `open` and `restart` reply for the test to settle; row `s1` is
// labelled `alpha`.
function startTerminal() {
  const emulator = createFakeTerminalEmulator();
  const sessions = fakeSessions();
  const calls: unknown[][] = [];
  const replies: ReturnType<typeof deferred<TerminalOpened>>[] = [];
  const harness = startDrawingPagePart(terminalPagePart, {
    dependencies: [sessions.dependency],
    services: { terminals: emulator },
    invoke: (method, ...args) => {
      calls.push([method, ...args]);
      if (method !== 'open' && method !== 'restart') {
        return Promise.resolve();
      }
      const reply = deferred<TerminalOpened>();
      replies.push(reply);
      return reply.promise;
    },
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  rows.set('s1', sessionRow('s1', { label: 'alpha' }));
  const drawer = (sessionId = 's1') => {
    const found = sessions.drawers.get(sessionId);
    if (found === undefined) {
      throw new Error(`no drawer for ${sessionId}`);
    }
    return found;
  };
  const world = {
    harness,
    emulator,
    sessions,
    calls,
    rows,
    drawer,
    screen: () => emulator.screens[0],
    invoked: (method: string) =>
      calls.filter(([called]) => called === method).map(([, ...args]) => args),
    logged: () =>
      harness.logs
        .filter(({ source }) => source === 'terminal')
        .map(({ message }) => message),
    toggle: () => harness.started().commands.toggle({ arg: undefined }),
    send: (message: string, data: unknown) => harness.send(message, data),
    // Settles the last held `open` or `restart` call with `reply`.
    answer: async (reply: TerminalOpened) => {
      replies.at(-1)?.resolve(reply);
      await settle();
    },
    reject: async (error: Error) => {
      replies.at(-1)?.reject(error);
      await settle();
    },
    // Opens s1's drawer, shows it, and settles its `open` with `reply`.
    openWith: async (reply: TerminalOpened = R) => {
      world.toggle();
      drawer().view.shown();
      await world.answer(reply);
    },
  };
  return world;
}

type World = ReturnType<typeof startTerminal>;

function data(shell: string, seq: number, chunk: string, sessionId = 's1') {
  return { sessionId, shell, chunk, seq };
}

describe('terminalPagePart', () => {
  beforeEach(() => {
    installFocusFakeDom(vi.stubGlobal);
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) =>
        name === '--wg-text-13' ? '13px' : '',
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness, toggle, drawer, screen } = startTerminal();
    toggle();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect([harness.counts(), drawer().disposed, screen().disposed]).toEqual([
      noCounts,
      true,
      true,
    ]);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startTerminal();
    harness.ready();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it('typed_OpensWithoutFocusAndMarks', () => {
    const { send, drawer, sessions, logged } = startTerminal();

    send('typed', { sessionId: 's1', shell: 'A', text: 'x' });

    expect([drawer().opens, sessions.activities, logged()]).toEqual([
      [{ focus: false }],
      [['s1', 'terminal', NEEDS_YOU_ACTIVITY]],
      ['typed in alpha'],
    ]);
  });

  it.each([
    { case: 'a letter', input: 'x', cleared: [], isLineLogged: false },
    {
      case: 'Enter',
      input: '\r',
      cleared: [['s1', 'terminal', null]],
      isLineLogged: true,
    },
  ])('input_Mark_$case', async ({ input, cleared, isLineLogged }) => {
    const world = startTerminal();
    world.send('typed', { sessionId: 's1', shell: 'A', text: 'x' });
    world.drawer().view.shown();
    await world.answer(R);

    world.screen().type(input);

    expect([
      world.invoked('write'),
      world.sessions.activities.filter(([, , activity]) => activity === null),
      world.logged().includes('line sent in alpha'),
    ]).toEqual([[['s1', input]], cleared, isLineLogged]);
  });

  it('toggle_OpenDrawer_ClosesAndClearsTheMark', () => {
    const { toggle, drawer, sessions, logged } = startTerminal();

    toggle();
    toggle();

    expect([
      drawer().opens,
      drawer().closes,
      sessions.activities,
      logged(),
    ]).toEqual([
      [{ focus: true }],
      1,
      [['s1', 'terminal', null]],
      ['drawer opened in alpha', 'drawer closed in alpha'],
    ]);
  });

  it('toggle_NoShownSession_Logs', () => {
    const { toggle, sessions, logged } = startTerminal();
    sessions.state.shown = null;

    toggle();

    expect([logged(), sessions.drawers.size]).toEqual([
      ['no session shown'],
      0,
    ]);
  });

  it('shown_FirstTime_OpensAtTheScreenSize', () => {
    const { toggle, drawer, screen, invoked } = startTerminal();
    toggle();
    screen().size = { cols: 100, rows: 30 };

    drawer().view.shown();
    drawer().view.shown();

    expect(invoked('open')).toEqual([['s1', 100, 30]]);
  });

  it.each([
    {
      case: 'after the reply',
      before: [],
      after: [data('A', 1, 'a'), data('A', 2, 'b'), data('A', 3, 'c')],
      written: ['ab', 'c'],
    },
    {
      case: 'while open waits',
      before: [data('A', 3, 'c')],
      after: [],
      written: ['ab', 'c'],
    },
    {
      case: 'stale while waiting',
      before: [data('A', 2, 'b')],
      after: [],
      written: ['ab'],
    },
    {
      case: 'other shell while waiting',
      before: [data('B', 1, 'z')],
      after: [],
      written: ['ab'],
    },
    {
      case: 'no drawer',
      before: [],
      after: [data('A', 1, 'a', 's2')],
      written: ['ab'],
    },
  ])('data_Order_$case', async ({ before, after, written }) => {
    const world = startTerminal();
    world.toggle();
    world.drawer().view.shown();
    for (const message of before) {
      world.send('data', message);
    }
    await world.answer(R);

    for (const message of after) {
      world.send('data', message);
    }

    expect([
      world.emulator.screens.length,
      world.screen().written,
      world.screen().resets,
    ]).toEqual([1, written, 0]);
  });

  it.each([
    {
      case: 'data of another shell',
      arrive: (world: World) => world.send('data', data('B', 1, 'z')),
    },
    {
      case: 'typed for another shell',
      arrive: (world: World) =>
        world.send('typed', { sessionId: 's1', shell: 'B', text: 'z' }),
    },
  ])('newShell_Reopens_$case', async ({ arrive }) => {
    const world = startTerminal();
    await world.openWith(R);

    arrive(world);
    const opens = world.invoked('open').length;
    await world.answer(REPLY_B);

    expect([
      opens,
      world.screen().resets,
      world.screen().written.at(-1),
      world.screen().written.includes('z'),
    ]).toEqual([2, 1, '$ z', false]);
  });

  it('restart_DropsOldQueuedChunks', async () => {
    const world = startTerminal();
    await world.openWith({ ...R, exit: EXIT_0 });

    world.screen().type('\r');
    world.send('data', data('A', 3, 'old'));
    await world.answer(RESTARTED);

    expect([
      world.screen().resets,
      world.screen().written.includes('old'),
      world.logged().includes('restarted in alpha'),
    ]).toEqual([1, false, true]);
  });

  it('reply_WithExit_WritesTheExitLine', async () => {
    const world = startTerminal();

    await world.openWith({ ...R, exit: EXIT_0 });

    expect(world.screen().written).toEqual(['ab', EXIT_LINE]);
  });

  it('exited_WhileWaiting_WrittenAfterTheBuffer', async () => {
    const world = startTerminal();
    world.toggle();
    world.drawer().view.shown();
    world.send('exited', { sessionId: 's1', shell: 'A', exit: EXIT_0 });

    await world.answer(R);

    expect([
      world.screen().written,
      world.logged().filter((line) => line === 'shell exited in alpha: code 0'),
    ]).toEqual([['ab', EXIT_LINE], ['shell exited in alpha: code 0']]);
  });

  it('pending_HoldsInputAndSendsTheLastSize', async () => {
    const world = startTerminal();
    world.toggle();
    world.screen().size = { cols: 100, rows: 30 };
    world.drawer().view.shown();
    world.screen().type('l');
    world.screen().type('s');
    world.screen().resizeTo({ cols: 90, rows: 20 });
    const sentWhileWaiting = world.calls.slice(1);

    await world.answer(R);

    expect([sentWhileWaiting, world.calls.slice(1)]).toEqual([
      [],
      [
        ['resize', 's1', 90, 20],
        ['write', 's1', 'l'],
        ['write', 's1', 's'],
      ],
    ]);
  });

  it('resize_Opened_InvokesResize', async () => {
    const world = startTerminal();
    await world.openWith(R);

    world.screen().resizeTo({ cols: 90, rows: 20 });

    expect(world.invoked('resize')).toEqual([['s1', 90, 20]]);
  });

  it('exited_WritesTheLineAndEnterRestarts', async () => {
    const world = startTerminal();
    await world.openWith(R);

    world.send('exited', { sessionId: 's1', shell: 'A', exit: EXIT_0 });
    const lastWritten = world.screen().written.at(-1);
    world.screen().type('\r');
    const restarts = world.invoked('restart');
    await world.answer(RESTARTED);

    expect([
      lastWritten,
      restarts,
      world.invoked('write'),
      world.screen().resets,
    ]).toEqual([EXIT_LINE, [['s1', 80, 24]], [], 1]);
  });

  it.each([
    { case: 'running shell', reply: R as TerminalOpened | null, restarts: 0 },
    { case: 'exited shell', reply: { ...R, exit: EXIT_0 }, restarts: 1 },
    { case: 'no drawer', reply: null, restarts: 0 },
  ])('restartCommand_$case', async ({ reply, restarts }) => {
    const world = startTerminal();
    if (reply !== null) {
      await world.openWith(reply);
    }

    world.harness.started().commands.restart({ arg: 's1' });

    expect(world.invoked('restart').length).toBe(restarts);
  });

  it('open_Rejects_WritesTheFailure', async () => {
    const world = startTerminal();
    world.toggle();
    world.drawer().view.shown();

    await world.reject(new Error('terminal found no shell program to start'));
    world.drawer().view.shown();

    expect([
      world.screen().written.at(-1),
      world.logged().at(-1),
      world.invoked('open').length,
    ]).toEqual([
      '\r\n[terminal: terminal found no shell program to start]\r\n',
      'open failed in alpha: terminal found no shell program to start',
      2,
    ]);
  });

  it.each([
    {
      case: 'focus in the drawer',
      focus: (world: World) =>
        asFake(world.screen().screen.element) as FocusFakeElement,
      returnFocuses: 1,
      logged: ['back to the session in alpha'],
    },
    {
      case: 'focus outside every drawer',
      focus: (_world: World) =>
        document.createElement('div') as unknown as FocusFakeElement,
      returnFocuses: 0,
      logged: [],
    },
  ])('back_$case', ({ focus, returnFocuses, logged }) => {
    const world = startTerminal();
    world.toggle();
    focus(world).focus();
    const loggedBefore = world.logged().length;

    world.harness.started().commands.back({ arg: undefined });

    expect([
      world.drawer().returnFocuses,
      world.logged().slice(loggedBefore),
    ]).toEqual([returnFocuses, logged]);
  });

  it('focus_SetsTheTerminalScope', () => {
    const world = startTerminal();
    world.toggle();

    world.drawer().view.focus();

    expect([world.harness.scope(), world.screen().focuses]).toEqual([
      'terminal.terminal',
      1,
    ]);
  });

  it('rowRemoved_DisposesTheDrawer', () => {
    const world = startTerminal();
    world.toggle();

    world.rows.delete('s1');

    expect([world.drawer().disposed, world.screen().disposed]).toEqual([
      true,
      true,
    ]);
  });

  it('themeChange_SetsThePaletteOnEveryScreen', () => {
    const world = startTerminal();
    world.toggle();
    world.sessions.state.shown = 's2';
    world.toggle();

    world.harness.state.publish(coreThemeSlot).set('dark');

    expect(world.emulator.screens.map(({ palettes }) => palettes.length)).toEqual(
      [1, 1],
    );
  });
});
