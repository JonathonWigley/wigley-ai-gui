import { describe, expect, it } from 'vitest';
import type { Timers } from '../contracts/ambient';
import type { RunMode } from '../contracts/plugin';
import { logSlowQuit, QUIT_WAIT_LOG_MS, quitStep } from './quit-wait';

// Timers that record each set and clear, and run a set callback only when the test fires it.
function recordingTimers() {
  const sets: { handle: number; ms: number; run: () => void }[] = [];
  const clears: number[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      const handle = sets.length + 7;
      sets.push({ handle, ms, run });
      return handle;
    },
    clear: (handle) => {
      clears.push(handle);
    },
  };
  return { timers, sets, clears };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('quitStep', () => {
  it.each<[RunMode, boolean, ReturnType<typeof quitStep>]>([
    ['live', false, 'start'],
    ['drive', false, 'start'],
    ['drive', true, 'exit'],
    ['live', true, 'hold'],
  ])(
    'a %s quit with quitStarted %s takes step %s',
    (runMode, quitStarted, step) => {
      expect(quitStep(runMode, quitStarted)).toBe(step);
    },
  );
});

describe('logSlowQuit', () => {
  it.each<[readonly string[], [string, string][]]>([
    [['chat', 'docs'], [['quit', 'quit is waiting on chat, docs']]],
    [['chat'], [['quit', 'quit is waiting on chat']]],
    [[], []],
  ])(
    'logSlowQuit_TimerFires_LogsStoppingIdsOnce (stopping %j)',
    (stopping, expected) => {
      const { timers, sets } = recordingTimers();
      const logs: [string, string][] = [];
      logSlowQuit(
        deferred().promise,
        () => stopping,
        timers,
        (source, message) => {
          logs.push([source, message]);
        },
      );

      expect(sets.map((set) => set.ms)).toEqual([QUIT_WAIT_LOG_MS]);
      sets[0].run();
      expect(logs).toEqual(expected);
    },
  );

  it('logSlowQuit_WorkSettlesFirst_ClearsTheTimerAndLogsNothing', async () => {
    const { timers, sets, clears } = recordingTimers();
    const logs: [string, string][] = [];
    const work = deferred();
    logSlowQuit(
      work.promise,
      () => ['chat'],
      timers,
      (source, message) => {
        logs.push([source, message]);
      },
    );

    work.resolve();
    await work.promise;
    await Promise.resolve();

    expect(clears).toEqual([sets[0].handle]);
    expect(logs).toEqual([]);
  });
});
