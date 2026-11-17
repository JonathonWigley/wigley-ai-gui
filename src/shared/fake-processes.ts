import type {
  DetachedStartOptions,
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
  SpawnedProcess,
  SpawnEvents,
  SpawnExit,
  SpawnOptions,
  SpawnSignal,
} from '../contracts/processes';

// One call `FakeProcesses.run` received.
export interface FakeRun {
  command: string;
  args: string[];
  cwd: string | undefined;
  timeoutMs: number | undefined;
  unsetEnv: readonly string[] | undefined;
  setEnv: Readonly<Record<string, string>> | undefined;
}

// One call `FakeProcesses.startDetached` received.
export interface FakeDetachedStart {
  command: string;
  args: string[];
  options: DetachedStartOptions;
}

// One program `FakeProcesses.spawn` started: what it was started with, what
// was written to it, and the test's drivers of its events. `kill` records its
// signal and closes nothing; a second `close` does nothing.
export class FakeSpawn implements SpawnedProcess {
  readonly written: string[] = [];
  isInputEnded = false;
  readonly kills: SpawnSignal[] = [];
  private hasClosed = false;

  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly cwd: string,
    readonly env: Readonly<Record<string, string>>,
    private readonly events: SpawnEvents,
  ) {}

  write(text: string): void {
    this.written.push(text);
  }

  endInput(): void {
    this.isInputEnded = true;
  }

  kill(signal: SpawnSignal = 'SIGTERM'): void {
    this.kills.push(signal);
  }

  stdout(text: string): void {
    this.events.stdout(text);
  }

  stderr(text: string): void {
    this.events.stderr(text);
  }

  close(exit: SpawnExit): void {
    if (!this.hasClosed) {
      this.hasClosed = true;
      this.events.closed(exit);
    }
  }
}

type ScriptedResult = ProcessResult | Error | Promise<ProcessResult>;

// A scripted `ProcessRunner` for the tests. A run nothing is scripted for
// rejects with `FakeProcesses: no result scripted for <command> <args>`. It
// sets no timer: a timed-out run is scripted as a result with `timedOut: true`.
// A run whose `signal` is aborted, at the call or later while a scripted promise
// holds it, rejects with `Stopped <command>`. A detached start is recorded and
// resolves, or rejects with the error `failDetachedStarts` set. A spawn is
// recorded as a `FakeSpawn` the test drives; nothing is scripted for it.
export class FakeProcesses implements ProcessRunner {
  // Every run, in call order.
  readonly runs: FakeRun[] = [];
  // Every detached start, in call order.
  readonly detachedStarts: FakeDetachedStart[] = [];
  // Every spawn, in call order.
  readonly spawns: FakeSpawn[] = [];
  private readonly results = new Map<string, ScriptedResult>();
  private detachedFailure: Error | null = null;

  // Every later detached start rejects with `error`; null resolves them again.
  failDetachedStarts(error: Error | null): void {
    this.detachedFailure = error;
  }

  startDetached(
    command: string,
    args: string[],
    options: DetachedStartOptions,
  ): Promise<void> {
    this.detachedStarts.push({ command, args: [...args], options });
    return this.detachedFailure === null
      ? Promise.resolve()
      : Promise.reject(this.detachedFailure);
  }

  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): SpawnedProcess {
    const spawned = new FakeSpawn(
      command,
      [...args],
      options.cwd,
      options.env,
      options.events,
    );
    this.spawns.push(spawned);
    return spawned;
  }

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
      setEnv: options?.setEnv,
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
