import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { DemoSection, DemoStep } from '../../../contracts/demo';
import { errorText } from '../../../shared/error-text';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import { REAL_SESSION_STEP_ID } from '../contract';
import {
  createRunDriver,
  type RunDriver,
  type RunDriverState,
  runOrder,
} from './run-driver';

interface BeatSpec {
  name: string;
  dwellSeconds?: number;
}

// A step whose enter, beats and dispose record into `calls` as
// `enter <id>`, `show <beat>` and `dispose <id>`; `before` runs at the start
// of each enter, to hold or reject it.
function fakeStep(
  calls: string[],
  id: string,
  beats: readonly (string | BeatSpec)[],
  options: {
    section?: DemoSection;
    order?: number;
    before?: () => Promise<void>;
  } = {},
): DemoStep {
  return {
    id,
    section: options.section ?? 'shell',
    order: options.order ?? 1,
    title: id,
    caption: `${id} caption`,
    files: [],
    async enter() {
      calls.push(`enter ${id}`);
      await options.before?.();
      return {
        beats: beats.map((beat) => {
          const spec = typeof beat === 'string' ? { name: beat } : beat;
          return { ...spec, show: () => void calls.push(`show ${spec.name}`) };
        }),
        dispose: () => void calls.push(`dispose ${id}`),
      };
    },
  };
}

// Lets every move a fired timer queued run to its end.
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Timers that fire only when `advanceTo` reaches their due time, counted in
// ms from the driver's creation.
function manualTimers() {
  let now = 0;
  let lastHandle = 0;
  const pending = new Map<number, { dueAt: number; run: () => void }>();
  const timers: Timers = {
    set(run, ms) {
      lastHandle += 1;
      pending.set(lastHandle, { dueAt: now + ms, run });
      return lastHandle;
    },
    clear(handle) {
      pending.delete(handle);
    },
  };
  const nextDue = (end: number) =>
    [...pending]
      .filter(([, timer]) => timer.dueAt <= end)
      .sort(([, a], [, b]) => a.dueAt - b.dueAt)
      .at(0);
  return {
    timers,
    async advanceTo(end: number) {
      let due = nextDue(end);
      while (due !== undefined) {
        const [handle, timer] = due;
        now = timer.dueAt;
        pending.delete(handle);
        timer.run();
        await settled();
        due = nextDue(end);
      }
      now = end;
    },
  };
}

function startDriver(steps: DemoStep[], autoplaySeconds = 5) {
  const logs: string[] = [];
  const failures: string[] = [];
  const clock = manualTimers();
  const driver = createRunDriver({
    steps: () => steps,
    enter: (step) => step.enter({ scratchDir: '/scratch', sessions: {} }),
    leave: async (_step, stage) => stage.dispose(),
    timers: clock.timers,
    autoplaySeconds: () => autoplaySeconds,
    changed: () => undefined,
    failed: (stepId, error) => failures.push(`${stepId}: ${errorText(error)}`),
    log: (line) => logs.push(line),
  });
  return { driver, logs, failures, clock };
}

function position(state: RunDriverState) {
  return { stepId: state.stepId, beat: state.beat };
}

describe('createRunDriver', () => {
  it.each<{ name: string; steps: DemoStep[]; expected: string[] }>([
    {
      name: 'section, then order',
      steps: [
        fakeStep([], 'p.bars', ['a'], { section: 'bars', order: 1 }),
        fakeStep([], 'p.shellTwo', ['a'], { section: 'shell', order: 2 }),
        fakeStep([], 'p.shellOne', ['a'], { section: 'shell', order: 1 }),
      ],
      expected: ['p.shellOne', 'p.shellTwo', 'p.bars'],
    },
    {
      name: 'a tie on order, broken by id',
      steps: [
        fakeStep([], 'p.b', ['a'], { section: 'live', order: 3 }),
        fakeStep([], 'p.c', ['a'], { section: 'sessions', order: 3 }),
        fakeStep([], 'p.a', ['a'], { section: 'live', order: 3 }),
      ],
      expected: ['p.c', 'p.a', 'p.b'],
    },
  ])('runOrder_SectionThenOrderThenId_Sorts: $name', ({ steps, expected }) => {
    expect(runOrder(steps).map(({ id }) => id)).toEqual(expected);
  });

  it.each<{
    name: string;
    from: [string, number];
    move(driver: RunDriver): Promise<void>;
    expectedCalls: string[];
    expectedState: { stepId: string; beat: number };
    expectedLog: string;
  }>([
    {
      name: 'next within a step',
      from: ['p.one', 0],
      move: (driver) => driver.next(),
      expectedCalls: ['show one-b'],
      expectedState: { stepId: 'p.one', beat: 1 },
      expectedLog: 'moved next',
    },
    {
      name: 'next from the last beat',
      from: ['p.one', 2],
      move: (driver) => driver.next(),
      expectedCalls: ['dispose p.one', 'enter p.two', 'show two-a'],
      expectedState: { stepId: 'p.two', beat: 0 },
      expectedLog: 'moved next',
    },
    {
      name: 'next at the end',
      from: ['p.two', 1],
      move: (driver) => driver.next(),
      expectedCalls: [],
      expectedState: { stepId: 'p.two', beat: 1 },
      expectedLog: 'at the last beat',
    },
    {
      name: 'previous within a step',
      from: ['p.one', 2],
      move: (driver) => driver.previous(),
      expectedCalls: ['show one-b'],
      expectedState: { stepId: 'p.one', beat: 1 },
      expectedLog: 'moved previous',
    },
    {
      name: 'previous from beat 0',
      from: ['p.two', 0],
      move: (driver) => driver.previous(),
      expectedCalls: ['dispose p.two', 'enter p.one', 'show one-c'],
      expectedState: { stepId: 'p.one', beat: 2 },
      expectedLog: 'moved previous',
    },
    {
      name: 'previous at the start',
      from: ['p.one', 0],
      move: (driver) => driver.previous(),
      expectedCalls: [],
      expectedState: { stepId: 'p.one', beat: 0 },
      expectedLog: 'at the first beat',
    },
    {
      name: 'goTo another step',
      from: ['p.one', 1],
      move: (driver) => driver.goTo('p.two'),
      expectedCalls: ['dispose p.one', 'enter p.two', 'show two-a'],
      expectedState: { stepId: 'p.two', beat: 0 },
      expectedLog: 'went to p.two',
    },
    {
      name: 'goTo the held step',
      from: ['p.one', 1],
      move: (driver) => driver.goTo('p.one'),
      expectedCalls: ['dispose p.one', 'enter p.one', 'show one-a'],
      expectedState: { stepId: 'p.one', beat: 0 },
      expectedLog: 'went to p.one',
    },
    {
      name: 'reset',
      from: ['p.two', 1],
      move: (driver) => driver.reset(),
      expectedCalls: ['dispose p.two', 'enter p.two', 'show two-a'],
      expectedState: { stepId: 'p.two', beat: 0 },
      expectedLog: 'reset p.two',
    },
  ])(
    'moves_FromPosition_LandOnBeatOrStep: $name',
    async ({ from, move, expectedCalls, expectedState, expectedLog }) => {
      const calls: string[] = [];
      // Listed out of run order, so the moves follow the sort and not the list.
      const { driver, logs } = startDriver([
        fakeStep(calls, 'p.two', ['two-a', 'two-b'], { order: 2 }),
        fakeStep(calls, 'p.one', ['one-a', 'one-b', 'one-c'], { order: 1 }),
      ]);
      const [stepId, beat] = from;
      await driver.goTo(stepId);
      for (let shown = 0; shown < beat; shown += 1) {
        await driver.next();
      }
      calls.length = 0;

      await move(driver);

      expect({
        calls,
        state: position(driver.state()),
        lastLog: logs.at(-1),
      }).toEqual({
        calls: expectedCalls,
        state: expectedState,
        lastLog: expectedLog,
      });
    },
  );

  it('goTo_UnknownId_RejectsAndKeepsTheStep', async () => {
    const calls: string[] = [];
    const { driver } = startDriver([
      fakeStep(calls, 'p.one', ['one-a', 'one-b']),
    ]);
    await driver.start();
    await driver.next();
    calls.length = 0;

    await expect(driver.goTo('nope')).rejects.toThrow('No demo step nope.');

    expect({ calls, state: position(driver.state()) }).toEqual({
      calls: [],
      state: { stepId: 'p.one', beat: 1 },
    });
  });

  it.each<{
    setting: number;
    dwellSeconds: number | undefined;
    firesAtMs: number;
  }>([
    { setting: 5, dwellSeconds: undefined, firesAtMs: 5000 },
    { setting: 5, dwellSeconds: 8, firesAtMs: 8000 },
    { setting: 5, dwellSeconds: 2, firesAtMs: 5000 },
    { setting: 0, dwellSeconds: undefined, firesAtMs: 1000 },
  ])(
    'autoplay_Dwell_IsTheLongerOfSettingAndBeat: setting $setting, dwell $dwellSeconds → $firesAtMs ms',
    async ({ setting, dwellSeconds, firesAtMs }) => {
      const { driver, clock } = startDriver(
        [fakeStep([], 'p.one', [{ name: 'one-a', dwellSeconds }, 'one-b'])],
        setting,
      );
      await driver.start();
      driver.setAutoplay(true);

      await clock.advanceTo(firesAtMs - 1);
      const beatBefore = driver.state().beat;
      await clock.advanceTo(firesAtMs);

      expect({ beatBefore, beatAfter: driver.state().beat }).toEqual({
        beatBefore: 0,
        beatAfter: 1,
      });
    },
  );

  it('autoplay_BeforeRealSession_StopsWithoutEntering', async () => {
    const calls: string[] = [];
    const { driver, logs, clock } = startDriver([
      fakeStep(calls, 'p.one', ['one-a']),
      fakeStep(calls, REAL_SESSION_STEP_ID, ['hello'], {
        section: 'live',
        order: 1000,
      }),
    ]);
    await driver.start();
    driver.setAutoplay(true);
    calls.length = 0;

    await clock.advanceTo(5000);
    const afterFire = {
      calls: [...calls],
      autoplay: driver.state().autoplay,
      stopLogged: logs.includes(
        `autoplay stopped before ${REAL_SESSION_STEP_ID}`,
      ),
    };
    await driver.next();

    expect({ afterFire, afterNext: calls }).toEqual({
      afterFire: { calls: [], autoplay: false, stopLogged: true },
      afterNext: [
        'dispose p.one',
        `enter ${REAL_SESSION_STEP_ID}`,
        'show hello',
      ],
    });
  });

  it('autoplay_KeyMove_RestartsTheDwell', async () => {
    const { driver, clock } = startDriver([
      fakeStep([], 'p.one', ['one-a', 'one-b', 'one-c']),
    ]);
    await driver.start();
    driver.setAutoplay(true);

    await clock.advanceTo(3000);
    await driver.next();
    await clock.advanceTo(7999);
    const beatBeforeDwell = driver.state().beat;
    await clock.advanceTo(8000);

    expect({ beatBeforeDwell, beatAfterDwell: driver.state().beat }).toEqual({
      beatBeforeDwell: 1,
      beatAfterDwell: 2,
    });
  });

  it('enter_Rejects_HoldsAFailedStageAndMovesOn', async () => {
    const calls: string[] = [];
    const { driver, logs, failures } = startDriver([
      fakeStep(calls, 'p.one', ['one-a'], {
        order: 1,
        before: async () => {
          throw new Error('boom');
        },
      }),
      fakeStep(calls, 'p.two', ['two-a'], { order: 2 }),
    ]);

    await driver.start();
    const held = {
      state: driver.state(),
      failures: [...failures],
      shown: logs.at(-1),
    };
    await driver.next();

    expect({ held, afterNext: position(driver.state()) }).toEqual({
      held: {
        state: { stepId: 'p.one', beat: 0, beatCount: 1, autoplay: false },
        failures: ['p.one: boom'],
        shown: 'showing p.one beat 1 of 1: failed',
      },
      afterNext: { stepId: 'p.two', beat: 0 },
    });
  });

  it('calls_DuringAnEnter_WaitForIt', async () => {
    const calls: string[] = [];
    const gate = deferred<void>();
    const { driver } = startDriver([
      fakeStep(calls, 'p.one', ['one-a', 'one-b'], {
        before: () => gate.promise,
      }),
    ]);

    const starting = driver.start();
    const moving = driver.next();
    await settled();
    const whileHeld = [...calls];
    gate.resolve();
    await Promise.all([starting, moving]);

    expect({ whileHeld, calls }).toEqual({
      whileHeld: ['enter p.one'],
      calls: ['enter p.one', 'show one-a', 'show one-b'],
    });
  });
});
