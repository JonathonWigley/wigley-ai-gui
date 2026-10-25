import type { ProcessResult, ProcessRunner } from '../contracts/processes';

// One call `FakeProcesses.run` received.
export interface FakeRun {
  command: string;
  args: string[];
  cwd: string | undefined;
  timeoutMs: number | undefined;
}

type ScriptedResult = ProcessResult | Error | Promise<ProcessResult>;

// A scripted `ProcessRunner` for the tests. A run nothing is scripted for
// rejects with `FakeProcesses: no result scripted for <command> <args>`. It
// sets no timer: a timed-out run is scripted as a result with `timedOut: true`.
export class FakeProcesses implements ProcessRunner {
  // Every run, in call order.
  readonly runs: FakeRun[] = [];
  private readonly results = new Map<string, ScriptedResult>();

  // The result of each later run whose command and args equal these. An Error
  // rejects the run; a Promise holds the run open until the test settles it.
  // A later script for the same command and args replaces the earlier one.
  script(command: string, args: string[], result: ScriptedResult): void {
    this.results.set(runKey(command, args), result);
  }

  run(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number },
  ): Promise<ProcessResult> {
    this.runs.push({
      command,
      args: [...args],
      cwd: options?.cwd,
      timeoutMs: options?.timeoutMs,
    });
    const result = this.results.get(runKey(command, args));
    if (result === undefined) {
      return Promise.reject(
        new Error(
          `FakeProcesses: no result scripted for ${[command, ...args].join(' ')}`,
        ),
      );
    }
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  }
}

// JSON, so `a b` and `a`, `b` stay apart.
function runKey(command: string, args: string[]): string {
  return JSON.stringify([command, ...args]);
}
