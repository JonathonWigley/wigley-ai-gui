import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ProcessResult, ProcessRunner } from '../../contracts/processes';

// `ProcessRunner` through `node:child_process`, in the app's environment.
// Output is collected whole, with no size cap. A run that cannot start
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
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      reject(new Error(`Stopped ${command}`));
      return;
    }
    const child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
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
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
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

function collected(
  code: number,
  stdout: Buffer[],
  stderr: Buffer[],
  timedOut: boolean,
): ProcessResult {
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    timedOut,
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
