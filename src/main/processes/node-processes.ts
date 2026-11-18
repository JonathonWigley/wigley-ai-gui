import {
  type ChildProcess,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
  spawn,
  type SpawnOptions as NodeSpawnOptions,
} from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Files } from '../../contracts/files';
import type { Paths } from '../../contracts/paths';
import type {
  OsName,
  PlatformPrograms,
  ProgramCandidate,
  ProgramName,
} from '../../contracts/platform';
import type {
  DetachedStartOptions,
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
  SpawnedProcess,
  SpawnExit,
  SpawnOptions,
  SpawnSignal,
} from '../../contracts/processes';
import {
  envVariable,
  findCandidate,
  findProgram,
  type ProgramLaunch,
  type ProgramSearch,
  shimLaunch,
} from '../../shared/program-lookup';

// Starts a child process, as Node's `spawn` does.
export type StartProgram = (
  file: string,
  args: readonly string[],
  options: NodeSpawnOptions,
) => ChildProcess;

export interface NodeProcessesDeps {
  files: Pick<Files, 'stat'>;
  paths: Pick<Paths, 'expandTilde' | 'join'>;
  os: OsName;
  homeDir: string;
  programs: PlatformPrograms;
  // The core setting that names `name`'s program, '' when unset or when
  // `name` has no core setting.
  programSetting(name: ProgramName): string;
  // Node's `spawn` when unset.
  start?: StartProgram;
}

type Environment = Readonly<Record<string, string | undefined>>;

// What Node starts for one program, and the lookup cache's key for its path;
// null when nothing was cached.
interface Launch extends ProgramLaunch {
  cacheKey: string | null;
}

// Turns a command into what Node starts.
interface Launcher {
  // Off Windows, `command` and `args` as given, at once. On Windows, after a
  // PATH × PATHEXT lookup in `env`, the found file (else `command` as given)
  // through `shimLaunch`; rejects when `shimLaunch` throws.
  launch(
    command: string,
    args: readonly string[],
    env: Environment,
  ): Launch | Promise<Launch>;
  // Drops `launch`'s cached path, so the next start of its command looks again.
  forget(launch: Launch): void;
}

// `ProcessRunner` through `node:child_process`, `run` in the app's environment
// less `unsetEnv` plus `setEnv`.
// Output is collected whole unless `maxOutputBytes` caps each stream, which
// marks the result `truncated` once either is cut. A run that cannot start
// rejects naming the program, or the folder when `cwd` does not exist. Past
// `timeoutMs` the program is killed and the run resolves at once with the
// output so far; a grandchild it started is not killed. An abort of `signal`
// kills it the same way and the run rejects at once with `Stopped <command>`.
// `startDetached` spawns with `detached` in the app's environment plus
// `setEnv`, its output appended to the log file when one is given and dropped
// otherwise, and unrefs the child. `spawn` pipes all three streams, decodes
// output as UTF-8, and reports a start failure or the exit through one
// `closed`.
// On Windows every `run`, `spawn` and `startDetached` first looks its command
// up over the child's PATH × PATHEXT, keeping each found path until a start of
// it fails, and starts a `.cmd` or `.bat` through cmd.exe; so the child starts
// after the lookup: `timeoutMs` counts from the start, a `signal` aborted
// during the lookup starts nothing, a spawn's `write` and `endInput` before
// the start are applied in order once it starts, and its `kill` before the
// start starts nothing and closes with that signal. An argument cmd.exe cannot
// pass fails the start with `shimLaunch`'s message. Off Windows, Node's own
// PATH search finds the command. `resolveProgram` reads `programSetting`, else
// looks up the platform's candidates in the app's PATH at each call.
export function createNodeProcesses(deps: NodeProcessesDeps): ProcessRunner {
  const start: StartProgram =
    deps.start ?? ((file, args, options) => spawn(file, args, options));
  const launcher =
    deps.os === 'windows' ? windowsLauncher(deps) : directLauncher();
  return {
    run: (command, args, options) =>
      runToEnd(launcher, start, deps.os, command, args, options),
    startDetached: (command, args, options) =>
      startDetached(launcher, start, deps.os, command, args, options),
    spawn: (command, args, options) =>
      spawnStreaming(launcher, start, command, args, options),
    resolveProgram: (name) => resolveProgram(deps, name),
  };
}

async function resolveProgram(
  deps: NodeProcessesDeps,
  name: ProgramName,
): Promise<ProgramCandidate | null> {
  const setting = deps.programSetting(name);
  if (setting !== '') {
    return { command: deps.paths.expandTilde(setting, deps.homeDir), args: [] };
  }
  // The live environment: main swaps in the login shell's PATH after start.
  return findCandidate(
    deps.programs[name],
    searchIn(deps, process.env),
    deps.files,
  );
}

function searchIn(deps: NodeProcessesDeps, env: Environment): ProgramSearch {
  return {
    os: deps.os,
    path: envVariable(env, 'PATH', deps.os),
    pathExt: envVariable(env, 'PATHEXT', deps.os),
    homeDir: deps.homeDir,
    paths: deps.paths,
  };
}

function directLauncher(): Launcher {
  return {
    launch: (command, args) => ({
      file: command,
      args: [...args],
      windowsVerbatimArguments: false,
      cacheKey: null,
    }),
    forget: () => {},
  };
}

function windowsLauncher(deps: NodeProcessesDeps): Launcher {
  // Found paths by command, PATH and PATHEXT; a miss is not kept.
  const found = new Map<string, string>();
  return {
    async launch(command, args, env) {
      const search = searchIn(deps, env);
      const key = JSON.stringify([command, search.path, search.pathExt]);
      let target = found.get(key);
      if (target === undefined) {
        const lookedUp = await findProgram(command, search, deps.files);
        if (lookedUp !== null) {
          found.set(key, lookedUp);
        }
        target = lookedUp ?? command;
      }
      // As Node's own `shell` option picks it.
      const comSpec =
        envVariable(process.env, 'ComSpec', 'windows') ?? 'cmd.exe';
      return {
        ...shimLaunch(target, args, 'windows', comSpec),
        cacheKey: found.has(key) ? key : null,
      };
    },
    forget(launch) {
      if (launch.cacheKey !== null) {
        found.delete(launch.cacheKey);
      }
    },
  };
}

// Calls `begin` with the launch, at once when it is ready; `fail` hears a
// failed lookup, or a throw from `begin` after one.
function withLaunch(
  launch: Launch | Promise<Launch>,
  begin: (launch: Launch) => void,
  fail: (error: Error) => void,
): void {
  if (launch instanceof Promise) {
    launch.then(begin).catch(fail);
    return;
  }
  begin(launch);
}

function spawnStreaming(
  launcher: Launcher,
  start: StartProgram,
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): SpawnedProcess {
  const { events } = options;
  let hasClosed = false;
  const close = (exit: SpawnExit) => {
    if (!hasClosed) {
      hasClosed = true;
      events.closed(exit);
    }
  };
  const startFailed = (error: NodeJS.ErrnoException): SpawnExit => ({
    code: null,
    signal: null,
    startError: { message: error.message, notFound: error.code === 'ENOENT' },
  });
  let child: ChildProcessWithoutNullStreams | null = null;
  // The `write` and `endInput` calls made before the child starts, in order.
  const beforeStart: ((
    stdin: ChildProcessWithoutNullStreams['stdin'],
  ) => void)[] = [];
  const begin = (launch: Launch) => {
    if (hasClosed) {
      return;
    }
    let started: ChildProcessWithoutNullStreams;
    try {
      // stdio is all pipes, so every stream is there.
      started = start(launch.file, launch.args, {
        cwd: options.cwd,
        env: { ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // Off Windows the flag does nothing; on it, no console window flashes.
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      // A spawn that throws (EINVAL, or EAGAIN on fork) rather than emitting `error`.
      launcher.forget(launch);
      queueMicrotask(() => close(startFailed(error as NodeJS.ErrnoException)));
      return;
    }
    child = started;
    const { stdin, stdout, stderr } = started;
    // EPIPE once the program has exited; `closed` reports the exit itself.
    stdin.on('error', () => {});
    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      if (!hasClosed) {
        events.stdout(chunk);
      }
    });
    stderr.on('data', (chunk: string) => {
      if (!hasClosed) {
        events.stderr(chunk);
      }
    });
    started.on('error', (error: NodeJS.ErrnoException) => {
      if (started.pid === undefined) {
        launcher.forget(launch);
      }
      close(startFailed(error));
    });
    started.on('close', (code: number | null, signal: string | null) =>
      close({ code, signal, startError: null }),
    );
    for (const apply of beforeStart.splice(0)) {
      apply(stdin);
    }
  };
  withLaunch(launcher.launch(command, args, options.env), begin, (error) =>
    close(startFailed(error)),
  );
  const toStdin = (
    apply: (stdin: ChildProcessWithoutNullStreams['stdin']) => void,
  ) => {
    if (hasClosed) {
      return;
    }
    if (child === null) {
      beforeStart.push(apply);
      return;
    }
    apply(child.stdin);
  };
  return {
    write(text) {
      toStdin((stdin) => stdin.write(text));
    },
    endInput() {
      toStdin((stdin) => stdin.end());
    },
    kill(signal: SpawnSignal = 'SIGTERM') {
      if (hasClosed) {
        return;
      }
      if (child === null) {
        close({ code: null, signal, startError: null });
        return;
      }
      child.kill(signal);
    },
  };
}

function startDetached(
  launcher: Launcher,
  start: StartProgram,
  os: OsName,
  command: string,
  args: string[],
  options: DetachedStartOptions,
): Promise<void> {
  const env = runEnv(os, undefined, options.setEnv);
  return new Promise((resolve, reject) => {
    const fail = (error: Error) =>
      reject(new Error(`Could not run ${command}: ${error.message}`));
    const begin = (launch: Launch) => {
      let logFd: number | null = null;
      try {
        if (options.logPath !== undefined) {
          mkdirSync(path.dirname(options.logPath), { recursive: true });
          logFd = openSync(options.logPath, 'a');
        }
      } catch (error) {
        fail(error as Error);
        return;
      }
      let child: ChildProcess;
      try {
        child = start(launch.file, launch.args, {
          cwd: options.cwd,
          env,
          detached: true,
          stdio: logFd === null ? 'ignore' : ['ignore', logFd, logFd],
          windowsHide: true,
          windowsVerbatimArguments: launch.windowsVerbatimArguments,
        });
      } catch (error) {
        // A spawn that throws (EINVAL, or EAGAIN on fork) rather than emitting `error`.
        launcher.forget(launch);
        fail(error as Error);
        return;
      } finally {
        // The child holds its own copy of the descriptor once spawned.
        if (logFd !== null) {
          closeSync(logFd);
        }
      }
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      child.once('error', (error: NodeJS.ErrnoException) => {
        launcher.forget(launch);
        reject(new Error(startFailureMessage(command, options.cwd, error)));
      });
    };
    withLaunch(launcher.launch(command, args, env ?? process.env), begin, fail);
  });
}

function runToEnd(
  launcher: Launcher,
  start: StartProgram,
  os: OsName,
  command: string,
  args: string[],
  options?: ProcessRunOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      reject(new Error(`Stopped ${command}`));
      return;
    }
    const env = runEnv(os, options?.unsetEnv, options?.setEnv);
    const begin = (launch: Launch) => {
      if (signal?.aborted) {
        reject(new Error(`Stopped ${command}`));
        return;
      }
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        // stdout and stderr are pipes, so both streams are there.
        child = start(launch.file, launch.args, {
          cwd: options?.cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          // Off Windows the flag does nothing; on it, no console window
          // flashes.
          windowsHide: true,
          windowsVerbatimArguments: launch.windowsVerbatimArguments,
        }) as ChildProcessByStdio<null, Readable, Readable>;
      } catch (error) {
        // A spawn that throws (EINVAL, or EAGAIN on fork) rather than
        // emitting `error`.
        launcher.forget(launch);
        reject(
          new Error(`Could not run ${command}: ${(error as Error).message}`),
        );
        return;
      }
      collectToEnd(child, command, options, resolve, reject, () =>
        launcher.forget(launch),
      );
    };
    withLaunch(
      launcher.launch(command, args, env ?? process.env),
      begin,
      (error) =>
        reject(new Error(`Could not run ${command}: ${error.message}`)),
    );
  });
}

// Collects a started run's output until it ends, is killed past `timeoutMs`,
// or `signal` aborts; `startFailed` hears a failure to start.
function collectToEnd(
  child: ChildProcessByStdio<null, Readable, Readable>,
  command: string,
  options: ProcessRunOptions | undefined,
  resolve: (result: ProcessResult) => void,
  reject: (error: Error) => void,
  startFailed: () => void,
): void {
  const signal = options?.signal;
  const stdout = emptyOutput();
  const stderr = emptyOutput();
  const cap = options?.maxOutputBytes ?? Infinity;
  let isKilled = false;
  const kill = () => {
    isKilled = true;
    child.kill('SIGKILL');
    // Releases the pipe handles and stops a surviving grandchild's output
    // from growing the buffers.
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const stop = () => {
    stopWaiting();
    kill();
    reject(new Error(`Stopped ${command}`));
  };
  const timer =
    options?.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          stopWaiting();
          kill();
          resolve(collected(-1, stdout, stderr, true));
        }, options.timeoutMs);
  const stopWaiting = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  };
  signal?.addEventListener('abort', stop);
  child.stdout.on('data', (chunk: Buffer) => keep(stdout, chunk, cap));
  child.stderr.on('data', (chunk: Buffer) => keep(stderr, chunk, cap));
  child.on('error', (error: NodeJS.ErrnoException) => {
    stopWaiting();
    if (child.pid === undefined) {
      startFailed();
    }
    if (!isKilled) {
      reject(new Error(startFailureMessage(command, options?.cwd, error)));
    }
  });
  child.on('close', (code) => {
    stopWaiting();
    if (!isKilled) {
      resolve(collected(code ?? -1, stdout, stderr, false));
    }
  });
}

// The app's environment without `unsetEnv`, then with `setEnv`'s names set.
// Undefined only when both are, so the child inherits the app's environment as
// it is. On Windows names ignore case, so a name drops every key equal to it
// without case, leaving one key for the lookup and the child to agree on.
function runEnv(
  os: OsName,
  unsetEnv: readonly string[] | undefined,
  setEnv: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv | undefined {
  if (unsetEnv === undefined && setEnv === undefined) {
    return undefined;
  }
  const env = { ...process.env };
  for (const name of [...(unsetEnv ?? []), ...Object.keys(setEnv ?? {})]) {
    dropName(env, name, os);
  }
  return { ...env, ...setEnv };
}

function dropName(env: NodeJS.ProcessEnv, name: string, os: OsName): void {
  if (os !== 'windows') {
    delete env[name];
    return;
  }
  const upper = name.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper) {
      delete env[key];
    }
  }
}

// One stream's kept chunks, their byte count, and whether any byte was dropped.
interface Output {
  chunks: Buffer[];
  bytes: number;
  isCut: boolean;
}

function emptyOutput(): Output {
  return { chunks: [], bytes: 0, isCut: false };
}

// Keeps as much of `chunk` as fits under `cap` bytes.
function keep(output: Output, chunk: Buffer, cap: number): void {
  const room = Math.max(cap - output.bytes, 0);
  const kept = chunk.length <= room ? chunk : chunk.subarray(0, room);
  if (kept.length < chunk.length) {
    output.isCut = true;
  }
  if (kept.length > 0) {
    output.chunks.push(kept);
    output.bytes += kept.length;
  }
}

function collected(
  code: number,
  stdout: Output,
  stderr: Output,
  timedOut: boolean,
): ProcessResult {
  const isCut = stdout.isCut || stderr.isCut;
  return {
    code,
    stdout: Buffer.concat(stdout.chunks).toString('utf8'),
    stderr: Buffer.concat(stderr.chunks).toString('utf8'),
    timedOut,
    ...(isCut ? { truncated: true } : {}),
  };
}

// Node reports ENOENT both for a missing program and for a missing `cwd`.
function startFailureMessage(
  command: string,
  cwd: string | undefined,
  error: NodeJS.ErrnoException,
): string {
  const isMissingCwd =
    error.code === 'ENOENT' && cwd !== undefined && !existsSync(cwd);
  if (isMissingCwd) {
    return `Could not run ${command}: the folder ${cwd} does not exist`;
  }
  return `Could not run ${command}: ${error.message}`;
}
