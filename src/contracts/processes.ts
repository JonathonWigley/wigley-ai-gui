// What a finished program left: its exit code, -1 when a signal ended it, and
// everything it wrote to stdout and stderr as UTF-8.
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs the machine's programs.
export interface ProcessRunner {
  // Runs `command` with `args`, no shell, in `cwd` when given. Resolves once
  // the program ends, a non-zero exit included; rejects with
  // `Could not run <command>: <reason>` when it cannot start.
  run(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Promise<ProcessResult>;
}
