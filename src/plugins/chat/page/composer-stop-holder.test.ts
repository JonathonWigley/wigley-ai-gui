import { describe, expect, it } from 'vitest';
import type {
  ChatComposerPart,
  ComposerStop,
  ComposerStopExits,
} from '../contract';
import { createComposerStopHolder } from './composer-stop-holder';

type Enter = 'takes' | 'declines' | 'throws';

// A part whose stop's `enter` takes the cursor, declines it or throws, as
// `enter` says, and keeps the exits it was handed; `calls` records each
// `enter` and `leave` by part id, in order. With `leaveThrows` its `leave`
// throws after recording the call.
function part(id: string, enter: Enter, calls: string[], leaveThrows = false) {
  const held: { exits: ComposerStopExits | null } = { exits: null };
  const stop: ComposerStop = {
    enter(_sessionId, exits) {
      calls.push(`enter ${id}`);
      held.exits = exits;
      if (enter === 'throws') {
        throw new Error('no roster');
      }
      return enter === 'takes';
    },
    leave() {
      calls.push(`leave ${id}`);
      if (leaveThrows) {
        throw new Error('gone');
      }
    },
  };
  const built: ChatComposerPart = { id, build: () => ({}), stop };
  return Object.assign(built, { held });
}

// The holder over one tab, `app`; `calls` records each part call and each
// deps call, `logs` each log line, and `holdingAt` what `holding()` read when
// deps' `toEntries` or `toBox` ran.
function setUp() {
  const calls: string[] = [];
  const logs: string[] = [];
  const holdingAt: (string | null)[] = [];
  const holder = createComposerStopHolder({
    sessionId: 'row-1',
    name: 'app',
    toEntries: () => {
      calls.push('toEntries');
      holdingAt.push(holder.holding());
    },
    toBox: (how) => {
      calls.push(`toBox ${how}`);
      holdingAt.push(holder.holding());
    },
    setChatScope: () => calls.push('setChatScope'),
    changed: (holding) => calls.push(`changed ${holding}`),
    log: (source, message) => logs.push(`[${source}] ${message}`),
  });
  return { holder, calls, logs, holdingAt };
}

describe('composer stop holder', () => {
  it.each([
    {
      case: 'no part has a stop',
      enters: [] as Enter[],
      holding: null,
      calls: [],
      logs: [],
    },
    {
      case: 'the first declines, the second takes',
      enters: ['declines', 'takes'] as Enter[],
      holding: 'p2',
      calls: ['enter p1', 'enter p2', 'changed true'],
      logs: ['[chat] composer part p2 took the cursor in app'],
    },
    {
      case: 'two take',
      enters: ['takes', 'takes'] as Enter[],
      holding: 'p1',
      calls: ['enter p1', 'changed true'],
      logs: ['[chat] composer part p1 took the cursor in app'],
    },
    {
      case: 'the first throws',
      enters: ['throws', 'takes'] as Enter[],
      holding: 'p2',
      calls: ['enter p1', 'enter p2', 'changed true'],
      logs: [
        '[chat] composer part p1 stop failed: no roster',
        '[chat] composer part p2 took the cursor in app',
      ],
    },
  ])('offer_$case', ({ enters, holding, calls, logs }) => {
    const run = setUp();
    const bare: ChatComposerPart = { id: 'bare', build: () => ({}) };
    const parts = [
      bare,
      ...enters.map((enter, index) => part(`p${index + 1}`, enter, run.calls)),
    ];

    const took = run.holder.offer(parts);

    expect(took).toBe(holding);
    expect(run.holder.holding()).toBe(holding);
    expect(run.calls).toEqual(calls);
    expect(run.logs).toEqual(logs);
  });

  it('exits_ToEntries_ClearsAndRunsChatsToEntries', () => {
    const run = setUp();
    const strip = part('strip', 'takes', run.calls);
    run.holder.offer([strip]);

    strip.held.exits!.toEntries();

    expect(run.holder.holding()).toBeNull();
    expect(run.calls).toEqual([
      'enter strip',
      'changed true',
      'changed false',
      'toEntries',
    ]);
    expect(run.logs.at(-1)).toBe('[chat] cursor back on the entries in app');
  });

  it.each(['insert', 'append'] as const)(
    'exits_ToBox_ClearsBeforeFocusing %s',
    (how) => {
      const run = setUp();
      const strip = part('strip', 'takes', run.calls);
      run.holder.offer([strip]);

      strip.held.exits!.toBox(how);

      expect(run.holdingAt).toEqual([null]);
      expect(run.calls).toEqual([
        'enter strip',
        'changed true',
        'changed false',
        `toBox ${how}`,
      ]);
    },
  );

  it.each([
    { case: 'after leave', newerOffer: false },
    { case: 'after a newer offer', newerOffer: true },
  ])('exits_AfterLeaveOrNewerOffer_Ignored $case', ({ newerOffer }) => {
    const run = setUp();
    const strip = part('strip', 'takes', run.calls);
    run.holder.offer([strip]);
    const stale = strip.held.exits!;
    if (newerOffer) {
      run.holder.offer([strip]);
    } else {
      run.holder.leave();
    }
    const callsBefore = [...run.calls];
    const holdingBefore = run.holder.holding();

    stale.toEntries();
    stale.toBox('insert');

    expect(run.calls).toEqual(callsBefore);
    expect(run.holder.holding()).toBe(holdingBefore);
    expect(run.logs.slice(-2)).toEqual([
      '[chat] stale composer stop exit in app ignored',
      '[chat] stale composer stop exit in app ignored',
    ]);
  });

  it.each([
    { case: 'leave runs', leaveThrows: false },
    { case: 'leave throws', leaveThrows: true },
  ])('leave_Holding_CallsPartLeaveOnce $case', ({ leaveThrows }) => {
    const run = setUp();
    const strip = part('strip', 'takes', run.calls, leaveThrows);
    run.holder.offer([strip]);

    run.holder.leave();
    run.holder.leave();

    expect(run.calls).toEqual([
      'enter strip',
      'changed true',
      'leave strip',
      'changed false',
    ]);
    expect(run.holder.holding()).toBeNull();
    expect(run.logs.at(-1)).toBe('[chat] composer part strip left in app');
  });

  it.each([
    {
      case: 'holding, not visible',
      holds: true,
      isVisible: false,
      leaves: ['leave strip', 'changed false'],
    },
    { case: 'holding, visible', holds: true, isVisible: true, leaves: [] },
    { case: 'not holding', holds: false, isVisible: false, leaves: [] },
  ])('scopeChanged_$case', ({ holds, isVisible, leaves }) => {
    const run = setUp();
    const strip = part('strip', holds ? 'takes' : 'declines', run.calls);
    run.holder.offer([strip]);
    const callsBefore = run.calls.length;

    run.holder.scopeChanged(isVisible);

    expect(run.calls.slice(callsBefore)).toEqual(leaves);
  });

  it.each([
    {
      case: 'holding',
      holds: true,
      after: ['leave strip', 'changed false', 'setChatScope'],
    },
    { case: 'not holding', holds: false, after: [] },
  ])('boxFocused_$case', ({ holds, after }) => {
    const run = setUp();
    const strip = part('strip', holds ? 'takes' : 'declines', run.calls);
    run.holder.offer([strip]);
    const callsBefore = run.calls.length;

    run.holder.boxFocused();

    expect(run.calls.slice(callsBefore)).toEqual(after);
  });
});
