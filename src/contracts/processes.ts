// What a finished program left: its exit code, -1 when a signal ended it or
// the timeout killed it, and everything it wrote to stdout and stderr as UTF-8.
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  // True only when `timeoutMs` passed and the program was killed.
  timedOut: boolean;
}

// Runs the machine's programs.
export interface ProcessRunner {
  // Runs `command` with `args`, no shell, in `cwd` when given. Resolves once
  // the program ends, a non-zero exit included, or once `timeoutMs` passes and
  // the program is killed; rejects with `Could not run <command>: <reason>`
  // when it cannot start.
  run(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number },
  ): Promise<ProcessResult>;
}
