import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type {
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
} from '../../contracts/processes';

// `ProcessRunner` through `node:child_process`, in the app's environment less
// `unsetEnv`.
// Output is collected whole unless `maxOutputBytes` caps each stream, which
// marks the result `truncated` once either is cut. A run that cannot start
// rejects naming the program, or the folder when `cwd` does not exist. Past
// `timeoutMs` the program is killed and the run resolves at once with the
// output so far; a grandchild it started is not killed. An abort of `signal`
// kills it the same way and the run rejects at once with `Stopped <command>`.
export function createNodeProcesses(): ProcessRunner {
  return { run: runToEnd };
}

function runToEnd(
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
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: envWithout(options?.unsetEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    child.on('error', (error) => {
      stopWaiting();
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
  });
}

// Undefined, the child inherits the app's environment as it is.
function envWithout(
  names: readonly string[] | undefined,
): NodeJS.ProcessEnv | undefined {
  if (names === undefined) {
    return undefined;
  }
  const env = { ...process.env };
  for (const name of names) {
    delete env[name];
  }
  return env;
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
