// What a finished program left: its exit code, -1 when a signal ended it or
// the timeout killed it, and everything it wrote to stdout and stderr as UTF-8.
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  // True only when `timeoutMs` passed and the program was killed.
  timedOut: boolean;
  // True only when `maxOutputBytes` cut stdout or stderr.
  truncated?: boolean;
}

// How one `ProcessRunner.run` runs its program.
export interface ProcessRunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  // Names removed from the app's environment for this run; every other
  // variable passes through.
  unsetEnv?: readonly string[];
  // The most bytes kept of each of stdout and stderr; the rest is read and
  // dropped. Unset, all of both is kept.
  maxOutputBytes?: number;
  // Names set for this run, after `unsetEnv` is applied, so a name in both is
  // set; every other variable passes through.
  setEnv?: Readonly<Record<string, string>>;
}

// How one `ProcessRunner.startDetached` starts its program: `logPath` is the
// full path of the file its stdout and stderr are appended to, made when
// missing.
export interface DetachedStartOptions {
  cwd?: string;
  logPath: string;
}

// Runs the machine's programs.
export interface ProcessRunner {
  // Runs `command` with `args`, no shell, in `cwd` when given, in the app's
  // environment without the names in `unsetEnv`, then with `setEnv`'s names
  // set. Resolves once
  // the program ends, a non-zero exit included, or once `timeoutMs` passes and
  // the program is killed; rejects with `Could not run <command>: <reason>`
  // when it cannot start. When `signal` aborts the program is killed and the
  // run rejects with `Stopped <command>`; a signal already aborted rejects so
  // without starting the program.
  run(
    command: string,
    args: string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessResult>;
  // Starts `command` with `args`, no shell, in `cwd` when given and in the
  // app's environment, detached from the app: in its own process group (on
  // Windows, its own console-less process), its stdout and stderr appended to
  // `logPath`, and not waited on, so it outlives the app's quit. Resolves once
  // the program has started; rejects with `Could not run <command>: <reason>`
  // when it cannot start or `logPath` cannot be opened. Nothing stops it: a
  // plugin's stop and the app's quit leave it running.
  startDetached(
    command: string,
    args: string[],
    options: DetachedStartOptions,
  ): Promise<void>;
  // Starts `command` with `args` in `cwd`, with `env` as its whole environment,
  // and streams it: no shell; stdin, stdout and stderr are pipes; output
  // arrives as UTF-8 text, a character never split across chunks. `closed` is
  // called exactly once, on the first of the program's exit and its failure to
  // start or run. A failure sets `startError` with the OS's message as it is,
  // `notFound` true for `ENOENT` (a missing program or `cwd`), and `code` and
  // `signal` null. `kill()` sends `SIGTERM`. A `write`, `endInput` or `kill`
  // after `closed` does nothing, and an error on stdin (`EPIPE` after the
  // exit) is dropped. A plugin's stop kills it with `SIGKILL`.
  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): SpawnedProcess;
}

export type SpawnSignal = 'SIGTERM' | 'SIGKILL';

// Why a spawned program did not start or run: the OS's message as it is, and
// whether it was `ENOENT`.
export interface SpawnStartError {
  message: string;
  notFound: boolean;
}

// How a spawned program ended: its exit code, or the signal that ended it, or
// `startError` with both null.
export interface SpawnExit {
  code: number | null;
  signal: string | null;
  startError: SpawnStartError | null;
}

// What a spawned program reports, from its start.
export interface SpawnEvents {
  stdout(chunk: string): void;
  stderr(chunk: string): void;
  closed(exit: SpawnExit): void;
}

// How one `ProcessRunner.spawn` runs its program: `env` is its whole
// environment, and nothing of the app's passes through.
export interface SpawnOptions {
  cwd: string;
  env: Readonly<Record<string, string>>;
  events: SpawnEvents;
}

// A program `ProcessRunner.spawn` started: its stdin and its stop.
export interface SpawnedProcess {
  write(text: string): void;
  endInput(): void;
  kill(signal?: SpawnSignal): void;
}
