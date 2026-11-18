import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Clock, Timers } from '../contracts/ambient';
import type {
  HostedExit,
  HostedSpawn,
  IdleRule,
  KeyPath,
  PipeDirection,
  PipeLine,
} from '../contracts/session-host';
import {
  HOST_END_GRACE_MS,
  type ListedProcess,
} from '../contracts/session-host-protocol';
import { readLines } from '../shared/local-channel/line-framing';
import { MAX_TIMER_MS } from '../shared/tracked-timers';
import type { DiagnosticLog } from './diagnostic-log';
import { createPipeLog, type PipeLog } from './pipe-log';

const DEFAULT_KEEP_IDLE_MINUTES = 60;
const MS_PER_MINUTE = 60_000;
// Claude starts the turn that reports a finished background subagent a few ms after the line that lists none.
export const DRAIN_REPORT_GRACE_MS = 2000;

export type HostSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

// The one receiver of a process's live lines and its close.
export interface ProcessSubscriber {
  line(id: string, line: PipeLine): void;
  closed(id: string, exit: HostedExit): void;
  spawned(id: string, pid: number): void;
}

export interface ProcessTableDeps {
  spawn: HostSpawn;
  // The host's own environment, which a spawn with `inheritEnv` lays its `env` over.
  env: NodeJS.ProcessEnv;
  clock: Clock;
  timers: Timers;
  logsFolder: string;
  diagnostics: DiagnosticLog;
  // After a process has left the table, with the exit its subscriber got.
  processClosed(id: string, exit: HostedExit): void;
}

export interface ProcessTable {
  // Subscribes `subscriber`, and calls its `spawned` before returning when the OS started the process, then writes
  // the spawn's `stdin` lines as `write` does. A refused or failed spawn calls its `closed`, with no other process
  // touched.
  spawn(request: HostedSpawn, subscriber: ProcessSubscriber): void;
  // `write`, `endInput` and `kill` do nothing for an id the table does not hold.
  write(id: string, text: string): void;
  endInput(id: string): void;
  kill(id: string, signal: 'SIGTERM' | 'SIGKILL'): void;
  // Replaces any earlier subscriber, and returns the log's path and the process's pid. `log` is null, and nothing is
  // subscribed, when the process is unknown or ending (`running` false) or its log is incomplete (`running` true).
  // `pid` is null whenever `running` is false.
  subscribe(
    id: string,
    subscriber: ProcessSubscriber,
  ): { running: boolean; log: string | null; pid: number | null };
  // Does nothing unless `subscriber` is process `id`'s.
  unsubscribe(id: string, subscriber: ProcessSubscriber): void;
  dropSubscriber(subscriber: ProcessSubscriber): void;
  list(): ListedProcess[];
  // True when the table holds process `id`, it is not ending, and its idle rule reads it busy.
  isBusy(id: string): boolean;
  // Refuses a value that is not finite, keeping the window it has.
  setKeepIdleMinutes(minutes: number): void;
  // The keep window runs only while this is false, the state the table starts in.
  setClientConnected(connected: boolean): void;
  // Ends each idle process now and each other when it turns idle; every later spawn is refused. A process the end of
  // its background work turned idle ends `DRAIN_REPORT_GRACE_MS` after that moment, unless a busy line comes first.
  drain(): void;
  // Calls `done` once the table is empty, at once when it already is.
  stopAll(done: () => void): void;
}

// The parts the idle rule reads busy from; a process is idle when none holds.
interface TurnState {
  isTurnOpen: boolean;
  openMessages: Set<string>;
  backgroundCount: number;
  // True once a stdout line whose `key` equals `messageEnd.value` has arrived, whatever its state.
  printsMessageEnds: boolean;
}

interface TableProcess {
  id: string;
  child: ChildProcessWithoutNullStreams;
  pid: number | null;
  log: PipeLog;
  idleRule: IdleRule;
  droppedOutKeys: readonly KeyPath[];
  startedAt: number;
  subscriber: ProcessSubscriber | null;
  turnState: TurnState;
  // True while no part of `turnState` holds.
  isIdle: boolean;
  idleSince: number;
  // True when the line that turned the process idle ended its background work.
  isIdleFromBackgroundEnd: boolean;
  keepTimer: number | null;
  drainGraceTimer: number | null;
  signalTimers: number[];
  isEnding: boolean;
}

// The line's JSON value when it is an object, else null.
function lineObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : null;
}

function isOneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function isTurnStateBusy(state: TurnState): boolean {
  return (
    state.isTurnOpen || state.openMessages.size > 0 || state.backgroundCount > 0
  );
}

function isSideLine(
  line: Record<string, unknown>,
  sideKey: string | null,
): boolean {
  return (
    sideKey !== null && line[sideKey] !== undefined && line[sideKey] !== null
  );
}

function countOfKinds(
  list: unknown,
  kindKey: string,
  kinds: readonly string[],
): number {
  if (!Array.isArray(list)) {
    return 0;
  }
  return list.filter(
    (item: unknown) => isRecord(item) && isOneOf(item[kindKey], kinds),
  ).length;
}

// The messages the turn-end `line` lists, or every open message while the process has printed no message-end line,
// as a CLI without message ends needs.
function closeTurnEndMessages(
  line: Record<string, unknown>,
  rule: IdleRule,
  state: TurnState,
) {
  if (!state.printsMessageEnds) {
    state.openMessages.clear();
    return;
  }
  const listedIds =
    rule.turnEndIdsKey === null ? undefined : line[rule.turnEndIdsKey];
  if (Array.isArray(listedIds)) {
    for (const id of listedIds) {
      if (typeof id === 'string') {
        state.openMessages.delete(id);
      }
    }
  }
}

// A turn end closes the main turn and its messages, a main busy line opens the turn, a message end closes its
// message, and a background line sets the count.
function readStdoutLine(
  line: Record<string, unknown>,
  rule: IdleRule,
  state: TurnState,
) {
  const value = line[rule.key];
  const { messageEnd, background } = rule;
  const isMessageEndLine = messageEnd !== null && value === messageEnd.value;
  if (isMessageEndLine) {
    state.printsMessageEnds = true;
  }
  if (value === rule.value) {
    state.isTurnOpen = false;
    closeTurnEndMessages(line, rule, state);
  } else if (
    isOneOf(value, rule.busyStdoutValues) &&
    !isSideLine(line, rule.sideKey)
  ) {
    state.isTurnOpen = true;
  }
  const endedMessageId =
    isMessageEndLine &&
    isOneOf(line[messageEnd.stateKey], messageEnd.endStates)
      ? line[messageEnd.idKey]
      : undefined;
  if (typeof endedMessageId === 'string') {
    state.openMessages.delete(endedMessageId);
  }
  const isBackgroundLine =
    background !== null &&
    Object.entries(background.match).every(
      ([key, matchValue]) => line[key] === matchValue,
    );
  if (isBackgroundLine) {
    state.backgroundCount = countOfKinds(
      line[background.listKey],
      background.kindKey,
      background.kinds,
    );
  }
}

// A busy stdin line opens its message when it carries an id, else the main turn.
function readStdinLine(
  line: Record<string, unknown>,
  rule: IdleRule,
  state: TurnState,
) {
  if (!isOneOf(line[rule.key], rule.busyStdinValues)) {
    return;
  }
  const messageId =
    rule.messageIdKey === null ? undefined : line[rule.messageIdKey];
  if (typeof messageId === 'string') {
    state.openMessages.add(messageId);
  } else {
    state.isTurnOpen = true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function isNullOrString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isMessageEndShape(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.value === 'string' &&
      typeof value.idKey === 'string' &&
      typeof value.stateKey === 'string' &&
      isStringArray(value.endStates))
  );
}

function isBackgroundShape(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isStringRecord(value.match) &&
      typeof value.listKey === 'string' &&
      typeof value.kindKey === 'string' &&
      isStringArray(value.kinds))
  );
}

// Every line reads the rule, so a bad one would otherwise throw far from the request that carried it.
function requireIdleRule({ id, idleRule }: HostedSpawn) {
  const isWellFormed =
    typeof idleRule?.key === 'string' &&
    typeof idleRule.value === 'string' &&
    Array.isArray(idleRule.busyStdoutValues) &&
    Array.isArray(idleRule.busyStdinValues) &&
    isNullOrString(idleRule.sideKey) &&
    isNullOrString(idleRule.messageIdKey) &&
    isNullOrString(idleRule.turnEndIdsKey) &&
    isMessageEndShape(idleRule.messageEnd) &&
    isBackgroundShape(idleRule.background);
  if (!isWellFormed) {
    throw new Error(`process ${id} has no well-formed idle rule`);
  }
}

// A bad one would otherwise throw on a stdout line, far from the request that carried it.
function requireDroppedOutKeys({ id, droppedOutKeys }: HostedSpawn) {
  const isWellFormed =
    Array.isArray(droppedOutKeys) &&
    droppedOutKeys.every(
      (path) =>
        Array.isArray(path) &&
        path.length > 0 &&
        path.every((key) => typeof key === 'string'),
    );
  if (!isWellFormed) {
    throw new Error(`process ${id} has no well-formed dropped keys`);
  }
}

function isStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

// A bad one would otherwise build the child's environment, or write its stdin, from a field nothing checked.
function requireSpawnShape({
  id,
  env,
  inheritEnv,
  unsetEnv,
  stdin,
}: HostedSpawn) {
  if (!isStringRecord(env)) {
    throw new Error(`process ${id} has no well-formed env`);
  }
  if (typeof inheritEnv !== 'boolean') {
    throw new Error(`process ${id} has no well-formed inheritEnv`);
  }
  if (!isStringArray(unsetEnv)) {
    throw new Error(`process ${id} has no well-formed unset names`);
  }
  if (!isStringArray(stdin)) {
    throw new Error(`process ${id} has no well-formed stdin lines`);
  }
}

// With `inheritEnv`: `hostEnv` less `ELECTRON_RUN_AS_NODE` and the unset names, under the spawn's `env`. Without it:
// the spawn's `env` alone.
function childEnvOf(
  { env, inheritEnv, unsetEnv }: HostedSpawn,
  hostEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!inheritEnv) {
    return { ...env };
  }
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value !== undefined) {
      childEnv[name] = value;
    }
  }
  // The host runs as Node through this name; a child Electron binary would too.
  delete childEnv.ELECTRON_RUN_AS_NODE;
  for (const name of unsetEnv) {
    delete childEnv[name];
  }
  return { ...childEnv, ...env };
}

// True when `root` held the value at `path`, now gone.
function deleteAtPath(root: unknown, path: KeyPath): boolean {
  let parent = root;
  for (const key of path.slice(0, -1)) {
    if (typeof parent !== 'object' || parent === null) {
      return false;
    }
    parent = (parent as Record<string, unknown>)[key];
  }
  const lastKey = path[path.length - 1];
  const holdsKey =
    typeof parent === 'object' &&
    parent !== null &&
    Object.hasOwn(parent, lastKey);
  if (!holdsKey) {
    return false;
  }
  delete (parent as Record<string, unknown>)[lastKey];
  return true;
}

// `text` less the dropped keys that `parsed`, its parse, holds, deleting them from `parsed`; `text` itself when it
// holds none.
function withoutDroppedKeys(
  text: string,
  parsed: Record<string, unknown>,
  droppedKeys: readonly KeyPath[],
): string {
  let droppedAny = false;
  for (const path of droppedKeys) {
    droppedAny = deleteAtPath(parsed, path) || droppedAny;
  }
  return droppedAny ? JSON.stringify(parsed) : text;
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
      Math.min(delay, MAX_TIMER_MS),
    );
  }

  function cancelDrainGraceTimer(hosted: TableProcess) {
    if (hosted.drainGraceTimer !== null) {
      timers.clear(hosted.drainGraceTimer);
      hosted.drainGraceTimer = null;
    }
  }

  function endProcess(hosted: TableProcess) {
    if (hosted.isEnding) {
      return;
    }
    hosted.isEnding = true;
    cancelKeepTimer(hosted);
    cancelDrainGraceTimer(hosted);
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

  // Ends an idle process for the drain: at once, or at the end of the report grace when the end of its background
  // work turned it idle.
  function endIdleForDrain(hosted: TableProcess) {
    cancelDrainGraceTimer(hosted);
    const graceLeft = hosted.isIdleFromBackgroundEnd
      ? hosted.idleSince + DRAIN_REPORT_GRACE_MS - clock.now()
      : 0;
    if (graceLeft > 0) {
      hosted.drainGraceTimer = timers.set(() => endProcess(hosted), graceLeft);
    } else {
      endProcess(hosted);
    }
  }

  function turnIdle(hosted: TableProcess, endedBackgroundWork: boolean) {
    if (hosted.isIdle) {
      return;
    }
    hosted.isIdle = true;
    hosted.idleSince = clock.now();
    hosted.isIdleFromBackgroundEnd = endedBackgroundWork;
    if (draining) {
      endIdleForDrain(hosted);
    } else {
      armKeepTimer(hosted);
    }
  }

  function turnBusy(hosted: TableProcess) {
    hosted.isIdle = false;
    cancelKeepTimer(hosted);
    cancelDrainGraceTimer(hosted);
  }

  // Turns the process busy or idle when its turn state changed what it reads; `endedBackgroundWork` when the line
  // read took the background count to 0.
  function settleIdle(hosted: TableProcess, endedBackgroundWork: boolean) {
    const isBusy = isTurnStateBusy(hosted.turnState);
    if (isBusy && hosted.isIdle) {
      turnBusy(hosted);
    } else if (!isBusy) {
      turnIdle(hosted, endedBackgroundWork);
    }
  }

  function childLine(hosted: TableProcess, dir: PipeDirection, text: string) {
    // Only stdout reads the idle rule; its line is parsed once.
    const parsed = dir === 'out' ? lineObject(text) : null;
    const hadBackgroundWork = hosted.turnState.backgroundCount > 0;
    if (parsed !== null) {
      // Before the drop, which may delete a key the rule reads.
      readStdoutLine(parsed, hosted.idleRule, hosted.turnState);
    }
    const delivered =
      parsed === null
        ? text
        : withoutDroppedKeys(text, parsed, hosted.droppedOutKeys);
    const line = hosted.log.append(dir, delivered);
    hosted.subscriber?.line(hosted.id, line);
    if (parsed !== null) {
      settleIdle(
        hosted,
        hadBackgroundWork && hosted.turnState.backgroundCount === 0,
      );
    }
  }

  function closeProcess(hosted: TableProcess, exit: HostedExit) {
    // A failed spawn emits `error`, then `close`; a late event may name an id spawned again since.
    if (processes.get(hosted.id) !== hosted) {
      return;
    }
    cancelKeepTimer(hosted);
    cancelDrainGraceTimer(hosted);
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
    deps.processClosed(hosted.id, exit);
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

  // Logs `text` as `in`, reads the idle rule on it, then writes it with its newline.
  function writeLine(hosted: TableProcess, text: string) {
    hosted.log.append('in', text);
    const parsed = lineObject(text);
    if (parsed !== null) {
      readStdinLine(parsed, hosted.idleRule, hosted.turnState);
      settleIdle(hosted, false);
    }
    hosted.child.stdin.write(`${text}\n`);
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
        requireDroppedOutKeys(request);
        requireSpawnShape(request);
        log = createPipeLog(deps.logsFolder, request.id, clock, (message) =>
          diagnostics.append(message),
        );
        const child = deps.spawn(request.command, request.args, {
          cwd: request.cwd,
          env: childEnvOf(request, deps.env),
        });
        const startedAt = clock.now();
        const hosted: TableProcess = {
          id: request.id,
          child,
          pid: child.pid ?? null,
          log,
          idleRule: request.idleRule,
          droppedOutKeys: request.droppedOutKeys,
          startedAt,
          subscriber,
          turnState: {
            isTurnOpen: false,
            openMessages: new Set(),
            backgroundCount: 0,
            printsMessageEnds: false,
          },
          isIdle: true,
          idleSince: startedAt,
          isIdleFromBackgroundEnd: false,
          keepTimer: null,
          drainGraceTimer: null,
          signalTimers: [],
          isEnding: false,
        };
        wireChild(hosted);
        processes.set(request.id, hosted);
        armKeepTimer(hosted);
        // Node sets `pid` at once when the OS started the child; a child with none never ran, and its `error` follows.
        if (hosted.pid !== null) {
          subscriber.spawned(request.id, hosted.pid);
          for (const line of request.stdin) {
            writeLine(hosted, line);
          }
        }
      } catch (error) {
        log?.remove();
        refuse((error as Error).message);
      }
    },
    write(id, text) {
      const hosted = processes.get(id);
      if (hosted !== undefined) {
        writeLine(hosted, text);
      }
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
        return { running: false, log: null, pid: null };
      }
      if (!hosted.log.isComplete) {
        return { running: true, log: null, pid: hosted.pid };
      }
      hosted.subscriber = subscriber;
      return { running: true, log: hosted.log.file, pid: hosted.pid };
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
    isBusy(id) {
      const hosted = processes.get(id);
      return hosted !== undefined && !hosted.isEnding && !hosted.isIdle;
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
          endIdleForDrain(hosted);
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
