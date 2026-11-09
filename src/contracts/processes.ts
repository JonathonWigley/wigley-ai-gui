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
}

// Runs the machine's programs.
export interface ProcessRunner {
  // Runs `command` with `args`, no shell, in `cwd` when given, in the app's
  // environment without the names in `unsetEnv`. Resolves once
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
}
