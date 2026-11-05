import type {
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
} from '../contracts/processes';

// One call `FakeProcesses.run` received.
export interface FakeRun {
  command: string;
  args: string[];
  cwd: string | undefined;
  timeoutMs: number | undefined;
  unsetEnv: readonly string[] | undefined;
}

type ScriptedResult = ProcessResult | Error | Promise<ProcessResult>;

// A scripted `ProcessRunner` for the tests. A run nothing is scripted for
// rejects with `FakeProcesses: no result scripted for <command> <args>`. It
// sets no timer: a timed-out run is scripted as a result with `timedOut: true`.
// A run whose `signal` is aborted, at the call or later while a scripted promise
// holds it, rejects with `Stopped <command>`.
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
    options?: ProcessRunOptions,
  ): Promise<ProcessResult> {
    this.runs.push({
      command,
      args: [...args],
      cwd: options?.cwd,
      timeoutMs: options?.timeoutMs,
      unsetEnv: options?.unsetEnv,
    });
    const signal = options?.signal;
    if (signal?.aborted) {
      return Promise.reject(new Error(`Stopped ${command}`));
    }
    const result = this.results.get(runKey(command, args));
    if (result === undefined) {
      return Promise.reject(
        new Error(
          `FakeProcesses: no result scripted for ${[command, ...args].join(' ')}`,
        ),
      );
    }
    if (result instanceof Error) {
      return Promise.reject(result);
    }
    return signal === undefined
      ? Promise.resolve(result)
      : settledOrStopped(command, result, signal);
  }
}

// `result` settles the run unless `signal` aborts first.
function settledOrStopped(
  command: string,
  result: ProcessResult | Promise<ProcessResult>,
  signal: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error(`Stopped ${command}`));
    signal.addEventListener('abort', stop);
    Promise.resolve(result)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', stop));
  });
}

// JSON, so `a b` and `a`, `b` stay apart.
function runKey(command: string, args: string[]): string {
  return JSON.stringify([command, ...args]);
}
