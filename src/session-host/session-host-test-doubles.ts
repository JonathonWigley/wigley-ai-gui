import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Clock, Timers } from '../contracts/ambient';
import type {
  HostedExit,
  HostedSpawn,
  PipeLine,
} from '../contracts/session-host';
import type { ProcessSubscriber } from './process-table';

export const IDLE_RULE = {
  key: 'type',
  value: 'result',
  ignoredStdoutValues: ['note'],
  ignoredStdinValues: ['ask'],
};

export function spawnRequest(id: string): HostedSpawn {
  return {
    id,
    command: '/bin/agent',
    args: [],
    cwd: '/work',
    env: {},
    idleRule: IDLE_RULE,
  };
}

// A settable clock with timers that fire when the test moves it.
export function manualTime(start = 0) {
  let now = start;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const clock: Clock = { now: () => now };
  const timers: Timers = {
    set(run, ms) {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, { at: now + ms, run });
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  return {
    clock,
    timers,
    // Fires every timer due by `time`, in order, each with the clock at its own time.
    advanceTo(time: number) {
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= time)
          .sort(([, a], [, b]) => a.at - b.at)[0];
        if (due === undefined) {
          break;
        }
        pending.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = time;
    },
  };
}

// A child with `PassThrough` stdio; `ran` false is a child that never ran, which has no pid.
export function fakeChild(ran = true) {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const signals: string[] = [];
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid: ran ? 1 : undefined,
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  }) as unknown as ChildProcessWithoutNullStreams;
  return {
    child,
    stdin,
    stdout,
    stderr,
    signals,
    close(code: number | null = 0, signal: string | null = null) {
      emitter.emit('close', code, signal);
    },
    emitError(error: Error) {
      emitter.emit('error', error);
    },
  };
}

export type FakeChild = ReturnType<typeof fakeChild>;

export function recordingSubscriber() {
  const lines: PipeLine[] = [];
  const closed: { id: string; exit: HostedExit }[] = [];
  const subscriber: ProcessSubscriber = {
    line: (_id, line) => lines.push(line),
    closed: (id, exit) => closed.push({ id, exit }),
  };
  return { subscriber, lines, closed };
}

// Lets `PassThrough` data, written before now, reach its listeners.
export function streamsDelivered(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
