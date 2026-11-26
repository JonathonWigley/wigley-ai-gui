import type { Clock, Timers } from '../contracts/ambient';
import type { Pty, PtyExit, PtySpawn } from '../contracts/pty';
import { HOST_END_GRACE_MS } from '../contracts/session-host-protocol';
import {
  TERMINAL_REPLAY_LIMIT,
  type TerminalExit,
  type TerminalInfo,
  type TerminalSpawn,
} from '../contracts/terminals';
import { keepTail } from '../shared/keep-tail';
import type { DiagnosticLog } from './diagnostic-log';
import type { RecordedPty } from './host-children';
import { inheritedEnvOf } from './inherited-env';

// The one receiver of a shell's live output and its close.
export interface TerminalSubscriber {
  data(id: string, chunk: string): void;
  closed(id: string, exit: TerminalExit): void;
}

export interface TerminalTableDeps {
  spawn: PtySpawn;
  // The host's own environment, which each shell inherits less `ELECTRON_RUN_AS_NODE`, under its terminal names.
  env: NodeJS.ProcessEnv;
  clock: Clock;
  // Times the SIGKILL that follows a kill by `HOST_END_GRACE_MS`.
  timers: Timers;
  diagnostics: DiagnosticLog;
  // Records a shell's pid in the host's children record until the handle is disposed.
  recordPid(pid: number): RecordedPty;
  // After a shell has left the table and its subscriber has heard its exit.
  terminalClosed(id: string): void;
}

// The host's shells, each in a pty, apart from the process table: no keep window, idle rule or pipe log applies.
export interface TerminalTable {
  // Subscribes `subscriber`. A refused or failed spawn calls its `closed` with the error, no other shell touched.
  spawn(request: TerminalSpawn, subscriber: TerminalSubscriber): void;
  // `write`, `resize` and `kill` do nothing for an id the table does not hold.
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  // Sends the pty its hangup, then SIGKILL after `HOST_END_GRACE_MS`; the shell lists as not running until it exits.
  // Does nothing more for a shell already ending.
  kill(id: string): void;
  // Replaces any earlier subscriber, and returns the shell's replay: its last `TERMINAL_REPLAY_LIMIT` code units of
  // output. Null, with nothing subscribed, for a shell the table does not hold.
  attach(
    id: string,
    subscriber: TerminalSubscriber,
  ): { replay: string; running: boolean } | null;
  // Does nothing unless `subscriber` is shell `id`'s.
  detach(id: string, subscriber: TerminalSubscriber): void;
  dropSubscriber(subscriber: TerminalSubscriber): void;
  list(): TerminalInfo[];
  // The drain: kills every shell now, as `kill` does, and refuses every later spawn.
  endAll(): void;
  // Kills every shell as `kill` does, and calls `done` once the table is empty, at once when it already is.
  stopAll(done: () => void): void;
}

interface TableShell {
  id: string;
  pty: Pty;
  recorded: RecordedPty;
  startedAt: number;
  subscriber: TerminalSubscriber | null;
  replay: string;
  isEnding: boolean;
  killTimer: number | null;
}

const SHELL_TERMINAL_ENV = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
};

function isPositiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isWellFormedSpawn({
  id,
  command,
  args,
  cwd,
  cols,
  rows,
}: TerminalSpawn): boolean {
  const hasStringArgs =
    Array.isArray(args) && args.every((arg) => typeof arg === 'string');
  return (
    typeof id === 'string' &&
    typeof command === 'string' &&
    typeof cwd === 'string' &&
    hasStringArgs &&
    isPositiveInteger(cols) &&
    isPositiveInteger(rows)
  );
}

// node-pty reports `exitCode` 0 for a shell a signal ended.
function terminalExitOf({ exitCode, signal }: PtyExit): TerminalExit {
  return signal === null
    ? { code: exitCode, signal: null, error: null }
    : { code: null, signal, error: null };
}

export function createTerminalTable(deps: TerminalTableDeps): TerminalTable {
  const { clock, timers, diagnostics } = deps;
  const shells = new Map<string, TableShell>();
  const stopWaiters: (() => void)[] = [];
  let draining = false;

  function refusalOf(request: TerminalSpawn): string | null {
    if (draining) {
      return 'the session host is draining';
    }
    if (shells.has(request.id)) {
      return `a terminal with id ${request.id} already exists`;
    }
    return isWellFormedSpawn(request)
      ? null
      : `terminal ${request.id} has no well-formed spawn`;
  }

  function endShell(shell: TableShell) {
    if (shell.isEnding) {
      return;
    }
    shell.isEnding = true;
    // A throw here must not skip the SIGKILL, nor the other shells of an `endAll` or `stopAll`.
    try {
      shell.pty.kill();
    } catch (error) {
      diagnostics.append(
        `terminal ${shell.id} kill: ${(error as Error).message}`,
      );
    }
    shell.killTimer = timers.set(
      () => shell.recorded.kill(),
      HOST_END_GRACE_MS,
    );
  }

  function closeShell(shell: TableShell, exit: TerminalExit) {
    if (shell.killTimer !== null) {
      timers.clear(shell.killTimer);
    }
    shells.delete(shell.id);
    shell.subscriber?.closed(shell.id, exit);
    shell.recorded.dispose();
    if (shells.size === 0) {
      for (const done of stopWaiters.splice(0)) {
        done();
      }
    }
    deps.terminalClosed(shell.id);
  }

  function receiveData(shell: TableShell, chunk: string) {
    shell.replay = keepTail(shell.replay + chunk, TERMINAL_REPLAY_LIMIT);
    shell.subscriber?.data(shell.id, chunk);
  }

  return {
    spawn(request, subscriber) {
      const refuse = (error: string) =>
        subscriber.closed(request.id, { code: null, signal: null, error });
      const refusal = refusalOf(request);
      if (refusal !== null) {
        refuse(refusal);
        return;
      }
      let pty: Pty;
      try {
        pty = deps.spawn(request.command, request.args, {
          cwd: request.cwd,
          env: { ...inheritedEnvOf(deps.env), ...SHELL_TERMINAL_ENV },
          cols: request.cols,
          rows: request.rows,
        });
      } catch (error) {
        refuse((error as Error).message);
        return;
      }
      const shell: TableShell = {
        id: request.id,
        pty,
        recorded: deps.recordPid(pty.pid),
        startedAt: clock.now(),
        subscriber,
        replay: '',
        isEnding: false,
        killTimer: null,
      };
      shells.set(shell.id, shell);
      pty.onData((chunk) => receiveData(shell, chunk));
      pty.onExit((exit) => closeShell(shell, terminalExitOf(exit)));
    },
    write(id, data) {
      shells.get(id)?.pty.write(data);
    },
    resize(id, cols, rows) {
      shells.get(id)?.pty.resize(cols, rows);
    },
    kill(id) {
      const shell = shells.get(id);
      if (shell !== undefined) {
        endShell(shell);
      }
    },
    attach(id, subscriber) {
      const shell = shells.get(id);
      if (shell === undefined) {
        return null;
      }
      shell.subscriber = subscriber;
      return { replay: shell.replay, running: !shell.isEnding };
    },
    detach(id, subscriber) {
      const shell = shells.get(id);
      if (shell?.subscriber === subscriber) {
        shell.subscriber = null;
      }
    },
    dropSubscriber(subscriber) {
      for (const shell of shells.values()) {
        if (shell.subscriber === subscriber) {
          shell.subscriber = null;
        }
      }
    },
    list() {
      return [...shells.values()].map((shell) => ({
        id: shell.id,
        startedAt: shell.startedAt,
        running: !shell.isEnding,
      }));
    },
    endAll() {
      draining = true;
      for (const shell of shells.values()) {
        endShell(shell);
      }
    },
    stopAll(done) {
      if (shells.size === 0) {
        done();
        return;
      }
      stopWaiters.push(done);
      for (const shell of shells.values()) {
        endShell(shell);
      }
    },
  };
}
