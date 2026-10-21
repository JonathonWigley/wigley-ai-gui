import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ProcessResult, ProcessRunner } from '../../contracts/processes';

// `ProcessRunner` through `node:child_process`, in the app's environment.
// Output is collected whole, with no size cap. A run that cannot start
// rejects naming the program, or the folder when `cwd` does not exist.
export function createNodeProcesses(): ProcessRunner {
  return { run: runToEnd };
}

function runToEnd(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      reject(new Error(startFailureMessage(command, options?.cwd, error)));
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
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
