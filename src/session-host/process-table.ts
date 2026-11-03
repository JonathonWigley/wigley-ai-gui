import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Clock, Timers } from '../contracts/ambient';
import type {
  HostedExit,
  HostedSpawn,
  IdleRule,
  PipeDirection,
  PipeLine,
} from '../contracts/session-host';
import {
  HOST_END_GRACE_MS,
  type ListedProcess,
} from '../contracts/session-host-protocol';
import { readLines } from '../shared/local-channel/line-framing';
import type { DiagnosticLog } from './diagnostic-log';
import { createPipeLog, type PipeLog } from './pipe-log';

const DEFAULT_KEEP_IDLE_MINUTES = 60;
const MS_PER_MINUTE = 60_000;
// `setTimeout` fires at once past this delay.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

export type HostSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

// The one receiver of a process's live lines and its close.
export interface ProcessSubscriber {
  line(id: string, line: PipeLine): void;
  closed(id: string, exit: HostedExit): void;
}

export interface ProcessTableDeps {
  spawn: HostSpawn;
  clock: Clock;
  timers: Timers;
  logsFolder: string;
  diagnostics: DiagnosticLog;
  // After a process has left the table.
  processClosed(): void;
}

export interface ProcessTable {
  // Subscribes `subscriber`. A refused or failed spawn calls its `closed`, with no other process touched.
  spawn(request: HostedSpawn, subscriber: ProcessSubscriber): void;
  // `write`, `endInput` and `kill` do nothing for an id the table does not hold.
  write(id: string, text: string): void;
  endInput(id: string): void;
  kill(id: string, signal: 'SIGTERM' | 'SIGKILL'): void;
  // Replaces any earlier subscriber, and returns the log's path. `log` is null, and nothing is subscribed, when the
  // process is unknown or ending (`running` false) or its log is incomplete (`running` true).
  subscribe(
    id: string,
    subscriber: ProcessSubscriber,
  ): { running: boolean; log: string | null };
  // Does nothing unless `subscriber` is process `id`'s.
  unsubscribe(id: string, subscriber: ProcessSubscriber): void;
  dropSubscriber(subscriber: ProcessSubscriber): void;
  list(): ListedProcess[];
  // Refuses a value that is not finite, keeping the window it has.
  setKeepIdleMinutes(minutes: number): void;
  // The keep window runs only while this is false, the state the table starts in.
  setClientConnected(connected: boolean): void;
  // Ends each idle process now and each other when it turns idle; every later spawn is refused.
  drain(): void;
  // Calls `done` once the table is empty, at once when it already is.
  stopAll(done: () => void): void;
}

interface TableProcess {
  id: string;
  child: ChildProcessWithoutNullStreams;
  log: PipeLog;
  idleRule: IdleRule;
  startedAt: number;
  subscriber: ProcessSubscriber | null;
  isIdle: boolean;
  idleSince: number;
  keepTimer: number | null;
  signalTimers: number[];
  isEnding: boolean;
}

function valueAtKey(text: string, key: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

function isBusyValue(value: unknown, busyValues: readonly string[]): boolean {
  return typeof value === 'string' && busyValues.includes(value);
}

// Every line reads the rule, so a bad one would otherwise throw far from the request that carried it.
function requireIdleRule({ id, idleRule }: HostedSpawn) {
  const isWellFormed =
    typeof idleRule?.key === 'string' &&
    Array.isArray(idleRule.busyStdoutValues) &&
    Array.isArray(idleRule.busyStdinValues);
  if (!isWellFormed) {
    throw new Error(`process ${id} has no well-formed idle rule`);
  }
}

export function createProcessTable(deps: ProcessTableDeps): ProcessTable {
  const { clock, timers, diagnostics } = deps;
  const processes = new Map<string, TableProcess>();
  const stopWaiters: (() => void)[] = [];
  let keepIdleMinutes = DEFAULT_KEEP_IDLE_MINUTES;
  let clientConnected = false;
  let lastClientLeftAt = 0;
  let draining = false;

  function cancelKeepTimer(hosted: TableProcess) {
    if (hosted.keepTimer !== null) {
      timers.clear(hosted.keepTimer);
      hosted.keepTimer = null;
    }
  }

  function armKeepTimer(hosted: TableProcess) {
    cancelKeepTimer(hosted);
    if (!hosted.isIdle || hosted.isEnding || clientConnected) {
      return;
    }
    const deadline =
      Math.max(hosted.idleSince, lastClientLeftAt) +
      keepIdleMinutes * MS_PER_MINUTE;
    const delay = Math.max(0, deadline - clock.now());
    hosted.keepTimer = timers.set(
      () => {
        if (clock.now() < deadline) {
          armKeepTimer(hosted);
        } else {
          endProcess(hosted);
        }
      },
      Math.min(delay, MAX_TIMER_DELAY_MS),
    );
  }

  function endProcess(hosted: TableProcess) {
    if (hosted.isEnding) {
      return;
    }
    hosted.isEnding = true;
    cancelKeepTimer(hosted);
    hosted.child.stdin.end();
    hosted.signalTimers.push(
      timers.set(() => {
        hosted.child.kill('SIGTERM');
        hosted.signalTimers.push(
          timers.set(() => hosted.child.kill('SIGKILL'), HOST_END_GRACE_MS),
        );
      }, HOST_END_GRACE_MS),
    );
  }

  function turnIdle(hosted: TableProcess) {
    if (hosted.isIdle) {
      return;
    }
    hosted.isIdle = true;
    hosted.idleSince = clock.now();
    if (draining) {
      endProcess(hosted);
    } else {
      armKeepTimer(hosted);
    }
  }

  function turnBusy(hosted: TableProcess) {
    hosted.isIdle = false;
    cancelKeepTimer(hosted);
  }

  function childLine(hosted: TableProcess, dir: PipeDirection, text: string) {
    const line = hosted.log.append(dir, text);
    hosted.subscriber?.line(hosted.id, line);
    if (dir !== 'out') {
      return;
    }
    const rule = hosted.idleRule;
    const value = valueAtKey(text, rule.key);
    if (value === rule.value) {
      turnIdle(hosted);
    } else if (isBusyValue(value, rule.busyStdoutValues)) {
      turnBusy(hosted);
    }
  }

  function closeProcess(hosted: TableProcess, exit: HostedExit) {
    // A failed spawn emits `error`, then `close`; a late event may name an id spawned again since.
    if (processes.get(hosted.id) !== hosted) {
      return;
    }
    cancelKeepTimer(hosted);
    for (const timer of hosted.signalTimers) {
      timers.clear(timer);
    }
    hosted.subscriber?.closed(hosted.id, exit);
    hosted.log.remove();
    processes.delete(hosted.id);
    if (processes.size === 0) {
      for (const done of stopWaiters.splice(0)) {
        done();
      }
    }
    deps.processClosed();
  }

  function logStreamErrors(
    hosted: TableProcess,
    streamName: string,
    stream: NodeJS.EventEmitter,
  ) {
    stream.on('error', (error: Error) =>
      diagnostics.append(`${hosted.id} ${streamName}: ${error.message}`),
    );
  }

  function wireChild(hosted: TableProcess) {
    const { child } = hosted;
    child.on('error', (error) => {
      // A child with no pid never ran, and no other event tells of it; a later error leaves `close` to come.
      if (child.pid === undefined) {
        closeProcess(hosted, {
          code: null,
          signal: null,
          error: error.message,
        });
      } else {
        diagnostics.append(`${hosted.id}: ${error.message}`);
      }
    });
    child.on('close', (code, signal) =>
      closeProcess(hosted, { code, signal, error: null }),
    );
    // A grandchild can hold the pipes past the exit, and `close` waits for them.
    child.once('exit', () => {
      hosted.signalTimers.push(
        timers.set(() => {
          child.stdout.destroy();
          child.stderr.destroy();
        }, HOST_END_GRACE_MS),
      );
    });
    // After the `error` listener: a child refused at EMFILE has no pipes, and its `error` still comes.
    logStreamErrors(hosted, 'stdin', child.stdin);
    logStreamErrors(hosted, 'stdout', child.stdout);
    logStreamErrors(hosted, 'stderr', child.stderr);
    readLines(child.stdout, (text) => childLine(hosted, 'out', text), {
      flushPartialAtEnd: true,
    });
    readLines(child.stderr, (text) => childLine(hosted, 'err', text), {
      flushPartialAtEnd: true,
    });
  }

  function refusalOf(id: string): string | null {
    if (draining) {
      return 'the session host is draining';
    }
    return processes.has(id) ? `a process with id ${id} already exists` : null;
  }

  return {
    spawn(request, subscriber) {
      const refuse = (error: string) =>
        subscriber.closed(request.id, { code: null, signal: null, error });
      const refusal = refusalOf(request.id);
      if (refusal !== null) {
        refuse(refusal);
        return;
      }
      let log: PipeLog | null = null;
      try {
        requireIdleRule(request);
        log = createPipeLog(deps.logsFolder, request.id, clock, (message) =>
          diagnostics.append(message),
        );
        const child = deps.spawn(request.command, request.args, {
          cwd: request.cwd,
          env: request.env,
        });
        const startedAt = clock.now();
        const hosted: TableProcess = {
          id: request.id,
          child,
          log,
          idleRule: request.idleRule,
          startedAt,
          subscriber,
          isIdle: true,
          idleSince: startedAt,
          keepTimer: null,
          signalTimers: [],
          isEnding: false,
        };
        wireChild(hosted);
        processes.set(request.id, hosted);
        armKeepTimer(hosted);
      } catch (error) {
        log?.remove();
        refuse((error as Error).message);
      }
    },
    write(id, text) {
      const hosted = processes.get(id);
      if (hosted === undefined) {
        return;
      }
      hosted.log.append('in', text);
      const value = valueAtKey(text, hosted.idleRule.key);
      if (isBusyValue(value, hosted.idleRule.busyStdinValues)) {
        turnBusy(hosted);
      }
      hosted.child.stdin.write(`${text}\n`);
    },
    endInput(id) {
      processes.get(id)?.child.stdin.end();
    },
    kill(id, signal) {
      processes.get(id)?.child.kill(signal);
    },
    subscribe(id, subscriber) {
      const hosted = processes.get(id);
      if (hosted === undefined || hosted.isEnding) {
        return { running: false, log: null };
      }
      if (!hosted.log.isComplete) {
        return { running: true, log: null };
      }
      hosted.subscriber = subscriber;
      return { running: true, log: hosted.log.file };
    },
    unsubscribe(id, subscriber) {
      const hosted = processes.get(id);
      if (hosted?.subscriber === subscriber) {
        hosted.subscriber = null;
      }
    },
    dropSubscriber(subscriber) {
      for (const hosted of processes.values()) {
        if (hosted.subscriber === subscriber) {
          hosted.subscriber = null;
        }
      }
    },
    list() {
      return [...processes.values()].map((hosted) => ({
        id: hosted.id,
        startedAt: hosted.startedAt,
        running: !hosted.isEnding,
        code: null,
        signal: null,
        log: hosted.log.file,
      }));
    },
    setKeepIdleMinutes(minutes) {
      if (!Number.isFinite(minutes)) {
        diagnostics.append(`refused keep window: ${minutes}`);
        return;
      }
      keepIdleMinutes = minutes;
      for (const hosted of processes.values()) {
        armKeepTimer(hosted);
      }
    },
    setClientConnected(connected) {
      clientConnected = connected;
      if (!connected) {
        lastClientLeftAt = clock.now();
      }
      for (const hosted of processes.values()) {
        armKeepTimer(hosted);
      }
    },
    drain() {
      draining = true;
      for (const hosted of processes.values()) {
        if (hosted.isIdle) {
          endProcess(hosted);
        }
      }
    },
    stopAll(done) {
      if (processes.size === 0) {
        done();
        return;
      }
      stopWaiters.push(done);
      for (const hosted of processes.values()) {
        hosted.child.kill('SIGTERM');
        hosted.signalTimers.push(
          timers.set(() => hosted.child.kill('SIGKILL'), HOST_END_GRACE_MS),
        );
      }
    },
  };
}
