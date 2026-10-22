import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import type { PendingKeys } from '../../../contracts/keymap';
import type { WhichKeyModel } from './which-key';
import { startWhichKey } from './which-key-controller';

const DELAY_MS = 200;
const TIMEOUT_MS = 1000;

function fakeTimers() {
  let nextHandle = 1;
  const scheduled = new Map<number, { run: () => void; ms: number }>();
  const timers: Timers = {
    set: (run, ms) => {
      const handle = nextHandle++;
      scheduled.set(handle, { run, ms });
      return handle;
    },
    clear: (handle) => {
      scheduled.delete(handle);
    },
  };
  // Runs every timer set for exactly `ms`, none set while they run.
  const runAfter = (ms: number) => {
    const due = [...scheduled].filter(([, timer]) => timer.ms === ms);
    for (const [handle, timer] of due) {
      scheduled.delete(handle);
      timer.run();
    }
  };
  return { timers, scheduled, runAfter };
}

function modelOf(pending: PendingKeys): WhichKeyModel {
  return { title: pending.keys.join(' '), entries: [] };
}

function setup(
  timeoutMs: number | null = null,
  delayMs: () => number = () => DELAY_MS,
) {
  const clock = fakeTimers();
  const calls: string[] = [];
  const logs: string[] = [];
  let report: (pending: PendingKeys | null) => void = () => undefined;
  startWhichKey({
    onPending: (listener) => {
      report = listener;
    },
    holdPending: () => calls.push('hold'),
    cancelPending: () => {
      calls.push('cancel');
      report(null);
    },
    model: modelOf,
    view: {
      show: (model) => calls.push(`show ${model.title}`),
      hide: () => calls.push('hide'),
    },
    timers: clock.timers,
    delayMs,
    timeoutMs: () => timeoutMs,
    log: (source, message) => logs.push(`[${source}] ${message}`),
  });
  const pend = (...keys: string[]) =>
    report({ where: 'page', keys, scope: 's' });
  return { ...clock, calls, logs, pend, end: () => report(null) };
}

describe('startWhichKey', () => {
  it('startWhichKey_OpensAfterDelay_AndHolds', () => {
    const run = setup();

    run.pend('Space');
    expect(run.calls).toEqual([]);
    run.runAfter(DELAY_MS);

    expect(run.calls).toEqual(['hold', 'show Space']);
    expect(run.logs).toEqual(['[keys] which-key shows Space']);
  });

  it('startWhichKey_OpenAndDeeperPrefix_RedrawsAtOnce', () => {
    const run = setup();
    run.pend('Space');
    run.runAfter(DELAY_MS);

    run.pend('Space', 'a');

    expect(run.calls).toEqual(['hold', 'show Space', 'show Space a']);
    expect(run.logs).toContain('[keys] which-key shows Space a');
  });

  it('startWhichKey_NullReport_HidesAndLogsClosed', () => {
    const run = setup();
    run.pend('Space');
    run.runAfter(DELAY_MS);

    run.end();

    expect(run.calls.at(-1)).toBe('hide');
    expect(run.logs.at(-1)).toBe('[keys] which-key closed');
  });

  it('startWhichKey_ClosedBeforeDelay_NeverShowsOrHolds', () => {
    const run = setup();
    run.pend('Space');

    run.end();
    run.runAfter(DELAY_MS);

    expect(run.calls).toEqual([]);
    expect(run.logs).toEqual([]);
    expect(run.scheduled.size).toBe(0);
  });

  it('startWhichKey_TimeoutSet_CancelsPending', () => {
    const run = setup(TIMEOUT_MS);
    run.pend('Space');
    run.runAfter(DELAY_MS);

    run.runAfter(TIMEOUT_MS);

    expect(run.calls).toEqual(['hold', 'show Space', 'cancel', 'hide']);
    expect(run.logs.at(-1)).toBe('[keys] which-key closed');
  });

  it('startWhichKey_TimeoutNull_NeverCancels', () => {
    const run = setup(null);
    run.pend('Space');
    run.runAfter(DELAY_MS);

    expect(run.scheduled.size).toBe(0);
    expect(run.calls).not.toContain('cancel');
  });

  it('reads the delay when it schedules', () => {
    let delayMs = 200;
    const run = setup(null, () => delayMs);
    run.pend('Space');
    run.runAfter(200);
    run.end();

    delayMs = 50;
    run.pend('Space', 'a');
    run.runAfter(50);

    expect(run.calls).toEqual([
      'hold',
      'show Space',
      'hide',
      'hold',
      'show Space a',
    ]);
  });
});
